import type { McxTick } from '@bullion-desk/shared';

export class McxFeedService {
  private currentTick: McxTick;
  private timer: NodeJS.Timeout | null = null;
  private listeners: Array<(tick: McxTick) => void> = [];

  constructor(initialTick?: Partial<McxTick>) {
    this.currentTick = {
      goldMcx: initialTick?.goldMcx ?? 78450,
      silverMcx: initialTick?.silverMcx ?? 94200,
      goldComex: initialTick?.goldComex ?? 2665.5,
      silverComex: initialTick?.silverComex ?? 31.42,
      usdInr: initialTick?.usdInr ?? 84.42,
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

  stepRandom(): McxTick {
    const goldDelta = Math.round((Math.random() - 0.49) * 35);
    const silverDelta = Math.round((Math.random() - 0.49) * 80);
    const comexGoldDelta = Number(((Math.random() - 0.49) * 1.4).toFixed(2));
    const comexSilverDelta = Number(((Math.random() - 0.49) * 0.05).toFixed(2));
    const usdDelta = Number(((Math.random() - 0.5) * 0.02).toFixed(2));

    return this.setTick({
      goldMcx: Math.max(50000, this.currentTick.goldMcx + goldDelta),
      silverMcx: Math.max(60000, this.currentTick.silverMcx + silverDelta),
      goldComex: Math.max(1800, Number((this.currentTick.goldComex + comexGoldDelta).toFixed(2))),
      silverComex: Math.max(18, Number((this.currentTick.silverComex + comexSilverDelta).toFixed(2))),
      usdInr: Math.max(75, Number((this.currentTick.usdInr + usdDelta).toFixed(2))),
    });
  }

  start(intervalMs = 1500) {
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
  }
}
