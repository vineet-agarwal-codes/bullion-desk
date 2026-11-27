import { useState } from 'react';
import type { AuthUser } from '@bullion-desk/shared';
import { Crown, KeyRound, ShieldAlert, ShieldCheck, Store } from 'lucide-react';
import { api, setAuthToken } from '../api';

interface Props {
  onLogin: (user: AuthUser) => void;
}

const DEMO_ACCOUNTS = [
  { label: 'Dealer Admin (Owner)', user: 'admin', pass: 'admin123', role: 'ADMIN' },
  { label: 'Mehra Sons (GROUP_A)', user: 'mehra', pass: 'mehra123', role: 'SUB_DEALER' },
  { label: 'Agarwal Payal (GROUP_A)', user: 'agarwal', pass: 'agarwal123', role: 'SUB_DEALER' },
  { label: 'Sharma Chains (GROUP_B)', user: 'sharma', pass: 'sharma123', role: 'SUB_DEALER' },
];

export function LoginView({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const performLogin = async (u: string, p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(u, p);
      setAuthToken(res.token);
      onLogin(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500 text-slate-950">
            <Crown className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">BullionDesk</h1>
            <p className="text-xs text-slate-400">
              RBAC-Secured Wholesale Bullion Trading OS
            </p>
          </div>
        </div>

        {error && (
          <div
            data-testid="login-error"
            className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
          >
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            performLogin(username, password);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Username or Registered Phone
            </label>
            <input
              data-testid="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. admin or mehra or +919811001122"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Password</label>
            <input
              data-testid="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
              required
            />
          </div>

          <button
            data-testid="login-submit"
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            <KeyRound className="h-4 w-4" />
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="border-t border-slate-800 pt-4 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Quick Demo Accounts (RBAC)
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.user}
                type="button"
                data-testid={`demo-login-${acc.user}`}
                onClick={() => performLogin(acc.user, acc.pass)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-left text-xs text-slate-300 hover:border-amber-500/50 hover:text-amber-300"
              >
                {acc.role === 'ADMIN' ? (
                  <ShieldCheck className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                ) : (
                  <Store className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                )}
                <div className="truncate">
                  <div className="font-semibold truncate">{acc.label}</div>
                  <div className="text-[10px] text-slate-500">
                    {acc.user} / {acc.pass}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
