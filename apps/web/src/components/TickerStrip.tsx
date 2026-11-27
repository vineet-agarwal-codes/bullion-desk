import type { McxTick } from '@bullion-desk/shared';
import { Activity, Lock, Unlock } from 'lucide-react';

interface Props {
  tick: McxTick | null;
  isFrozen: boolean;
  freezeReason: string | null;
}

export function TickerStrip({ tick, isFrozen, freezeReason }: Props) {
  const isLiveParity = tick?.source === 'LIVE_PARITY';

  return (
    <div className="border-b border-slate-800 bg-slate-900/90 px-4 py-2">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <Activity className="h-3.5 w-3.5 animate-pulse" />
            <span>MCX INDIA</span>
            <span
              className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                isLiveParity
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}
              title={
                isLiveParity
                  ? 'Live international spot + Indian 6% import duty parity'
                  : 'Simulated local MCX tick feed'
              }
            >
              {isLiveParity ? 'LIVE PARITY' : 'SIMULATED'}
            </span>
          </div>
          <div>
            <span className="text-slate-400">MCX GOLD (10g): </span>
            <span className="font-mono font-semibold text-amber-400" data-testid="mcx-gold-tick">
              {tick ? `₹${tick.goldMcx.toLocaleString('en-IN')}` : '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-400">MCX SILVER (1kg): </span>
            <span className="font-mono font-semibold text-slate-200" data-testid="mcx-silver-tick">
              {tick ? `₹${tick.silverMcx.toLocaleString('en-IN')}` : '—'}
            </span>
          </div>
        </div>

        <div
          data-testid="market-status-badge"
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold ${
            isFrozen
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
              : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
          }`}
        >
          {isFrozen ? (
            <>
              <Lock className="h-3 w-3" />
              <span>FROZEN — CALL FOR RATE {freezeReason ? `(${freezeReason})` : ''}</span>
            </>
          ) : (
            <>
              <Unlock className="h-3 w-3" />
              <span>TRADING ACTIVE</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
