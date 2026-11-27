import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('Auth & RBAC Security Integration', () => {
  let ctx: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    ctx = await createApp({ dbPath: ':memory:', enableFeedTimer: false });
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('rejects unauthenticated access to protected endpoints with 401', async () => {
    const clientsRes = await ctx.app.inject({ method: 'GET', url: '/api/clients' });
    expect(clientsRes.statusCode).toBe(401);

    const ordersRes = await ctx.app.inject({ method: 'GET', url: '/api/orders' });
    expect(ordersRes.statusCode).toBe(401);
  });

  it('isolates SUB_DEALER data: only sees own client profile and own orders, and gets 403 on ADMIN routes', async () => {
    const mehraLogin = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'mehra', password: 'mehra123' },
      })
    ).json();
    const agarwalLogin = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'agarwal', password: 'agarwal123' },
      })
    ).json();

    // Mehra places an order
    await ctx.app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { Authorization: `Bearer ${mehraLogin.token}` },
      payload: {
        clientId: 'client-mehra',
        scripId: 'gold-999-rtgs',
        side: 'BUY',
        orderType: 'MARKET',
        qtyUnits: 1,
      },
    });

    // Agarwal tries to view clients -> only sees Agarwal
    const agarwalClients = (
      await ctx.app.inject({
        method: 'GET',
        url: '/api/clients',
        headers: { Authorization: `Bearer ${agarwalLogin.token}` },
      })
    ).json();
    expect(agarwalClients).toHaveLength(1);
    expect(agarwalClients[0].id).toBe('client-agarwal');

    // Agarwal tries to view orders -> cannot see Mehra's order
    const agarwalOrders = (
      await ctx.app.inject({
        method: 'GET',
        url: '/api/orders',
        headers: { Authorization: `Bearer ${agarwalLogin.token}` },
      })
    ).json();
    expect(agarwalOrders).toHaveLength(0);

    // Agarwal tries to place order as Mehra -> 403 Forbidden
    const spoofOrder = await ctx.app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { Authorization: `Bearer ${agarwalLogin.token}` },
      payload: {
        clientId: 'client-mehra',
        scripId: 'gold-999-rtgs',
        side: 'BUY',
        orderType: 'MARKET',
        qtyUnits: 1,
      },
    });
    expect(spoofOrder.statusCode).toBe(403);

    // Agarwal tries Admin Kill Switch -> 403 Forbidden
    const freezeAttempt = await ctx.app.inject({
      method: 'POST',
      url: '/api/market/freeze',
      headers: { Authorization: `Bearer ${agarwalLogin.token}` },
      payload: { isFrozen: true },
    });
    expect(freezeAttempt.statusCode).toBe(403);
  });
});
