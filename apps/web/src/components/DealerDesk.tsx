import { useState } from 'react';
import type { Order, ScripConfig, ScripQuote } from '@bullion-desk/shared';
import { Download, Lock, RefreshCw, Unlock } from 'lucide-react';
import { api } from '../api';

interface Props {
  scrips: ScripConfig[];
  quotes: ScripQuote[];
  isFrozen: boolean;
  freezeReason: string | null;
  orders: Order[];
  positions: Array<{
    metal: string;
    settlement: string;
    buyGrams: number;
    sellGrams: number;
    netGrams: number;
    buyCount: number;
    sellCount: number;
    totalTurnoverInr: number;
  }>;
  onRefresh: () => void;
}

export function DealerDesk({
  scrips,
  quotes,
  isFrozen,
  freezeReason,
  orders,
  positions,
  onRefresh,
}: Props) {
  const [reasonInput, setReasonInput] = useState(freezeReason ?? 'High Volatility');

  const adjustOffset = async (scrip: ScripConfig, delta: number) => {
    await api.updateScrip(scrip.id, { manualOffset: scrip.manualOffset + delta });
    onRefresh();
  };

  const toggleActive = async (scrip: ScripConfig) => {
    await api.updateScrip(scrip.id, { isActive: !scrip.isActive });
    onRefresh();
  };

  const toggleFreeze = async () => {
    await api.setFreeze(!isFrozen, !isFrozen ? reasonInput : '');
    onRefresh();
  };

  const exportCsv = () => {
    const header = 'DealNo,Client,Scrip,Side,Qty,TotalGrams,Rate,GST,TotalINR,Status,Source\n';
    const rows = orders
      .map(
        (o) =>
          `${o.dealNumber},"${o.clientName}",${o.scripCode},${o.side},${o.qtyUnits},${o.totalGrams},${o.quotedRate},${o.gstAmount},${o.totalInr},${o.status},${o.source}`
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bullion-orders-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Kill Switch & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            data-testid="kill-switch-btn"
            onClick={toggleFreeze}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
              isFrozen
                ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                : 'bg-rose-600 text-white hover:bg-rose-500'
            }`}
          >
            {isFrozen ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {isFrozen ? 'Resume Market (Unfreeze)' : 'KILL SWITCH: Freeze All Rates'}
          </button>
          <input
            type="text"
            value={reasonInput}
            onChange={(e) => setReasonInput(e.target.value)}
            placeholder="Freeze reason..."
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20"
          >
            <Download className="h-3.5 w-3.5" />
            Export Tally CSV
          </button>
        </div>
      </div>

      {/* Scrip Master Formula Engine */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-200">
          Scrip Master & Live Spread Controls
        </div>
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900 text-xs uppercase text-slate-400">
              <th className="px-4 py-2.5">Scrip</th>
              <th className="px-4 py-2.5 text-right">Offset (₹)</th>
              <th className="px-4 py-2.5 text-center">Quick Adjust</th>
              <th className="px-4 py-2.5 text-right">Bid Spread</th>
              <th className="px-4 py-2.5 text-right">Buy (Bid)</th>
              <th className="px-4 py-2.5 text-right">Sell (Ask)</th>
              <th className="px-4 py-2.5 text-center">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {scrips.map((s) => {
              const q = quotes.find((qt) => qt.scripId === s.id);
              return (
                <tr key={s.id} className="hover:bg-slate-800/30">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-100">{s.name}</div>
                    <div className="text-xs text-slate-500">
                      {s.code} • Purity {s.purity}
                    </div>
                  </td>
                  <td
                    className="px-4 py-2.5 text-right font-mono font-semibold text-amber-400"
                    data-testid={`offset-val-${s.id}`}
                  >
                    {s.manualOffset >= 0 ? `+${s.manualOffset}` : s.manualOffset}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      {[-100, -50, 50, 100].map((d) => (
                        <button
                          key={d}
                          data-testid={`adjust-${s.id}-${d}`}
                          onClick={() => adjustOffset(s, d)}
                          className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-xs text-slate-300 hover:border-amber-500 hover:text-amber-300"
                        >
                          {d > 0 ? `+${d}` : d}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-300">₹{s.bidSpread}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-rose-300">
                    ₹{q?.buyRate.toLocaleString('en-IN') ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-300">
                    ₹{q?.sellRate.toLocaleString('en-IN') ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={s.isActive}
                      onChange={() => toggleActive(s)}
                      className="h-4 w-4 accent-amber-500"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Net Position Summary */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Net Open Physical Exposure (Bhaav Book)
          </h3>
          {positions.length === 0 ? (
            <div className="text-xs text-slate-500 py-4">No confirmed positions today.</div>
          ) : (
            <div className="space-y-2 text-xs">
              {positions.map((p) => (
                <div
                  key={`${p.metal}-${p.settlement}`}
                  className="flex items-center justify-between rounded-lg bg-slate-950 p-3 border border-slate-800"
                >
                  <div>
                    <span className="font-bold text-amber-400">{p.metal}</span>{' '}
                    <span className="text-slate-400">({p.settlement})</span>
                    <div className="text-slate-500 mt-0.5">
                      Buy: {p.buyGrams}g | Sell: {p.sellGrams}g
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="font-bold text-slate-100">Net: {p.netGrams}g</div>
                    <div className="text-slate-400">
                      ₹{p.totalTurnoverInr.toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Live Order Blotter ({orders.length})
          </h3>
          <div className="max-h-56 overflow-y-auto space-y-1.5 text-xs">
            {orders.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between rounded-lg bg-slate-950 px-3 py-2 border border-slate-800"
              >
                <div>
                  <span className="font-mono font-bold text-slate-300">#{o.dealNumber}</span>{' '}
                  <span className="text-slate-400">{o.clientName}</span> —{' '}
                  <span className={o.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>
                    {o.side} {o.qtyUnits}× {o.scripCode}
                  </span>
                </div>
                <div className="font-mono text-slate-200">{o.status}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
