import { randomUUID } from 'node:crypto';
import type { AiCommandService } from './aiCommandService.js';
import type { MarketService } from './marketService.js';

export interface WhatsAppMessage {
  id: string;
  phone: string;
  senderRole: 'OWNER' | 'SUB_DEALER' | 'PUBLIC' | 'BOT';
  direction: 'INBOUND' | 'OUTBOUND';
  text: string;
  timestamp: number;
}

export class WhatsAppAgentService {
  private messages: WhatsAppMessage[] = [];
  private pendingConfirmOrderByPhone = new Map<string, string>();
  public readonly ownerPhone: string;

  constructor(
    private market: MarketService,
    private ai: AiCommandService,
    ownerPhone: string = process.env.OWNER_PHONE ?? '+919999999999'
  ) {
    this.ownerPhone = ownerPhone;
  }

  getMessages(phone?: string): WhatsAppMessage[] {
    if (!phone) return [...this.messages];
    return this.messages.filter((m) => m.phone === phone);
  }

  private record(
    phone: string,
    senderRole: WhatsAppMessage['senderRole'],
    direction: WhatsAppMessage['direction'],
    text: string
  ): WhatsAppMessage {
    const msg: WhatsAppMessage = {
      id: randomUUID(),
      phone,
      senderRole,
      direction,
      text,
      timestamp: Date.now(),
    };
    this.messages.push(msg);
    if (this.messages.length > 500) {
      this.messages.shift();
    }
    return msg;
  }

  handleIncoming(phone: string, rawText: string): { reply: string; role: 'OWNER' | 'SUB_DEALER' | 'PUBLIC' } {
    const text = rawText.trim();
    const isOwner = phone === this.ownerPhone;
    const client = isOwner ? null : this.market.getClient(phone);
    const role: 'OWNER' | 'SUB_DEALER' | 'PUBLIC' = isOwner
      ? 'OWNER'
      : client
        ? 'SUB_DEALER'
        : 'PUBLIC';

    this.record(phone, role, 'INBOUND', text);

    let reply = '';
    if (role === 'OWNER') {
      reply = this.handleOwnerMessage(phone, text);
    } else if (role === 'SUB_DEALER' && client) {
      reply = this.handleSubDealerMessage(phone, client.id, text);
    } else {
      reply = this.handlePublicMessage(text);
    }

    this.record(phone, 'BOT', 'OUTBOUND', reply);
    return { reply, role };
  }

  private handleOwnerMessage(phone: string, text: string): string {
    const res = this.ai.executeCommand(text, `wa-owner-${phone}`, {
      role: 'DEALER',
      autoExecute: true,
    });

    if (res.parsed.intent === 'QUERY_POSITION') {
      const positions = this.market.getPositionSummary();
      if (positions.length === 0) {
        return '📊 *Net Exposure:* No confirmed saudas today.';
      }
      const lines = positions.map(
        (p) =>
          `• *${p.metal} (${p.settlement})*: Net ${p.netGrams}g | Turnover ₹${p.totalTurnoverInr.toLocaleString('en-IN')}`
      );
      return `📊 *BullionDesk Net Exposure*\n${lines.join('\n')}`;
    }

    if (res.parsed.intent === 'QUERY_RATE') {
      return this.formatRatesReply('GROUP_A', res.parsed.metal, res.parsed.settlement);
    }

    if (res.executed) {
      return `✅ *Owner Desk Updated*\n${res.message}`;
    }
    return `⚠️ Could not process command: ${res.message}\nTry: "Silver cash +100", "Freeze", "Position"`;
  }

