import { useEffect, useRef, useState } from 'react';
import type {
  AuthUser,
  ClientProfile,
  Order,
  OrderSide,
  OrderType,
  ScripQuote,
  SettlementType,
} from '@bullion-desk/shared';
import { calculateOrderFinancials } from '@bullion-desk/shared';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Coins,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import { api } from '../api';
import { VoiceCommandBar } from './VoiceCommandBar';

interface Props {
  user: AuthUser;
  quotes: ScripQuote[];
  isFrozen: boolean;
  clients: ClientProfile[];
  selectedClientId: string;
  onSelectClient: (id: string) => void;
  orders: Order[];
  onOrderChanged: () => void;
}

export function ClientBoard({
  user,
  quotes,
  isFrozen,
  clients,
  selectedClientId,
  onSelectClient,
  orders,
  onOrderChanged,
}: Props) {
  const [settlementFilter, setSettlementFilter] = useState<'ALL' | SettlementType>('ALL');
  const [ticket, setTicket] = useState<{
    quote: ScripQuote;
    side: OrderSide;
    editingOrderId?: string;
  } | null>(null);
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [qtyUnits, setQtyUnits] = useState<number>(1);
  const [limitRate, setLimitRate] = useState<string>('');
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<Order | null>(null);
  const [pastOrdersExpanded, setPastOrdersExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ title: string; detail: string; kind: 'INFO' | 'SUCCESS' } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);
  const prevOrderStatusesRef = useRef<Map<string, string>>(new Map());

  const selectedClient = clients.find((c) => c.id === selectedClientId) ?? clients[0];
  const clientOrders = orders.filter(
    (o) => o.clientId === selectedClient?.id && o.status !== 'CANCELLED'
  );
  const openOrders = clientOrders.filter(
    (o) => o.status === 'PENDING_LIMIT' || o.status === 'PROCESSING'
  );

  // Show in-app notification toast when an order transitions to CONFIRMED
  useEffect(() => {
    const prev = prevOrderStatusesRef.current;
    for (const o of clientOrders) {
      const oldStatus = prev.get(o.id);
      if ((oldStatus === 'PROCESSING' || oldStatus === 'PENDING_LIMIT') && o.status === 'CONFIRMED') {
        setToast({
          title: `Deal #${o.dealNumber} Confirmed`,
          detail: `${o.side} ${o.qtyUnits} × ${o.scripCode} @ ₹${o.quotedRate.toLocaleString('en-IN')} • WhatsApp notification sent`,
          kind: 'SUCCESS',
        });
      }
      prev.set(o.id, o.status);
    }
  }, [clientOrders]);

  const filteredQuotes = quotes.filter(
    (q) => q.isActive && (settlementFilter === 'ALL' || q.settlement === settlementFilter)
  );

  const openTicket = (quote: ScripQuote, side: OrderSide) => {
    if (isFrozen) return;
    setTicket({ quote, side });
    setOrderType('MARKET');
    setQtyUnits(1);
    setLimitRate(String(side === 'BUY' ? quote.sellRate : quote.buyRate));
    setError(null);
  };

  const openEditTicket = (order: Order) => {
    const quote = quotes.find((q) => q.scripId === order.scripId);
    if (!quote || isFrozen) return;
    setTicket({ quote, side: order.side, editingOrderId: order.id });
    setOrderType(order.orderType);
    setQtyUnits(order.qtyUnits);
    setLimitRate(
      String(order.limitRate ?? (order.side === 'BUY' ? quote.sellRate : quote.buyRate))
    );
    setError(null);
  };

  const openDraftTicket = (draft: {
    scripId: string;
    side: OrderSide;
    orderType: OrderType;
    qtyUnits: number;
    limitRate?: number;
  }) => {
    const quote = quotes.find((q) => q.scripId === draft.scripId);
    if (!quote || isFrozen) return;
    setTicket({ quote, side: draft.side });
    setOrderType(draft.orderType);
    setQtyUnits(draft.qtyUnits);
    setLimitRate(
      String(draft.limitRate ?? (draft.side === 'BUY' ? quote.sellRate : quote.buyRate))
    );
    setError(null);
  };

  const handlePlaceOrder = async () => {
    if (!ticket || !selectedClient) return;
    setSubmitting(true);
    setError(null);
    const liveQuote = quotes.find((q) => q.scripId === ticket.quote.scripId) ?? ticket.quote;
    const expectedRate = ticket.side === 'BUY' ? liveQuote.sellRate : liveQuote.buyRate;
    try {
      if (ticket.editingOrderId) {
        await api.cancelOrder(ticket.editingOrderId);
      }
      const created = await api.createOrder({
        clientId: selectedClient.id,
        scripId: ticket.quote.scripId,
        side: ticket.side,
        orderType,
        qtyUnits,
        limitRate: orderType === 'LIMIT' ? Number(limitRate) : undefined,
        expectedRate: orderType === 'MARKET' ? expectedRate : undefined,
        source: 'WEB',
      });
      setTicket(null);
      setToast({
        title: `Order #${created.dealNumber} Placed`,
        detail:
          created.status === 'PROCESSING'
            ? 'Verifying risk & hedging — you will receive app & WhatsApp confirmation shortly.'
            : `Open Limit Order @ ₹${created.quotedRate.toLocaleString('en-IN')}`,
        kind: 'INFO',
      });
      onOrderChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (orderId: string) => {
    setError(null);
    try {
      await api.confirmOrder(orderId);
      onOrderChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCancel = async (orderId: string) => {
    try {
      await api.cancelOrder(orderId);
      onOrderChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <VoiceCommandBar
        role="CLIENT"
        sessionId={`client-voice-${selectedClient?.id ?? 'default'}`}
        clientId={selectedClient?.id}
        samples={[
          '2 peti chandi pakki kar do',
          '10g gold 999 rtgs book karo',
        ]}
        onExecuted={() => onOrderChanged()}
        onOpenOrderTicket={openDraftTicket}
      />
      {/* Dual Ledger (Khata) Summary Strip on Top */}
      {selectedClient && (
        <div
          data-testid="khata-top-panel"
          className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 rounded-xl border border-amber-500/25 bg-slate-900/80 p-2.5 sm:p-4"
        >
          <div className="col-span-2 sm:col-span-1 flex items-center justify-between sm:justify-start gap-2 sm:gap-3 rounded-lg bg-slate-950/80 px-3 py-2.5 sm:px-4 sm:py-3 border border-slate-800">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-400 shrink-0" />
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                Khata Cash
              </div>
            </div>
            <div
              className="font-mono text-sm sm:text-base font-bold text-slate-100 whitespace-nowrap"
              data-testid="client-cash-balance"
            >
              ₹{selectedClient.cashBalanceInr.toLocaleString('en-IN')}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3 rounded-lg bg-slate-950/80 px-3 py-2.5 sm:px-4 sm:py-3 border border-slate-800">
            <div className="flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5 sm:h-5 sm:w-5 text-amber-400 shrink-0" />
              <div className="text-[10px] sm:text-[11px] uppercase tracking-wider text-slate-400">
                Fine Gold
              </div>
            </div>
            <div
              className="font-mono text-sm sm:text-base font-bold text-amber-400 whitespace-nowrap"
              data-testid="client-gold-balance"
            >
              {selectedClient.metalBalanceGoldGrams.toFixed(2)} g
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3 rounded-lg bg-slate-950/80 px-3 py-2.5 sm:px-4 sm:py-3 border border-slate-800">
            <div className="flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5 sm:h-5 sm:w-5 text-slate-300 shrink-0" />
              <div className="text-[10px] sm:text-[11px] uppercase tracking-wider text-slate-400">
                Fine Silver
              </div>
            </div>
            <div
              className="font-mono text-sm sm:text-base font-bold text-slate-200 whitespace-nowrap"
              data-testid="client-silver-balance"
            >
              {(selectedClient.metalBalanceSilverGrams / 1000).toFixed(3)} kg
            </div>
          </div>
        </div>
      )}

      {/* Client Context & Settlement Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="text-[11px] sm:text-xs font-medium uppercase tracking-wider text-slate-400">
            Account:
          </span>
          {user.role === 'ADMIN' ? (
            <select
              data-testid="client-selector"
              value={selectedClient?.id ?? ''}
              onChange={(e) => onSelectClient(e.target.value)}
              className="flex-1 sm:flex-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-100 focus:border-amber-500 focus:outline-none"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firmName} ({c.clientGroup})
                </option>
              ))}
            </select>
          ) : (
            <span
              data-testid="logged-in-firm"
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs sm:text-sm font-semibold text-emerald-300"
            >
              {user.displayName}
            </span>
          )}
        </div>

        <div className="flex w-full sm:w-auto items-center gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800">
          {(['ALL', 'RTGS', 'CASH'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSettlementFilter(tab)}
              data-testid={`filter-${tab.toLowerCase()}`}
              className={`flex-1 sm:flex-none whitespace-nowrap rounded-md px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-semibold transition ${
                settlementFilter === tab
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="sm:hidden">
                {tab === 'ALL' ? 'All' : tab === 'RTGS' ? 'RTGS (+3%)' : 'Cash / Badla'}
              </span>
              <span className="hidden sm:inline">
                {tab === 'ALL' ? 'All Boards' : tab === 'RTGS' ? 'RTGS (Pakka +3% GST)' : 'Cash / Badla'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* In-App Order Processing / Confirmation Notification */}
      {toast && (
        <div
          data-testid="order-status-toast"
          className={`flex items-center justify-between gap-4 rounded-xl border p-3.5 text-xs ${
            toast.kind === 'SUCCESS'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {toast.kind === 'SUCCESS' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            ) : (
              <Clock className="h-5 w-5 text-amber-400 animate-spin shrink-0" />
            )}
            <div>
              <div className="font-bold">{toast.title}</div>
              <div className="opacity-85">{toast.detail}</div>
            </div>
          </div>
          <button onClick={() => setToast(null)} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>
      )}

      {error && (
        <div
          data-testid="client-error-banner"
          className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Always-visible Open Orders Panel at the top */}
      {openOrders.length > 0 && (
        <div
          data-testid="open-orders-panel"
          className="rounded-xl border border-sky-500/30 bg-slate-900/80 p-4 space-y-2.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
              Open Orders ({openOrders.length})
            </span>
          </div>
          <div className="space-y-2">
            {openOrders.map((o) => (
              <div
                key={o.id}
                data-testid={`open-order-${o.dealNumber}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-xs"
              >
                <div>
                  <span className="font-mono font-bold text-slate-200">#{o.dealNumber}</span>{' '}
                  <span
                    className={
                      o.side === 'BUY' ? 'font-bold text-emerald-400' : 'font-bold text-rose-400'
                    }
                  >
                    {o.side}
                  </span>{' '}
                  <span className="font-medium text-slate-100">
                    {o.qtyUnits} × {o.scripCode}
                  </span>{' '}
                  <span className="text-slate-400">
                    ({o.orderType} @ ₹{o.quotedRate.toLocaleString('en-IN')})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 font-semibold ${
                      o.status === 'PROCESSING'
                        ? 'bg-amber-500/20 text-amber-300 animate-pulse'
                        : 'bg-sky-500/20 text-sky-300'
                    }`}
                  >
                    {o.status === 'PENDING_LIMIT' ? 'OPEN LIMIT' : o.status}
                  </span>
                  {o.status === 'PENDING_LIMIT' && (
                    <>
                      <button
                        data-testid={`modify-open-order-${o.dealNumber}`}
                        onClick={() => openEditTicket(o)}
                        className="rounded bg-slate-800 px-2.5 py-1 font-medium text-amber-300 hover:bg-slate-700"
                      >
                        Modify
                      </button>
                      <button
                        data-testid={`cancel-open-order-${o.dealNumber}`}
                        onClick={() => handleCancel(o.id)}
                        className="rounded bg-slate-800 px-2.5 py-1 font-medium text-slate-300 hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mobile Rate Board Cards (Zero horizontal scroll, thumb-friendly Buy/Sell) */}
      <div className="md:hidden space-y-2.5">
        {filteredQuotes.map((q) => (
          <div
            key={q.scripId}
            data-testid={`rate-card-${q.scripId}`}
            className="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Coins
                  className={`h-4 w-4 shrink-0 ${q.metal === 'GOLD' ? 'text-amber-400' : 'text-slate-300'}`}
                />
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-slate-100 leading-tight">{q.name}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Purity {q.purity} • {q.unit} • MCX ₹{q.mcxBase.toLocaleString('en-IN')}
                  </div>
                </div>
              </div>
              <span
                className={`shrink-0 inline-flex rounded px-2 py-0.5 text-[10px] font-semibold ${
                  q.settlement === 'RTGS'
                    ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                    : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                }`}
              >
                {q.settlement} {q.gstPercent > 0 ? `+${q.gstPercent}%` : '0%'}
              </span>
            </div>

            {isFrozen ? (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 py-2 text-center font-mono text-xs font-semibold text-rose-400">
                MARKET FROZEN — CALL FOR RATE
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => openTicket(q, 'SELL')}
                  className="flex flex-col items-center justify-center rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 active:scale-[0.98] transition"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-400">
                    Sell (Bid)
                  </span>
                  <span className="font-mono text-sm font-bold text-rose-200">
                    ₹{q.buyRate.toLocaleString('en-IN')}
                  </span>
                </button>
                <button
                  onClick={() => openTicket(q, 'BUY')}
                  className="flex flex-col items-center justify-center rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 active:scale-[0.98] transition"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                    Buy (Ask)
                  </span>
                  <span className="font-mono text-sm font-bold text-emerald-200">
                    ₹{q.sellRate.toLocaleString('en-IN')}
                  </span>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop Live Rate Board */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-xl">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900 text-xs uppercase tracking-wider text-slate-400">
              <th className="px-4 py-3">Product / Scrip</th>
              <th className="px-4 py-3">Settlement</th>
              <th className="px-4 py-3 text-right">MCX Base</th>
              <th className="px-4 py-3 text-right text-rose-400">We Buy (Bid)</th>
              <th className="px-4 py-3 text-right text-emerald-400">We Sell (Ask)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {filteredQuotes.map((q) => (
              <tr key={q.scripId} data-testid={`rate-row-${q.scripId}`} className="hover:bg-slate-800/40">
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <Coins
                      className={`h-4 w-4 ${q.metal === 'GOLD' ? 'text-amber-400' : 'text-slate-300'}`}
                    />
                    <div>
                      <div className="font-semibold text-slate-100">{q.name}</div>
                      <div className="text-xs text-slate-400">
                        Purity {q.purity} • Unit {q.unit}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <span
                    className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${
                      q.settlement === 'RTGS'
                        ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                        : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                    }`}
                  >
                    {q.settlement} {q.gstPercent > 0 ? `(+${q.gstPercent}% GST)` : '(0% GST)'}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-right font-mono text-sm text-slate-400">
                  ₹{q.mcxBase.toLocaleString('en-IN')}
                </td>
                <td className="px-4 py-3.5 text-right">
                  {isFrozen ? (
                    <span className="font-mono text-xs font-semibold text-rose-400">CALL FOR RATE</span>
                  ) : (
                    <button
                      data-testid={`sell-btn-${q.scripId}`}
                      onClick={() => openTicket(q, 'SELL')}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 font-mono text-sm font-bold text-rose-300 hover:bg-rose-500/25 transition"
                      title="Sell to Bullion House at Bid"
                    >
                      ₹{q.buyRate.toLocaleString('en-IN')}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3.5 text-right">
                  {isFrozen ? (
                    <span className="font-mono text-xs font-semibold text-rose-400">CALL FOR RATE</span>
                  ) : (
                    <button
                      data-testid={`buy-btn-${q.scripId}`}
                      onClick={() => openTicket(q, 'BUY')}
                      className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-mono text-sm font-bold text-emerald-300 hover:bg-emerald-500/25 transition"
                      title="Buy from Bullion House at Ask"
                    >
                      ₹{q.sellRate.toLocaleString('en-IN')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Order Ticket Modal */}
      {ticket && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
          <div
            data-testid="order-ticket-modal"
            className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-slate-700 bg-slate-900 p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-100">
                  {ticket.side === 'BUY' ? 'Buy' : 'Sell'} {ticket.quote.name}
                </h3>
                <p className="text-xs text-slate-400">
                  {selectedClient?.firmName} • {ticket.quote.settlement}
                </p>
              </div>
              <button
                onClick={() => setTicket(null)}
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="flex gap-2">
              {(['MARKET', 'LIMIT'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setOrderType(t)}
                  className={`flex-1 rounded-lg py-2 text-xs font-bold ${
                    orderType === t
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {t} ORDER
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Quantity ({ticket.quote.unit} units)
              </label>
              <input
                data-testid="order-qty-input"
                type="number"
                min={1}
                value={qtyUnits}
                onChange={(e) => setQtyUnits(Math.max(1, Number(e.target.value)))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
              />
              <div className="mt-2 flex gap-2">
                {[1, 2, 5, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => setQtyUnits(n)}
                    className="rounded bg-slate-800 px-2.5 py-1 text-xs font-mono text-slate-300 hover:bg-slate-700"
                  >
                    {n}x
                  </button>
                ))}
              </div>
            </div>

            {orderType === 'LIMIT' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">Target Limit Rate (₹)</label>
                <input
                  data-testid="order-limit-input"
                  type="number"
                  value={limitRate}
                  onChange={(e) => setLimitRate(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                />
              </div>
            )}

            {(() => {
              const liveQuote =
                quotes.find((q) => q.scripId === ticket.quote.scripId) ?? ticket.quote;
              const liveMarketRate =
                ticket.side === 'BUY' ? liveQuote.sellRate : liveQuote.buyRate;
              const rate = orderType === 'LIMIT' ? Number(limitRate) || 0 : liveMarketRate;
              const fin = calculateOrderFinancials(qtyUnits, rate, liveQuote.gstPercent);
              return (
                <div className="rounded-lg bg-slate-950 p-3 text-xs space-y-1 border border-slate-800">
                  <div className="flex justify-between">
                    <span className="text-slate-400">
                      {orderType === 'LIMIT' ? 'Your Limit Rate / Unit:' : 'Live Market Rate / Unit:'}
                    </span>
                    <span className="font-mono text-slate-200">₹{rate.toLocaleString('en-IN')}</span>
                  </div>
                  {orderType === 'LIMIT' && (
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>Current Live Rate:</span>
                      <span className="font-mono">₹{liveMarketRate.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-400">GST ({liveQuote.gstPercent}%):</span>
                    <span className="font-mono text-slate-200">
                      ₹{fin.gstAmount.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-800 pt-1 font-bold text-amber-400">
                    <span>Total INR:</span>
                    <span className="font-mono">₹{fin.totalInr.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              );
            })()}

            <button
              data-testid="submit-order-btn"
              disabled={submitting}
              onClick={handlePlaceOrder}
              className={`w-full rounded-xl py-2.5 text-sm font-bold transition ${
                ticket.side === 'BUY'
                  ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                  : 'bg-rose-500 text-white hover:bg-rose-400'
              }`}
            >
              {submitting
                ? 'Booking...'
                : ticket.editingOrderId
                  ? `Update ${ticket.side} Order`
                  : `Book ${ticket.side} Order`}
            </button>
          </div>
        </div>
      )}

      {/* Zerodha / Groww Style Orders Book (Collapsed by default) */}
      {selectedClient && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <button
            type="button"
            data-testid="toggle-past-orders"
            onClick={() => setPastOrdersExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/40 transition"
          >
            <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Order Book & Past Saudas ({clientOrders.length})
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span>{pastOrdersExpanded ? 'Hide' : 'Show'}</span>
              {pastOrdersExpanded ? (
                <ChevronUp className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              )}
            </div>
          </button>

          {pastOrdersExpanded &&
            (clientOrders.length === 0 ? (
              <div className="border-t border-slate-800 text-slate-500 py-8 text-center text-xs">
                No orders placed yet.
              </div>
            ) : (
              <div className="border-t border-slate-800 divide-y divide-slate-800/70">
              {clientOrders.map((o) => {
                const timeStr = new Date(o.createdAt).toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });
                return (
                  <div
                    key={o.id}
                    data-testid={`order-item-${o.dealNumber}`}
                    onClick={() => setSelectedOrderDetail(o)}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs hover:bg-slate-800/40 cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3 min-w-[220px]">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          o.side === 'BUY'
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {o.side}
                      </span>
                      <div>
                        <div className="font-semibold text-slate-100">
                          {o.scripCode}{' '}
                          <span className="font-mono text-slate-400">× {o.qtyUnits}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          #{o.dealNumber} • {timeStr} • {o.orderType} • via {o.source}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right font-mono">
                        <div className="font-semibold text-slate-100">
                          ₹{o.quotedRate.toLocaleString('en-IN')}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Total ₹{o.totalInr.toLocaleString('en-IN')}
                        </div>
                      </div>

                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {o.status === 'PENDING_LIMIT' ? (
                          <>
                            <span className="rounded bg-sky-500/20 px-2 py-0.5 font-semibold text-sky-300">
                              OPEN LIMIT
                            </span>
                            <button
                              onClick={() => openEditTicket(o)}
                              className="rounded bg-slate-800 px-2 py-0.5 text-amber-300 hover:bg-slate-700"
                            >
                              Modify
                            </button>
                            <button
                              onClick={() => handleCancel(o.id)}
                              className="rounded bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <span
                            className={`rounded px-2 py-0.5 font-semibold ${
                              o.status === 'CONFIRMED'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : o.status === 'PROCESSING'
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : 'bg-slate-700 text-slate-400'
                            }`}
                          >
                            {o.status}
                          </span>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-600" />
                    </div>
                  </div>
                );
              })}
              </div>
            ))}
        </div>
      )}

      {/* Order Detail Modal (Zerodha / Groww style) */}
      {selectedOrderDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setSelectedOrderDetail(null)}
        >
          <div
            data-testid="order-detail-modal"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                      selectedOrderDetail.side === 'BUY'
                        ? 'bg-sky-500/20 text-sky-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {selectedOrderDetail.side}
                  </span>
                  <h3 className="text-base font-bold text-slate-100">
                    Deal #{selectedOrderDetail.dealNumber} — {selectedOrderDetail.scripCode}
                  </h3>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedOrderDetail.clientName} • {selectedOrderDetail.settlement}
                </p>
              </div>
              <button
                onClick={() => setSelectedOrderDetail(null)}
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl bg-slate-950 p-4 border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Status</span>
                <span className="font-bold text-emerald-300">{selectedOrderDetail.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Order Type / Channel</span>
                <span className="text-slate-200">
                  {selectedOrderDetail.orderType} via {selectedOrderDetail.source}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Placed At</span>
                <span className="font-mono text-slate-200">
                  {new Date(selectedOrderDetail.createdAt).toLocaleString('en-IN')}
                </span>
              </div>
              {selectedOrderDetail.confirmedAt && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Confirmed At</span>
                  <span className="font-mono text-slate-200">
                    {new Date(selectedOrderDetail.confirmedAt).toLocaleString('en-IN')}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-800 pt-2">
                <span className="text-slate-400">Quantity / Weight</span>
                <span className="font-mono text-slate-200">
                  {selectedOrderDetail.qtyUnits} units ({selectedOrderDetail.totalGrams} g)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Booked Rate / Unit</span>
                <span className="font-mono text-slate-200">
                  ₹{selectedOrderDetail.quotedRate.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">GST</span>
                <span className="font-mono text-slate-200">
                  ₹{selectedOrderDetail.gstAmount.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-800 pt-2 font-bold text-amber-400 text-sm">
                <span>Total INR</span>
                <span className="font-mono">
                  ₹{selectedOrderDetail.totalInr.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {selectedOrderDetail.status === 'PENDING_LIMIT' && (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const o = selectedOrderDetail;
                    setSelectedOrderDetail(null);
                    openEditTicket(o);
                  }}
                  className="flex-1 rounded-xl bg-amber-500 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
                >
                  Modify Limit Order
                </button>
                <button
                  onClick={() => {
                    const id = selectedOrderDetail.id;
                    setSelectedOrderDetail(null);
                    handleCancel(id);
                  }}
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-800 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                >
                  Cancel Order
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
