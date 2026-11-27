import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('AI Command API Integration', () => {
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

  it('executes dealer voice command to freeze and unfreeze market via /api/ai/command', async () => {
    const freezeRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/ai/command',
      headers: adminHeaders,
      payload: { text: 'Sab rate freeze kar do', sessionId: 'dealer-1', role: 'DEALER' },
    });
    expect(freezeRes.statusCode).toBe(200);
    expect(freezeRes.json().executed).toBe(true);
    expect(ctx.market.isFrozen().isFrozen).toBe(true);

    const unfreezeRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/ai/command',
      headers: adminHeaders,
      payload: { text: 'Market chalu karo', sessionId: 'dealer-1', role: 'DEALER' },
    });
    expect(unfreezeRes.statusCode).toBe(200);
    expect(ctx.market.isFrozen().isFrozen).toBe(false);
  });
});
