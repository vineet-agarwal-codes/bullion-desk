import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { McxTick } from '@bullion-desk/shared';
import type { MarketService } from './marketService.js';

export interface UnfixedPosition {
  id: string;
  clientId: string;
  clientName: string;
  metal: 'GOLD' | 'SILVER';
  grams: number;
  entryRatePerUnit: number;
  marginDepositedInr: number;
  currentRatePerUnit: number;
  mtmLossInr: number;
  marginUtilizationPct: number;
  riskStatus: 'HEALTHY' | 'WARNING' | 'MARGIN_CALL';
  status: 'OPEN' | 'LIQUIDATED';
  createdAt: number;
}

export interface RtgsVerificationResult {
  id: string;
  clientId: string;
  remitterName: string;
  expectedLegalName: string;
  amountInr: number;
  utrNumber: string;
  status: 'VERIFIED' | 'BLOCKED_NAME_MISMATCH';
  deliveryToken: string | null;
  barSerial: string | null;
  measuredGrams: number | null;
  ewayBillNo: string | null;
  createdAt: number;
}

export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(pvt|ltd|private|limited|llp|sons|jewellers|bullion|payal|chains|co|and)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isRtgsRemitterMatch(remitterName: string, expectedFirmName: string): boolean {
  const normRemitter = normalizeEntityName(remitterName);
  const normExpected = normalizeEntityName(expectedFirmName);
  if (!normRemitter || !normExpected) return false;
  return normRemitter.includes(normExpected) || normExpected.includes(normRemitter);
}

export class RiskAndComplianceService {
  private orderTimestamps: number[] = [];

  constructor(
    private db: Database.Database,
    private market: MarketService
  ) {}

  recordOrderVelocity() {
    const now = Date.now();
    this.orderTimestamps.push(now);
    this.orderTimestamps = this.orderTimestamps.filter((t) => now - t <= 5000);
  }

  getDynamicSpreadStatus() {
    const now = Date.now();
    this.orderTimestamps = this.orderTimestamps.filter((t) => now - t <= 5000);
    const goldVaultRow = this.db
      .prepare('SELECT value FROM market_settings WHERE key = ?')
      .get('gold_vault_grams') as { value: string } | undefined;
    const silverVaultRow = this.db
      .prepare('SELECT value FROM market_settings WHERE key = ?')
      .get('silver_vault_kg') as { value: string } | undefined;

    const goldVaultGrams = Number(goldVaultRow?.value ?? 4500);
    const silverVaultKg = Number(silverVaultRow?.value ?? 240);

    const velocityCount5s = this.orderTimestamps.length;
    const toxicFlowAlert = velocityCount5s >= 3;
    const silverSkewInr = silverVaultKg < 100 ? 150 : 0;
    const goldSkewInr = goldVaultGrams < 1000 ? 75 : 0;

    return {
      goldVaultGrams,
      silverVaultKg,
      velocityCount5s,
      toxicFlowAlert,
      recommendedSilverAskSkewInr: silverSkewInr + (toxicFlowAlert ? 100 : 0),
      recommendedGoldAskSkewInr: goldSkewInr + (toxicFlowAlert ? 50 : 0),
    };
  }

