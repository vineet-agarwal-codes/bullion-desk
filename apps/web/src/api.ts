import type {
  ClientGroup,
  ClientProfile,
  CreateOrderInput,
  MarketState,
  Order,
  ScripConfig,
} from '@bullion-desk/shared';

export const API_BASE = import.meta.env.VITE_API_URL ?? '';
export const WS_BASE = API_BASE
  ? API_BASE.replace(/^http/, 'ws')
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Request failed');
  }
  return data as T;
}

export const api = {
  getMarket: (group: ClientGroup = 'GROUP_B') =>
    request<MarketState>(`/api/market?group=${group}`),
  getScrips: () => request<ScripConfig[]>('/api/scrips'),
  updateScrip: (
    id: string,
    patch: Partial<Pick<ScripConfig, 'manualOffset' | 'bidSpread' | 'purityDiscount' | 'isActive'>>
  ) => request<ScripConfig>(`/api/scrips/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  setFreeze: (isFrozen: boolean, reason?: string) =>
    request<{ isFrozen: boolean; freezeReason: string | null }>('/api/market/freeze', {
      method: 'POST',
      body: JSON.stringify({ isFrozen, reason }),
    }),
  getClients: () => request<ClientProfile[]>('/api/clients'),
  getOrders: () => request<Order[]>('/api/orders'),
  createOrder: (input: CreateOrderInput) =>
    request<Order>('/api/orders', { method: 'POST', body: JSON.stringify(input) }),
  confirmOrder: (id: string) =>
    request<Order>(`/api/orders/${id}/confirm`, { method: 'POST' }),
  cancelOrder: (id: string) =>
    request<Order>(`/api/orders/${id}/cancel`, { method: 'POST' }),
  getPositions: () =>
    request<
      Array<{
        metal: string;
        settlement: string;
        buyGrams: number;
        sellGrams: number;
        netGrams: number;
        buyCount: number;
        sellCount: number;
        totalTurnoverInr: number;
      }>
    >('/api/positions'),
  sendAiCommand: (payload: {
    text: string;
    sessionId: string;
    role: 'DEALER' | 'CLIENT';
    clientId?: string;
    autoExecute?: boolean;
  }) =>
    request<{
      parsed: {
        intent: string;
        confidence: number;
        explanation: string;
        usedContext: boolean;
      };
      executed: boolean;
      message: string;
      order?: Order;
    }>('/api/ai/command', { method: 'POST', body: JSON.stringify(payload) }),
  simulateWhatsApp: (phone: string, text: string) =>
    request<{ reply: string; role: 'OWNER' | 'SUB_DEALER' | 'PUBLIC' }>('/api/whatsapp/simulate', {
      method: 'POST',
      body: JSON.stringify({ phone, text }),
    }),
  getWhatsAppMessages: (phone?: string) =>
    request<
      Array<{
        id: string;
        phone: string;
        senderRole: string;
        direction: 'INBOUND' | 'OUTBOUND';
        text: string;
        timestamp: number;
      }>
    >(`/api/whatsapp/messages${phone ? `?phone=${encodeURIComponent(phone)}` : ''}`),
  getHedging: () =>
    request<{
      mode: 'LIVE' | 'SHADOW';
      residuals: { goldGrams: number; silverGrams: number };
      executions: Array<{
        id: string;
        metal: string;
        contract: string;
        side: string;
        lots: number;
        grams: number;
        mcxPrice: number;
        mode: string;
        slippageSavedInr: number;
        createdAt: number;
      }>;
    }>('/api/hedging'),
  setHedgingMode: (mode: 'LIVE' | 'SHADOW') =>
    request<{ mode: 'LIVE' | 'SHADOW' }>('/api/hedging/mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  getSpreadStatus: () =>
    request<{
      goldVaultGrams: number;
      silverVaultKg: number;
      velocityCount5s: number;
      toxicFlowAlert: boolean;
      recommendedSilverAskSkewInr: number;
      recommendedGoldAskSkewInr: number;
    }>('/api/risk/spread-status'),
  getUnfixedPositions: () =>
    request<
      Array<{
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
      }>
    >('/api/risk/unfixed'),
  createUnfixedPosition: (payload: {
    clientId: string;
    metal: 'GOLD' | 'SILVER';
    grams: number;
    entryRatePerUnit: number;
    marginDepositedInr: number;
  }) => request('/api/risk/unfixed', { method: 'POST', body: JSON.stringify(payload) }),
  liquidateUnfixedPosition: (id: string) =>
    request(`/api/risk/unfixed/${id}/liquidate`, { method: 'POST' }),
  getRtgsVerifications: () =>
    request<
      Array<{
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
      }>
    >('/api/compliance/rtgs'),
  verifyRtgs: (payload: {
    clientId: string;
    remitterName: string;
    amountInr: number;
    utrNumber: string;
    barSerial?: string;
    measuredGrams?: number;
  }) =>
    request<{
      status: 'VERIFIED' | 'BLOCKED_NAME_MISMATCH';
      deliveryToken: string | null;
      ewayBillNo: string | null;
    }>('/api/compliance/rtgs/verify', { method: 'POST', body: JSON.stringify(payload) }),
};
