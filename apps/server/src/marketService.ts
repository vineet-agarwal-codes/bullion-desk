import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  calculateOrderFinancials,
  calculateScripQuote,
  type ClientGroup,
  type ClientProfile,
  type CreateOrderInput,
  type MarketState,
  type McxTick,
  type Order,
  type ScripConfig,
} from '@bullion-desk/shared';
import type { McxFeedService } from './feed.js';

export interface PositionSummaryRow {
  metal: string;
  settlement: string;
  buyGrams: number;
  sellGrams: number;
  netGrams: number;
  buyCount: number;
  sellCount: number;
  totalTurnoverInr: number;
}

export class MarketService {
  private orderListeners: Array<(order: Order) => void> = [];

  constructor(
    private db: Database.Database,
    private feed: McxFeedService
  ) {}

  subscribeOrders(fn: (order: Order) => void): () => void {
    this.orderListeners.push(fn);
    return () => {
      this.orderListeners = this.orderListeners.filter((l) => l !== fn);
    };
  }

  private emitOrder(order: Order) {
    for (const fn of this.orderListeners) {
      fn(order);
    }
  }

  isFrozen(): { isFrozen: boolean; freezeReason: string | null } {
    const frozenRow = this.db
      .prepare('SELECT value FROM market_settings WHERE key = ?')
      .get('is_frozen') as { value: string } | undefined;
    const reasonRow = this.db
      .prepare('SELECT value FROM market_settings WHERE key = ?')
      .get('freeze_reason') as { value: string } | undefined;
    return {
      isFrozen: frozenRow?.value === '1',
      freezeReason: reasonRow?.value || null,
    };
  }

  setFreeze(isFrozen: boolean, reason: string = ''): { isFrozen: boolean; freezeReason: string | null } {
    this.db
      .prepare('INSERT OR REPLACE INTO market_settings (key, value) VALUES (?, ?)')
      .run('is_frozen', isFrozen ? '1' : '0');
    this.db
      .prepare('INSERT OR REPLACE INTO market_settings (key, value) VALUES (?, ?)')
      .run('freeze_reason', reason);
    return this.isFrozen();
  }

