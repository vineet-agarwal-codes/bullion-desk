import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('v0.4.0 Auto-Hedging, Badla MTM Risk & RTGS Fraud Shield Integration', () => {
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

  it('auto-triggers MCX hedge execution when a 30kg Silver Peti order is confirmed', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: adminHeaders,
      payload: {
        clientId: 'client-agarwal',
        scripId: 'silver-999-peti-cash',
        side: 'BUY',
        orderType: 'MARKET',
        qtyUnits: 1,
      },
    });
    const order = createRes.json();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/confirm`,
      headers: adminHeaders,
    });

    const hedgeRes = await ctx.app.inject({ method: 'GET', url: '/api/hedging', headers: adminHeaders });
    const hedgeData = hedgeRes.json();
    expect(hedgeData.executions.length).toBe(1);
    expect(hedgeData.executions[0].contract).toBe('SILVER (30kg)');
    expect(hedgeData.executions[0].side).toBe('BUY');
    expect(hedgeData.executions[0].lots).toBe(1);
  });

  it('tracks Badla unfixed metal MTM loss, flags MARGIN_CALL on MCX spike, and supports 1-click liquidation', async () => {
    const posRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/risk/unfixed',
      headers: adminHeaders,
      payload: {
        clientId: 'client-sharma',
        metal: 'SILVER',
        grams: 50000, // 50 kg
        entryRatePerUnit: 138200,
        marginDepositedInr: 200000, // ₹2L margin
      },
    });
    expect(posRes.statusCode).toBe(201);

    // Spike Silver MCX by +₹3,800 -> MTM loss = 50 * 3800 = ₹1,90,000 (95% of ₹2L margin -> MARGIN_CALL)
    await ctx.app.inject({
      method: 'POST',
      url: '/api/market/tick',
      headers: adminHeaders,
      payload: { silverMcx: 142000 },
    });

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/risk/unfixed',
      headers: adminHeaders,
    });
    const pos = listRes.json()[0];
    expect(pos.riskStatus).toBe('MARGIN_CALL');
    expect(pos.marginUtilizationPct).toBe(95);

    const liqRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/risk/unfixed/${pos.id}/liquidate`,
      headers: adminHeaders,
    });
    expect(liqRes.json().status).toBe('LIQUIDATED');
  });

  it('blocks mismatched RTGS remitter and issues Vault Delivery Token + e-Way Bill for verified RTGS', async () => {
    const blocked = await ctx.app.inject({
      method: 'POST',
      url: '/api/compliance/rtgs/verify',
      headers: adminHeaders,
      payload: {
        clientId: 'client-mehra',
        remitterName: 'XYZ SHELL TRADING CO',
        amountInr: 2500000,
        utrNumber: 'HDFC12345678',
      },
    });
    expect(blocked.json().status).toBe('BLOCKED_NAME_MISMATCH');
    expect(blocked.json().deliveryToken).toBeNull();

    const verified = await ctx.app.inject({
      method: 'POST',
      url: '/api/compliance/rtgs/verify',
      headers: adminHeaders,
      payload: {
        clientId: 'client-mehra',
        remitterName: 'MEHRA SONS BULLION',
        amountInr: 2500000,
        utrNumber: 'HDFC87654321',
        barSerial: 'MMTC-999-A402',
        measuredGrams: 1000.02,
      },
    });
    expect(verified.json().status).toBe('VERIFIED');
    expect(verified.json().deliveryToken).toMatch(/^BD-DEL-/);
    expect(verified.json().ewayBillNo).toMatch(/^EWB-/);
  });
});
