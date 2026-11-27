import { useState } from 'react';
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
import { CheckCircle2, Clock, Coins, Pencil, ShieldAlert, XCircle } from 'lucide-react';
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedClient = clients.find((c) => c.id === selectedClientId) ?? clients[0];
  const clientOrders = orders.filter(
    (o) => o.clientId === selectedClient?.id && o.status !== 'CANCELLED'
  );
  const pendingOrders = clientOrders.filter((o) => o.status === 'PENDING_CONFIRM');
  const latestPendingOrder = pendingOrders[0] ?? null;

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

  const handlePlaceOrder = async () => {
    if (!ticket || !selectedClient) return;
    setSubmitting(true);
    setError(null);
    try {
      if (ticket.editingOrderId) {
        await api.cancelOrder(ticket.editingOrderId);
      }
      await api.createOrder({
        clientId: selectedClient.id,
        scripId: ticket.quote.scripId,
        side: ticket.side,
        orderType,
        qtyUnits,
        limitRate: orderType === 'LIMIT' ? Number(limitRate) : undefined,
        source: 'WEB',
      });
      setTicket(null);
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
      />
      {/* Client Context & Settlement Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Sub-Dealer Account:
          </span>
          {user.role === 'ADMIN' ? (
            <select
              data-testid="client-selector"
              value={selectedClient?.id ?? ''}
              onChange={(e) => onSelectClient(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm font-medium text-slate-100 focus:border-amber-500 focus:outline-none"
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
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-300"
            >
              {selectedClient?.firmName ?? user.displayName} ({selectedClient?.clientGroup ?? user.clientGroup})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800">
          {(['ALL', 'RTGS', 'CASH'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSettlementFilter(tab)}
              data-testid={`filter-${tab.toLowerCase()}`}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                settlementFilter === tab
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab === 'ALL' ? 'All Boards' : tab === 'RTGS' ? 'RTGS (Pakka +3% GST)' : 'Cash / Badla'}
            </button>
          ))}
        </div>
      </div>

      {/* Pending Deal Confirmation Banner */}
      {latestPendingOrder && (
        <div
          data-testid="pending-confirm-banner"
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4"
        >
          <div className="flex items-center gap-3">
            <Clock className="h-6 w-6 text-amber-400 animate-pulse" />
            <div>
              <div className="font-semibold text-amber-200">
                Deal #{latestPendingOrder.dealNumber} Pending Confirmation — {latestPendingOrder.side}{' '}
                {latestPendingOrder.qtyUnits} × {latestPendingOrder.scripCode}
              </div>
              <div className="text-xs text-amber-300/80">
                Locked Rate: ₹{latestPendingOrder.quotedRate.toLocaleString('en-IN')} | Total: ₹
                {latestPendingOrder.totalInr.toLocaleString('en-IN')} (GST: ₹
                {latestPendingOrder.gstAmount.toLocaleString('en-IN')})
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              data-testid="confirm-deal-btn"
              onClick={() => handleConfirm(latestPendingOrder.id)}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400"
            >
              <CheckCircle2 className="h-4 w-4" />
              Confirm Sauda
            </button>
            <button
              data-testid="edit-deal-btn"
              onClick={() => openEditTicket(latestPendingOrder)}
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-slate-900 px-3 py-2 text-sm font-medium text-amber-300 hover:bg-slate-800"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </button>
            <button
              data-testid="cancel-deal-btn"
              onClick={() => handleCancel(latestPendingOrder.id)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
            >
              <XCircle className="h-4 w-4" />
              Cancel
            </button>
          </div>
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

      {/* Live Rate Board */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-xl">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            data-testid="order-ticket-modal"
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-4"
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
              const rate =
                orderType === 'LIMIT'
                  ? Number(limitRate) || 0
                  : ticket.side === 'BUY'
                    ? ticket.quote.sellRate
                    : ticket.quote.buyRate;
              const fin = calculateOrderFinancials(qtyUnits, rate, ticket.quote.gstPercent);
              return (
                <div className="rounded-lg bg-slate-950 p-3 text-xs space-y-1 border border-slate-800">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Rate / Unit:</span>
                    <span className="font-mono text-slate-200">₹{rate.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">GST ({ticket.quote.gstPercent}%):</span>
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

      {/* Client Dual Ledger & Order History */}
      {selectedClient && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Dual Ledger — {selectedClient.name}
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Cash Balance:</span>
                <span className="font-mono font-semibold text-slate-100" data-testid="client-cash-balance">
                  ₹{selectedClient.cashBalanceInr.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Fine Gold (999):</span>
                <span className="font-mono font-semibold text-amber-400" data-testid="client-gold-balance">
                  {selectedClient.metalBalanceGoldGrams.toFixed(2)} g
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Fine Silver (999):</span>
                <span className="font-mono font-semibold text-slate-200" data-testid="client-silver-balance">
                  {(selectedClient.metalBalanceSilverGrams / 1000).toFixed(3)} kg
                </span>
              </div>
            </div>
          </div>

          <div className="md:col-span-2 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Recent Saudas ({clientOrders.length})
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1.5 text-xs">
              {clientOrders.length === 0 ? (
                <div className="text-slate-500 py-4 text-center">No orders placed yet.</div>
              ) : (
                clientOrders.map((o) => (
                  <div
                    key={o.id}
                    data-testid={`order-item-${o.dealNumber}`}
                    className="flex items-center justify-between rounded-lg bg-slate-950/80 px-3 py-2 border border-slate-800/80"
                  >
                    <div>
                      <span className="font-mono font-bold text-slate-300">#{o.dealNumber}</span>{' '}
                      <span
                        className={o.side === 'BUY' ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}
                      >
                        {o.side}
                      </span>{' '}
                      <span>
                        {o.qtyUnits} × {o.scripCode}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">₹{o.quotedRate.toLocaleString('en-IN')}</span>
                      {o.status === 'PENDING_CONFIRM' ? (
                        <>
                          <button
                            onClick={() => handleConfirm(o.id)}
                            className="rounded bg-emerald-500 px-2 py-0.5 font-bold text-slate-950 hover:bg-emerald-400"
                          >
                            Confirm
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
                          className={`rounded px-1.5 py-0.5 font-semibold ${
                            o.status === 'CONFIRMED'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : o.status === 'PENDING_LIMIT'
                                ? 'bg-sky-500/20 text-sky-300'
                                : 'bg-slate-700 text-slate-400'
                          }`}
                        >
                          {o.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
