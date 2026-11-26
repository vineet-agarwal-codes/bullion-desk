import { describe, expect, it } from 'vitest';
import {
  CreateOrderInputSchema,
  MarketStateSchema,
  McxTickSchema,
  WsServerMessageSchema,
} from './types.js';

describe('Shared API & WebSocket Contracts', () => {
  it('validates CreateOrderInputSchema', () => {
    const valid = CreateOrderInputSchema.parse({
      clientId: 'client-1',
      scripId: 'gold-999-rtgs',
      side: 'BUY',
      orderType: 'MARKET',
      qtyUnits: 2,
    });
    expect(valid.source).toBe('WEB');

    expect(() =>
      CreateOrderInputSchema.parse({
        clientId: 'client-1',
        scripId: 'gold-999-rtgs',
        side: 'BUY',
        orderType: 'MARKET',
        qtyUnits: -5,
      })
    ).toThrow();
  });

  it('validates WsServerMessageSchema MARKET_SNAPSHOT contract', () => {
    const tick = McxTickSchema.parse({
      goldMcx: 78500,
      silverMcx: 94200,
      goldComex: 2660,
      silverComex: 31.5,
      usdInr: 84.4,
      timestamp: Date.now(),
    });
    const state = MarketStateSchema.parse({
      isFrozen: false,
      freezeReason: null,
      tick,
      quotes: [],
    });
    const msg = WsServerMessageSchema.parse({
      type: 'MARKET_SNAPSHOT',
      payload: state,
    });
    expect(msg.type).toBe('MARKET_SNAPSHOT');
  });
});
