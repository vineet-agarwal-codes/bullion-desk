import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('WhatsApp Agents Integration (Sub-Dealer & Owner)', () => {
  let ctx: Awaited<ReturnType<typeof createApp>>;
  let adminHeaders: Record<string, string>;

  beforeEach(async () => {
    ctx = await createApp({ dbPath: ':memory:', enableFeedTimer: false });
    const login = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'admin123' },
      })
    ).json();
    adminHeaders = { Authorization: `Bearer ${login.token}` };
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('allows Sub-Dealer to check rates, place order, and confirm with HAA on WhatsApp', async () => {
    const rateRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/whatsapp/simulate',
      headers: adminHeaders,
      payload: { phone: '+919811001122', text: 'rate kya hai' },
    });
    expect(rateRes.statusCode).toBe(200);
    expect(rateRes.json().role).toBe('SUB_DEALER');
    expect(rateRes.json().reply).toContain('Live BullionDesk Rates');

    const bookRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/whatsapp/simulate',
      headers: adminHeaders,
      payload: { phone: '+919811001122', text: '2 peti chandi pakki kar do' },
    });
    expect(bookRes.statusCode).toBe(200);
    expect(bookRes.json().reply).toContain('Reply HAA within 15s');

    const confirmRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/whatsapp/simulate',
      headers: adminHeaders,
      payload: { phone: '+919811001122', text: 'HAA' },
    });
    expect(confirmRes.statusCode).toBe(200);
    expect(confirmRes.json().reply).toContain('Sauda Confirmed');

    const ledgerRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/whatsapp/simulate',
      headers: adminHeaders,
      payload: { phone: '+919811001122', text: 'mera hisab' },
    });
    expect(ledgerRes.json().reply).toContain('60.000 kg');
  });

  it('allows Owner to adjust prices and query net exposure via WhatsApp', async () => {
    const adjRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/whatsapp/simulate',
      headers: adminHeaders,
      payload: { phone: '+919999999999', text: 'Silver cash +100' },
    });
    expect(adjRes.statusCode).toBe(200);
    expect(adjRes.json().role).toBe('OWNER');
    expect(adjRes.json().reply).toContain('Owner Desk Updated');

    const scrip = ctx.market.getScrip('silver-999-cash');
    expect(scrip?.manualOffset).toBe(550);
  });

  it('rejects WhatsApp HAA confirmation if dealer changes price significantly before HAA', async () => {
    const bookRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/whatsapp/simulate',
      headers: adminHeaders,
      payload: { phone: '+919811001122', text: '2 peti chandi pakki kar do' },
    });
    expect(bookRes.json().reply).toContain('Reply HAA within 15s');

    // Dealer increases silver peti offset by +500/kg (= +15,000 per peti) before user replies HAA
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/scrips/silver-999-peti-cash',
      headers: adminHeaders,
      payload: { manualOffset: 900 },
    });

    const confirmRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/whatsapp/simulate',
      headers: adminHeaders,
      payload: { phone: '+919811001122', text: 'HAA' },
    });
    expect(confirmRes.json().reply).toContain('Rate changed');
  });
});
