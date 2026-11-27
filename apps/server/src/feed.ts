import type { McxTick } from '@bullion-desk/shared';

async function fetchYahooPrice(symbol: string): Promise<number> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Yahoo Finance ${symbol} HTTP ${res.status}`);
  const data = (await res.json()) as {
    chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
  };
  const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    throw new Error(`Invalid price for ${symbol}`);
  }
  return price;
}

async function fetchGrowwMcxSpot(): Promise<{ goldMcx: number; silverMcx: number }> {
  const res = await fetch('https://groww.in/commodities', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Groww commodities HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
  if (!match?.[1]) throw new Error('Groww __NEXT_DATA__ not found');

  const jsonStr = match[1];
  const goldMatch = jsonStr.match(/"symbol":"GOLD"[^}]*"spotPrice":(\d+(?:\.\d+)?)/);
  const silverMatch = jsonStr.match(/"symbol":"SILVER"[^}]*"spotPrice":(\d+(?:\.\d+)?)/);

  const goldMcx = goldMatch ? Math.round(Number(goldMatch[1])) : 0;
  const silverMcx = silverMatch ? Math.round(Number(silverMatch[1])) : 0;
  if (goldMcx <= 0 || silverMcx <= 0) {
    throw new Error('Groww MCX GOLD/SILVER spotPrice missing');
  }
  return { goldMcx, silverMcx };
}

export class McxFeedService {
  private currentTick: McxTick;
  private timer: NodeJS.Timeout | null = null;
  private liveSyncTimer: NodeJS.Timeout | null = null;
  private listeners: Array<(tick: McxTick) => void> = [];

  constructor(initialTick?: Partial<McxTick>) {
    // Realistic Nov 2026 MCX India defaults (aligned with Groww/Moneycontrol)
    this.currentTick = {
      goldMcx: initialTick?.goldMcx ?? 125299,
      silverMcx: initialTick?.silverMcx ?? 153953,
      goldComex: initialTick?.goldComex ?? 3655.8,
      silverComex: initialTick?.silverComex ?? 43.77,
      usdInr: initialTick?.usdInr ?? 92.66,
      source: initialTick?.source ?? 'SIMULATED',
      timestamp: initialTick?.timestamp ?? Date.now(),
    };
  }

  getTick(): McxTick {
    return { ...this.currentTick };
  }

  subscribe(fn: (tick: McxTick) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  setTick(patch: Partial<McxTick>): McxTick {
    this.currentTick = {
      ...this.currentTick,
      ...patch,
      timestamp: Date.now(),
    };
    for (const fn of this.listeners) {
      fn(this.currentTick);
    }
    return this.getTick();
  }

  /**
   * Fetches live MCX India Gold & Silver spot/futures rates (Groww MCX),
   * falling back to Yahoo Finance COMEX + Indian customs parity if unavailable.
   */
  async syncLiveParity(): Promise<McxTick | null> {
    try {
      const mcx = await fetchGrowwMcxSpot();
      return this.setTick({
        goldMcx: mcx.goldMcx,
        silverMcx: mcx.silverMcx,
        source: 'LIVE_MCX',
      });
    } catch {
      try {
        const [gc, si, usdInr] = await Promise.all([
          fetchYahooPrice('GC=F'),
          fetchYahooPrice('SI=F'),
          fetchYahooPrice('INR=X'),
        ]);
        const TROY_OZ_GRAMS = 31.1034768;
        const INDIA_IMPORT_PARITY = 1.06;

        const goldMcx = Math.round((gc / TROY_OZ_GRAMS) * 10 * usdInr * INDIA_IMPORT_PARITY);
        const silverMcx = Math.round((si / TROY_OZ_GRAMS) * 1000 * usdInr * INDIA_IMPORT_PARITY);

        return this.setTick({
          goldMcx,
          silverMcx,
          goldComex: Number(gc.toFixed(2)),
          silverComex: Number(si.toFixed(2)),
          usdInr: Number(usdInr.toFixed(2)),
          source: 'LIVE_PARITY',
        });
      } catch {
        return null;
      }
    }
  }

  stepRandom(): McxTick {
    const goldDelta = Math.round((Math.random() - 0.49) * 35);
    const silverDelta = Math.round((Math.random() - 0.49) * 80);

    return this.setTick({
      goldMcx: Math.max(50000, this.currentTick.goldMcx + goldDelta),
      silverMcx: Math.max(60000, this.currentTick.silverMcx + silverDelta),
    });
  }

  start(intervalMs = 2000, enableLiveFetch = true) {
    if (enableLiveFetch && !this.liveSyncTimer) {
      void this.syncLiveParity();
      this.liveSyncTimer = setInterval(() => {
        void this.syncLiveParity();
      }, 15_000);
    }
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.stepRandom();
    }, intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.liveSyncTimer) {
      clearInterval(this.liveSyncTimer);
      this.liveSyncTimer = null;
    }
  }
}
