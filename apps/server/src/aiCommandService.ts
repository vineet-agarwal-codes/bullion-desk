import {
  replaceHindiNumbers,
  transliterateDevanagariToHinglish,
  type MetalType,
  type Order,
  type ScripConfig,
  type SettlementType,
} from '@bullion-desk/shared';
import type { MarketService } from './marketService.js';
import { executeMcpTool } from './mcpTools.js';
import { parseIntentWithAgy } from './llmRouter.js';
import { formatBullionRatesMessage } from './rateFormatter.js';

export interface AiSessionContext {
  lastMetal?: MetalType;
  lastSettlement?: SettlementType;
  lastPurity?: number;
  lastScripId?: string;
}

export type AiIntentType =
  | 'ADJUST_OFFSET'
  | 'SET_OFFSET'
  | 'SET_SPREAD'
  | 'FREEZE_MARKET'
  | 'UNFREEZE_MARKET'
  | 'PLACE_ORDER'
  | 'QUERY_RATE'
  | 'QUERY_POSITION'
  | 'UNKNOWN';

export interface AiParsedCommand {
  intent: AiIntentType;
  confidence: number;
  metal?: MetalType;
  settlement?: SettlementType;
  purity?: number;
  targetScripIds: string[];
  delta?: number;
  value?: number;
  side?: 'BUY' | 'SELL';
  qtyUnits?: number;
  limitRate?: number;
  explanation: string;
  usedContext: boolean;
}

export interface AiCommandResponse {
  parsed: AiParsedCommand;
  executed: boolean;
  message: string;
  updatedScrips?: ScripConfig[];
  order?: Order;
  context: AiSessionContext;
}

function normalizeHinglishText(raw: string): string {
  let text = transliterateDevanagariToHinglish(raw).toLowerCase().trim();
  // Protect Hindi verb endings "kar do" / "karde" before converting "do" -> 2
  text = text.replace(/\bkar\s+do\b/g, 'karo').replace(/\bkarde\b/g, 'karo');
  // Common STT phonetic corrections for bullion terms
  text = text
    .replace(/\b(petti|patti|patty|paiti)\b/g, 'peti')
    .replace(/\b(shandi|chandy|sandi)\b/g, 'chandi');
  text = replaceHindiNumbers(text);
  return text.replace(/\s+/g, ' ').trim();
}

export class AiCommandService {
  private sessions = new Map<string, AiSessionContext>();

  constructor(private market: MarketService) {}

  getContext(sessionId: string): AiSessionContext {
    return this.sessions.get(sessionId) ?? {};
  }

