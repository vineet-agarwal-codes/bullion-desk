import { execFile } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { ScripConfig } from '@bullion-desk/shared';
import type { AiSessionContext } from './aiCommandService.js';

const execFileAsync = promisify(execFile);

const AGY_BIN = process.env.AGY_BIN ?? '/home/ubuntu/.local/bin/agy';
const AGY_MODEL = process.env.AGY_LLM_MODEL ?? 'Gemini 3.8 Flash (Low)';

export interface LlmIntentOutput {
  intent:
    | 'ADJUST_OFFSET'
    | 'SET_OFFSET'
    | 'SET_SPREAD'
    | 'FREEZE_MARKET'
    | 'UNFREEZE_MARKET'
    | 'PLACE_ORDER'
    | 'QUERY_RATE'
    | 'QUERY_POSITION'
    | 'CLARIFY'
    | 'UNKNOWN';
  confidence: number;
  metal?: 'GOLD' | 'SILVER';
  settlement?: 'RTGS' | 'CASH';
  purity?: number;
  targetScripIds: string[];
  delta?: number;
  value?: number;
  side?: 'BUY' | 'SELL';
  qtyUnits?: number;
  limitRate?: number;
  explanation: string;
  clarificationQuestion?: string;
  usedContext: boolean;
}

const INTENT_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [
        'ADJUST_OFFSET',
        'SET_OFFSET',
        'SET_SPREAD',
        'FREEZE_MARKET',
        'UNFREEZE_MARKET',
        'PLACE_ORDER',
        'QUERY_RATE',
        'QUERY_POSITION',
        'CLARIFY',
        'UNKNOWN',
      ],
    },
    confidence: { type: 'number' },
    metal: { type: 'string', enum: ['GOLD', 'SILVER'] },
    settlement: { type: 'string', enum: ['RTGS', 'CASH'] },
    purity: { type: 'number' },
    targetScripIds: { type: 'array', items: { type: 'string' } },
    delta: { type: 'number' },
    value: { type: 'number' },
    side: { type: 'string', enum: ['BUY', 'SELL'] },
    qtyUnits: { type: 'number' },
    limitRate: { type: 'number' },
    explanation: { type: 'string' },
    clarificationQuestion: { type: 'string' },
    usedContext: { type: 'boolean' },
  },
  required: ['intent', 'confidence', 'targetScripIds', 'explanation', 'usedContext'],
});

export async function parseIntentWithAgy(
  userText: string,
  role: 'DEALER' | 'CLIENT',
  scrips: ScripConfig[],
  context: AiSessionContext
): Promise<LlmIntentOutput | null> {
  if (process.env.ENABLE_AGY_LLM !== 'true') {
    return null;
  }

  const scripSummary = scrips
    .filter((s) => s.isActive)
    .map((s) => `${s.id} (${s.name}, ${s.metal}, ${s.settlement}, purity=${s.purity}, unit=${s.unit})`)
    .join('\n');

  const prompt = [
    'You are the BullionDesk AI Intent & MCP Tool Router for an Indian wholesale bullion house (Shubh Jewellers).',
    'Convert the user message (Hinglish, Hindi, or English) into a structured JSON intent.',
    `User Role: ${role}`,
    `Session Context: ${JSON.stringify(context)}`,
    'Available Scrips:',
    scripSummary,
    'Domain Rules:',
    '- "peti" = silver-999-peti-cash (30kg Silver Bar). "chorsa" = 1kg Silver.',
    '- "pakki kar do" / "pakka kar do" means confirm/lock the deal (NOT RTGS), whereas "pakka bill" / "rtgs" / "gst" means RTGS.',
    '- "bhau" / "bhav" / "bhaav" / "rate" / "kya chal raha" / "chalra" = QUERY_RATE (never PLACE_ORDER!).',
    '- "dedh" = 1.5, "dhai" = 2.5, "sadhe teen" = 3.5, "dus" = 10, "sau" = 100.',
    '- If user says "aur 50 kam kar do" without naming metal/settlement, use Session Context and set usedContext=true.',
    '- If a message is conversational greeting or unclear, return intent="UNKNOWN" or "CLARIFY".',
    `User Message: ${JSON.stringify(userText)}`,
  ].join('\n');

  try {
    const { stdout } = await execFileAsync(
      AGY_BIN,
      [
        `--print=${prompt}`,
        '--model',
        AGY_MODEL,
        '--output-format',
        'json',
        '--json-schema',
        INTENT_JSON_SCHEMA,
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout) as {
      status?: string;
      structured_output?: LlmIntentOutput;
    };
    if (parsed.status === 'SUCCESS' && parsed.structured_output) {
      return parsed.structured_output;
    }
    return null;
  } catch {
    return null;
  }
}

export async function transcribeAudioWithAgy(
  audioBase64: string,
  mimeType: string = 'audio/webm'
): Promise<{ transcript: string; provider: 'AGY_MULTIMODAL' }> {
  const id = randomUUID();
  const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp4') ? 'mp4' : 'webm';
  const rawPath = `/tmp/bullion-audio-${id}.${ext}`;
  const wavPath = `/tmp/bullion-audio-${id}.wav`;

  try {
    await writeFile(rawPath, Buffer.from(audioBase64, 'base64'));
    // Convert to 16kHz mono WAV for clean multimodal ingestion
    try {
      await execFileAsync('ffmpeg', ['-y', '-i', rawPath, '-ar', '16000', '-ac', '1', wavPath], {
        timeout: 10_000,
      });
    } catch {
      // If ffmpeg conversion fails, fall back to raw file
    }

    const targetPath = (await import('node:fs')).existsSync(wavPath) ? wavPath : rawPath;
    const schema = JSON.stringify({
      type: 'object',
      properties: { transcript: { type: 'string' } },
      required: ['transcript'],
    });
    const prompt = [
      `Read the audio file at ${targetPath} and transcribe what the speaker said.`,
      'The speaker is an Indian bullion trader speaking Hinglish, Hindi, or English.',
      'Bullion glossary: peti, chorsa, rawa, chandi, sona, bhaav, bhav, pakki, kaccha, badla, rtgs, spread, badha, kam, dedh, dhai, dus.',
      'CRITICAL: Always output the transcript in Hinglish (Latin script, e.g. "dedh peti chandi pakki kar do"), NEVER in Devanagari script.',
    ].join(' ');

    const { stdout } = await execFileAsync(
      AGY_BIN,
      [
        `--print=${prompt}`,
        '--model',
        AGY_MODEL,
        '--output-format',
        'json',
        '--json-schema',
        schema,
      ],
      { timeout: 25_000, maxBuffer: 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout) as {
      status?: string;
      structured_output?: { transcript?: string };
    };
    const transcript = parsed.structured_output?.transcript?.trim() ?? '';
    return { transcript, provider: 'AGY_MULTIMODAL' };
  } finally {
    await unlink(rawPath).catch(() => {});
    await unlink(wavPath).catch(() => {});
  }
}