  createUnfixedPosition(input: {
    clientId: string;
    metal: 'GOLD' | 'SILVER';
    grams: number;
    entryRatePerUnit: number;
    marginDepositedInr: number;
  }): UnfixedPosition {
    const client = this.market.getClient(input.clientId);
    if (!client) throw new Error('Client not found');

    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO unfixed_positions (id, client_id, client_name, metal, grams, entry_rate_per_unit, margin_deposited_inr, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`
      )
      .run(
        id,
        client.id,
        client.firmName,
        input.metal,
        input.grams,
        input.entryRatePerUnit,
        input.marginDepositedInr,
        now
      );

    return this.listUnfixedPositions().find((p) => p.id === id)!;
  }

  listUnfixedPositions(tick?: McxTick): UnfixedPosition[] {
    const activeTick = tick ?? this.market.getMarketState().tick;
    const rows = this.db
      .prepare('SELECT * FROM unfixed_positions ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => {
      const metal = r.metal as 'GOLD' | 'SILVER';
      const grams = Number(r.grams);
      const entryRate = Number(r.entry_rate_per_unit);
      const margin = Number(r.margin_deposited_inr);
      const currentRate = metal === 'GOLD' ? activeTick.goldMcx : activeTick.silverMcx;
      const unitGrams = metal === 'GOLD' ? 10 : 1000;

      // Client took physical metal without fixing price: if market rises, client owes more INR -> MTM loss against margin
      const rateDiff = Math.max(0, currentRate - entryRate);
      const mtmLossInr = Math.round((grams / unitGrams) * rateDiff);
      const utilizationPct = margin > 0 ? Math.min(100, Math.round((mtmLossInr / margin) * 100)) : 100;

      const riskStatus: UnfixedPosition['riskStatus'] =
        utilizationPct >= 85 ? 'MARGIN_CALL' : utilizationPct >= 70 ? 'WARNING' : 'HEALTHY';

      return {
        id: String(r.id),
        clientId: String(r.client_id),
        clientName: String(r.client_name),
        metal,
        grams,
        entryRatePerUnit: entryRate,
        marginDepositedInr: margin,
        currentRatePerUnit: currentRate,
        mtmLossInr,
        marginUtilizationPct: utilizationPct,
        riskStatus,
        status: r.status as 'OPEN' | 'LIQUIDATED',
        createdAt: Number(r.created_at),
      };
    });
  }

  liquidateUnfixedPosition(id: string): UnfixedPosition {
    const existing = this.listUnfixedPositions().find((p) => p.id === id);
    if (!existing) throw new Error('Unfixed position not found');
    this.db
      .prepare("UPDATE unfixed_positions SET status = 'LIQUIDATED', closed_at = ? WHERE id = ?")
      .run(Date.now(), id);
    return this.listUnfixedPositions().find((p) => p.id === id)!;
  }

  verifyRtgsAndIssueToken(input: {
    clientId: string;
    remitterName: string;
    amountInr: number;
    utrNumber: string;
    barSerial?: string;
    measuredGrams?: number;
  }): RtgsVerificationResult {
    const client = this.market.getClient(input.clientId);
    if (!client) throw new Error('Client not found');

    const matched = isRtgsRemitterMatch(input.remitterName, client.firmName);
    const id = randomUUID();
    const now = Date.now();
    const status: RtgsVerificationResult['status'] = matched
      ? 'VERIFIED'
      : 'BLOCKED_NAME_MISMATCH';

    const deliveryToken = matched ? `BD-DEL-${id.slice(0, 8).toUpperCase()}` : null;
    const ewayBillNo = matched ? `EWB-${Math.floor(100000000 + Math.random() * 899999999)}` : null;

    this.db
      .prepare(
        `INSERT INTO rtgs_verifications (id, client_id, remitter_name, expected_legal_name, amount_inr, utr_number, status, delivery_token, bar_serial, measured_grams, eway_bill_no, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        client.id,
        input.remitterName,
        client.firmName,
        input.amountInr,
        input.utrNumber,
        status,
        deliveryToken,
        input.barSerial ?? null,
        input.measuredGrams ?? null,
        ewayBillNo,
        now
      );

    return {
      id,
      clientId: client.id,
      remitterName: input.remitterName,
      expectedLegalName: client.firmName,
      amountInr: input.amountInr,
      utrNumber: input.utrNumber,
      status,
      deliveryToken,
      barSerial: input.barSerial ?? null,
      measuredGrams: input.measuredGrams ?? null,
      ewayBillNo,
      createdAt: now,
    };
  }

  listRtgsVerifications(limit = 20): RtgsVerificationResult[] {
    const rows = this.db
      .prepare('SELECT * FROM rtgs_verifications ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      clientId: String(r.client_id),
      remitterName: String(r.remitter_name),
      expectedLegalName: String(r.expected_legal_name),
      amountInr: Number(r.amount_inr),
      utrNumber: String(r.utr_number),
      status: r.status as RtgsVerificationResult['status'],
      deliveryToken: r.delivery_token ? String(r.delivery_token) : null,
      barSerial: r.bar_serial ? String(r.bar_serial) : null,
      measuredGrams: r.measured_grams !== null ? Number(r.measured_grams) : null,
      ewayBillNo: r.eway_bill_no ? String(r.eway_bill_no) : null,
      createdAt: Number(r.created_at),
    }));
  }
}
