import type { ClientGroup, McxTick, ScripConfig, ScripQuote } from './types.js';

export const GROUP_SPREAD_ADJUSTMENT: Record<ClientGroup, number> = {
  GROUP_A: -50, // VIP wholesale buyers get tighter spread
  GROUP_B: 0,   // Standard sub-dealers
  PUBLIC: 150,  // Unregistered / public view sees wider spread
};

/**
 * Calculates live Bid (dealer buy) and Ask (dealer sell) rates for a bullion scrip.
 *
 * Indian Bullion Convention:
 * - sellRate (Ask): Rate at which the bullion house SELLS physical metal to the sub-dealer.
 * - buyRate (Bid): Rate at which the bullion house BUYS physical metal back from the sub-dealer.
 * - Gold MCX is quoted per 10g; Silver MCX is quoted per 1kg.
 */
export function calculateScripQuote(
  tick: McxTick,
  scrip: ScripConfig,
  clientGroup: ClientGroup = 'GROUP_B',
  isFrozen: boolean = false
): ScripQuote {
  const mcxBase = scrip.metal === 'GOLD' ? tick.goldMcx : tick.silverMcx;
  const groupAdj = GROUP_SPREAD_ADJUSTMENT[clientGroup];

  // Scale MCX base if unit is different from standard MCX quote unit
  // Gold MCX = 10g, Silver MCX = 1000g (1kg)
  const standardMcxGrams = scrip.metal === 'GOLD' ? 10 : 1000;
  const unitScale = scrip.unitGrams / standardMcxGrams;

  const scaledBase = mcxBase * unitScale;
  const scaledPurityDiscount = scrip.purityDiscount * unitScale;
  const scaledOffset = (scrip.manualOffset + groupAdj) * unitScale;
  const scaledBidSpread = scrip.bidSpread * unitScale;

  // For 100% pure (24K 1000), if purity > 999, small fineness adjustment or pure base
  const finenessFactor = scrip.purity === 1000 ? 1.001 : 1.0;

  const sellRate = Math.round(scaledBase * finenessFactor - scaledPurityDiscount + scaledOffset);
  const buyRate = Math.round(sellRate - scaledBidSpread);

  return {
    scripId: scrip.id,
    code: scrip.code,
    name: scrip.name,
    metal: scrip.metal,
    purity: scrip.purity,
    settlement: scrip.settlement,
    unit: scrip.unit,
    unitGrams: scrip.unitGrams,
    mcxBase: Math.round(scaledBase),
    buyRate,
    sellRate,
    gstPercent: scrip.gstPercent,
    isFrozen,
    isActive: scrip.isActive,
    timestamp: tick.timestamp,
  };
}

/**
 * Computes total INR value including GST (for RTGS) or 0 GST (for CASH).
 */
export function calculateOrderFinancials(
  qtyUnits: number,
  ratePerUnit: number,
  gstPercent: number
): { subtotalInr: number; gstAmount: number; totalInr: number } {
  const subtotalInr = Math.round(qtyUnits * ratePerUnit);
  const gstAmount = Math.round(subtotalInr * (gstPercent / 100));
  const totalInr = subtotalInr + gstAmount;
  return { subtotalInr, gstAmount, totalInr };
}
