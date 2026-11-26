import { describe, expect, it } from 'vitest';
import { calculateOrderFinancials, calculateScripQuote } from './pricing.js';
import type { McxTick, ScripConfig } from './types.js';

const sampleTick: McxTick = {
  goldMcx: 78000,
  silverMcx: 94000,
  goldComex: 2650,
  silverComex: 31.2,
  usdInr: 84.4,
  timestamp: 1700000000000,
};

const gold999Rtgs: ScripConfig = {
  id: 'gold-999-rtgs',
  code: 'GOLD_999_RTGS',
  name: 'Gold 999 RTGS (10g)',
  metal: 'GOLD',
  purity: 999,
  settlement: 'RTGS',
  unit: '10G',
  unitGrams: 10,
  manualOffset: 250,
  bidSpread: 100,
  purityDiscount: 0,
  gstPercent: 3,
  isActive: true,
  minQty: 1,
  maxQty: 100,
};

const gold995Cash: ScripConfig = {
  ...gold999Rtgs,
  id: 'gold-995-cash',
  code: 'GOLD_995_CASH',
  name: 'Gold 995 Cash (10g)',
  purity: 995,
  settlement: 'CASH',
  manualOffset: 100,
  bidSpread: 150,
  purityDiscount: 350,
  gstPercent: 0,
};

const silverPetiCash: ScripConfig = {
  id: 'silver-999-peti-cash',
  code: 'SILVER_999_PETI_CASH',
  name: 'Silver 999 Peti Cash (30kg)',
  metal: 'SILVER',
  purity: 999,
  settlement: 'CASH',
  unit: '30KG_PETI',
  unitGrams: 30000,
  manualOffset: 500,
  bidSpread: 400,
  purityDiscount: 0,
  gstPercent: 0,
  isActive: true,
  minQty: 1,
  maxQty: 10,
};

describe('calculateScripQuote', () => {
  it('computes distinct buyRate and sellRate for Gold 999 RTGS', () => {
    const quote = calculateScripQuote(sampleTick, gold999Rtgs, 'GROUP_B', false);
    expect(quote.sellRate).toBe(78250);
    expect(quote.buyRate).toBe(78150);
    expect(quote.gstPercent).toBe(3);
    expect(quote.isFrozen).toBe(false);
  });

  it('applies purityDiscount for Gold 995 Cash', () => {
    const quote = calculateScripQuote(sampleTick, gold995Cash, 'GROUP_B', false);
    // 78000 - 350 + 100 = 77750 sell, 77750 - 150 = 77600 buy
    expect(quote.sellRate).toBe(77750);
    expect(quote.buyRate).toBe(77600);
    expect(quote.gstPercent).toBe(0);
  });

  it('scales unitGrams properly for 30kg Silver Peti', () => {
    const quote = calculateScripQuote(sampleTick, silverPetiCash, 'GROUP_B', false);
    // 1kg = 94000 + 500 = 94500; 30kg = 2,835,000 sell; spread 400*30=12000 -> buy 2,823,000
    expect(quote.sellRate).toBe(2835000);
    expect(quote.buyRate).toBe(2823000);
  });

  it('adjusts spread by client group (GROUP_A tighter, PUBLIC wider)', () => {
    const vip = calculateScripQuote(sampleTick, gold999Rtgs, 'GROUP_A', false);
    const pub = calculateScripQuote(sampleTick, gold999Rtgs, 'PUBLIC', false);
    expect(vip.sellRate).toBe(78200);
    expect(pub.sellRate).toBe(78400);
  });

  it('marks quote as frozen when Kill Switch is active', () => {
    const quote = calculateScripQuote(sampleTick, gold999Rtgs, 'GROUP_B', true);
    expect(quote.isFrozen).toBe(true);
  });
});

describe('calculateOrderFinancials', () => {
  it('adds 3% GST for RTGS orders', () => {
    const res = calculateOrderFinancials(2, 78250, 3);
    expect(res.subtotalInr).toBe(156500);
    expect(res.gstAmount).toBe(4695);
    expect(res.totalInr).toBe(161195);
  });

  it('charges 0 GST for CASH orders', () => {
    const res = calculateOrderFinancials(2, 77750, 0);
    expect(res.subtotalInr).toBe(155500);
    expect(res.gstAmount).toBe(0);
    expect(res.totalInr).toBe(155500);
  });
});
