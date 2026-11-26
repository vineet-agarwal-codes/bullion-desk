import Database from 'better-sqlite3';
import type { ClientProfile, ScripConfig } from '@bullion-desk/shared';

export function initDatabase(dbPath: string = './bullion-desk.db'): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS market_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scrips (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      metal TEXT NOT NULL,
      purity REAL NOT NULL,
      settlement TEXT NOT NULL,
      unit TEXT NOT NULL,
      unit_grams REAL NOT NULL,
      manual_offset REAL NOT NULL DEFAULT 0,
      bid_spread REAL NOT NULL DEFAULT 100,
      purity_discount REAL NOT NULL DEFAULT 0,
      gst_percent REAL NOT NULL DEFAULT 3,
      is_active INTEGER NOT NULL DEFAULT 1,
      min_qty REAL NOT NULL DEFAULT 1,
      max_qty REAL NOT NULL DEFAULT 100
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      firm_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      gstin TEXT,
      client_group TEXT NOT NULL DEFAULT 'GROUP_B',
      max_silver_kg REAL NOT NULL DEFAULT 150,
      max_gold_grams REAL NOT NULL DEFAULT 2000,
      cash_balance_inr REAL NOT NULL DEFAULT 0,
      metal_balance_gold_grams REAL NOT NULL DEFAULT 0,
      metal_balance_silver_grams REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      deal_number INTEGER NOT NULL,
      client_id TEXT NOT NULL REFERENCES clients(id),
      client_name TEXT NOT NULL,
      scrip_id TEXT NOT NULL REFERENCES scrips(id),
      scrip_code TEXT NOT NULL,
      metal TEXT NOT NULL,
      settlement TEXT NOT NULL,
      side TEXT NOT NULL,
      order_type TEXT NOT NULL,
      qty_units REAL NOT NULL,
      total_grams REAL NOT NULL,
      quoted_rate REAL NOT NULL,
      limit_rate REAL,
      gst_amount REAL NOT NULL,
      total_inr REAL NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'WEB',
      expires_at INTEGER,
      confirmed_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hedge_executions (
      id TEXT PRIMARY KEY,
      metal TEXT NOT NULL,
      contract TEXT NOT NULL,
      side TEXT NOT NULL,
      lots INTEGER NOT NULL,
      grams REAL NOT NULL,
      mcx_price REAL NOT NULL,
      mode TEXT NOT NULL,
      slippage_saved_inr REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS unfixed_positions (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id),
      client_name TEXT NOT NULL,
      metal TEXT NOT NULL,
      grams REAL NOT NULL,
      entry_rate_per_unit REAL NOT NULL,
      margin_deposited_inr REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at INTEGER NOT NULL,
      closed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS rtgs_verifications (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id),
      remitter_name TEXT NOT NULL,
      expected_legal_name TEXT NOT NULL,
      amount_inr REAL NOT NULL,
      utr_number TEXT NOT NULL,
      status TEXT NOT NULL,
      delivery_token TEXT,
      bar_serial TEXT,
      measured_grams REAL,
      eway_bill_no TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  seedInitialData(db);
  return db;
}

function seedInitialData(db: Database.Database) {
  const existingSetting = db
    .prepare('SELECT value FROM market_settings WHERE key = ?')
    .get('is_frozen');
  if (!existingSetting) {
    db.prepare('INSERT INTO market_settings (key, value) VALUES (?, ?)').run('is_frozen', '0');
    db.prepare('INSERT INTO market_settings (key, value) VALUES (?, ?)').run('freeze_reason', '');
    db.prepare('INSERT INTO market_settings (key, value) VALUES (?, ?)').run('next_deal_number', '4001');
    db.prepare('INSERT INTO market_settings (key, value) VALUES (?, ?)').run('hedge_mode', 'LIVE');
    db.prepare('INSERT INTO market_settings (key, value) VALUES (?, ?)').run('gold_vault_grams', '4500');
    db.prepare('INSERT INTO market_settings (key, value) VALUES (?, ?)').run('silver_vault_kg', '240');
  }

  const scripCount = (db.prepare('SELECT COUNT(*) as c FROM scrips').get() as { c: number }).c;
  if (scripCount === 0) {
    const defaultScrips: ScripConfig[] = [
      {
        id: 'gold-24k-100-rtgs',
        code: 'GOLD_24K_100_RTGS',
        name: 'Gold 24K (100% Pure) RTGS',
        metal: 'GOLD',
        purity: 1000,
        settlement: 'RTGS',
        unit: '10G',
        unitGrams: 10,
        manualOffset: 300,
        bidSpread: 120,
        purityDiscount: 0,
        gstPercent: 3,
        isActive: true,
        minQty: 1,
        maxQty: 100,
      },
      {
        id: 'gold-999-rtgs',
        code: 'GOLD_999_RTGS',
        name: 'Gold 999 RTGS (10g)',
        metal: 'GOLD',
        purity: 999,
        settlement: 'RTGS',
        unit: '10G',
        unitGrams: 10,
        manualOffset: 250,
        bidSpread: 100,
        purityDiscount: 0,
        gstPercent: 3,
        isActive: true,
        minQty: 1,
        maxQty: 100,
      },
      {
        id: 'gold-999-cash',
        code: 'GOLD_999_CASH',
        name: 'Gold 999 Cash / Badla (10g)',
        metal: 'GOLD',
        purity: 999,
        settlement: 'CASH',
        unit: '10G',
        unitGrams: 10,
        manualOffset: 150,
        bidSpread: 120,
        purityDiscount: 0,
        gstPercent: 0,
        isActive: true,
        minQty: 1,
        maxQty: 100,
      },
      {
        id: 'gold-995-rtgs',
        code: 'GOLD_995_RTGS',
        name: 'Gold 995 RTGS (10g)',
        metal: 'GOLD',
        purity: 995,
        settlement: 'RTGS',
        unit: '10G',
        unitGrams: 10,
        manualOffset: 220,
        bidSpread: 120,
        purityDiscount: 350,
        gstPercent: 3,
        isActive: true,
        minQty: 1,
        maxQty: 100,
      },
      {
        id: 'gold-995-cash',
        code: 'GOLD_995_CASH',
        name: 'Gold 995 Cash (10g)',
        metal: 'GOLD',
        purity: 995,
        settlement: 'CASH',
        unit: '10G',
        unitGrams: 10,
        manualOffset: 100,
        bidSpread: 150,
        purityDiscount: 350,
        gstPercent: 0,
        isActive: true,
        minQty: 1,
        maxQty: 100,
      },
      {
        id: 'silver-9999-rtgs',
        code: 'SILVER_9999_RTGS',
        name: 'Silver 999.9 Fine RTGS (1kg)',
        metal: 'SILVER',
        purity: 999.9,
        settlement: 'RTGS',
        unit: '1KG',
        unitGrams: 1000,
        manualOffset: 850,
        bidSpread: 350,
        purityDiscount: 0,
        gstPercent: 3,
        isActive: true,
        minQty: 1,
        maxQty: 200,
      },
      {
        id: 'silver-999-rtgs',
        code: 'SILVER_999_RTGS',
        name: 'Silver 999 Chorsa RTGS (1kg)',
        metal: 'SILVER',
        purity: 999,
        settlement: 'RTGS',
        unit: '1KG',
        unitGrams: 1000,
        manualOffset: 650,
        bidSpread: 300,
        purityDiscount: 0,
        gstPercent: 3,
        isActive: true,
        minQty: 1,
        maxQty: 200,
      },
      {
        id: 'silver-999-cash',
        code: 'SILVER_999_CASH',
        name: 'Silver 999 Chorsa Cash (1kg)',
        metal: 'SILVER',
        purity: 999,
        settlement: 'CASH',
        unit: '1KG',
        unitGrams: 1000,
        manualOffset: 450,
        bidSpread: 350,
        purityDiscount: 0,
        gstPercent: 0,
        isActive: true,
        minQty: 1,
        maxQty: 200,
      },
      {
        id: 'silver-999-peti-cash',
        code: 'SILVER_999_PETI_CASH',
        name: 'Silver 999 Peti Cash (30kg Bar)',
        metal: 'SILVER',
        purity: 999,
        settlement: 'CASH',
        unit: '30KG_PETI',
        unitGrams: 30000,
        manualOffset: 400,
        bidSpread: 300,
        purityDiscount: 0,
        gstPercent: 0,
        isActive: true,
        minQty: 1,
        maxQty: 10,
      },
    ];

    const insertScrip = db.prepare(`
      INSERT INTO scrips (id, code, name, metal, purity, settlement, unit, unit_grams, manual_offset, bid_spread, purity_discount, gst_percent, is_active, min_qty, max_qty)
      VALUES (@id, @code, @name, @metal, @purity, @settlement, @unit, @unitGrams, @manualOffset, @bidSpread, @purityDiscount, @gstPercent, @isActive, @minQty, @maxQty)
    `);
    for (const s of defaultScrips) {
      insertScrip.run({ ...s, isActive: s.isActive ? 1 : 0 });
    }
  }

  const clientCount = (db.prepare('SELECT COUNT(*) as c FROM clients').get() as { c: number }).c;
  if (clientCount === 0) {
    const defaultClients: ClientProfile[] = [
      {
        id: 'client-mehra',
        name: 'Rajesh Mehra',
        firmName: 'Mehra Sons Bullion (Kucha Mahajani)',
        phone: '+919811001122',
        gstin: '07AAACM1234F1Z5',
        clientGroup: 'GROUP_A',
        maxSilverKg: 300,
        maxGoldGrams: 5000,
        cashBalanceInr: 2500000,
        metalBalanceGoldGrams: 0,
        metalBalanceSilverGrams: 0,
        isActive: true,
      },
      {
        id: 'client-agarwal',
        name: 'Vikram Agarwal',
        firmName: 'Agarwal Payal & Bullion (Agra)',
        phone: '+919837002233',
        gstin: '09AABCA9876K1Z2',
        clientGroup: 'GROUP_A',
        maxSilverKg: 500,
        maxGoldGrams: 3000,
        cashBalanceInr: 1800000,
        metalBalanceGoldGrams: 0,
        metalBalanceSilverGrams: 0,
        isActive: true,
      },
      {
        id: 'client-sharma',
        name: 'Deepak Sharma',
        firmName: 'Sharma Chains (Meerut)',
        phone: '+919719003344',
        gstin: '09AADCS4567L1Z9',
        clientGroup: 'GROUP_B',
        maxSilverKg: 120,
        maxGoldGrams: 1000,
        cashBalanceInr: 500000,
        metalBalanceGoldGrams: 0,
        metalBalanceSilverGrams: 0,
        isActive: true,
      },
    ];

    const insertClient = db.prepare(`
      INSERT INTO clients (id, name, firm_name, phone, gstin, client_group, max_silver_kg, max_gold_grams, cash_balance_inr, metal_balance_gold_grams, metal_balance_silver_grams, is_active)
      VALUES (@id, @name, @firmName, @phone, @gstin, @clientGroup, @maxSilverKg, @maxGoldGrams, @cashBalanceInr, @metalBalanceGoldGrams, @metalBalanceSilverGrams, @isActive)
    `);
    for (const c of defaultClients) {
      insertClient.run({ ...c, isActive: c.isActive ? 1 : 0 });
    }
  }
}
