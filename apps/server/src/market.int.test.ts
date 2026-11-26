import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('MarketService & API Integration', () => {
  let ctx: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    ctx = await createApp({ dbPath: ':memory:', enableFeedTimer: false });
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('lists all seeded Gold (100%, 999, 995) and Silver scrips across RTGS and Cash', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/scrips' });
    expect(res.statusCode).toBe(200);
    const scrips = res.json();
    expect(scrips.length).toBeGreaterThanOrEqual(8);
    expect(scrips.some((s: { code: string }) => s.code === 'GOLD_24K_100_RTGS')).toBe(true);
    expect(scrips.some((s: { code: string }) => s.code === 'GOLD_995_CASH')).toBe(true);
    expect(scrips.some((s: { code: string }) => s.code === 'SILVER_999_PETI_CASH')).toBe(true);
  });

  it('updates scrip offset and reflects immediately in market quotes', async () => {
    const before = (await ctx.app.inject({ method: 'GET', url: '/api/market?group=GROUP_B' })).json();
    const goldBefore = before.quotes.find((q: { scripId: string }) => q.scripId === 'gold-999-rtgs');

    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/scrips/gold-999-rtgs',
      payload: { manualOffset: 450 },
    });
    expect(patchRes.statusCode).toBe(200);

    const after = (await ctx.app.inject({ method: 'GET', url: '/api/market?group=GROUP_B' })).json();
    const goldAfter = after.quotes.find((q: { scripId: string }) => q.scripId === 'gold-999-rtgs');
    expect(goldAfter.sellRate - goldBefore.sellRate).toBe(200);
  });

  it('enforces Kill Switch (Market Freeze) and rejects new orders', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/market/freeze',
      payload: { isFrozen: true, reason: 'Fed Announcement Volatility' },
    });

    const orderRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/orders',
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
    expect(created.status).toBe('PENDING_CONFIRM');

    const confirmRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/orders/${created.id}/confirm`,
    });
    expect(confirmRes.statusCode).toBe(200);
    const confirmed = confirmRes.json();
    expect(confirmed.status).toBe('CONFIRMED');

    const clients = (await ctx.app.inject({ method: 'GET', url: '/api/clients' })).json();
    const mehra = clients.find((c: { id: string }) => c.id === 'client-mehra');
    expect(mehra.metalBalanceGoldGrams).toBe(20);
    expect(mehra.cashBalanceInr).toBe(2500000 - confirmed.totalInr);

    const positions = (await ctx.app.inject({ method: 'GET', url: '/api/positions' })).json();
    expect(positions.length).toBe(1);
    expect(positions[0].buyGrams).toBe(20);
  });

  it('auto-fills PENDING_LIMIT orders when MCX tick reaches target price', async () => {
    // Current silver MCX is 94200, silver-999-cash offset is +450 -> sellRate 94650 (GROUP_B)
    // Place LIMIT BUY at 94000 for client-sharma (GROUP_B)
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        clientId: 'client-sharma',
        scripId: 'silver-999-cash',
        side: 'BUY',
        orderType: 'LIMIT',
        qtyUnits: 5,
        limitRate: 94000,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const order = createRes.json();
    expect(order.status).toBe('PENDING_LIMIT');

    // Drop MCX silver to 93500 -> sellRate becomes 93950 <= 94000
    await ctx.app.inject({
      method: 'POST',
      url: '/api/market/tick',
      payload: { silverMcx: 93500 },
    });

    const orders = (await ctx.app.inject({ method: 'GET', url: '/api/orders' })).json();
    const updated = orders.find((o: { id: string }) => o.id === order.id);
    expect(updated.status).toBe('CONFIRMED');
    expect(updated.quotedRate).toBe(93950);
  });
});