  parseCommand(
    rawText: string,
    sessionId: string,
    role: 'DEALER' | 'CLIENT' = 'DEALER'
  ): AiParsedCommand {
    const text = normalizeHinglishText(rawText);
    const ctx = this.getContext(sessionId);
    let usedContext = false;

    // 1. Freeze / Unfreeze intents
    if (/\b(unfreeze|chalu|kholo|resume|start|on)\b/.test(text) && /\b(rate|market|trading|sab|unfreeze|resume|chalu|kholo)\b/.test(text)) {
      return {
        intent: 'UNFREEZE_MARKET',
        confidence: 0.95,
        targetScripIds: [],
        explanation: 'Resume live market trading and unfreeze all rates',
        usedContext: false,
      };
    }

    if (/\b(freeze|band|rok|halt|stop)\b/.test(text)) {
      return {
        intent: 'FREEZE_MARKET',
        confidence: 0.95,
        targetScripIds: [],
        explanation: 'Activate Kill Switch: Freeze all live rates (Call for Rate)',
        usedContext: false,
      };
    }

    // 2. Position / Exposure query
    if (/\b(position|exposure|bhaav book|net|hisab|balance)\b/.test(text)) {
      return {
        intent: 'QUERY_POSITION',
        confidence: 0.9,
        targetScripIds: [],
        explanation: 'Query current net exposure / ledger balance',
        usedContext: false,
      };
    }

    // 3. Detect Metal, Settlement, Purity
    let metal: MetalType | undefined;
    if (/\b(gold|sona|peela|rawa)\b/.test(text)) metal = 'GOLD';
    else if (/\b(silver|chandi|safed|peti|chorsa|payal)\b/.test(text)) metal = 'SILVER';

    let settlement: SettlementType | undefined;
    if (/\b(rtgs|gst|bill)\b/.test(text) || /\bpakka\s+bill\b/.test(text)) settlement = 'RTGS';
    else if (/\b(cash|kaccha|kachha|badla|rokda)\b/.test(text)) settlement = 'CASH';

    let purity: number | undefined;
    if (/\b(999\.9|9999)\b/.test(text)) purity = 999.9;
    else if (/\b(24k|100%|1000|pure)\b/.test(text)) purity = 1000;
    else if (/\b995\b/.test(text)) purity = 995;
    else if (/\b999\b/.test(text)) purity = 999;

    const isPeti = /\bpeti\b/.test(text);

    // 4. Rate Query (supports rate, bhaav, bhav, bhau, kya chal raha/chalra, batao, etc.)
    const hasRateWord = /\b(rate|rates|bhaav|bhav|bhau|price|prices|quote|quotes|market)\b/.test(text);
    const hasRateQuestion = /\b(kya hai|kya chal|chalra|chal raha|batao|dikhao|kitna)\b/.test(text);
    const isAdjustOrOrderVerb = /\b(badha|kam|ghata|plus|minus|set|book|pakki|buy|khareed|khareedo|sell|bech|becho|laga|order)\b/.test(
      text
    );
    if ((hasRateWord || hasRateQuestion) && !isAdjustOrOrderVerb) {
      if (!metal && ctx.lastMetal) {
        metal = ctx.lastMetal;
        usedContext = true;
      }
      const scrips = this.resolveTargetScrips(metal, settlement, purity, isPeti);
      return {
        intent: 'QUERY_RATE',
        confidence: 0.9,
        metal,
        settlement,
        purity,
        targetScripIds: scrips.map((s) => s.id),
        explanation: `Fetch live rates for ${metal ?? 'all metals'} ${settlement ?? ''}`.trim(),
        usedContext,
      };
    }

    // 5. Order Placement (MUST have explicit order verb or unit+qty — never blindly place an order!)
    const isOrderVerb = /\b(book|pakki|buy|khareed|khareedo|sell|bech|becho|laga|order|le lo|de do)\b/.test(
      text
    );
    const hasOrderUnit = /\b(peti|chorsa|kg|kilo|g|gm|gram|tola|tora)\b/.test(text);
    if (isOrderVerb || (role === 'CLIENT' && hasOrderUnit && /\d/.test(text))) {
      const side: 'BUY' | 'SELL' = /\b(sell|bech)\b/.test(text) ? 'SELL' : 'BUY';
      if (!metal && ctx.lastMetal) {
        metal = ctx.lastMetal;
        usedContext = true;
      }
      if (!metal) metal = 'SILVER'; // default for peti/chandi if unspecified
      if (!settlement) settlement = isPeti ? 'CASH' : (ctx.lastSettlement ?? 'RTGS');

      const scrips = this.resolveTargetScrips(metal, settlement, purity, isPeti);
      const targetScrip = scrips[0];

      // Parse qty
      const qtyMatch = text.match(/(\d+(?:\.\d+)?)\s*(peti|chorsa|kg|kilo|g|gm|gram|tola|tora)?/);
      let qtyUnits = qtyMatch ? Number(qtyMatch[1]) : 1;
      const unitToken = qtyMatch?.[2];

      if (targetScrip) {
        if (unitToken === 'kg' || unitToken === 'kilo') {
          qtyUnits = Math.max(1, Math.round((qtyUnits * 1000) / targetScrip.unitGrams));
        } else if (unitToken === 'g' || unitToken === 'gm' || unitToken === 'gram') {
          qtyUnits = Math.max(1, Math.round(qtyUnits / targetScrip.unitGrams));
        }
      }

      // Check limit price ("94000 pe")
      const limitMatch = text.match(/(?:pe|at|@|limit)\s*(\d{4,7})/);
      const limitRate = limitMatch ? Number(limitMatch[1]) : undefined;

      return {
        intent: 'PLACE_ORDER',
        confidence: targetScrip ? 0.9 : 0.5,
        metal,
        settlement,
        purity,
        targetScripIds: targetScrip ? [targetScrip.id] : [],
        side,
        qtyUnits,
        limitRate,
        explanation: `${side} ${qtyUnits} unit(s) of ${targetScrip?.name ?? metal}${limitRate ? ` @ Limit ₹${limitRate}` : ' at Market'}`,
        usedContext,
      };
    }

    // 6. Dealer Price / Spread Modifications (with Context Carryover for ambiguous inputs)
    if (!metal && ctx.lastMetal) {
      metal = ctx.lastMetal;
      usedContext = true;
    }
    if (!settlement && ctx.lastSettlement && usedContext) {
      settlement = ctx.lastSettlement;
    }
    if (!purity && ctx.lastPurity && usedContext) {
      purity = ctx.lastPurity;
    }

    const scrips =
      usedContext && ctx.lastScripId && !rawText.toLowerCase().includes('sab') && !rawText.toLowerCase().includes('all')
        ? [this.market.getScrip(ctx.lastScripId)!].filter(Boolean)
        : this.resolveTargetScrips(metal, settlement, purity, isPeti);

    // Strip purity tokens before extracting offset/spread numeric values so "Gold 995" doesn't capture 995
    const valueText = text.replace(/\b(999\.9|9999|999|995|24k|100%)\b/g, ' ');

    // Detect spread change
    if (/\b(spread|bid)\b/.test(valueText)) {
      const spreadAfterMatch = valueText.match(/(?:spread|bid)[^\d]*(\d+)/);
      const numMatch = spreadAfterMatch ?? valueText.match(/(\d+)/);
      if (numMatch) {
        const val = Number(numMatch[1]);
        return {
          intent: 'SET_SPREAD',
          confidence: 0.9,
          metal,
          settlement,
          purity,
          targetScripIds: scrips.map((s) => s.id),
          value: val,
          explanation: `Set Bid-Ask spread to ₹${val} for ${scrips.map((s) => s.code).join(', ')}`,
          usedContext,
        };
      }
    }

    // Detect relative offset adjustment (+ / - / badha / kam / ghata)
    const signedMatch = valueText.match(/([+-])\s*(\d+)/);
    const numMatch = valueText.match(/(\d+)/);
    const isIncrease = /\b(badha|badhao|increase|up|add|plus)\b/.test(text) || signedMatch?.[1] === '+';
    const isDecrease = /\b(kam|ghata|ghatao|decrease|down|reduce|minus)\b/.test(text) || signedMatch?.[1] === '-';

    if ((isIncrease || isDecrease) && numMatch) {
      const magnitude = signedMatch ? Number(signedMatch[2]) : Number(numMatch[1]);
      const delta = isDecrease ? -magnitude : magnitude;
      return {
        intent: 'ADJUST_OFFSET',
        confidence: scrips.length > 0 ? 0.92 : 0.4,
        metal,
        settlement,
        purity,
        targetScripIds: scrips.map((s) => s.id),
        delta,
        explanation: `Adjust manual offset by ${delta >= 0 ? `+₹${delta}` : `-₹${Math.abs(delta)}`} on ${scrips.map((s) => s.code).join(', ')}`,
        usedContext,
      };
    }

    // Detect absolute offset ("offset 300 kar do")
    if (/\b(offset|premium|margin)\b/.test(text) && numMatch) {
      const val = Number(numMatch[1]);
      return {
        intent: 'SET_OFFSET',
        confidence: 0.88,
        metal,
        settlement,
        purity,
        targetScripIds: scrips.map((s) => s.id),
        value: val,
        explanation: `Set manual offset to +₹${val} on ${scrips.map((s) => s.code).join(', ')}`,
        usedContext,
      };
    }

    return {
      intent: 'UNKNOWN',
      confidence: 0.1,
      targetScripIds: [],
      explanation: `Could not unambiguously parse: "${rawText}"`,
      usedContext,
    };
  }

