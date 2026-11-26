import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('WhatsApp Cloud API Webhook Contract', () => {
  let ctx: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    ctx = await createApp({ dbPath: ':memory:', enableFeedTimer: false });
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('verifies Meta webhook challenge on GET /api/whatsapp/webhook', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=bullion-desk-verify&hub.challenge=123456',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('123456');
  });

  it('processes Meta Cloud API POST webhook payload', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/whatsapp/webhook',
      payload: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ from: '919811001122', text: { body: 'rate kya hai' } }],
                },
              },
            ],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.replies[0].role).toBe('SUB_DEALER');
  });
});
