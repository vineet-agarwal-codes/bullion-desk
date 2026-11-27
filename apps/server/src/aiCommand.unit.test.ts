import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase } from './db.js';
import { McxFeedService } from './feed.js';
import { MarketService } from './marketService.js';
import { AiCommandService } from './aiCommandService.js';

describe('AiCommandService Unit Tests (Hinglish & Context)', () => {
  let db: ReturnType<typeof initDatabase>;
  let ai: AiCommandService;

  beforeEach(() => {
    db = initDatabase(':memory:');
    const feed = new McxFeedService();
    const market = new MarketService(db, feed);
    ai = new AiCommandService(market);
  });

  afterEach(() => {
    db.close();
  });

  it('parses Hinglish dealer price increase and resolves ambiguous follow-up via context', () => {
    const r1 = ai.executeCommand('Bhaiya silver cash sau rupaye badha do', 'sess-1', {
      role: 'DEALER',
    });
    expect(r1.executed).toBe(true);
    expect(r1.parsed.intent).toBe('ADJUST_OFFSET');
    expect(r1.parsed.delta).toBe(100);
    expect(r1.updatedScrips?.[0].id).toBe('silver-999-cash');
    expect(r1.updatedScrips?.[0].manualOffset).toBe(550); // 450 + 100

    // Ambiguous follow-up without metal or settlement!
    const r2 = ai.executeCommand('Aur pachas kam kar do', 'sess-1', {
      role: 'DEALER',
    });
    expect(r2.executed).toBe(true);
    expect(r2.parsed.usedContext).toBe(true);
    expect(r2.parsed.delta).toBe(-50);
    expect(r2.updatedScrips?.[0].id).toBe('silver-999-cash');
    expect(r2.updatedScrips?.[0].manualOffset).toBe(500);
  });

  it('parses Gold 995 RTGS spread adjustment', () => {
    const r = ai.executeCommand('Gold 995 RTGS ka spread 200 kar do', 'sess-2', {
      role: 'DEALER',
    });
    expect(r.executed).toBe(true);
    expect(r.parsed.intent).toBe('SET_SPREAD');
    expect(r.updatedScrips?.[0].id).toBe('gold-995-rtgs');
    expect(r.updatedScrips?.[0].bidSpread).toBe(200);
  });

  it('parses sub-dealer Hinglish peti order ("do peti chandi pakki kar do")', () => {
    const r = ai.executeCommand('do peti chandi pakki kar do', 'sess-client-1', {
      role: 'CLIENT',
      clientId: 'client-agarwal',
    });
    expect(r.executed).toBe(true);
    expect(r.order).toBeDefined();
    expect(r.order?.scripId).toBe('silver-999-peti-cash');
    expect(r.order?.qtyUnits).toBe(2);
    expect(r.order?.totalGrams).toBe(60000); // 2 * 30kg
    expect(r.order?.source).toBe('VOICE');
  });

  it('parses "Dus peti chandi pakki kar do" and Devanagari Hindi "दस पेटी चांदी पक्की कर दो"', () => {
    const r1 = ai.parseCommand('Dus peti chandi pakki kar do', 'sess-dus', 'CLIENT');
    expect(r1.intent).toBe('PLACE_ORDER');
    expect(r1.qtyUnits).toBe(10);
    expect(r1.targetScripIds[0]).toBe('silver-999-peti-cash');

    const r2 = ai.parseCommand('दस पेटी चांदी पक्की कर दो', 'sess-dev', 'CLIENT');
    expect(r2.intent).toBe('PLACE_ORDER');
    expect(r2.qtyUnits).toBe(10);
    expect(r2.targetScripIds[0]).toBe('silver-999-peti-cash');
  });
});