  private resolveTargetScrips(
    metal?: MetalType,
    settlement?: SettlementType,
    purity?: number,
    isPeti?: boolean
  ): ScripConfig[] {
    let all = this.market.listScrips().filter((s) => s.isActive);
    if (metal) all = all.filter((s) => s.metal === metal);
    if (settlement) all = all.filter((s) => s.settlement === settlement);
    if (purity) all = all.filter((s) => s.purity === purity);
    if (isPeti) {
      const peti = all.filter((s) => s.unit === '30KG_PETI');
      if (peti.length > 0) return peti;
    }
    // Prefer 1KG standard over 30KG peti for general silver price adjustments unless peti specified
    if (metal === 'SILVER' && !isPeti && all.length > 1) {
      const standard = all.filter((s) => s.unit !== '30KG_PETI');
      if (standard.length > 0) return standard;
    }
    return all;
  }

  executeCommand(
    rawText: string,
    sessionId: string,
    options: { role?: 'DEALER' | 'CLIENT'; clientId?: string; autoExecute?: boolean; source?: 'WEB' | 'WHATSAPP' | 'VOICE' } = {}
  ): AiCommandResponse {
    const role = options.role ?? 'DEALER';
    const parsed = this.parseCommand(rawText, sessionId, role);
    return this.applyParsedCommand(rawText, parsed, sessionId, options);
  }

