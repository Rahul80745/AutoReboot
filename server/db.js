import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FIELDS } from './form-defaults.js';

// keep using a database created before the rename (data/spidy.db) if that is all that exists
const defaultFile = path.join(process.cwd(), 'data', 'autoreboot.db');
const legacyFile = path.join(process.cwd(), 'data', 'spidy.db');
const file = process.env.DATABASE_FILE || (!fs.existsSync(defaultFile) && fs.existsSync(legacyFile) ? legacyFile : defaultFile);
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','owner')),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  phone       TEXT UNIQUE,
  salt        TEXT NOT NULL,
  pass_hash   TEXT NOT NULL,
  city        TEXT NOT NULL DEFAULT '',
  state       TEXT NOT NULL DEFAULT '',
  business    TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#2563EB',
  verified    INTEGER NOT NULL DEFAULT 0,
  rating      REAL NOT NULL DEFAULT 0,
  reviews     INTEGER NOT NULL DEFAULT 0,
  is_bot      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at  INTEGER NOT NULL,
  last_login  INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS listings (
  id           TEXT PRIMARY KEY,
  seller_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,
  subtype      TEXT,
  brand        TEXT NOT NULL,
  model        TEXT NOT NULL,
  title        TEXT NOT NULL,
  year         INTEGER NOT NULL,
  tyres        INTEGER NOT NULL DEFAULT 0,
  emission     TEXT NOT NULL,
  fuel         TEXT NOT NULL,
  transmission TEXT NOT NULL,
  km           INTEGER NOT NULL,
  engine       TEXT NOT NULL DEFAULT '',
  power        TEXT NOT NULL DEFAULT '',
  load         TEXT NOT NULL DEFAULT '',
  ownership    TEXT NOT NULL DEFAULT '1st Owner',
  reg_no       TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL,
  state        TEXT NOT NULL,
  price        INTEGER NOT NULL,
  negotiable   INTEGER NOT NULL DEFAULT 1,
  description  TEXT NOT NULL DEFAULT '',
  highlights   TEXT NOT NULL DEFAULT '[]',
  color        TEXT NOT NULL DEFAULT '#F3F4F7',
  photos       TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','removed')),
  views        INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_seller  ON listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_updated ON listings(updated_at);

CREATE TABLE IF NOT EXISTS favorites (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id  TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS chats (
  id          TEXT PRIMARY KEY,
  listing_id  TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  buyer_read  INTEGER NOT NULL DEFAULT 0,
  seller_read INTEGER NOT NULL DEFAULT 0,
  buyer_hidden  INTEGER NOT NULL DEFAULT 0,
  seller_hidden INTEGER NOT NULL DEFAULT 0,
  UNIQUE (listing_id, buyer_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT NOT NULL DEFAULT '',
  images      TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '#/',
  icon        TEXT NOT NULL DEFAULT 'bell',
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS finance_requests (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id  TEXT REFERENCES listings(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  age         INTEGER NOT NULL,
  mobile      TEXT NOT NULL,
  city        TEXT NOT NULL,
  state       TEXT NOT NULL,
  pincode     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_finance_user ON finance_requests(user_id);

CREATE TABLE IF NOT EXISTS form_fields (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL,
  grp         TEXT NOT NULL,
  required    INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  locked      INTEGER NOT NULL DEFAULT 0,
  builtin     INTEGER NOT NULL DEFAULT 1,
  placeholder TEXT NOT NULL DEFAULT '',
  options     TEXT NOT NULL DEFAULT '[]',
  sort        INTEGER NOT NULL DEFAULT 0
);
`);

// migrations for databases created by earlier versions
if (!db.prepare('PRAGMA table_info(listings)').all().some((c) => c.name === 'extras')) {
  db.exec("ALTER TABLE listings ADD COLUMN extras TEXT NOT NULL DEFAULT '{}'");
}

/** Insert any built-in form fields that are missing (never overwrites owner edits). */
export function ensureFormFields() {
  db.prepare("DELETE FROM form_fields WHERE key = 'color'").run(); // colour picker was removed
  const have = new Set(db.prepare('SELECT key FROM form_fields').all().map((r) => r.key));
  const ins = db.prepare('INSERT INTO form_fields (key,label,type,grp,required,enabled,locked,builtin,placeholder,options,sort) VALUES (?,?,?,?,?,1,?,1,?,?,?)');
  DEFAULT_FIELDS.forEach((f, i) => {
    if (!have.has(f.key)) ins.run(f.key, f.label, f.type, f.group, f.required ? 1 : 0, f.locked ? 1 : 0, f.placeholder, JSON.stringify(f.options), (i + 1) * 10);
  });
}

// rename of the brand: move seeded/owner e-mail addresses from the old domain
db.exec(`UPDATE users SET email = replace(email, '@spidy.in', '@autoreboot.in') WHERE email LIKE '%@spidy.in'
  AND NOT EXISTS (SELECT 1 FROM users x WHERE x.email = replace(users.email, '@spidy.in', '@autoreboot.in'))`);
db.exec(`UPDATE users SET email = replace(email, '@seller.spidy.in', '@seller.autoreboot.in') WHERE email LIKE '%@seller.spidy.in'`);

/** Run fn inside a transaction (rolls back if it throws). */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- row <-> API object mappers ---------- */
export const userRow = (u) => u && ({
  id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone || '', city: u.city, state: u.state,
  business: u.business, color: u.color, createdAt: u.created_at, verified: !!u.verified,
  rating: u.rating, reviews: u.reviews, isBot: !!u.is_bot, status: u.status,
});

/** What other users may see about someone (no email / phone). */
export const publicUserRow = (u) => u && ({
  id: u.id, name: u.name, city: u.city, state: u.state, business: u.business, color: u.color,
  createdAt: u.created_at, verified: !!u.verified, rating: u.rating, reviews: u.reviews, isBot: !!u.is_bot,
});

export const listingRow = (l) => l && ({
  id: l.id, sellerId: l.seller_id, category: l.category, subtype: l.subtype, brand: l.brand, model: l.model,
  title: l.title, year: l.year, tyres: l.tyres, emission: l.emission, fuel: l.fuel, transmission: l.transmission,
  km: l.km, engine: l.engine, power: l.power, load: l.load, ownership: l.ownership, regNo: l.reg_no, body: l.body,
  city: l.city, state: l.state, price: l.price, negotiable: !!l.negotiable, description: l.description,
  highlights: JSON.parse(l.highlights), extras: JSON.parse(l.extras || '{}'), color: l.color, photos: JSON.parse(l.photos), status: l.status,
  views: l.views, createdAt: l.created_at, updatedAt: l.updated_at,
});

export const chatRow = (c) => c && ({
  id: c.id, listingId: c.listing_id, buyerId: c.buyer_id, sellerId: c.seller_id,
  createdAt: c.created_at, updatedAt: c.updated_at,
});

export const messageRow = (m) => m && ({
  id: m.id, chatId: m.chat_id, senderId: m.sender_id, text: m.text, images: JSON.parse(m.images), createdAt: m.created_at,
});

export const notificationRow = (n) => n && ({
  id: n.id, userId: n.user_id, title: n.title, body: n.body, link: n.link, icon: n.icon, read: !!n.read, createdAt: n.created_at,
});

export const financeRow = (r) => r && ({
  id: r.id, userId: r.user_id, listingId: r.listing_id, name: r.name, age: r.age, mobile: r.mobile,
  city: r.city, state: r.state, pincode: r.pincode, status: r.status, createdAt: r.created_at,
});

export function notify(userId, n) {
  db.prepare('INSERT INTO notifications (id,user_id,title,body,link,icon,read,created_at) VALUES (?,?,?,?,?,?,0,?)')
    .run(uid('n_'), userId, n.title, n.body || '', n.link || '#/', n.icon || 'bell', Date.now());
  // keep the table bounded per user
  db.prepare(`DELETE FROM notifications WHERE user_id = ? AND id NOT IN
    (SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 200)`).run(userId, userId);
}

export const formFieldRow = (f) => f && ({
  key: f.key, label: f.label, type: f.type, group: f.grp, required: !!f.required, enabled: !!f.enabled,
  locked: !!f.locked, builtin: !!f.builtin, placeholder: f.placeholder, options: JSON.parse(f.options), sort: f.sort,
});
export const allFormFields = () => db.prepare('SELECT * FROM form_fields ORDER BY sort, key').all().map(formFieldRow);
