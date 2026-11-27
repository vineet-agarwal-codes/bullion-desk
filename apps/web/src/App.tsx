import { useCallback, useEffect, useState } from 'react';
import type {
  AuthUser,
  ClientProfile,
  MarketState,
  Order,
  ScripConfig,
  WsServerMessage,
} from '@bullion-desk/shared';
import { Crown, LayoutDashboard, LogOut, MessageCircle, ShieldCheck, Store } from 'lucide-react';
import { api, getAuthToken, setAuthToken, WS_BASE } from './api';
import { ClientBoard } from './components/ClientBoard';
import { DealerDesk } from './components/DealerDesk';
import { LoginView } from './components/LoginView';
import { RiskHedgeSuite } from './components/RiskHedgeSuite';
import { TickerStrip } from './components/TickerStrip';
import { WhatsAppSimulator } from './components/WhatsAppSimulator';

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [view, setView] = useState<'CLIENT' | 'DEALER' | 'WHATSAPP' | 'RISK'>('CLIENT');
  const [market, setMarket] = useState<MarketState | null>(null);
  const [scrips, setScrips] = useState<ScripConfig[]>([]);
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [positions, setPositions] = useState<Awaited<ReturnType<typeof api.getPositions>>>([]);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setAuthChecked(true);
      return;
    }
    api
      .getMe()
      .then((res) => {
        setUser(res.user);
        setView(res.user.role === 'ADMIN' ? 'DEALER' : 'CLIENT');
        if (res.user.clientId) setSelectedClientId(res.user.clientId);
      })
      .catch(() => {
        setAuthToken(null);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  const selectedClient = clients.find((c) => c.id === selectedClientId) ?? clients[0];
  const activeGroup =
    user?.role === 'ADMIN'
      ? (selectedClient?.clientGroup ?? 'GROUP_B')
      : (user?.clientGroup ?? 'GROUP_B');

  const loadAll = useCallback(async () => {
    if (!user) return;
    const isAdmin = user.role === 'ADMIN';
    const [m, s, c, o, p] = await Promise.all([
      api.getMarket(activeGroup),
      api.getScrips(),
      api.getClients(),
      api.getOrders(),
      isAdmin ? api.getPositions() : Promise.resolve([]),
    ]);
    setMarket(m);
    setScrips(s);
    setClients(c);
    if (!selectedClientId && c.length > 0) {
      setSelectedClientId(user.clientId ?? c[0].id);
    }
    setOrders(o);
    setPositions(p);
  }, [user, activeGroup, selectedClientId]);

  useEffect(() => {
    if (user) loadAll();
  }, [user, loadAll]);

  useEffect(() => {
    if (!user) return;
    const token = getAuthToken();
    const ws = new WebSocket(
      `${WS_BASE}/ws?group=${activeGroup}${token ? `&token=${encodeURIComponent(token)}` : ''}`
    );
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
  }, [user, activeGroup, loadAll]);

  const handleLogin = (loggedInUser: AuthUser) => {
    setUser(loggedInUser);
    setSelectedClientId(loggedInUser.clientId ?? '');
    setView(loggedInUser.role === 'ADMIN' ? 'DEALER' : 'CLIENT');
  };

  const handleLogout = () => {
    setAuthToken(null);
    setUser(null);
    setClients([]);
    setOrders([]);
    setPositions([]);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">
        Loading BullionDesk...
      </div>
    );
  }

  if (!user) {
    return <LoginView onLogin={handleLogin} />;
  }

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
                Shubh Jewellers <span className="text-xs font-normal text-amber-400">v0.5</span>
              </h1>
              <p className="text-[11px] text-slate-400">
                {user.displayName} •{' '}
                <span className="text-amber-400 font-semibold">{user.role}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <nav className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 p-1">
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
                Rate Board
              </button>

              {user.role === 'ADMIN' && (
                <>
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
                    data-testid="nav-risk-suite"
                    onClick={() => setView('RISK')}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      view === 'RISK'
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Hedge & Risk Suite
                  </button>
                </>
              )}

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
                WhatsApp
              </button>
            </nav>

            <button
              data-testid="logout-btn"
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-rose-500/40 hover:text-rose-300"
            >
              <LogOut className="h-3.5 w-3.5" />
              Logout
            </button>
          </div>
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
            user={user}
            quotes={market?.quotes ?? []}
            isFrozen={market?.isFrozen ?? false}
            clients={clients}
            selectedClientId={selectedClient?.id ?? ''}
            onSelectClient={setSelectedClientId}
            orders={orders}
            onOrderChanged={loadAll}
          />
        )}
        {view === 'DEALER' && user.role === 'ADMIN' && (
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
          <WhatsAppSimulator user={user} clients={clients} onOrderOrRateChanged={loadAll} />
        )}
        {view === 'RISK' && user.role === 'ADMIN' && (
          <RiskHedgeSuite clients={clients} tick={market?.tick ?? null} />
        )}
      </main>
    </div>
  );
}
export default App;
