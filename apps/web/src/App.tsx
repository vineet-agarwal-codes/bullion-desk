import { useCallback, useEffect, useState } from 'react';
import type {
  ClientProfile,
  MarketState,
  Order,
  ScripConfig,
  WsServerMessage,
} from '@bullion-desk/shared';
import { Crown, LayoutDashboard, MessageCircle, Store } from 'lucide-react';
import { api, WS_BASE } from './api';
import { ClientBoard } from './components/ClientBoard';
import { DealerDesk } from './components/DealerDesk';
import { TickerStrip } from './components/TickerStrip';
import { WhatsAppSimulator } from './components/WhatsAppSimulator';

export function App() {
  const [view, setView] = useState<'CLIENT' | 'DEALER' | 'WHATSAPP'>('CLIENT');
  const [market, setMarket] = useState<MarketState | null>(null);
  const [scrips, setScrips] = useState<ScripConfig[]>([]);
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('client-mehra');
  const [orders, setOrders] = useState<Order[]>([]);
  const [positions, setPositions] = useState<Awaited<ReturnType<typeof api.getPositions>>>([]);

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const activeGroup = selectedClient?.clientGroup ?? 'GROUP_B';

  const loadAll = useCallback(async () => {
    const [m, s, c, o, p] = await Promise.all([
      api.getMarket(activeGroup),
      api.getScrips(),
      api.getClients(),
      api.getOrders(),
      api.getPositions(),
    ]);
    setMarket(m);
    setScrips(s);
    setClients(c);
    setOrders(o);
    setPositions(p);
  }, [activeGroup]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws?group=${activeGroup}`);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as WsServerMessage;
        if (msg.type === 'MARKET_SNAPSHOT') {
          setMarket(msg.payload);
        } else if (msg.type === 'ORDER_EVENT') {
          loadAll();
        }
      } catch {
        // ignore malformed frames
      }
    };
    return () => ws.close();
  }, [activeGroup, loadAll]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/95 px-4 py-3">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-slate-950">
              <Crown className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-100">
                BullionDesk <span className="text-xs font-normal text-amber-400">v0.1</span>
              </h1>
              <p className="text-[11px] text-slate-400">
                Kucha Mahajani • Agra • Wholesale Bullion OS
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 p-1">
            <button
              data-testid="nav-client-board"
              onClick={() => setView('CLIENT')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                view === 'CLIENT'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Store className="h-3.5 w-3.5" />
              Sub-Dealer Rate Board
            </button>
            <button
              data-testid="nav-dealer-desk"
              onClick={() => setView('DEALER')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                view === 'DEALER'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dealer Admin Desk
            </button>
            <button
              data-testid="nav-whatsapp"
              onClick={() => setView('WHATSAPP')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                view === 'WHATSAPP'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp Agents
            </button>
          </nav>
        </div>
      </header>

      <TickerStrip
        tick={market?.tick ?? null}
        isFrozen={market?.isFrozen ?? false}
        freezeReason={market?.freezeReason ?? null}
      />

      <main className="mx-auto max-w-7xl px-4 py-6">
        {view === 'CLIENT' && (
          <ClientBoard
            quotes={market?.quotes ?? []}
            isFrozen={market?.isFrozen ?? false}
            clients={clients}
            selectedClientId={selectedClientId}
            onSelectClient={setSelectedClientId}
            orders={orders}
            onOrderChanged={loadAll}
          />
        )}
        {view === 'DEALER' && (
          <DealerDesk
            scrips={scrips}
            quotes={market?.quotes ?? []}
            isFrozen={market?.isFrozen ?? false}
            freezeReason={market?.freezeReason ?? null}
            orders={orders}
            positions={positions}
            onRefresh={loadAll}
          />
        )}
        {view === 'WHATSAPP' && (
          <WhatsAppSimulator clients={clients} onOrderOrRateChanged={loadAll} />
        )}
      </main>
    </div>
  );
}
export default App;
