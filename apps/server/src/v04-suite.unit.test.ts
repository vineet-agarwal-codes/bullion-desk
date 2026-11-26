import { describe, expect, it } from 'vitest';
import { quantizeMcxLots } from './hedgingService.js';
import { isRtgsRemitterMatch } from './riskService.js';

describe('v0.4.0 Hedging & Compliance Unit Tests', () => {
  it('quantizes 36 kg Silver into 1 SILVER (30kg) + 1 SILVERM (5kg) with 1kg residual', () => {
    const lots = quantizeMcxLots('SILVER', 36000);
    expect(lots).toEqual([
      { contract: 'SILVER (30kg)', lots: 1, hedgedGrams: 30000, residualGrams: 6000 },
      { contract: 'SILVERM (5kg)', lots: 1, hedgedGrams: 5000, residualGrams: 1000 },
    ]);
  });

  it('quantizes 1250g Gold into 1 GOLD (1kg) + 2 GOLDM (100g)', () => {
    const lots = quantizeMcxLots('GOLD', 1250);
    expect(lots).toEqual([
      { contract: 'GOLD (1kg)', lots: 1, hedgedGrams: 1000, residualGrams: 250 },
      { contract: 'GOLDM (100g)', lots: 2, hedgedGrams: 200, residualGrams: 50 },
    ]);
  });

  it('matches legitimate RTGS remitter names and blocks mismatched third-party cyber funds', () => {
    expect(isRtgsRemitterMatch('MEHRA SONS BULLION PVT LTD', 'Mehra Sons Bullion (Kucha Mahajani)')).toBe(
      true
    );
    expect(isRtgsRemitterMatch('RANDOM FRAUD ENTERPRISES', 'Mehra Sons Bullion (Kucha Mahajani)')).toBe(
      false
    );
  });
});
