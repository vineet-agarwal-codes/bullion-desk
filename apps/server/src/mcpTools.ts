import { z } from 'zod';
import type { AuthUser } from '@bullion-desk/shared';
import type { MarketService } from './marketService.js';

export interface McpToolDefinition {
  name: string;
  description: string;
  allowedRoles: Array<'ADMIN' | 'SUB_DEALER'>;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'get_live_rates',
    description: 'Fetch live Buy (Bid) and Sell (Ask) rates for Gold and Silver scrips.',
    allowedRoles: ['ADMIN', 'SUB_DEALER'],
    inputSchema: {
      type: 'object',
      properties: {
        metal: { type: 'string', enum: ['GOLD', 'SILVER'] },
        settlement: { type: 'string', enum: ['RTGS', 'CASH'] },
      },
    },
  },
  {
    name: 'place_order',
    description: 'Place a Gold or Silver Buy/Sell order (Market or Limit) for a sub-dealer.',
    allowedRoles: ['ADMIN', 'SUB_DEALER'],
    inputSchema: {
      type: 'object',
      properties: {
        scripId: { type: 'string' },
        side: { type: 'string', enum: ['BUY', 'SELL'] },
        orderType: { type: 'string', enum: ['MARKET', 'LIMIT'] },
        qtyUnits: { type: 'number' },
        limitRate: { type: 'number' },
      },
      required: ['scripId', 'side', 'qtyUnits'],
    },
  },
  {
    name: 'get_client_ledger',
    description: 'Fetch dual ledger (Cash INR, Fine Gold g, Fine Silver kg) for the sub-dealer.',
    allowedRoles: ['ADMIN', 'SUB_DEALER'],
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'adjust_scrip_offset',
    description: 'Admin only: Adjust manual offset (+/- INR) on one or more scrips.',
    allowedRoles: ['ADMIN'],
    inputSchema: {
      type: 'object',
      properties: {
        scripIds: { type: 'array', items: { type: 'string' } },
        delta: { type: 'number' },
      },
      required: ['scripIds', 'delta'],
    },
  },
  {
    name: 'set_scrip_spread',
    description: 'Admin only: Set Bid-Ask spread (INR) on one or more scrips.',
    allowedRoles: ['ADMIN'],
    inputSchema: {
      type: 'object',
      properties: {
        scripIds: { type: 'array', items: { type: 'string' } },
        bidSpread: { type: 'number' },
      },
      required: ['scripIds', 'bidSpread'],
    },
  },
  {
    name: 'toggle_market_freeze',
    description: 'Admin only: Activate or deactivate the Kill Switch (Freeze/Unfreeze all rates).',
    allowedRoles: ['ADMIN'],
    inputSchema: {
      type: 'object',
      properties: {
        isFrozen: { type: 'boolean' },
        reason: { type: 'string' },
      },
      required: ['isFrozen'],
    },
  },
  {
    name: 'get_net_positions',
    description: 'Admin only: Get net open physical exposure (Bhaav Book) across Gold and Silver.',
    allowedRoles: ['ADMIN'],
    inputSchema: { type: 'object', properties: {} },
  },
];

export function executeMcpTool(
  market: MarketService,
  toolName: string,
  rawArgs: Record<string, unknown>,
  user: Pick<AuthUser, 'role' | 'clientId' | 'clientGroup'>,
  source: 'WEB' | 'WHATSAPP' | 'VOICE' = 'VOICE'
): { ok: boolean; result: unknown } {
  const def = MCP_TOOLS.find((t) => t.name === toolName);
  if (!def) {
    throw new Error(`Unknown MCP tool: ${toolName}`);
  }
  if (!def.allowedRoles.includes(user.role)) {
    throw new Error(`Forbidden: Role ${user.role} cannot invoke MCP tool ${toolName}`);
  }

  switch (toolName) {
    case 'get_live_rates': {
      const args = z
        .object({
          metal: z.enum(['GOLD', 'SILVER']).optional(),
          settlement: z.enum(['RTGS', 'CASH']).optional(),
        })
        .parse(rawArgs);
      const state = market.getMarketState(user.clientGroup ?? 'GROUP_B');
      let quotes = state.quotes.filter((q) => q.isActive);
      if (args.metal) quotes = quotes.filter((q) => q.metal === args.metal);
      if (args.settlement) quotes = quotes.filter((q) => q.settlement === args.settlement);
      return { ok: true, result: { isFrozen: state.isFrozen, tick: state.tick, quotes } };
    }

    case 'place_order': {
      const args = z
        .object({
          scripId: z.string().min(1),
          side: z.enum(['BUY', 'SELL']),
          orderType: z.enum(['MARKET', 'LIMIT']).default('MARKET'),
          qtyUnits: z.number().positive(),
          limitRate: z.number().positive().optional(),
          clientId: z.string().optional(),
        })
        .parse(rawArgs);

      const targetClientId =
        user.role === 'ADMIN' ? (args.clientId ?? user.clientId ?? 'client-mehra') : user.clientId;
      if (!targetClientId) {
        throw new Error('No clientId associated with user for place_order');
      }
      const order = market.createOrder({
        clientId: targetClientId,
        scripId: args.scripId,
        side: args.side,
        orderType: args.orderType,
        qtyUnits: args.qtyUnits,
        limitRate: args.limitRate,
        source,
      });
      return { ok: true, result: order };
    }

    case 'get_client_ledger': {
      const targetClientId = user.clientId ?? 'client-mehra';
      const client = market.getClient(targetClientId);
      if (!client) throw new Error('Client not found');
      return { ok: true, result: client };
    }

    case 'adjust_scrip_offset': {
      const args = z
        .object({
          scripIds: z.array(z.string()).min(1),
          delta: z.number(),
        })
        .parse(rawArgs);
      const updated = args.scripIds.map((id) => {
        const s = market.getScrip(id);
        if (!s) throw new Error(`Scrip ${id} not found`);
        return market.updateScrip(id, { manualOffset: s.manualOffset + args.delta });
      });
      return { ok: true, result: updated };
    }

    case 'set_scrip_spread': {
      const args = z
        .object({
          scripIds: z.array(z.string()).min(1),
          bidSpread: z.number().nonnegative(),
        })
        .parse(rawArgs);
      const updated = args.scripIds.map((id) => market.updateScrip(id, { bidSpread: args.bidSpread }));
      return { ok: true, result: updated };
    }

    case 'toggle_market_freeze': {
      const args = z
        .object({
          isFrozen: z.boolean(),
          reason: z.string().optional(),
        })
        .parse(rawArgs);
      return { ok: true, result: market.setFreeze(args.isFrozen, args.reason ?? 'MCP Tool Freeze') };
    }

    case 'get_net_positions': {
      return { ok: true, result: market.getPositionSummary() };
    }

    default:
      throw new Error(`Unhandled MCP tool: ${toolName}`);
  }
}