  listScrips(): ScripConfig[] {
    const rows = this.db.prepare('SELECT * FROM scrips ORDER BY metal, settlement, purity DESC').all() as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      metal: r.metal as 'GOLD' | 'SILVER',
      purity: Number(r.purity),
      settlement: r.settlement as 'RTGS' | 'CASH',
      unit: String(r.unit),
      unitGrams: Number(r.unit_grams),
      manualOffset: Number(r.manual_offset),
      bidSpread: Number(r.bid_spread),
      purityDiscount: Number(r.purity_discount),
      gstPercent: Number(r.gst_percent),
      isActive: Boolean(r.is_active),
      minQty: Number(r.min_qty),
      maxQty: Number(r.max_qty),
    }));
  }

  getScrip(idOrCode: string): ScripConfig | null {
    const all = this.listScrips();
    return all.find((s) => s.id === idOrCode || s.code === idOrCode) ?? null;
  }

  updateScrip(
    id: string,
    patch: Partial<Pick<ScripConfig, 'manualOffset' | 'bidSpread' | 'purityDiscount' | 'isActive'>>
  ): ScripConfig {
    const existing = this.getScrip(id);
    if (!existing) {
      throw new Error(`Scrip ${id} not found`);
    }
    const next = {
      manualOffset: patch.manualOffset ?? existing.manualOffset,
      bidSpread: patch.bidSpread ?? existing.bidSpread,
      purityDiscount: patch.purityDiscount ?? existing.purityDiscount,
      isActive: patch.isActive ?? existing.isActive,
    };
    this.db
      .prepare(
        `UPDATE scrips SET manual_offset = ?, bid_spread = ?, purity_discount = ?, is_active = ? WHERE id = ?`
      )
      .run(next.manualOffset, next.bidSpread, next.purityDiscount, next.isActive ? 1 : 0, existing.id);

    return this.getScrip(existing.id)!;
  }

  listClients(): ClientProfile[] {
    const rows = this.db.prepare('SELECT * FROM clients ORDER BY firm_name').all() as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      firmName: String(r.firm_name),
      phone: String(r.phone),
      gstin: r.gstin ? String(r.gstin) : null,
      clientGroup: r.client_group as ClientGroup,
      maxSilverKg: Number(r.max_silver_kg),
      maxGoldGrams: Number(r.max_gold_grams),
      cashBalanceInr: Number(r.cash_balance_inr),
      metalBalanceGoldGrams: Number(r.metal_balance_gold_grams),
      metalBalanceSilverGrams: Number(r.metal_balance_silver_grams),
      isActive: Boolean(r.is_active),
    }));
  }

  getClient(idOrPhone: string): ClientProfile | null {
    const all = this.listClients();
    return all.find((c) => c.id === idOrPhone || c.phone === idOrPhone) ?? null;
  }

  updateClientLimits(
    id: string,
    patch: Partial<Pick<ClientProfile, 'maxSilverKg' | 'maxGoldGrams' | 'clientGroup' | 'isActive'>>
  ): ClientProfile {
    const client = this.getClient(id);
    if (!client) throw new Error(`Client ${id} not found`);
    const next = {
      maxSilverKg: patch.maxSilverKg ?? client.maxSilverKg,
      maxGoldGrams: patch.maxGoldGrams ?? client.maxGoldGrams,
      clientGroup: patch.clientGroup ?? client.clientGroup,
      isActive: patch.isActive ?? client.isActive,
    };
    this.db
      .prepare(
        `UPDATE clients SET max_silver_kg = ?, max_gold_grams = ?, client_group = ?, is_active = ? WHERE id = ?`
      )
      .run(next.maxSilverKg, next.maxGoldGrams, next.clientGroup, next.isActive ? 1 : 0, client.id);
    return this.getClient(client.id)!;
  }

  getMarketState(clientGroup: ClientGroup = 'GROUP_B'): MarketState {
    const tick = this.feed.getTick();
    const { isFrozen, freezeReason } = this.isFrozen();
    const scrips = this.listScrips();
    const quotes = scrips.map((s) => calculateScripQuote(tick, s, clientGroup, isFrozen));
    return { isFrozen, freezeReason, tick, quotes };
  }

  private mapOrderRow(r: Record<string, unknown>): Order {
    return {
      id: String(r.id),
      dealNumber: Number(r.deal_number),
      clientId: String(r.client_id),
      clientName: String(r.client_name),
      scripId: String(r.scrip_id),
      scripCode: String(r.scrip_code),
      metal: r.metal as 'GOLD' | 'SILVER',
      settlement: r.settlement as 'RTGS' | 'CASH',
      side: r.side as 'BUY' | 'SELL',
      orderType: r.order_type as 'MARKET' | 'LIMIT',
      qtyUnits: Number(r.qty_units),
      totalGrams: Number(r.total_grams),
      quotedRate: Number(r.quoted_rate),
      limitRate: r.limit_rate !== null && r.limit_rate !== undefined ? Number(r.limit_rate) : null,
      gstAmount: Number(r.gst_amount),
      totalInr: Number(r.total_inr),
      status: r.status as Order['status'],
      source: r.source as Order['source'],
      expiresAt: r.expires_at !== null && r.expires_at !== undefined ? Number(r.expires_at) : null,
      confirmedAt: r.confirmed_at !== null && r.confirmed_at !== undefined ? Number(r.confirmed_at) : null,
      createdAt: Number(r.created_at),
    };
  }

  listOrders(limit = 50): Order[] {
    const rows = this.db
      .prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapOrderRow(r));
  }

  getOrder(id: string): Order | null {
    const row = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapOrderRow(row) : null;
  }

  createOrder(input: CreateOrderInput): Order {
    const { isFrozen } = this.isFrozen();
    if (isFrozen) {
      throw new Error('Market is currently frozen by dealer (Call for Rate)');
    }

    const client = this.getClient(input.clientId);
    if (!client || !client.isActive) {
      throw new Error('Client not found or inactive');
    }

    const scrip = this.getScrip(input.scripId);
    if (!scrip || !scrip.isActive) {
      throw new Error('Scrip not found or inactive');
    }

    if (input.qtyUnits < scrip.minQty || input.qtyUnits > scrip.maxQty) {
      throw new Error(`Quantity must be between ${scrip.minQty} and ${scrip.maxQty} units`);
    }

    const totalGrams = input.qtyUnits * scrip.unitGrams;
    if (scrip.metal === 'GOLD' && totalGrams > client.maxGoldGrams) {
      throw new Error(`Order exceeds client max Gold limit (${client.maxGoldGrams}g)`);
    }
    if (scrip.metal === 'SILVER' && totalGrams / 1000 > client.maxSilverKg) {
      throw new Error(`Order exceeds client max Silver limit (${client.maxSilverKg}kg)`);
    }

    if (input.orderType === 'LIMIT' && (!input.limitRate || input.limitRate <= 0)) {
      throw new Error('Limit rate is required for LIMIT orders');
    }

    const tick = this.feed.getTick();
    const quote = calculateScripQuote(tick, scrip, client.clientGroup, isFrozen);
    const marketRate = input.side === 'BUY' ? quote.sellRate : quote.buyRate;
    const effectiveRate = input.orderType === 'LIMIT' ? input.limitRate! : marketRate;

    const { gstAmount, totalInr } = calculateOrderFinancials(
      input.qtyUnits,
      effectiveRate,
      scrip.gstPercent
    );

    const now = Date.now();
    const id = randomUUID();

    // Check if LIMIT order is immediately marketable
    const isLimitMarketable =
      input.orderType === 'LIMIT' &&
      ((input.side === 'BUY' && quote.sellRate <= input.limitRate!) ||
        (input.side === 'SELL' && quote.buyRate >= input.limitRate!));

    const status: Order['status'] =
      input.orderType === 'MARKET' || isLimitMarketable ? 'PENDING_CONFIRM' : 'PENDING_LIMIT';
    const expiresAt = status === 'PENDING_CONFIRM' ? now + 60_000 : null;

    const txn = this.db.transaction(() => {
      const dealRow = this.db
        .prepare('SELECT value FROM market_settings WHERE key = ?')
        .get('next_deal_number') as { value: string };
      const dealNumber = Number(dealRow.value);
      this.db
        .prepare('UPDATE market_settings SET value = ? WHERE key = ?')
        .run(String(dealNumber + 1), 'next_deal_number');

      this.db
        .prepare(
          `INSERT INTO orders (
            id, deal_number, client_id, client_name, scrip_id, scrip_code,
            metal, settlement, side, order_type, qty_units, total_grams,
            quoted_rate, limit_rate, gst_amount, total_inr, status, source,
            expires_at, confirmed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          dealNumber,
          client.id,
          client.firmName,
          scrip.id,
          scrip.code,
          scrip.metal,
          scrip.settlement,
          input.side,
          input.orderType,
          input.qtyUnits,
          totalGrams,
          effectiveRate,
          input.limitRate ?? null,
          gstAmount,
          totalInr,
          status,
          input.source ?? 'WEB',
          expiresAt,
          null,
          now
        );
    });
    txn();

    const order = this.getOrder(id)!;
    this.emitOrder(order);
    return order;
  }

  confirmOrder(orderId: string): Order {
    const now = Date.now();
    const txn = this.db.transaction(() => {
      const order = this.getOrder(orderId);
      if (!order) throw new Error('Order not found');
      if (order.status === 'CONFIRMED') return order;
      if (order.status !== 'PENDING_CONFIRM') {
        throw new Error(`Cannot confirm order in status ${order.status}`);
      }
      if (order.expiresAt && now > order.expiresAt) {
        this.db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('EXPIRED', orderId);
        throw new Error('Deal confirmation window expired (15s timeout)');
      }

      this.db
        .prepare('UPDATE orders SET status = ?, confirmed_at = ? WHERE id = ?')
        .run('CONFIRMED', now, orderId);

      // Update client dual ledger (Cash + Fine Metal)
      // If client BUYS metal: client owes INR (-cashBalance) and receives metal (+metalBalance)
      // If client SELLS metal: client receives INR (+cashBalance) and owes metal (-metalBalance)
      const cashDelta = order.side === 'BUY' ? -order.totalInr : order.totalInr;
      const metalDelta = order.side === 'BUY' ? order.totalGrams : -order.totalGrams;

      if (order.metal === 'GOLD') {
        this.db
          .prepare(
            'UPDATE clients SET cash_balance_inr = cash_balance_inr + ?, metal_balance_gold_grams = metal_balance_gold_grams + ? WHERE id = ?'
          )
          .run(cashDelta, metalDelta, order.clientId);
      } else {
        this.db
          .prepare(
            'UPDATE clients SET cash_balance_inr = cash_balance_inr + ?, metal_balance_silver_grams = metal_balance_silver_grams + ? WHERE id = ?'
          )
          .run(cashDelta, metalDelta, order.clientId);
      }
      return this.getOrder(orderId)!;
    });

    const confirmed = txn();
    this.emitOrder(confirmed);
    return confirmed;
  }

  cancelOrder(orderId: string): Order {
    const order = this.getOrder(orderId);
    if (!order) throw new Error('Order not found');
    if (order.status === 'CONFIRMED') {
      throw new Error('Cannot cancel an already confirmed deal');
    }
    this.db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('CANCELLED', orderId);
    const updated = this.getOrder(orderId)!;
    this.emitOrder(updated);
    return updated;
  }

  processTick(tick: McxTick): Order[] {
    const { isFrozen } = this.isFrozen();
    if (isFrozen) return [];

    const pendingLimits = this.db
      .prepare("SELECT * FROM orders WHERE status = 'PENDING_LIMIT'")
      .all() as Array<Record<string, unknown>>;

    const triggered: Order[] = [];
    for (const row of pendingLimits) {
      const order = this.mapOrderRow(row);
      const client = this.getClient(order.clientId);
      const scrip = this.getScrip(order.scripId);
      if (!client || !scrip || !scrip.isActive || !order.limitRate) continue;

      const quote = calculateScripQuote(tick, scrip, client.clientGroup, false);
      const shouldFill =
        (order.side === 'BUY' && quote.sellRate <= order.limitRate) ||
        (order.side === 'SELL' && quote.buyRate >= order.limitRate);

      if (shouldFill) {
        const fillRate = order.side === 'BUY' ? quote.sellRate : quote.buyRate;
        const { gstAmount, totalInr } = calculateOrderFinancials(
          order.qtyUnits,
          fillRate,
          scrip.gstPercent
        );
        const now = Date.now();
        this.db.transaction(() => {
          this.db
            .prepare(
              'UPDATE orders SET quoted_rate = ?, gst_amount = ?, total_inr = ?, status = ?, confirmed_at = ? WHERE id = ?'
            )
            .run(fillRate, gstAmount, totalInr, 'CONFIRMED', now, order.id);

          const cashDelta = order.side === 'BUY' ? -totalInr : totalInr;
          const metalDelta = order.side === 'BUY' ? order.totalGrams : -order.totalGrams;
          if (order.metal === 'GOLD') {
            this.db
              .prepare(
                'UPDATE clients SET cash_balance_inr = cash_balance_inr + ?, metal_balance_gold_grams = metal_balance_gold_grams + ? WHERE id = ?'
              )
              .run(cashDelta, metalDelta, order.clientId);
          } else {
            this.db
              .prepare(
                'UPDATE clients SET cash_balance_inr = cash_balance_inr + ?, metal_balance_silver_grams = metal_balance_silver_grams + ? WHERE id = ?'
              )
              .run(cashDelta, metalDelta, order.clientId);
          }
        })();
        const updated = this.getOrder(order.id)!;
        this.emitOrder(updated);
        triggered.push(updated);
      }
    }
    return triggered;
  }

  getPositionSummary(): PositionSummaryRow[] {
    const rows = this.db
      .prepare(
        `SELECT
          metal,
          settlement,
          SUM(CASE WHEN side = 'BUY' THEN total_grams ELSE 0 END) as buy_grams,
          SUM(CASE WHEN side = 'SELL' THEN total_grams ELSE 0 END) as sell_grams,
          SUM(CASE WHEN side = 'BUY' THEN 1 ELSE 0 END) as buy_count,
          SUM(CASE WHEN side = 'SELL' THEN 1 ELSE 0 END) as sell_count,
          SUM(total_inr) as total_turnover_inr
        FROM orders
        WHERE status = 'CONFIRMED'
        GROUP BY metal, settlement`
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => {
      const buyGrams = Number(r.buy_grams ?? 0);
      const sellGrams = Number(r.sell_grams ?? 0);
      return {
        metal: String(r.metal),
        settlement: String(r.settlement),
        buyGrams,
        sellGrams,
        netGrams: buyGrams - sellGrams,
        buyCount: Number(r.buy_count ?? 0),
        sellCount: Number(r.sell_count ?? 0),
        totalTurnoverInr: Number(r.total_turnover_inr ?? 0),
      };
    });
  }
}
