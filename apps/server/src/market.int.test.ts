import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('MarketService & API Integration', () => {
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

  it('lists all seeded Gold (100%, 999, 995) and Silver scrips across RTGS and Cash', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/scrips', headers: adminHeaders });
    expect(res.statusCode).toBe(200);
    const scrips = res.json();
    expect(scrips.length).toBeGreaterThanOrEqual(8);
    expect(scrips.some((s: { code: string }) => s.code === 'GOLD_24K_100_RTGS')).toBe(true);
    expect(scrips.some((s: { code: string }) => s.code === 'GOLD_995_CASH')).toBe(true);
    expect(scrips.some((s: { code: string }) => s.code === 'SILVER_999_PETI_CASH')).toBe(true);
  });

  it('updates scrip offset and reflects immediately in market quotes', async () => {
    const before = (
      await ctx.app.inject({ method: 'GET', url: '/api/market?group=GROUP_B', headers: adminHeaders })
    ).json();
    const goldBefore = before.quotes.find((q: { scripId: string }) => q.scripId === 'gold-999-rtgs');

    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/scrips/gold-999-rtgs',
      headers: adminHeaders,
      payload: { manualOffset: 450 },
    });
    expect(patchRes.statusCode).toBe(200);

    const after = (
      await ctx.app.inject({ method: 'GET', url: '/api/market?group=GROUP_B', headers: adminHeaders })
    ).json();
    const goldAfter = after.quotes.find((q: { scripId: string }) => q.scripId === 'gold-999-rtgs');
    expect(goldAfter.sellRate - goldBefore.sellRate).toBe(200);
  });

  it('enforces Kill Switch (Market Freeze) and rejects new orders', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/market/freeze',
      headers: adminHeaders,
      payload: { isFrozen: true, reason: 'Fed Announcement Volatility' },
    });

    const orderRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: adminHeaders,
      payload: {
        clientId: 'client-mehra',
        scripId: 'gold-999-rtgs',
        side: 'BUY',
        orderType: 'MARKET',
        qtyUnits: 2,
      },
    });
    expect(orderRes.statusCode).toBe(400);
    expect(orderRes.json().error).toContain('frozen');
  });

  it('creates a Market Order, confirms it, and updates client dual ledger + position summary', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: adminHeaders,
      payload: {
        clientId: 'client-mehra',
        scripId: 'gold-999-rtgs',
        side: 'BUY',
        orderType: 'MARKET',
        qtyUnits: 2,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.status).toBe('PROCESSING');

    const confirmRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/orders/${created.id}/confirm`,
      headers: adminHeaders,
    });
    expect(confirmRes.statusCode).toBe(200);
    const confirmed = confirmRes.json();
    expect(confirmed.status).toBe('CONFIRMED');

    const clients = (
      await ctx.app.inject({ method: 'GET', url: '/api/clients', headers: adminHeaders })
    ).json();
    const mehra = clients.find((c: { id: string }) => c.id === 'client-mehra');
    expect(mehra.metalBalanceGoldGrams).toBe(20);
    expect(mehra.cashBalanceInr).toBe(2500000 - confirmed.totalInr);

    const positions = (
      await ctx.app.inject({ method: 'GET', url: '/api/positions', headers: adminHeaders })
    ).json();
    expect(positions.length).toBe(1);
    expect(positions[0].buyGrams).toBe(20);
  });

  it('auto-fills PENDING_LIMIT orders when MCX tick reaches target price', async () => {
    // Current silver MCX is 153953, silver-999-cash offset is +450 -> sellRate 154403 (GROUP_B)
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: adminHeaders,
      payload: {
        clientId: 'client-sharma',
        scripId: 'silver-999-cash',
        side: 'BUY',
        orderType: 'LIMIT',
        qtyUnits: 5,
        limitRate: 153000,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const order = createRes.json();
    expect(order.status).toBe('PENDING_LIMIT');

    // Drop MCX silver to 152500 -> sellRate becomes 152950 <= 153000
    await ctx.app.inject({
      method: 'POST',
      url: '/api/market/tick',
      headers: adminHeaders,
      payload: { silverMcx: 152500 },
    });

    const orders = (
      await ctx.app.inject({ method: 'GET', url: '/api/orders', headers: adminHeaders })
    ).json();
    const updated = orders.find((o: { id: string }) => o.id === order.id);
    expect(updated.status).toBe('CONFIRMED');
    expect(updated.quotedRate).toBe(153000);
  });

  it('rejects order with stale expectedRate when dealer changes price concurrently (race condition guard)', async () => {
    // Market rate for gold-999-rtgs is ~115700. Dealer increases offset by +500
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/scrips/gold-999-rtgs',
      headers: adminHeaders,
      payload: { manualOffset: 750 },
    });

    const staleRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: adminHeaders,
      payload: {
        clientId: 'client-mehra',
        scripId: 'gold-999-rtgs',
        side: 'BUY',
        orderType: 'MARKET',
        qtyUnits: 1,
        expectedRate: 115700,
      },
    });
    expect(staleRes.statusCode).toBe(400);
    expect(staleRes.json().error).toContain('Rate changed');
  });
});
