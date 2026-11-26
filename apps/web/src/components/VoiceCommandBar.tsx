import { useRef, useState } from 'react';
import { Mic, MicOff, Send, Sparkles } from 'lucide-react';
import { api } from '../api';

interface Props {
  role: 'DEALER' | 'CLIENT';
  sessionId: string;
  clientId?: string;
  samples: string[];
  onExecuted: (orderCreated?: boolean) => void;
}

export function VoiceCommandBar({ role, sessionId, clientId, samples, onExecuted }: Props) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [result, setResult] = useState<{
    message: string;
    usedContext: boolean;
    executed: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  const runCommand = async (cmdText: string) => {
    const trimmed = cmdText.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const res = await api.sendAiCommand({
        text: trimmed,
        sessionId,
        role,
        clientId,
        autoExecute: true,
      });
      setResult({
        message: res.message,
        usedContext: res.parsed.usedContext,
        executed: res.executed,
      });
      setText('');
      onExecuted(Boolean(res.order));
    } catch (err) {
      setResult({
        message: (err as Error).message,
        usedContext: false,
        executed: false,
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleMic = () => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SpeechRec) {
      setResult({
        message: 'Browser microphone SpeechRecognition unavailable; type Hinglish command below.',
        usedContext: false,
        executed: false,
      });
      return;
    }

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const rec = new SpeechRec() as {
      lang: string;
      interimResults: boolean;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? '';
      setText(transcript);
      runCommand(transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <div
      data-testid={`voice-bar-${role.toLowerCase()}`}
      className="rounded-xl border border-amber-500/30 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/20 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
          <Sparkles className="h-4 w-4" />
          <span>
            {role === 'DEALER'
              ? 'AI Voice & Hinglish Desk Command (Context-Aware)'
              : 'AI Hinglish Voice Sauda Booking'}
          </span>
        </div>
        <span className="text-[11px] text-slate-400">Session: {sessionId}</span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runCommand(text);
        }}
        className="flex gap-2"
      >
        <button
          type="button"
          onClick={toggleMic}
          className={`flex items-center justify-center rounded-lg px-3 py-2 transition ${
            listening
              ? 'bg-rose-500 text-white animate-pulse'
              : 'border border-slate-700 bg-slate-950 text-amber-400 hover:bg-slate-800'
          }`}
          title="Speak Hinglish command"
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>

        <input
          data-testid={`voice-input-${role.toLowerCase()}`}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            role === 'DEALER'
              ? 'e.g. "Silver cash 100 badha do" then "Aur 50 kam kar do"'
              : 'e.g. "2 peti chandi pakki kar do"'
          }
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
        />

        <button
          data-testid={`voice-submit-${role.toLowerCase()}`}
          type="submit"
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          Execute
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {samples.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => runCommand(s)}
            className="rounded-full border border-slate-700/80 bg-slate-950/70 px-2.5 py-1 text-[11px] text-slate-300 hover:border-amber-500/50 hover:text-amber-300"
          >
            “{s}”
          </button>
        ))}
      </div>

      {result && (
        <div
          data-testid={`voice-result-${role.toLowerCase()}`}
          className={`rounded-lg px-3 py-2 text-xs border ${
            result.executed
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          }`}
        >
          {result.usedContext && (
            <span className="mr-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
              CONTEXT RESOLVED
            </span>
          )}
          {result.message}
        </div>
      )}
    </div>
  );
}
