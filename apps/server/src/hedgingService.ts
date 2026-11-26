import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { McxTick, Order } from '@bullion-desk/shared';

export interface HedgeExecution {
  id: string;
  metal: 'GOLD' | 'SILVER';
  contract: string;
  side: 'BUY' | 'SELL';
  lots: number;
  grams: number;
  mcxPrice: number;
  mode: 'LIVE' | 'SHADOW';
  slippageSavedInr: number;
  createdAt: number;
}

export interface HedgeQuantizationResult {
  contract: string;
  lots: number;
  hedgedGrams: number;
  residualGrams: number;
}

/**
 * Quantizes net physical delta into standard MCX futures contracts:
 * - GOLD: GOLD (1000g) and GOLDM (100g)
 * - SILVER: SILVER (30000g / 30kg) and SILVERM (5000g / 5kg)
 */
export function quantizeMcxLots(
  metal: 'GOLD' | 'SILVER',
  netPhysicalGrams: number
): HedgeQuantizationResult[] {
  const absGrams = Math.abs(netPhysicalGrams);
  const results: HedgeQuantizationResult[] = [];

  if (metal === 'SILVER') {
    const bigLots = Math.floor(absGrams / 30000);
    let rem = absGrams - bigLots * 30000;
    if (bigLots > 0) {
      results.push({
        contract: 'SILVER (30kg)',
        lots: bigLots,
        hedgedGrams: bigLots * 30000,
        residualGrams: rem,
      });
    }
    const miniLots = Math.floor(rem / 5000);
    rem -= miniLots * 5000;
    if (miniLots > 0) {
      results.push({
        contract: 'SILVERM (5kg)',
        lots: miniLots,
        hedgedGrams: miniLots * 5000,
        residualGrams: rem,
      });
    }
    return results;
  } else {
    const bigLots = Math.floor(absGrams / 1000);
    let rem = absGrams - bigLots * 1000;
    if (bigLots > 0) {
      results.push({
        contract: 'GOLD (1kg)',
        lots: bigLots,
        hedgedGrams: bigLots * 1000,
        residualGrams: rem,
      });
    }
    const miniLots = Math.floor(rem / 100);
    rem -= miniLots * 100;
    if (miniLots > 0) {
      results.push({
        contract: 'GOLDM (100g)',
        lots: miniLots,
        hedgedGrams: miniLots * 100,
        residualGrams: rem,
      });
    }
    return results;
  }
}

export class HedgingService {
  private residualGoldGrams = 0;
  private residualSilverGrams = 0;

  constructor(private db: Database.Database) {}

  getMode(): 'LIVE' | 'SHADOW' {
    const row = this.db
      .prepare('SELECT value FROM market_settings WHERE key = ?')
      .get('hedge_mode') as { value: string } | undefined;
    return row?.value === 'SHADOW' ? 'SHADOW' : 'LIVE';
  }

  setMode(mode: 'LIVE' | 'SHADOW'): 'LIVE' | 'SHADOW' {
    this.db
      .prepare('INSERT OR REPLACE INTO market_settings (key, value) VALUES (?, ?)')
      .run('hedge_mode', mode);
    return mode;
  }

  getResiduals() {
    return {
      goldGrams: this.residualGoldGrams,
      silverGrams: this.residualSilverGrams,
    };
  }

  onOrderConfirmed(order: Order, tick: McxTick): HedgeExecution[] {
    // When client BUYS from dealer, dealer is SHORT physical -> dealer must BUY MCX to hedge
    // When client SELLS to dealer, dealer is LONG physical -> dealer must SELL MCX to hedge
    const signedGrams = order.side === 'BUY' ? order.totalGrams : -order.totalGrams;

    if (order.metal === 'GOLD') {
      this.residualGoldGrams += signedGrams;
    } else {
      this.residualSilverGrams += signedGrams;
    }

    const currentResidual =
      order.metal === 'GOLD' ? this.residualGoldGrams : this.residualSilverGrams;
    const quantized = quantizeMcxLots(order.metal, currentResidual);
    if (quantized.length === 0) return [];

    const hedgeSide: 'BUY' | 'SELL' = currentResidual > 0 ? 'BUY' : 'SELL';
    const mcxPrice = order.metal === 'GOLD' ? tick.goldMcx : tick.silverMcx;
    const mode = this.getMode();
    const created: HedgeExecution[] = [];

    let totalHedged = 0;
    for (const q of quantized) {
      totalHedged += q.hedgedGrams;
      const exec: HedgeExecution = {
        id: randomUUID(),
        metal: order.metal,
        contract: q.contract,
        side: hedgeSide,
        lots: q.lots,
        grams: q.hedgedGrams,
        mcxPrice,
        mode,
        // Estimated slippage saved vs manual 4s desk punching (~₹150/kg silver, ₹60/10g gold)
        slippageSavedInr:
          order.metal === 'SILVER'
            ? Math.round((q.hedgedGrams / 1000) * 150)
            : Math.round((q.hedgedGrams / 10) * 60),
        createdAt: Date.now(),
      };
      this.db
        .prepare(
          `INSERT INTO hedge_executions (id, metal, contract, side, lots, grams, mcx_price, mode, slippage_saved_inr, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          exec.id,
          exec.metal,
          exec.contract,
          exec.side,
          exec.lots,
          exec.grams,
          exec.mcxPrice,
          exec.mode,
          exec.slippageSavedInr,
          exec.createdAt
        );
      created.push(exec);
    }

    const sign = currentResidual > 0 ? 1 : -1;
    const newResidual = currentResidual - sign * totalHedged;
    if (order.metal === 'GOLD') {
      this.residualGoldGrams = newResidual;
    } else {
      this.residualSilverGrams = newResidual;
    }

    return created;
  }

  listExecutions(limit = 50): HedgeExecution[] {
    const rows = this.db
      .prepare('SELECT * FROM hedge_executions ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      metal: r.metal as 'GOLD' | 'SILVER',
      contract: String(r.contract),
      side: r.side as 'BUY' | 'SELL',
      lots: Number(r.lots),
      grams: Number(r.grams),
      mcxPrice: Number(r.mcx_price),
      mode: r.mode as 'LIVE' | 'SHADOW',
      slippageSavedInr: Number(r.slippage_saved_inr),
      createdAt: Number(r.created_at),
    }));
  }
}
