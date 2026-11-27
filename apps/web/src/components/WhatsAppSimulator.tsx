import { useEffect, useState } from 'react';
import type { AuthUser, ClientProfile } from '@bullion-desk/shared';
import { MessageCircle, Send, ShieldCheck, User } from 'lucide-react';
import { api } from '../api';

interface Props {
  user: AuthUser;
  clients: ClientProfile[];
  onOrderOrRateChanged: () => void;
}

export function WhatsAppSimulator({ user, clients, onOrderOrRateChanged }: Props) {
  const defaultPhone =
    user.role === 'SUB_DEALER' && user.phone ? user.phone : '+919811001122';
  const [selectedPhone, setSelectedPhone] = useState<string>(defaultPhone);
  const [text, setText] = useState('');
  const [sendingPhone, setSendingPhone] = useState<string | null>(null);
  const isSendingCurrent = sendingPhone === selectedPhone;
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      phone: string;
      senderRole: string;
      direction: 'INBOUND' | 'OUTBOUND';
      text: string;
      timestamp: number;
    }>
  >([]);

  const loadMessages = async () => {
    const msgs = await api.getWhatsAppMessages(selectedPhone);
    setMessages(msgs);
  };

  useEffect(() => {
    loadMessages();
  }, [selectedPhone]);

  const sendMsg = async (msgText: string) => {
    const trimmed = msgText.trim();
    const targetPhone = selectedPhone;
    if (!trimmed || sendingPhone === targetPhone) return;

    // Optimistically show sent message immediately and clear input
    const optimisticId = `opt-${Date.now()}`;
    setText('');
    setSendingPhone(targetPhone);
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        phone: targetPhone,
        senderRole: targetPhone === '+919999999999' ? 'OWNER' : 'SUB_DEALER',
        direction: 'INBOUND',
        text: trimmed,
        timestamp: Date.now(),
      },
    ]);

    try {
      await api.simulateWhatsApp(targetPhone, trimmed);
      if (selectedPhone === targetPhone) {
        await loadMessages();
      }
      onOrderOrRateChanged();
    } finally {
      setSendingPhone((curr) => (curr === targetPhone ? null : curr));
    }
  };

  const isOwner = selectedPhone === '+919999999999';
  const quickChips = isOwner
    ? ['Silver cash +100', 'Aur 50 kam kar do', 'Position', 'Freeze', 'Market chalu karo']
    : ['rate kya hai', '2 peti chandi pakki kar do', 'HAA', 'mera hisab'];

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {/* Identity Selector */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
          <MessageCircle className="h-4 w-4" />
          <span>WhatsApp Agent Identities</span>
        </div>
        <p className="text-xs text-slate-400">
          Switch between Owner & Sub-Dealer phones to test autonomous WhatsApp Cloud API agents.
        </p>

        <div className="space-y-2">
          {user.role === 'ADMIN' && (
            <button
              data-testid="wa-identity-owner"
              onClick={() => setSelectedPhone('+919999999999')}
              className={`w-full flex items-center gap-2.5 rounded-lg border p-3 text-left text-xs transition ${
                isOwner
                  ? 'border-amber-500 bg-amber-500/10 text-amber-200'
                  : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
              }`}
            >
              <ShieldCheck className="h-4 w-4 text-amber-400 shrink-0" />
              <div>
                <div className="font-bold">Bullion House Owner</div>
                <div className="text-slate-400">+919999999999 • Admin Agent</div>
              </div>
            </button>
          )}

          {clients.map((c) => (
            <button
              key={c.id}
              data-testid={`wa-identity-${c.id}`}
              onClick={() => setSelectedPhone(c.phone)}
              className={`w-full flex items-center gap-2.5 rounded-lg border p-3 text-left text-xs transition ${
                selectedPhone === c.phone
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
                  : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
              }`}
            >
              <User className="h-4 w-4 text-emerald-400 shrink-0" />
              <div>
                <div className="font-bold">{c.firmName}</div>
                <div className="text-slate-400">
                  {c.phone} • {c.clientGroup}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* WhatsApp Chat Window */}
      <div className="md:col-span-2 flex flex-col rounded-xl border border-slate-800 bg-slate-950 overflow-hidden h-[520px]">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-slate-950 font-bold text-xs">
              WA
            </div>
            <div>
              <div className="text-sm font-bold text-slate-100">
                Shubh Jewellers Bot ({isOwner ? 'Owner Mode' : 'Sub-Dealer Mode'})
              </div>
              <div className="text-[11px] text-emerald-400">
                Active Webhook: {selectedPhone}
              </div>
            </div>
          </div>
        </div>

        <div
          data-testid="wa-chat-history"
          className="flex-1 overflow-y-auto p-4 space-y-3 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 to-slate-950"
        >
          {messages.length === 0 && !isSendingCurrent && (
            <div className="text-center text-xs text-slate-500 py-12">
              Send a Hinglish WhatsApp message below to interact with the Shubh Jewellers agent.
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.direction === 'INBOUND' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-3.5 py-2 text-xs whitespace-pre-line shadow ${
                  m.direction === 'INBOUND'
                    ? 'bg-emerald-700 text-white rounded-br-none'
                    : 'bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          {isSendingCurrent && (
            <div className="flex justify-start" data-testid="wa-typing-indicator">
              <div className="rounded-xl rounded-bl-none border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs text-slate-400 animate-pulse">
                Shubh Jewellers Bot is typing...
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-800 bg-slate-900/90 p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {quickChips.map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={isSendingCurrent}
                onClick={() => sendMsg(chip)}
                className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-300 hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-40"
              >
                {chip}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMsg(text);
            }}
            className="flex gap-2"
          >
            <input
              data-testid="wa-message-input"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type WhatsApp message (e.g. 'rate kya hai' or '2 peti chandi pakki kar do')..."
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
            <button
              data-testid="wa-send-btn"
              type="submit"
              disabled={isSendingCurrent || !text.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {isSendingCurrent ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
