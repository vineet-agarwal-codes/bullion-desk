import { z } from 'zod';

export const MetalTypeSchema = z.enum(['GOLD', 'SILVER']);
export type MetalType = z.infer<typeof MetalTypeSchema>;

export const SettlementTypeSchema = z.enum(['RTGS', 'CASH']);
export type SettlementType = z.infer<typeof SettlementTypeSchema>;

export const OrderSideSchema = z.enum(['BUY', 'SELL']);
export type OrderSide = z.infer<typeof OrderSideSchema>;

export const OrderTypeSchema = z.enum(['MARKET', 'LIMIT']);
export type OrderType = z.infer<typeof OrderTypeSchema>;

export const OrderStatusSchema = z.enum([
  'PROCESSING',
  'PENDING_CONFIRM',
  'PENDING_LIMIT',
  'CONFIRMED',
  'CANCELLED',
  'EXPIRED',
  'REJECTED',
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const ClientGroupSchema = z.enum(['GROUP_A', 'GROUP_B', 'PUBLIC']);
export type ClientGroup = z.infer<typeof ClientGroupSchema>;

export const UserRoleSchema = z.enum(['ADMIN', 'SUB_DEALER']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const AuthUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: UserRoleSchema,
  displayName: z.string(),
  clientId: z.string().nullable(),
  clientGroup: ClientGroupSchema.nullable(),
  phone: z.string().nullable(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const McxTickSchema = z.object({
  goldMcx: z.number().positive(),       // INR per 10g
  silverMcx: z.number().positive(),     // INR per 1kg
  goldComex: z.number().positive(),     // USD per oz
  silverComex: z.number().positive(),   // USD per oz
  usdInr: z.number().positive(),        // INR per USD
  source: z.enum(['LIVE_MCX', 'LIVE_PARITY', 'SIMULATED']).default('SIMULATED'),
  timestamp: z.number().int().positive(),
});
export type McxTick = z.infer<typeof McxTickSchema>;

export const ScripConfigSchema = z.object({
  id: z.string(),
  code: z.string(),                     // e.g. GOLD_999_RTGS
  name: z.string(),                     // e.g. Gold 999 RTGS (10g)
  metal: MetalTypeSchema,
  purity: z.number().min(500).max(1000), // 1000 (24K 100%), 999.9, 999, 995
  settlement: SettlementTypeSchema,
  unit: z.string(),                     // '10G', '1KG', '30KG_PETI'
  unitGrams: z.number().positive(),     // 10, 1000, 30000
  manualOffset: z.number(),             // Dealer +/- offset from MCX
  bidSpread: z.number().nonnegative(),  // Sell - Buy spread
  purityDiscount: z.number().nonnegative(), // Discount for 995 vs 999
  gstPercent: z.number().nonnegative(), // 3.0 for RTGS, 0 for CASH
  isActive: z.boolean(),
  minQty: z.number().positive(),
  maxQty: z.number().positive(),
});
export type ScripConfig = z.infer<typeof ScripConfigSchema>;

export const ScripQuoteSchema = z.object({
  scripId: z.string(),
  code: z.string(),
  name: z.string(),
  metal: MetalTypeSchema,
  purity: z.number(),
  settlement: SettlementTypeSchema,
  unit: z.string(),
  unitGrams: z.number(),
  mcxBase: z.number(),
  buyRate: z.number(),                  // Dealer's Buy (Bid) - client sells at this
  sellRate: z.number(),                 // Dealer's Sell (Ask) - client buys at this
  gstPercent: z.number(),
  isFrozen: z.boolean(),
  isActive: z.boolean(),
  timestamp: z.number(),
});
export type ScripQuote = z.infer<typeof ScripQuoteSchema>;

export const ClientProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  firmName: z.string(),
  phone: z.string(),
  gstin: z.string().nullable(),
  clientGroup: ClientGroupSchema,
  maxSilverKg: z.number().nonnegative(),
  maxGoldGrams: z.number().nonnegative(),
  cashBalanceInr: z.number(),
  metalBalanceGoldGrams: z.number(),
  metalBalanceSilverGrams: z.number(),
  isActive: z.boolean(),
});
export type ClientProfile = z.infer<typeof ClientProfileSchema>;

export const CreateOrderInputSchema = z.object({
  clientId: z.string().min(1),
  scripId: z.string().min(1),
  side: OrderSideSchema,                // BUY = client buys from dealer (at sellRate), SELL = client sells to dealer (at buyRate)
  orderType: OrderTypeSchema,
  qtyUnits: z.number().positive(),
  limitRate: z.number().positive().optional(),
  expectedRate: z.number().positive().optional(),
  source: z.enum(['WEB', 'WHATSAPP', 'VOICE']).default('WEB'),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  dealNumber: z.number().int(),
  clientId: z.string(),
  clientName: z.string(),
  scripId: z.string(),
  scripCode: z.string(),
  metal: MetalTypeSchema,
  settlement: SettlementTypeSchema,
  side: OrderSideSchema,
  orderType: OrderTypeSchema,
  qtyUnits: z.number(),
  totalGrams: z.number(),
  quotedRate: z.number(),
  limitRate: z.number().nullable(),
  gstAmount: z.number(),
  totalInr: z.number(),
  status: OrderStatusSchema,
  source: z.enum(['WEB', 'WHATSAPP', 'VOICE']),
  expiresAt: z.number().nullable(),
  confirmedAt: z.number().nullable(),
  createdAt: z.number(),
});
export type Order = z.infer<typeof OrderSchema>;

export const MarketStateSchema = z.object({
  isFrozen: z.boolean(),
  freezeReason: z.string().nullable(),
  tick: McxTickSchema,
  quotes: z.array(ScripQuoteSchema),
});
export type MarketState = z.infer<typeof MarketStateSchema>;

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('MARKET_SNAPSHOT'),
    payload: MarketStateSchema,
  }),
  z.object({
    type: z.literal('ORDER_EVENT'),
    payload: OrderSchema,
  }),
]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
