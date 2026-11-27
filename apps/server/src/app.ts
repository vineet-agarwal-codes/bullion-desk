import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import {
  type AuthUser,
  ClientGroupSchema,
  CreateOrderInputSchema,
  type WsServerMessage,
} from '@bullion-desk/shared';
import { z } from 'zod';
import { initDatabase } from './db.js';
import { McxFeedService } from './feed.js';
import { MarketService } from './marketService.js';
import { AiCommandService } from './aiCommandService.js';
import { WhatsAppAgentService } from './whatsappService.js';
import { HedgingService } from './hedgingService.js';
import { RiskAndComplianceService } from './riskService.js';
import { AuthService } from './authService.js';

export interface AppOptions {
  dbPath?: string;
  enableFeedTimer?: boolean;
  enableLiveFeed?: boolean;
  feedIntervalMs?: number;
}

export async function createApp(options: AppOptions = {}): Promise<{
  app: FastifyInstance;
  db: Database.Database;
  feed: McxFeedService;
  market: MarketService;
  auth: AuthService;
}> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const db = initDatabase(options.dbPath ?? './bullion-desk.db');
  const feed = new McxFeedService();
  const market = new MarketService(db, feed);
  const auth = new AuthService(db);
  const aiCommand = new AiCommandService(market);
  const whatsapp = new WhatsAppAgentService(market, aiCommand);
  const hedging = new HedgingService(db);
  const risk = new RiskAndComplianceService(db, market);

  const getUserFromReq = (req: FastifyRequest): AuthUser | null => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return auth.verifyToken(authHeader.slice(7).trim());
    }
    const query = req.query as { token?: string } | undefined;
    if (query?.token) {
      return auth.verifyToken(query.token);
    }
    return null;
  };

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> => {
    const user = getUserFromReq(req);
    if (!user) {
      reply.status(401).send({ error: 'Authentication required' });
      return null;
    }
    return user;
  };

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> => {
    const user = await requireAuth(req, reply);
    if (!user) return null;
    if (user.role !== 'ADMIN') {
      reply.status(403).send({ error: 'Forbidden: Dealer Admin access required' });
      return null;
    }
    return user;
  };

  const wsClients = new Set<{
    socket: { send: (data: string) => void; readyState: number };
    group: 'GROUP_A' | 'GROUP_B' | 'PUBLIC';
    user: AuthUser | null;
  }>();

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
    if (order.status === 'CONFIRMED') {
      risk.recordOrderVelocity();
      hedging.onOrderConfirmed(order, feed.getTick());
    }
    const msg: WsServerMessage = {
      type: 'ORDER_EVENT',
      payload: order,
    };
    const raw = JSON.stringify(msg);
    for (const client of wsClients) {
      if (client.socket.readyState === 1) {
        // RBAC: Only broadcast order events to ADMIN or the owning SUB_DEALER
        if (
          client.user?.role === 'ADMIN' ||
          (client.user?.role === 'SUB_DEALER' && client.user.clientId === order.clientId)
        ) {
          client.socket.send(raw);
        }
      }
    }
  });

  if (options.enableFeedTimer !== false) {
    feed.start(options.feedIntervalMs ?? 2000, options.enableLiveFeed ?? false);
  }

  app.get('/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  // Authentication Endpoints
  app.post('/api/auth/login', async (req, reply) => {
    const schema = z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Username and password are required' });
    }
    const result = auth.login(parsed.data.username, parsed.data.password);
    if (!result) {
      return reply.status(401).send({ error: 'Invalid username/phone or password' });
    }
    return result;
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    return { user };
  });

  // WebSocket (RBAC-scoped)
  app.get('/ws', { websocket: true }, (socket, req) => {
    const user = getUserFromReq(req);
    const query = req.query as { group?: string };
    let group: 'GROUP_A' | 'GROUP_B' | 'PUBLIC' = 'PUBLIC';

    if (user?.role === 'ADMIN') {
      const parsedGroup = ClientGroupSchema.safeParse(query.group ?? 'GROUP_B');
      group = parsedGroup.success ? parsedGroup.data : 'GROUP_B';
    } else if (user?.role === 'SUB_DEALER') {
      group = user.clientGroup ?? 'GROUP_B';
    }

    const entry = { socket, group, user };
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

  // Market State & Quotes (RBAC-aware tiering)
  app.get('/api/market', async (req) => {
    const user = getUserFromReq(req);
    const query = req.query as { group?: string };
    let group: 'GROUP_A' | 'GROUP_B' | 'PUBLIC' = 'PUBLIC';
    if (user?.role === 'ADMIN') {
      const parsed = ClientGroupSchema.safeParse(query.group ?? 'GROUP_B');
      group = parsed.success ? parsed.data : 'GROUP_B';
    } else if (user?.role === 'SUB_DEALER') {
      group = user.clientGroup ?? 'GROUP_B';
    }
    return market.getMarketState(group);
  });

  // Admin Only: Inject MCX Tick
  app.post('/api/market/tick', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
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

  // Admin Only: Kill Switch (Freeze / Unfreeze)
  app.post('/api/market/freeze', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const schema = z.object({
      isFrozen: z.boolean(),
      reason: z.string().optional(),
    });
    const body = schema.parse(req.body);
    const state = market.setFreeze(body.isFrozen, body.reason ?? '');
    broadcastMarket();
    return state;
  });

  // Scrips (Read for auth users, Write for ADMIN only)
  app.get('/api/scrips', async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    return market.listScrips();
  });

  app.patch('/api/scrips/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
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

  // Clients (RBAC: ADMIN sees all, SUB_DEALER sees ONLY self)
  app.get('/api/clients', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    if (user.role === 'ADMIN') {
      return market.listClients();
    }
    const own = user.clientId ? market.getClient(user.clientId) : null;
    return own ? [own] : [];
  });

  app.patch('/api/clients/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
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

  // Orders (RBAC: ADMIN sees all, SUB_DEALER sees ONLY own orders)
  app.get('/api/orders', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const all = market.listOrders();
    if (user.role === 'ADMIN') return all;
    return all.filter((o) => o.clientId === user.clientId);
  });

  app.post('/api/orders', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const parsed = CreateOrderInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    if (user.role === 'SUB_DEALER' && parsed.data.clientId !== user.clientId) {
      return reply.status(403).send({ error: 'Forbidden: Cannot place orders for another sub-dealer' });
    }
    try {
      const order = market.createOrder(parsed.data);
      return reply.status(201).send(order);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/orders/:id/confirm', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const existing = market.getOrder(id);
    if (!existing) return reply.status(404).send({ error: 'Order not found' });
    if (user.role === 'SUB_DEALER' && existing.clientId !== user.clientId) {
      return reply.status(403).send({ error: 'Forbidden: Cannot confirm another sub-dealer order' });
    }
    try {
      return market.confirmOrder(id);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/orders/:id/cancel', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const existing = market.getOrder(id);
    if (!existing) return reply.status(404).send({ error: 'Order not found' });
    if (user.role === 'SUB_DEALER' && existing.clientId !== user.clientId) {
      return reply.status(403).send({ error: 'Forbidden: Cannot cancel another sub-dealer order' });
    }
    try {
      return market.cancelOrder(id);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/positions', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return market.getPositionSummary();
  });

  // AI Voice & Hinglish Command Endpoint (RBAC-scoped)
  app.post('/api/ai/command', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const schema = z.object({
      text: z.string().min(1),
      sessionId: z.string().default('default-session'),
      role: z.enum(['DEALER', 'CLIENT']).default('DEALER'),
      clientId: z.string().optional(),
      autoExecute: z.boolean().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    if (user.role === 'SUB_DEALER' && parsed.data.role === 'DEALER') {
      return reply.status(403).send({ error: 'Forbidden: Sub-dealers cannot run dealer price commands' });
    }

    const effectiveRole = user.role === 'ADMIN' ? parsed.data.role : 'CLIENT';
    const effectiveClientId = user.role === 'ADMIN' ? parsed.data.clientId : (user.clientId ?? undefined);

    try {
      const result = aiCommand.executeCommand(parsed.data.text, parsed.data.sessionId, {
        role: effectiveRole,
        clientId: effectiveClientId,
        autoExecute: parsed.data.autoExecute,
      });
      if (result.executed) {
        broadcastMarket();
      }
      return result;
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // Meta WhatsApp Cloud API Webhook (verified by hub.verify_token)
  app.get('/api/whatsapp/webhook', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? 'bullion-desk-verify';
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
      return reply.status(200).send(query['hub.challenge'] ?? '');
    }
    return reply.status(403).send({ error: 'Verification failed' });
  });

  app.post('/api/whatsapp/webhook', async (req, reply) => {
    const metaSchema = z.object({
      entry: z.array(
        z.object({
          changes: z.array(
            z.object({
              value: z.object({
                messages: z
                  .array(
                    z.object({
                      from: z.string(),
                      text: z.object({ body: z.string() }).optional(),
                    })
                  )
                  .optional(),
              }),
            })
          ),
        })
      ),
    });
    const parsed = metaSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid Meta WhatsApp webhook payload' });
    }
    const replies: Array<{ to: string; reply: string; role: string }> = [];
    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        for (const msg of change.value.messages ?? []) {
          const phone = msg.from.startsWith('+') ? msg.from : `+${msg.from}`;
          const text = msg.text?.body ?? '';
          if (text) {
            const res = whatsapp.handleIncoming(phone, text);
            replies.push({ to: phone, ...res });
          }
        }
      }
    }
    broadcastMarket();
    return { status: 'ok', replies };
  });

  // WhatsApp Simulator Endpoints (RBAC-scoped)
  app.post('/api/whatsapp/simulate', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const schema = z.object({
      phone: z.string().min(1),
      text: z.string().min(1),
    });
    const body = schema.parse(req.body);
    if (user.role === 'SUB_DEALER' && body.phone !== user.phone) {
      return reply.status(403).send({ error: 'Forbidden: Can only simulate your own WhatsApp number' });
    }
    const res = whatsapp.handleIncoming(body.phone, body.text);
    broadcastMarket();
    return res;
  });

  app.get('/api/whatsapp/messages', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const query = req.query as { phone?: string };
    if (user.role === 'SUB_DEALER') {
      return whatsapp.getMessages(user.phone ?? '__none__');
    }
    return whatsapp.getMessages(query.phone);
  });

  // Admin Only: Auto-Hedging, Dynamic Spread, Badla MTM Risk & RTGS Fraud Shield
  app.get('/api/hedging', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return {
      mode: hedging.getMode(),
      residuals: hedging.getResiduals(),
      executions: hedging.listExecutions(),
    };
  });

  app.post('/api/hedging/mode', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const body = z.object({ mode: z.enum(['LIVE', 'SHADOW']) }).parse(req.body);
    return { mode: hedging.setMode(body.mode) };
  });

  app.get('/api/risk/spread-status', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return risk.getDynamicSpreadStatus();
  });

  app.get('/api/risk/unfixed', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return risk.listUnfixedPositions();
  });

  app.post('/api/risk/unfixed', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const schema = z.object({
      clientId: z.string().min(1),
      metal: z.enum(['GOLD', 'SILVER']),
      grams: z.number().positive(),
      entryRatePerUnit: z.number().positive(),
      marginDepositedInr: z.number().positive(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      return reply.status(201).send(risk.createUnfixedPosition(parsed.data));
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/risk/unfixed/:id/liquidate', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    try {
      return risk.liquidateUnfixedPosition(id);
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  app.get('/api/compliance/rtgs', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return risk.listRtgsVerifications();
  });

  app.post('/api/compliance/rtgs/verify', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const schema = z.object({
      clientId: z.string().min(1),
      remitterName: z.string().min(1),
      amountInr: z.number().positive(),
      utrNumber: z.string().min(4),
      barSerial: z.string().optional(),
      measuredGrams: z.number().positive().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      return reply.status(201).send(risk.verifyRtgsAndIssueToken(parsed.data));
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.addHook('onClose', async () => {
    feed.stop();
    db.close();
  });

  return { app, db, feed, market, auth };
}