  async executeCommandAsync(
    rawText: string,
    sessionId: string,
    options: {
      role?: 'DEALER' | 'CLIENT';
      clientId?: string;
      autoExecute?: boolean;
      source?: 'WEB' | 'WHATSAPP' | 'VOICE';
    } = {}
  ): Promise<AiCommandResponse> {
    const role = options.role ?? 'DEALER';
    const ctx = this.getContext(sessionId);
    const llmOut = await parseIntentWithAgy(rawText, role, this.market.listScrips(), ctx);
    const parsed: AiParsedCommand =
      llmOut && llmOut.intent !== 'CLARIFY'
        ? {
            intent: llmOut.intent,
            confidence: llmOut.confidence,
            metal: llmOut.metal,
            settlement: llmOut.settlement,
            purity: llmOut.purity,
            targetScripIds: llmOut.targetScripIds,
            delta: llmOut.delta,
            value: llmOut.value,
            side: llmOut.side,
            qtyUnits: llmOut.qtyUnits,
            limitRate: llmOut.limitRate,
            explanation: llmOut.explanation,
            usedContext: llmOut.usedContext,
          }
        : llmOut?.intent === 'CLARIFY'
          ? {
              intent: 'UNKNOWN',
              confidence: llmOut.confidence,
              targetScripIds: [],
              explanation: llmOut.clarificationQuestion ?? llmOut.explanation,
              usedContext: llmOut.usedContext,
            }
          : this.parseCommand(rawText, sessionId, role);

    return this.applyParsedCommand(rawText, parsed, sessionId, options);
  }

