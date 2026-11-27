import { useRef, useState } from 'react';
import { transliterateDevanagariToHinglish } from '@bullion-desk/shared';
import { CheckCircle2, Loader2, Mic, MicOff, Send, Sparkles, XCircle } from 'lucide-react';
import { api } from '../api';

interface Props {
  role: 'DEALER' | 'CLIENT';
  sessionId: string;
  clientId?: string;
  samples: string[];
  onExecuted: (orderCreated?: boolean) => void;
  onOpenOrderTicket?: (draft: {
    scripId: string;
    side: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT';
    qtyUnits: number;
    limitRate?: number;
  }) => void;
}

export function VoiceCommandBar({
  role,
  sessionId,
  clientId,
  samples,
  onExecuted,
  onOpenOrderTicket,
}: Props) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [preview, setPreview] = useState<{
    originalText: string;
    intent: string;
    explanation: string;
    usedContext: boolean;
  } | null>(null);
  const [result, setResult] = useState<{
    message: string;
    usedContext: boolean;
    executed: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isBusy = loading || transcribing || listening;

  const previewCommand = async (cmdText: string) => {
    const trimmed = cmdText.trim();
    if (!trimmed || isBusy) return;
    setLoading(true);
    setResult(null);
    setPreview(null);
    try {
      const res = await api.sendAiCommand({
        text: trimmed,
        sessionId,
        role,
        clientId,
        autoExecute: false,
      });

      // For sub-dealer order commands, open the Order Ticket Modal pre-filled so they only confirm once
      if (
        role === 'CLIENT' &&
        res.parsed.intent === 'PLACE_ORDER' &&
        res.parsed.targetScripIds?.[0] &&
        onOpenOrderTicket
      ) {
        onOpenOrderTicket({
          scripId: res.parsed.targetScripIds[0],
          side: res.parsed.side ?? 'BUY',
          orderType: res.parsed.limitRate ? 'LIMIT' : 'MARKET',
          qtyUnits: res.parsed.qtyUnits ?? 1,
          limitRate: res.parsed.limitRate,
        });
        setText('');
        return;
      }

      // Read-only queries execute immediately like an AI assistant (no confirmation step needed)
      if (res.parsed.intent === 'QUERY_RATE' || res.parsed.intent === 'QUERY_POSITION') {
        const execRes = await api.sendAiCommand({
          text: trimmed,
          sessionId,
          role,
          clientId,
          autoExecute: true,
        });
        setResult({
          message: execRes.message,
          usedContext: execRes.parsed.usedContext,
          executed: execRes.executed,
        });
        setText('');
        return;
      }

      setPreview({
        originalText: trimmed,
        intent: res.parsed.intent,
        explanation: res.parsed.explanation,
        usedContext: res.parsed.usedContext,
      });
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

  const confirmExecute = async () => {
    if (!preview || isBusy) return;
    setLoading(true);
    try {
      const res = await api.sendAiCommand({
        text: preview.originalText,
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
      setPreview(null);
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

  const toggleMic = async () => {
    if (listening) {
      recognitionRef.current?.stop();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setListening(false);
      return;
    }

    if (loading || transcribing) return;

    setPreview(null);
    setResult(null);

    // 1. Start MediaRecorder for high-accuracy server-side Hinglish Audio STT (Agy Multimodal)
    if (navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunksRef.current = [];
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          if (blob.size < 500) return;
          setTranscribing(true);
          try {
            const reader = new FileReader();
            const base64: string = await new Promise((resolve, reject) => {
              reader.onloadend = () => {
                const res = String(reader.result ?? '');
                resolve(res.split(',')[1] ?? '');
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            if (base64) {
              const stt = await api.transcribeAudio(base64, blob.type || 'audio/webm');
              if (stt.transcript) {
                setText(transliterateDevanagariToHinglish(stt.transcript));
              }
            }
          } catch {
            // Keep browser live transcript if server STT fails
          } finally {
            setTranscribing(false);
          }
        };
        mediaRecorderRef.current = recorder;
        recorder.start();
        setListening(true);
      } catch {
        setResult({
          message: 'Microphone permission denied or unavailable.',
          usedContext: false,
          executed: false,
        });
        return;
      }
    }

    // 2. Also run browser SpeechRecognition for instant live typing feedback while speaking
    const SpeechRec =
      (
        window as unknown as {
          SpeechRecognition?: new () => unknown;
          webkitSpeechRecognition?: new () => unknown;
        }
      ).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (SpeechRec) {
      const rec = new SpeechRec() as {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        onresult: (e: {
          results: ArrayLike<ArrayLike<{ transcript: string }>>;
        }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
        stop: () => void;
      };
      rec.lang = 'hi-IN';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (e) => {
        const parts: string[] = [];
        for (let i = 0; i < e.results.length; i++) {
          const chunk = e.results[i]?.[0]?.transcript?.trim();
          if (chunk) parts.push(chunk);
        }
        setText(transliterateDevanagariToHinglish(parts.join(' ')));
      };
      rec.onerror = () => {};
      rec.onend = () => {};
      recognitionRef.current = rec;
      rec.start();
    }
  };

  const buttonLabel = transcribing ? 'Refining...' : loading ? 'Processing...' : 'Execute';

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
              : 'AI Hinglish Voice Sauda & Rate Assistant'}
          </span>
        </div>
        <span className="text-[11px] text-slate-400">
          {listening
            ? 'Recording... (click mic to stop)'
            : transcribing
              ? 'Refining Hinglish via AI Audio STT...'
              : loading
                ? 'Processing with AI Agent...'
                : `Session: ${sessionId}`}
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          previewCommand(text);
        }}
        className="flex gap-2"
      >
        <button
          type="button"
          onClick={toggleMic}
          disabled={loading || transcribing}
          className={`flex items-center justify-center rounded-lg px-3 py-2 transition disabled:opacity-50 ${
            listening
              ? 'bg-rose-500 text-white animate-pulse'
              : 'border border-slate-700 bg-slate-950 text-amber-400 hover:bg-slate-800'
          }`}
          title="Speak Hinglish command (types into box for review)"
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>

        <input
          ref={inputRef}
          data-testid={`voice-input-${role.toLowerCase()}`}
          type="text"
          value={text}
          disabled={loading || transcribing}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            role === 'DEALER'
              ? 'Speak or type: "Silver cash 100 badha do" then click Execute'
              : 'Speak or type: "bhav kya chal raha hai" or "2 peti chandi pakki kar do"'
          }
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none disabled:opacity-60"
        />

        <button
          data-testid={`voice-submit-${role.toLowerCase()}`}
          type="submit"
          disabled={isBusy || !text.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {loading || transcribing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {buttonLabel}
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {samples.map((s) => (
          <button
            key={s}
            type="button"
            disabled={isBusy}
            onClick={() => {
              setText(s);
              previewCommand(s);
            }}
            className="rounded-full border border-slate-700/80 bg-slate-950/70 px-2.5 py-1 text-[11px] text-slate-300 hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-40"
          >
            “{s}”
          </button>
        ))}
      </div>

      {/* Confirmation Preview Step before Executing Admin/Complex Mutations */}
      {preview && (
        <div
          data-testid={`voice-preview-${role.toLowerCase()}`}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3.5 py-2.5 text-xs"
        >
          <div className="space-y-0.5">
            <div className="font-bold text-amber-300">
              Confirm AI Action ({preview.intent})
              {preview.usedContext && (
                <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px]">
                  CONTEXT RESOLVED
                </span>
              )}
            </div>
            <div className="text-slate-200">{preview.explanation}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid={`voice-confirm-${role.toLowerCase()}`}
              disabled={isBusy}
              onClick={confirmExecute}
              className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Confirm & Run
            </button>
            <button
              type="button"
              data-testid={`voice-cancel-${role.toLowerCase()}`}
              disabled={isBusy}
              onClick={() => {
                setPreview(null);
                inputRef.current?.focus();
              }}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-300 hover:bg-slate-800"
            >
              <XCircle className="h-3.5 w-3.5" />
              Edit
            </button>
          </div>
        </div>
      )}

      {result && (
        <div
          data-testid={`voice-result-${role.toLowerCase()}`}
          className={`rounded-lg px-3 py-2 text-xs border whitespace-pre-line ${
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
