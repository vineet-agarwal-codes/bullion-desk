# BullionDesk — Wholesale Indian Bullion Trading & Risk OS

A production-oriented B2B SaaS platform built for Indian wholesale bullion houses (Kucha Mahajani, Agra, Meerut, Zaveri Bazaar).

## Features by Version

- **v0.1.0 — Core Pricing, Live MCX Feed & Order Confirmation**
  - Real-time MCX Gold (10g) & Silver (1kg) WebSocket tick engine.
  - Scrip Formula Matrix: Gold 24K (100%), 999, 995 & Silver 999.9, 999, 30kg Peti across **RTGS (+3% GST)** and **Cash / Badla (0% GST)** with distinct **Buy (Bid)** and **Sell (Ask)** rates.
  - Client group tiering (`GROUP_A` VIP, `GROUP_B` Standard, `PUBLIC`).
  - 1-Touch Market & Limit Order booking with 15-second 2-step deal confirmation and Dual Ledger (INR Cash + Fine Gold/Silver grams).
  - Dealer Admin Desk with instant `+50/-50/+100/-100` offset controls, Kill Switch (Rate Freeze), Net Exposure summary, and Tally CSV export.

- **v0.2.0 — Context-Aware AI Voice & Hinglish Command Engine**
  - Understands colloquial Hinglish & mandi lexicon (*peti, chorsa, rawa, pakka, kaccha, badha do, kam kar do, freeze*).
  - Session context memory resolves ambiguous follow-ups (`"Silver cash 100 badha do"` → `"Aur 50 kam kar do"`).
  - Browser Web Speech API microphone integration + Hinglish text command bar.

- **v0.3.0 — WhatsApp Cloud API & Autonomous Agents**
  - Meta WhatsApp Cloud API webhook (`GET/POST /api/whatsapp/webhook`) + built-in Live Simulator UI.
  - **Sub-Dealer Agent**: Check live rates, book orders in Hinglish, 2-step `HAA` confirmation, and check dual-ledger balance (`"mera hisab"`).
  - **Owner Agent**: Adjust prices, toggle Kill Switch, and query net exposure via WhatsApp.

- **v0.4.0 — Auto-Hedging, Dynamic Spreads, Badla MTM Risk & RTGS Fraud Shield**
  - **MCX Auto-Hedge & Lot Quantizer**: Aggregates physical bookings and quantizes into MCX `SILVER` (30kg), `SILVERM` (5kg), `GOLD` (1kg), and `GOLDM` (100g) contracts (LIVE & SHADOW modes).
  - **Dynamic Spread-Skewer & Velocity Guard**: Vault inventory skew + 5-second toxic-flow burst detection.
  - **Badla / Unfixed Metal MTM Risk Manager**: Real-time MTM utilization %, `WARNING` / `MARGIN_CALL` alerts, and 1-Click Rate-Cut Liquidation.
  - **RTGS Fraud Shield & Vault Delivery Gate**: Legal name-match verification against GSTIN to block tainted cyber-cell funds, issuing QR Vault Delivery Tokens (`BD-DEL-...`) and e-Way Bill numbers.

## Quick Start

```bash
npm install
npm run build
npm run dev:server   # http://localhost:3001
npm run dev:web      # http://localhost:5173
```

## Testing

```bash
npm run test:unit         # Unit tests
npm run test:integration  # Fastify + SQLite integration tests
npm run test:contract     # Zod & Meta Webhook contract tests
npm run test:e2e          # Playwright end-to-end tests
```