  private applyParsedCommand(
    _rawText: string,
    parsed: AiParsedCommand,
    sessionId: string,
    options: {
      role?: 'DEALER' | 'CLIENT';
      clientId?: string;
      autoExecute?: boolean;
      source?: 'WEB' | 'WHATSAPP' | 'VOICE';
    } = {}
  ): AiCommandResponse {
    const role = options.role ?? 'DEALER';

    // Update session context if metal/settlement/scrip resolved
    const prevCtx = this.getContext(sessionId);
    const nextCtx: AiSessionContext = {
      lastMetal: parsed.metal ?? prevCtx.lastMetal,
      lastSettlement: parsed.settlement ?? prevCtx.lastSettlement,
      lastPurity: parsed.purity ?? prevCtx.lastPurity,
      lastScripId:
        parsed.targetScripIds.length === 1 ? parsed.targetScripIds[0] : prevCtx.lastScripId,
    };
    this.sessions.set(sessionId, nextCtx);

    if (options.autoExecute === false) {
      return {
        parsed,
        executed: false,
        message: parsed.explanation,
        context: nextCtx,
      };
    }

    const mcpUser = {
      role: role === 'DEALER' ? ('ADMIN' as const) : ('SUB_DEALER' as const),
      clientId: options.clientId ?? 'client-mehra',
      clientGroup: 'GROUP_B' as const,
    };

    switch (parsed.intent) {
      case 'FREEZE_MARKET': {
        executeMcpTool(this.market, 'toggle_market_freeze', { isFrozen: true, reason: 'Voice/AI Command Freeze' }, mcpUser, options.source ?? 'VOICE');
        return {
          parsed,
          executed: true,
          message: 'Market FROZEN. All client boards now display Call for Rate.',
          context: nextCtx,
        };
      }
      case 'UNFREEZE_MARKET': {
        executeMcpTool(this.market, 'toggle_market_freeze', { isFrozen: false, reason: '' }, mcpUser, options.source ?? 'VOICE');
        return {
          parsed,
          executed: true,
          message: 'Market RESUMED. Live rates active.',
          context: nextCtx,
        };
      }
      case 'ADJUST_OFFSET': {
        if (parsed.targetScripIds.length === 0 || parsed.delta === undefined) {
          return { parsed, executed: false, message: 'No matching scrips found to adjust.', context: nextCtx };
        }
        const res = executeMcpTool(
          this.market,
          'adjust_scrip_offset',
          { scripIds: parsed.targetScripIds, delta: parsed.delta },
          mcpUser,
          options.source ?? 'VOICE'
        );
        const updatedScrips = res.result as ScripConfig[];
        return {
          parsed,
          executed: updatedScrips.length > 0,
          message:
            updatedScrips.length > 0
              ? `Updated ${updatedScrips.map((s) => `${s.code} (offset ${s.manualOffset >= 0 ? '+' : ''}${s.manualOffset})`).join(', ')}`
              : 'No matching scrips found to adjust.',
          updatedScrips,
          context: nextCtx,
        };
      }
      case 'SET_OFFSET': {
        const updatedScrips: ScripConfig[] = [];
        for (const id of parsed.targetScripIds) {
          if (parsed.value !== undefined) {
            updatedScrips.push(this.market.updateScrip(id, { manualOffset: parsed.value }));
          }
        }
        return {
          parsed,
          executed: updatedScrips.length > 0,
          message: `Set offset to ₹${parsed.value} on ${updatedScrips.map((s) => s.code).join(', ')}`,
          updatedScrips,
          context: nextCtx,
        };
      }
      case 'SET_SPREAD': {
        if (parsed.targetScripIds.length === 0 || parsed.value === undefined) {
          return { parsed, executed: false, message: 'No matching scrips found to set spread.', context: nextCtx };
        }
        const res = executeMcpTool(
          this.market,
          'set_scrip_spread',
          { scripIds: parsed.targetScripIds, bidSpread: parsed.value },
          mcpUser,
          options.source ?? 'VOICE'
        );
        const updatedScrips = res.result as ScripConfig[];
        return {
          parsed,
          executed: updatedScrips.length > 0,
          message: `Set Bid-Ask spread to ₹${parsed.value} on ${updatedScrips.map((s) => s.code).join(', ')}`,
          updatedScrips,
          context: nextCtx,
        };
      }
      case 'PLACE_ORDER': {
        const scripId = parsed.targetScripIds[0];
        if (!scripId) {
          return {
            parsed,
            executed: false,
            message: 'Could not determine which product/scrip to book.',
            context: nextCtx,
          };
        }
        const res = executeMcpTool(
          this.market,
          'place_order',
          {
            clientId: options.clientId ?? 'client-mehra',
            scripId,
            side: parsed.side ?? 'BUY',
            orderType: parsed.limitRate ? 'LIMIT' : 'MARKET',
            qtyUnits: parsed.qtyUnits ?? 1,
            limitRate: parsed.limitRate,
          },
          mcpUser,
          options.source ?? 'VOICE'
        );
        const order = res.result as Order;
        return {
          parsed,
          executed: true,
          message: `Deal #${order.dealNumber} created (${order.status}): ${order.side} ${order.qtyUnits} × ${order.scripCode} @ ₹${order.quotedRate}`,
          order,
          context: nextCtx,
        };
      }
      case 'QUERY_RATE': {
        const res = executeMcpTool(
          this.market,
          'get_live_rates',
          { metal: parsed.metal, settlement: parsed.settlement },
          mcpUser,
          options.source ?? 'VOICE'
        );
        const data = res.result as {
          isFrozen: boolean;
          tick: { goldMcx: number; silverMcx: number };
          quotes: Array<{
            name: string;
            metal: 'GOLD' | 'SILVER';
            settlement: 'RTGS' | 'CASH';
            gstPercent: number;
            buyRate: number;
            sellRate: number;
          }>;
        };
        if (data.isFrozen) {
          return {
            parsed,
            executed: true,
            message: 'Market is currently FROZEN (Call for Rate).',
            context: nextCtx,
          };
        }
        return {
          parsed,
          executed: true,
          message: formatBullionRatesMessage(data.quotes, {
            header: `Live Rates (${parsed.metal ?? 'Gold & Silver'})`,
            tick: data.tick,
            metal: parsed.metal,
            settlement: parsed.settlement,
            markdown: false,
          }),
          context: nextCtx,
        };
      }
      case 'QUERY_POSITION': {
        if (role === 'CLIENT') {
          const res = executeMcpTool(this.market, 'get_client_ledger', {}, mcpUser, options.source ?? 'VOICE');
          const c = res.result as {
            firmName: string;
            cashBalanceInr: number;
            metalBalanceGoldGrams: number;
            metalBalanceSilverGrams: number;
          };
          return {
            parsed,
            executed: true,
            message: `Dual Ledger: Cash ₹${c.cashBalanceInr.toLocaleString('en-IN')} | Gold ${c.metalBalanceGoldGrams.toFixed(2)}g | Silver ${(c.metalBalanceSilverGrams / 1000).toFixed(3)}kg`,
            context: nextCtx,
          };
        }
        const res = executeMcpTool(this.market, 'get_net_positions', {}, mcpUser, options.source ?? 'VOICE');
        const positions = res.result as Array<{
          metal: string;
          settlement: string;
          netGrams: number;
          totalTurnoverInr: number;
        }>;
        const msg =
          positions.length === 0
            ? 'No confirmed open positions today.'
            : positions
                .map(
                  (p) =>
                    `${p.metal} (${p.settlement}): Net ${p.netGrams}g | Turnover ₹${p.totalTurnoverInr.toLocaleString('en-IN')}`
                )
                .join('\n');
        return { parsed, executed: true, message: msg, context: nextCtx };
      }
      default:
        return {
          parsed,
          executed: false,
          message: parsed.explanation,
          context: nextCtx,
        };
    }
  }
}
