import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('MCP Tools Registry & RBAC Execution', () => {
  let ctx: Awaited<ReturnType<typeof createApp>>;
  let adminToken: string;
  let subDealerToken: string;

  beforeEach(async () => {
    ctx = await createApp({ dbPath: ':memory:', enableFeedTimer: false });
    adminToken = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'admin123' },
      })
    ).json().token;
    subDealerToken = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'mehra', password: 'mehra123' },
      })
    ).json().token;
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('lists role-appropriate MCP tools and blocks SUB_DEALER from admin MCP tools', async () => {
    const subTools = (
      await ctx.app.inject({
        method: 'GET',
        url: '/api/mcp/tools',
        headers: { Authorization: `Bearer ${subDealerToken}` },
      })
    ).json();
    expect(subTools.some((t: { name: string }) => t.name === 'place_order')).toBe(true);
    expect(subTools.some((t: { name: string }) => t.name === 'toggle_market_freeze')).toBe(false);

    const forbidden = await ctx.app.inject({
      method: 'POST',
      url: '/api/mcp/call',
      headers: { Authorization: `Bearer ${subDealerToken}` },
      payload: { name: 'toggle_market_freeze', arguments: { isFrozen: true } },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('executes get_live_rates and place_order via MCP tool call', async () => {
    const ratesRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/mcp/call',
      headers: { Authorization: `Bearer ${subDealerToken}` },
      payload: { name: 'get_live_rates', arguments: { metal: 'SILVER', settlement: 'CASH' } },
    });
    expect(ratesRes.statusCode).toBe(200);
    expect(ratesRes.json().ok).toBe(true);

    const orderRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/mcp/call',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'place_order',
        arguments: {
          clientId: 'client-mehra',
          scripId: 'silver-999-peti-cash',
          side: 'BUY',
          qtyUnits: 1.5,
        },
      },
    });
    expect(orderRes.statusCode).toBe(200);
    expect(orderRes.json().result.totalGrams).toBe(45000);
  });
});
