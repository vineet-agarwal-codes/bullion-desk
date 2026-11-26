import { useEffect, useState } from 'react';
import type { ClientProfile, McxTick } from '@bullion-desk/shared';
import { Activity, AlertTriangle, CheckCircle, Cpu, Shield, Zap } from 'lucide-react';
import { api } from '../api';

interface Props {
  clients: ClientProfile[];
  tick: McxTick | null;
}

export function RiskHedgeSuite({ clients, tick }: Props) {
  const [hedging, setHedging] = useState<Awaited<ReturnType<typeof api.getHedging>> | null>(null);
  const [spreadStatus, setSpreadStatus] = useState<Awaited<ReturnType<typeof api.getSpreadStatus>> | null>(null);
  const [unfixed, setUnfixed] = useState<Awaited<ReturnType<typeof api.getUnfixedPositions>>>([]);
  const [rtgsList, setRtgsList] = useState<Awaited<ReturnType<typeof api.getRtgsVerifications>>>([]);

  // Badla MTM form
  const [badlaClient, setBadlaClient] = useState('client-sharma');
  const [badlaGrams, setBadlaGrams] = useState('50000');
  const [badlaMargin, setBadlaMargin] = useState('200000');

  // RTGS Fraud Shield form
  const [rtgsClient, setRtgsClient] = useState('client-mehra');
  const [remitterName, setRemitterName] = useState('MEHRA SONS BULLION PVT LTD');
  const [rtgsAmount, setRtgsAmount] = useState('2500000');
  const [utr, setUtr] = useState('HDFC99887766');

  const loadSuite = async () => {
    const [h, s, u, r] = await Promise.all([
      api.getHedging(),
      api.getSpreadStatus(),
      api.getUnfixedPositions(),
      api.getRtgsVerifications(),
    ]);
    setHedging(h);
    setSpreadStatus(s);
    setUnfixed(u);
    setRtgsList(r);
  };

  useEffect(() => {
    loadSuite();
  }, [tick?.timestamp]);

  const toggleHedgeMode = async () => {
    const next = hedging?.mode === 'LIVE' ? 'SHADOW' : 'LIVE';
    await api.setHedgingMode(next);
    loadSuite();
  };

  const addBadlaPosition = async () => {
    await api.createUnfixedPosition({
      clientId: badlaClient,
      metal: 'SILVER',
      grams: Number(badlaGrams),
      entryRatePerUnit: tick?.silverMcx ?? 94200,
      marginDepositedInr: Number(badlaMargin),
    });
    loadSuite();
  };

  const verifyRtgs = async () => {
    await api.verifyRtgs({
      clientId: rtgsClient,
      remitterName,
      amountInr: Number(rtgsAmount),
      utrNumber: utr,
      barSerial: 'MMTC-999-X101',
      measuredGrams: 1000.02,
    });
    loadSuite();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* 1. MCX Auto-Hedging & Lot Quantizer */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-400">
            <Cpu className="h-4 w-4" />
            <span>MCX Auto-Hedge & Lot Quantizer</span>
          </div>
          <button
            data-testid="toggle-hedge-mode-btn"
            onClick={toggleHedgeMode}
            className={`rounded-lg px-3 py-1 text-xs font-bold ${
              hedging?.mode === 'LIVE'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
            }`}
          >
            Mode: {hedging?.mode ?? 'LIVE'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-slate-950 p-3 border border-slate-800">
            <div className="text-slate-400">Unhedged Gold Tail</div>
            <div className="font-mono text-base font-bold text-amber-300">
              {hedging?.residuals.goldGrams ?? 0} g
            </div>
          </div>
          <div className="rounded-lg bg-slate-950 p-3 border border-slate-800">
            <div className="text-slate-400">Unhedged Silver Tail</div>
            <div className="font-mono text-base font-bold text-slate-200">
              {((hedging?.residuals.silverGrams ?? 0) / 1000).toFixed(2)} kg
            </div>
          </div>
        </div>

        <div className="space-y-1.5 max-h-44 overflow-y-auto text-xs" data-testid="hedge-executions-list">
          {hedging?.executions.length === 0 ? (
            <div className="text-slate-500 py-4 text-center">
              Confirm a ≥100g Gold or ≥5kg Silver deal to trigger MCX lot quantization.
            </div>
          ) : (
            hedging?.executions.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between rounded-lg bg-slate-950 px-3 py-2 border border-slate-800"
              >
                <div>
                  <span className={e.side === 'BUY' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                    {e.side} {e.lots}× {e.contract}
                  </span>
                  <div className="text-[11px] text-slate-500">
                    {e.mode} • MCX ₹{e.mcxPrice.toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="text-right font-mono text-emerald-300">
                  Saved ₹{e.slippageSavedInr}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 2. Dynamic Spread-Skewer & Velocity Guard */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-sky-400">
          <Zap className="h-4 w-4" />
          <span>Dynamic Spread-Skewer & Velocity Protection</span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-slate-950 p-3 border border-slate-800">
            <div className="text-slate-400">Delhi Vault Silver</div>
            <div className="font-mono text-base font-bold text-slate-100">
              {spreadStatus?.silverVaultKg ?? 240} kg
            </div>
          </div>
          <div className="rounded-lg bg-slate-950 p-3 border border-slate-800">
            <div className="text-slate-400">5s Order Velocity</div>
            <div className="font-mono text-base font-bold text-slate-100">
              {spreadStatus?.velocityCount5s ?? 0} orders
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Toxic Flow Guard:</span>
            <span
              className={`font-bold ${
                spreadStatus?.toxicFlowAlert ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {spreadStatus?.toxicFlowAlert ? 'ACTIVE (SPREAD WIDENED)' : 'NORMAL'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Recommended Silver Ask Skew:</span>
            <span className="font-mono text-amber-300">
              +₹{spreadStatus?.recommendedSilverAskSkewInr ?? 0}/kg
            </span>
          </div>
        </div>
      </div>

      {/* 3. Badla & Unfixed Rate (Kaccha Bhaav) MTM Margin Monitor */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-rose-400">
          <Activity className="h-4 w-4" />
          <span>Badla / Unfixed Metal MTM Risk Manager</span>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <select
            value={badlaClient}
            onChange={(e) => setBadlaClient(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firmName}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={badlaGrams}
            onChange={(e) => setBadlaGrams(e.target.value)}
            placeholder="Grams"
            className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-slate-200"
          />
          <input
            type="number"
            value={badlaMargin}
            onChange={(e) => setBadlaMargin(e.target.value)}
            placeholder="Margin INR"
            className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-slate-200"
          />
          <button
            data-testid="add-unfixed-btn"
            onClick={addBadlaPosition}
            className="rounded-lg bg-amber-500 px-3 py-1.5 font-bold text-slate-950 hover:bg-amber-400"
          >
            + Log Unfixed
          </button>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto text-xs" data-testid="unfixed-list">
          {unfixed.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-lg bg-slate-950 p-3 border border-slate-800"
            >
              <div>
                <div className="font-semibold text-slate-200">
                  {p.clientName} ({(p.grams / 1000).toFixed(1)} kg {p.metal})
                </div>
                <div className="text-slate-400">
                  Margin: ₹{p.marginDepositedInr.toLocaleString('en-IN')} | MTM Util:{' '}
                  <span
                    className={
                      p.riskStatus === 'MARGIN_CALL'
                        ? 'text-rose-400 font-bold'
                        : p.riskStatus === 'WARNING'
                          ? 'text-amber-400 font-bold'
                          : 'text-emerald-400 font-bold'
                    }
                  >
                    {p.marginUtilizationPct}% ({p.riskStatus})
                  </span>
                </div>
              </div>
              {p.status === 'OPEN' ? (
                <button
                  onClick={async () => {
                    await api.liquidateUnfixedPosition(p.id);
                    loadSuite();
                  }}
                  className="rounded bg-rose-600 px-2.5 py-1 font-bold text-white hover:bg-rose-500"
                >
                  Cut Rate
                </button>
              ) : (
                <span className="text-slate-500 font-mono">LIQUIDATED</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 4. RTGS Fraud Shield & Vault Delivery Token */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
          <Shield className="h-4 w-4" />
          <span>RTGS Fraud Shield & Vault Delivery Gate</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <select
            value={rtgsClient}
            onChange={(e) => setRtgsClient(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firmName}
              </option>
            ))}
          </select>
          <input
            data-testid="rtgs-remitter-input"
            type="text"
            value={remitterName}
            onChange={(e) => setRemitterName(e.target.value)}
            placeholder="Bank Remitter Name"
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200"
          />
          <input
            type="number"
            value={rtgsAmount}
            onChange={(e) => setRtgsAmount(e.target.value)}
            placeholder="Amount INR"
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-slate-200"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              placeholder="UTR Number"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-slate-200"
            />
            <button
              data-testid="verify-rtgs-btn"
              onClick={verifyRtgs}
              className="rounded-lg bg-emerald-500 px-3 py-1.5 font-bold text-slate-950 hover:bg-emerald-400"
            >
              Verify
            </button>
          </div>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto text-xs" data-testid="rtgs-results-list">
          {rtgsList.map((r) => (
            <div
              key={r.id}
              className={`flex items-center justify-between rounded-lg p-3 border ${
                r.status === 'VERIFIED'
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : 'border-rose-500/40 bg-rose-500/10'
              }`}
            >
              <div className="flex items-center gap-2">
                {r.status === 'VERIFIED' ? (
                  <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                )}
                <div>
                  <div className="font-bold text-slate-100">{r.remitterName}</div>
                  <div className="text-slate-400">
                    UTR: {r.utrNumber} • {r.status}
                  </div>
                </div>
              </div>
              {r.deliveryToken && (
                <div className="text-right font-mono text-emerald-300">
                  <div>{r.deliveryToken}</div>
                  <div className="text-[10px] text-slate-400">{r.ewayBillNo}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
