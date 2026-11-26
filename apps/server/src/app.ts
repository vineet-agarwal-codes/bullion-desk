import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import {
  ClientGroupSchema,
  CreateOrderInputSchema,
  type WsServerMessage,
} from '@bullion-desk/shared';
import { z } from 'zod';
import { initDatabase } from './db.js';
import { McxFeedService } from './feed.js';
import { MarketService } from './marketService.js';

export interface AppOptions {
  dbPath?: string;
  enableFeedTimer?: boolean;
  feedIntervalMs?: number;
}

export async function createApp(options: AppOptions = {}): Promise<{
  app: FastifyInstance;
  db: Database.Database;
  feed: McxFeedService;
  market: MarketService;
}> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const db = initDatabase(options.dbPath ?? './bullion-desk.db');
  const feed = new McxFeedService();
  const market = new MarketService(db, feed);

  const wsClients = new Set<{ socket: { send: (data: string) => void; readyState: number }; group: 'GROUP_A' | 'GROUP_B' | 'PUBLIC' }>();

  const broadcastMarket = () => {
    for (const client of wsClients) {
      if (client.socket.readyState === 1) {
        const msg: WsServerMessage = {
          type: 'MARKET_SNAPSHOT',
          payload: market.getMarketState(client.group),
        };
        client.socket.send(JSON.stringify(msg));
      }
    }
  };

  feed.subscribe((tick) => {
    market.processTick(tick);
    broadcastMarket();
  });

  market.subscribeOrders((order) => {
    const msg: WsServerMessage = {
      type: 'ORDER_EVENT',
      payload: order,
    };
    const raw = JSON.stringify(msg);
    for (const client of wsClients) {
      if (client.socket.readyState === 1) {
        client.socket.send(raw);
      }
    }
  });

  if (options.enableFeedTimer !== false) {
    feed.start(options.feedIntervalMs ?? 1500);
  }

  app.get('/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  app.get('/ws', { websocket: true }, (socket, req) => {
    const query = req.query as { group?: string };
    const parsedGroup = ClientGroupSchema.safeParse(query.group ?? 'GROUP_B');
    const group = parsedGroup.success ? parsedGroup.data : 'GROUP_B';

    const entry = { socket, group };
    wsClients.add(entry);

    const snapshot: WsServerMessage = {
      type: 'MARKET_SNAPSHOT',
      payload: market.getMarketState(group),
    };
    socket.send(JSON.stringify(snapshot));

    socket.on('close', () => {
      wsClients.delete(entry);
    });
  });

  // Market State & Quotes
  app.get('/api/market', async (req) => {
    const query = req.query as { group?: string };
    const parsed = ClientGroupSchema.safeParse(query.group ?? 'GROUP_B');
    return market.getMarketState(parsed.success ? parsed.data : 'GROUP_B');
  });

  // Admin: Inject MCX Tick (for testing / simulation)
  app.post('/api/market/tick', async (req) => {
    const schema = z.object({
      goldMcx: z.number().positive().optional(),
      silverMcx: z.number().positive().optional(),
      goldComex: z.number().positive().optional(),
      silverComex: z.number().positive().optional(),
      usdInr: z.number().positive().optional(),
    });
    const body = schema.parse(req.body);
    const tick = feed.setTick(body);
    return { tick };
  });

  // Admin: Kill Switch (Freeze / Unfreeze)
  app.post('/api/market/freeze', async (req) => {
    const schema = z.object({
      isFrozen: z.boolean(),
      reason: z.string().optional(),
    });
    const body = schema.parse(req.body);
    const state = market.setFreeze(body.isFrozen, body.reason ?? '');
    broadcastMarket();
    return state;
  });

  // Scrips CRUD
  app.get('/api/scrips', async () => market.listScrips());

  app.patch('/api/scrips/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const schema = z.object({
      manualOffset: z.number().optional(),
      bidSpread: z.number().nonnegative().optional(),
      purityDiscount: z.number().nonnegative().optional(),
      isActive: z.boolean().optional(),
    });
    const body = schema.parse(req.body);
    try {
      const updated = market.updateScrip(id, body);
      broadcastMarket();
      return updated;
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  // Clients
  app.get('/api/clients', async () => market.listClients());

  app.patch('/api/clients/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const schema = z.object({
      maxSilverKg: z.number().nonnegative().optional(),
      maxGoldGrams: z.number().nonnegative().optional(),
      clientGroup: ClientGroupSchema.optional(),
      isActive: z.boolean().optional(),
    });
    const body = schema.parse(req.body);
    try {
      return market.updateClientLimits(id, body);
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  // Orders
  app.get('/api/orders', async () => market.listOrders());

  app.post('/api/orders', async (req, reply) => {
    const parsed = CreateOrderInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    try {
      const order = market.createOrder(parsed.data);
      return reply.status(201).send(order);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/orders/:id/confirm', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return market.confirmOrder(id);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/orders/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return market.cancelOrder(id);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/positions', async () => market.getPositionSummary());

  app.addHook('onClose', async () => {
    feed.stop();
    db.close();
  });

  return { app, db, feed, market };
}
