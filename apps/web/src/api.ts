import type {
  ClientGroup,
  ClientProfile,
  CreateOrderInput,
  MarketState,
  Order,
  ScripConfig,
} from '@bullion-desk/shared';

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
export const WS_BASE = API_BASE.replace(/^http/, 'ws');

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
};