  private handleSubDealerMessage(phone: string, clientId: string, text: string): string {
    const lower = text.toLowerCase().trim();
    const pendingOrderId = this.pendingConfirmOrderByPhone.get(phone);

    // 1. Check 2-step confirmation ("HAA" / "YES" / "CONFIRM")
    if (pendingOrderId && /^(haa|ha|yes|y|confirm|ok|done|pakka)$/i.test(lower)) {
      try {
        const confirmed = this.market.confirmOrder(pendingOrderId);
        this.pendingConfirmOrderByPhone.delete(phone);
        return `✅ *Sauda Confirmed! Deal #${confirmed.dealNumber}*\n${confirmed.side} ${confirmed.qtyUnits} × ${confirmed.scripCode}\nRate: ₹${confirmed.quotedRate.toLocaleString('en-IN')}\nTotal: ₹${confirmed.totalInr.toLocaleString('en-IN')}`;
      } catch (err) {
        this.pendingConfirmOrderByPhone.delete(phone);
        return `❌ Confirmation failed: ${(err as Error).message}`;
      }
    }

    if (pendingOrderId && /^(nahi|na|no|n|cancel|ruk)$/i.test(lower)) {
      this.market.cancelOrder(pendingOrderId);
      this.pendingConfirmOrderByPhone.delete(phone);
      return `🚫 Pending deal cancelled.`;
    }

    const client = this.market.getClient(clientId)!;

    // 2. Ledger / Balance check
    if (/\b(hisab|balance|ledger|khata)\b/i.test(lower)) {
      return (
        `📒 *Dual Ledger — ${client.firmName}*\n` +
        `• Cash Balance: ₹${client.cashBalanceInr.toLocaleString('en-IN')}\n` +
        `• Fine Gold (999): ${client.metalBalanceGoldGrams.toFixed(2)} g\n` +
        `• Fine Silver (999): ${(client.metalBalanceSilverGrams / 1000).toFixed(3)} kg`
      );
    }

    // 3. Parse via AI Command Service
    const parsed = this.ai.parseCommand(text, `wa-client-${phone}`, 'CLIENT');

    if (parsed.intent === 'QUERY_RATE') {
      return this.formatRatesReply(client.clientGroup, parsed.metal, parsed.settlement);
    }

    if (parsed.intent === 'PLACE_ORDER') {
      try {
        const res = this.ai.executeCommand(text, `wa-client-${phone}`, {
          role: 'CLIENT',
          clientId,
          autoExecute: true,
        });
        if (res.order) {
          // Ensure source is tagged as WHATSAPP
          if (res.order.status === 'PENDING_CONFIRM') {
            this.pendingConfirmOrderByPhone.set(phone, res.order.id);
            return (
              `⏳ *Deal #${res.order.dealNumber} — Reply HAA within 15s to Confirm*\n` +
              `${res.order.side} ${res.order.qtyUnits} × ${res.order.scripCode}\n` +
              `Rate: ₹${res.order.quotedRate.toLocaleString('en-IN')}\n` +
              `Total: ₹${res.order.totalInr.toLocaleString('en-IN')} (GST ₹${res.order.gstAmount.toLocaleString('en-IN')})\n\n` +
              `Reply *HAA* to confirm or *NAHI* to cancel.`
            );
          }
          return `📌 *Limit Order Placed! Deal #${res.order.dealNumber}*\n${res.message}`;
        }
      } catch (err) {
        return `❌ Order rejected: ${(err as Error).message}`;
      }
    }

    return (
      `🙏 Namaste ${client.name}!\n` +
      `• Check rates: *"rate kya hai"* or *"silver rtgs"*\n` +
      `• Book order: *"2 peti chandi pakki kar do"* or *"10g gold 999 rtgs"*\n` +
      `• Check ledger: *"mera hisab"*`
    );
  }

  private handlePublicMessage(text: string): string {
    if (/\b(rate|bhaav|price|gold|silver|sona|chandi)\b/i.test(text)) {
      return (
        this.formatRatesReply('PUBLIC') +
        `\n\nℹ️ *Unregistered number:* Register with our Kucha Mahajani desk to book deals on WhatsApp.`
      );
    }
    return `Welcome to *BullionDesk*. Reply *"rate"* for live Gold & Silver public quotes.`;
  }

  private formatRatesReply(
    group: 'GROUP_A' | 'GROUP_B' | 'PUBLIC',
    metal?: 'GOLD' | 'SILVER',
    settlement?: 'RTGS' | 'CASH'
  ): string {
    const state = this.market.getMarketState(group);
    if (state.isFrozen) {
      return `🔒 *MARKET FROZEN — CALL FOR RATE*\n${state.freezeReason ?? ''}`.trim();
    }
    let quotes = state.quotes.filter((q) => q.isActive);
    if (metal) quotes = quotes.filter((q) => q.metal === metal);
    if (settlement) quotes = quotes.filter((q) => q.settlement === settlement);

    const lines = quotes.slice(0, 6).map(
      (q) =>
        `• *${q.name}*: Buy ₹${q.buyRate.toLocaleString('en-IN')} | Sell ₹${q.sellRate.toLocaleString('en-IN')}`
    );
    return (
      `📈 *Live BullionDesk Rates (${group})*\n` +
      `MCX Gold: ₹${state.tick.goldMcx.toLocaleString('en-IN')} | MCX Silver: ₹${state.tick.silverMcx.toLocaleString('en-IN')}\n\n` +
      lines.join('\n')
    );
  }
}
