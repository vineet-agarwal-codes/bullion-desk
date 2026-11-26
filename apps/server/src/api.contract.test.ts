import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarketStateSchema, OrderSchema } from '@bullion-desk/shared';
import { createApp } from './app.js';

describe('Server API Response Contracts', () => {
  let ctx: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    ctx = await createApp({ dbPath: ':memory:', enableFeedTimer: false });
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('GET /api/market conforms to MarketStateSchema', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/market' });
    expect(res.statusCode).toBe(200);
    expect(() => MarketStateSchema.parse(res.json())).not.toThrow();
  });

  it('POST /api/orders conforms to OrderSchema', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        clientId: 'client-agarwal',
        scripId: 'silver-999-rtgs',
        side: 'BUY',
        orderType: 'MARKET',
        qtyUnits: 2,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(() => OrderSchema.parse(res.json())).not.toThrow();
  });
});
