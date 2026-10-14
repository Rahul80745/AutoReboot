import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db, tx, uid, notify, ensureFormFields, allFormFields, userRow, publicUserRow, listingRow, chatRow, messageRow, notificationRow, financeRow,
} from './db.js';
import {
  COOKIE, hashPassword, verifyPassword, newSalt, createSession, destroySession, destroyUserSessions,
  userForToken, parseCookies, setSessionCookie, clearSessionCookie, rateLimit,
} from './security.js';
import { scheduleBotReply } from './bot.js';
import {
  CATEGORY_IDS, CAT_PREFIX, SPEC_DEFAULTS, STATES, subById,
} from './catalog.js';
import { GROUPS, CUSTOM_TYPES, REQUIRABLE } from './form-defaults.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const AVATAR_COLORS = ['#E5194D', '#2563EB', '#138A43', '#7C3AED', '#D97706', '#0891B2', '#DB2777'];

class HttpError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}
const bad = (message, field) => new HttpError(400, message, field);

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const crypto_sha = (t) => crypto.createHash('sha256').update(t || '').digest('hex');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------ validation ------------------------------ */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const DATA_IMG_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMG_CHARS = 2_000_000; // ~1.5 MB per image after base64

function cleanImages(arr, max, allowArt = false) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const x of arr.slice(0, max)) {
    if (typeof x !== 'string') continue;
    if (allowArt && /^art:[A-Z0-9]+:[a-z]+$/.test(x)) { out.push(x); continue; }
    if (x.length > MAX_IMG_CHARS || !DATA_IMG_RE.test(x)) throw bad('One of the images is not a supported format or is too large');
    out.push(x);
  }
  return out;
}

const SELECT_DEFAULTS = { emission: 'BS-VI', fuel: 'Diesel', transmission: 'Manual' };
const TEXT_KEYS = ['regNo', 'engine', 'power', 'load', 'body'];
const TEXT_MAX = { regNo: 20, engine: 40, power: 40, load: 60, body: 80 };

/** Validate + normalise a listing payload against the owner-configured form. `prev` = existing listing (edits). */
function validateListing(d, fields, prev = null) {
  const F = Object.fromEntries(fields.map((f) => [f.key, f]));
  const on = (k) => F[k] && F[k].enabled;
  const label = (k, fallback) => (F[k] ? F[k].label : fallback);
  const out = {};

  // identity fields are always required
  if (!CATEGORY_IDS.includes(d.category)) throw bad('Choose a vehicle type', 'category');
  out.category = d.category;
  if (d.category === 'trucks') {
    if (!subById(d.subtype)) throw bad(`Choose a ${label('subtype', 'truck type').toLowerCase()}`, 'subtype');
    out.subtype = d.subtype;
  } else out.subtype = null;
  out.brand = str(d.brand, 60); if (!out.brand) throw bad(`Choose a ${label('brand', 'brand').toLowerCase()}`, 'brand');
  out.model = str(d.model, 80); if (!out.model) throw bad(`Enter the ${label('model', 'model').toLowerCase()}`, 'model');
  out.city = str(d.city, 80); if (!out.city) throw bad('Enter the city', 'city');
  out.state = str(d.state, 60); if (!STATES.includes(out.state)) throw bad('Choose a state', 'state');
  const now = new Date().getFullYear();
  out.year = Math.trunc(+d.year);
  if (!(out.year >= 1990 && out.year <= now)) throw bad(`Enter a year between 1990 and ${now}`, 'year');
  out.price = Math.trunc(+d.price);
  if (!(out.price >= 10000 && out.price <= 5_000_000_000)) throw bad('Enter a price of at least ₹10,000', 'price');
  if (d.km === '' || d.km === null || d.km === undefined || !(+d.km >= 0 && +d.km <= 10_000_000)) throw bad('Enter the distance or hours used', 'km');
  out.km = Math.trunc(+d.km);

  const required = (k, empty) => { if (on(k) && F[k].required && empty) throw bad(`${F[k].label} is required`, k); };
  const sp = SPEC_DEFAULTS[d.category === 'trucks' ? d.subtype : d.category];

  out.tyres = Math.min(30, Math.max(0, Math.trunc(+d.tyres) || 0));
  required('tyres', !out.tyres && !['tractors', 'construction', 'farm'].includes(d.category));

  for (const k of Object.keys(SELECT_DEFAULTS)) {
    const opts = F[k]?.options || [];
    let v = str(d[k], 40);
    if (on(k) && opts.length && !opts.includes(v) && v !== prev?.[k]) v = '';
    if (!v) { required(k, true); v = opts.includes(SELECT_DEFAULTS[k]) ? SELECT_DEFAULTS[k] : (opts[0] || ''); }
    out[k] = v;
  }
  for (const k of TEXT_KEYS) {
    let v = str(d[k], TEXT_MAX[k]);
    if (k === 'regNo') v = v.toUpperCase();
    if (on(k)) { required(k, !v); if (!v && k !== 'regNo') v = sp[k === 'body' ? 'body' : k]; }
    out[k] = v;
  }
  out.negotiable = d.negotiable === undefined ? 1 : d.negotiable ? 1 : 0;
  out.description = str(d.description, 1200); required('description', !out.description);
  out.highlights = (Array.isArray(d.highlights) ? d.highlights : []).slice(0, 30).map((h) => str(h, 80)).filter(Boolean);
  required('highlights', !out.highlights.length);
  out.color = /^#[0-9a-fA-F]{6}$/.test(d.color || '') ? d.color : '#F3F4F7';
  out.photos = cleanImages(d.photos, 8); required('photos', !out.photos.length);
  out.ownership = ['1st Owner', '2nd Owner', '3rd Owner', '4th Owner or more'].includes(d.ownership) ? d.ownership : '1st Owner';

  // owner-defined custom fields
  const given = d.extras && typeof d.extras === 'object' ? d.extras : {};
  out.extras = {};
  for (const f of fields.filter((x) => !x.builtin)) {
    const raw = given[f.key];
    let v;
    if (f.type === 'toggle') v = raw === undefined || raw === '' ? undefined : !!raw;
    else if (f.type === 'number') v = raw === '' || raw == null || !Number.isFinite(+raw) ? undefined : +raw;
    else if (f.type === 'select') v = typeof raw === 'string' && (f.options.includes(raw) || (!f.enabled && raw)) ? raw.slice(0, 80) : undefined;
    else v = raw == null ? undefined : str(raw, f.type === 'textarea' ? 1000 : 200) || undefined;
    if (f.enabled && f.required && f.type !== 'toggle' && v === undefined) throw bad(`${f.label} is required`, f.key);
    if (v !== undefined) out.extras[f.key] = v;
  }
  // Ad title: shown as the listing's title. Falls back to "Brand Model" when optional and left empty.
  const autoOf = (b, m) => `${b} ${m}`.replace(/^Tata Tata/, 'Tata');
  const adTitle = str(d.title, 100);
  required('title', !adTitle);
  out.title = !adTitle || (prev && adTitle === prev.title && prev.title === autoOf(prev.brand, prev.model)) ? autoOf(out.brand, out.model) : adTitle;
  return out;
}

/* -------------------------------- app ---------------------------------- */
export function createApp({ demo = true } = {}) {
  ensureFormFields();
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    });
    next();
  });
  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.use(express.json({ limit: '12mb' }));

  // CSRF defence in depth: state-changing API calls must be same-origin JSON.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Cross-origin request blocked' }); }
      catch { return res.status(403).json({ error: 'Bad origin' }); }
    }
    if (req.headers['content-length'] !== '0' && req.body && !req.is('application/json') && Object.keys(req.body).length) {
      return res.status(415).json({ error: 'Expected JSON' });
    }
    next();
  });

  app.use((req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    req.token = token;
    req.user = userForToken(token);
    next();
  });

  const needAuth = (req, res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in to continue')));
  const needUser = (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please log in to continue'));
    if (req.user.role !== 'user') return next(new HttpError(403, 'This action is only available to user accounts'));
    next();
  };
  const needOwner = (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please log in to continue'));
    if (req.user.role !== 'owner') return next(new HttpError(403, 'Owner access only'));
    next();
  };

  const api = express.Router();
  app.use('/api', api);

  /* ------------------------------- auth -------------------------------- */
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 12 });
  const DUMMY_SALT = newSalt();

  api.post('/auth/register', authLimiter, wrap(async (req, res) => {
    const name = str(req.body.name, 80);
    const email = str(req.body.email, 120).toLowerCase();
    const phone = String(req.body.phone || '').replace(/\D/g, '');
    const password = String(req.body.password || '');
    if (name.length < 2) throw bad('Enter your full name', 'name');
    if (!EMAIL_RE.test(email)) throw bad('Enter a valid email address', 'email');
    if (!PHONE_RE.test(phone)) throw bad('Enter a valid 10 digit mobile number', 'phone');
    if (password.length < 8) throw bad('Password must be at least 8 characters', 'password');
    if (password.length > 200) throw bad('Password is too long', 'password');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('An account with this email already exists', 'email');
    if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw bad('This mobile number is already registered', 'phone');
    const state = STATES.includes(req.body.state) ? req.body.state : '';
    const salt = newSalt();
    const hash = await hashPassword(password, salt);
    const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    const id = uid('u_');
    db.prepare(`INSERT INTO users (id,role,name,email,phone,salt,pass_hash,city,state,color,created_at,last_login)
                VALUES (?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, email, phone, salt, hash, str(req.body.city, 80), state, AVATAR_COLORS[count % AVATAR_COLORS.length], Date.now(), Date.now());
    notify(id, { title: 'Welcome to Autoreboot', body: 'Your account is ready. Browse verified commercial vehicles or list your own.', link: '#/', icon: 'sparkle' });
    setSessionCookie(req, res, createSession(id));
    res.status(201).json({ user: userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  }));

  api.post('/auth/login', authLimiter, wrap(async (req, res) => {
    const as = req.body.as === 'owner' ? 'owner' : 'user';
    const key = str(req.body.id, 120).toLowerCase();
    const password = String(req.body.password || '');
    const phone = key.replace(/\D/g, '');
    let u;
    if (as === 'owner') u = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'owner'").get(key);
    else u = db.prepare("SELECT * FROM users WHERE role = 'user' AND is_bot = 0 AND (email = ? OR (? != '' AND length(?) = 10 AND phone = ?))").get(key, phone, phone, phone);
    const ok = await verifyPassword(password, u ? u.salt : DUMMY_SALT, u ? u.pass_hash : '!');
    if (!u || !ok) {
      // If the credentials are right but belong to the other role, say so (only after the password matched).
      const other = db.prepare('SELECT * FROM users WHERE email = ? AND is_bot = 0').get(key);
      if (other && other.role !== as && await verifyPassword(password, other.salt, other.pass_hash)) {
        throw new HttpError(401, other.role === 'owner' ? 'This is an owner account. Use the Owner sign in.' : 'This is a user account. Use the User sign in.', 'id');
      }
      throw new HttpError(401, as === 'owner' ? 'Incorrect owner email or password' : 'Incorrect email / mobile number or password', 'password');
    }
    if (u.status !== 'active') throw new HttpError(403, 'This account has been suspended. Contact support.');
    db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), u.id);
    setSessionCookie(req, res, createSession(u.id));
    res.json({ user: userRow(u) });
  }));

  api.post('/auth/logout', (req, res) => {
    destroySession(req.token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  api.get('/auth/me', (req, res) => res.json({ user: req.user ? userRow(req.user) : null }));

  api.patch('/auth/me', needAuth, wrap(async (req, res) => {
    const u = req.user; const b = req.body; const set = {};
    if (b.name !== undefined) { set.name = str(b.name, 80); if (set.name.length < 2) throw bad('Enter your full name', 'name'); }
    if (b.phone !== undefined && u.role === 'user') {
      const p = String(b.phone).replace(/\D/g, '');
      if (!PHONE_RE.test(p)) throw bad('Enter a valid 10 digit mobile number', 'phone');
      if (db.prepare('SELECT 1 FROM users WHERE phone = ? AND id != ?').get(p, u.id)) throw bad('This mobile number is already registered', 'phone');
      set.phone = p;
    }
    if (b.city !== undefined) set.city = str(b.city, 80);
    if (b.business !== undefined) set.business = str(b.business, 100);
    if (b.state !== undefined) set.state = STATES.includes(b.state) ? b.state : '';
    const keys = Object.keys(set);
    if (keys.length) db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => set[k]), u.id);
    res.json({ user: userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
  }));

  api.post('/auth/password', needAuth, authLimiter, wrap(async (req, res) => {
    const u = req.user;
    if (!(await verifyPassword(String(req.body.old || ''), u.salt, u.pass_hash))) throw bad('Current password is incorrect', 'old');
    const next = String(req.body.new || '');
    if (next.length < 8) throw bad('New password must be at least 8 characters', 'new');
    if (next.length > 200) throw bad('Password is too long', 'new');
    const salt = newSalt();
    db.prepare('UPDATE users SET salt = ?, pass_hash = ? WHERE id = ?').run(salt, await hashPassword(next, salt), u.id);
    // sign out every other device
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(u.id, crypto_sha(req.token));
    res.json({ ok: true });
  }));

  /* ------------------------- snapshot / sync ---------------------------- */
  api.get('/bootstrap', (req, res) => {
    const me = req.user;
    const lsince = Math.max(0, +req.query.ls || 0);
    const msince = Math.max(0, +req.query.ms || 0);
    const meId = me ? me.id : '';
    const visible = me && me.role === 'owner' ? `(1 = 1 OR l.seller_id = ?)` : `((l.status IN ('active','sold') AND u.status = 'active') OR l.seller_id = ?)`;
    const ids = db.prepare(`SELECT l.id FROM listings l JOIN users u ON u.id = l.seller_id WHERE ${visible}`).all(meId).map((r) => r.id);
    const changed = db.prepare(`SELECT l.* FROM listings l JOIN users u ON u.id = l.seller_id WHERE ${visible} AND l.updated_at >= ?`)
      .all(meId, lsince).map(listingRow);

    const out = { now: Date.now(), demo, user: me ? userRow(me) : null, listings: changed, listingIds: ids, formFields: allFormFields() };
    const userIds = new Set(db.prepare(`SELECT DISTINCT l.seller_id id FROM listings l JOIN users u ON u.id = l.seller_id WHERE ${visible}`).all(meId).map((r) => r.id));
    if (me && me.role === 'user') {
      const chats = db.prepare(`SELECT * FROM chats WHERE (buyer_id = ? AND buyer_hidden = 0) OR (seller_id = ? AND seller_hidden = 0) ORDER BY updated_at DESC`).all(meId, meId);
      out.chats = chats.map((c) => ({ ...chatRow(c), lastRead: c.buyer_id === meId ? c.buyer_read : c.seller_read }));
      const chatIds = chats.map((c) => c.id);
      out.messages = chatIds.length
        ? db.prepare(`SELECT * FROM messages WHERE chat_id IN (${chatIds.map(() => '?').join(',')}) AND created_at >= ? ORDER BY created_at`).all(...chatIds, msince).map(messageRow)
        : [];
      chats.forEach((c) => { userIds.add(c.buyer_id); userIds.add(c.seller_id); });
      out.favorites = db.prepare('SELECT listing_id FROM favorites WHERE user_id = ?').all(meId).map((r) => r.listing_id);
      out.notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(meId).map(notificationRow);
      out.finance = db.prepare('SELECT * FROM finance_requests WHERE user_id = ? ORDER BY created_at DESC').all(meId).map(financeRow);
    }
    if (me) userIds.add(meId);
    const idList = [...userIds];
    out.users = idList.length
      ? db.prepare(`SELECT * FROM users WHERE id IN (${idList.map(() => '?').join(',')})`).all(...idList).map((u) => (u.id === meId ? userRow(u) : publicUserRow(u)))
      : [];
    res.json(out);
  });

  /* ------------------------------ listings ------------------------------ */
  function nextListingId(d) {
    const pre = d.category === 'trucks' ? subById(d.subtype).prefix : CAT_PREFIX[d.category];
    let id;
    do { id = pre + String(Math.floor(100000 + Math.random() * 899999)); } while (db.prepare('SELECT 1 FROM listings WHERE id = ?').get(id));
    return id;
  }
  const L_COLS = ['category', 'subtype', 'brand', 'model', 'title', 'year', 'tyres', 'emission', 'fuel', 'transmission', 'km', 'engine', 'power', 'load', 'ownership', 'reg_no', 'body', 'city', 'state', 'price', 'negotiable', 'description', 'highlights', 'color', 'photos', 'extras'];
  const lVals = (v) => [v.category, v.subtype, v.brand, v.model, v.title, v.year, v.tyres, v.emission, v.fuel, v.transmission, v.km, v.engine, v.power, v.load, v.ownership, v.regNo, v.body, v.city, v.state, v.price, v.negotiable, v.description, JSON.stringify(v.highlights), v.color, JSON.stringify(v.photos), JSON.stringify(v.extras)];

  api.post('/listings', needUser, wrap(async (req, res) => {
    const v = validateListing(req.body, allFormFields());
    const id = nextListingId(v); const now = Date.now();
    db.prepare(`INSERT INTO listings (id,seller_id,${L_COLS.join(',')},status,views,created_at,updated_at) VALUES (?,?,${L_COLS.map(() => '?').join(',')},'active',0,?,?)`)
      .run(id, req.user.id, ...lVals(v), now, now);
    notify(req.user.id, { title: 'Your vehicle is live', body: `${v.title} is now visible to buyers. Listing ID ${id}.`, link: '#/v/' + id, icon: 'checkCircle' });
    res.status(201).json({ listing: listingRow(db.prepare('SELECT * FROM listings WHERE id = ?').get(id)) });
  }));

  const ownListing = (req) => {
    const l = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
    if (!l || l.seller_id !== req.user.id) throw new HttpError(403, 'You can only change your own listings');
    return l;
  };

  api.patch('/listings/:id', needUser, wrap(async (req, res) => {
    const cur = ownListing(req);
    if (cur.status === 'removed') throw new HttpError(403, 'This listing was removed by the Autoreboot team');
    const prev = listingRow(cur);
    const v = validateListing({ ...prev, ...req.body }, allFormFields(), prev);
    db.prepare(`UPDATE listings SET ${L_COLS.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...lVals(v), Date.now(), cur.id);
    res.json({ listing: listingRow(db.prepare('SELECT * FROM listings WHERE id = ?').get(cur.id)) });
  }));

  api.post('/listings/:id/status', needUser, wrap(async (req, res) => {
    const cur = ownListing(req);
    if (cur.status === 'removed') throw new HttpError(403, 'This listing was removed by the Autoreboot team');
    if (!['active', 'sold'].includes(req.body.status)) throw bad('Invalid status');
    db.prepare('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?').run(req.body.status, Date.now(), cur.id);
    res.json({ listing: listingRow(db.prepare('SELECT * FROM listings WHERE id = ?').get(cur.id)) });
  }));

  api.delete('/listings/:id', needUser, wrap(async (req, res) => {
    const cur = ownListing(req);
    db.prepare('DELETE FROM listings WHERE id = ?').run(cur.id);
    res.json({ ok: true });
  }));

  api.post('/listings/:id/view', (req, res) => {
    db.prepare("UPDATE listings SET views = views + 1 WHERE id = ? AND status != 'removed'").run(req.params.id);
    res.json({ ok: true });
  });

  /* ------------------------ favourites / notifications ------------------- */
  api.post('/favorites/:id/toggle', needUser, (req, res) => {
    const l = db.prepare("SELECT id FROM listings WHERE id = ? AND status != 'removed'").get(req.params.id);
    if (!l) throw new HttpError(404, 'This vehicle is no longer available');
    const has = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND listing_id = ?').get(req.user.id, l.id);
    if (has) db.prepare('DELETE FROM favorites WHERE user_id = ? AND listing_id = ?').run(req.user.id, l.id);
    else db.prepare('INSERT INTO favorites (user_id,listing_id,created_at) VALUES (?,?,?)').run(req.user.id, l.id, Date.now());
    res.json({ on: !has });
  });

  api.post('/notifications/read-all', needUser, (req, res) => {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });
  api.post('/notifications/:id/read', needUser, (req, res) => {
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ ok: true });
  });

  /* -------------------------------- chats -------------------------------- */
  const myChat = (req) => {
    const c = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
    if (!c || (c.buyer_id !== req.user.id && c.seller_id !== req.user.id)) throw new HttpError(404, 'Conversation not found');
    return c;
  };

  api.post('/chats', needUser, (req, res) => {
    const l = db.prepare("SELECT * FROM listings WHERE id = ? AND status != 'removed'").get(str(req.body.listingId, 30));
    if (!l) throw new HttpError(404, 'This vehicle is no longer available');
    if (l.seller_id === req.user.id) throw bad('This is your own listing');
    let c = db.prepare('SELECT * FROM chats WHERE listing_id = ? AND buyer_id = ?').get(l.id, req.user.id);
    if (!c) {
      const id = uid('c_'); const now = Date.now();
      db.prepare('INSERT INTO chats (id,listing_id,buyer_id,seller_id,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, l.id, req.user.id, l.seller_id, now, now);
      c = { id };
    } else db.prepare('UPDATE chats SET buyer_hidden = 0 WHERE id = ?').run(c.id);
    res.json({ id: c.id });
  });

  api.post('/chats/:id/messages', needUser, wrap(async (req, res) => {
    const c = myChat(req);
    const text = String(req.body.text ?? '').trim();
    const images = cleanImages(req.body.images, 4);
    if (!text && !images.length) throw bad('Write a message first');
    if (text.length > 1000) throw bad('Messages can be up to 1000 characters');
    const other = c.buyer_id === req.user.id ? c.seller_id : c.buyer_id;
    const otherUser = db.prepare('SELECT * FROM users WHERE id = ?').get(other);
    if (!otherUser) throw new HttpError(404, 'This user no longer exists');
    const m = { id: uid('m_'), created_at: Date.now() };
    tx(() => {
      db.prepare('INSERT INTO messages (id,chat_id,sender_id,text,images,created_at) VALUES (?,?,?,?,?,?)').run(m.id, c.id, req.user.id, text, JSON.stringify(images), m.created_at);
      const mine = c.buyer_id === req.user.id ? 'buyer_read' : 'seller_read';
      db.prepare(`UPDATE chats SET updated_at = ?, ${mine} = ?, buyer_hidden = 0, seller_hidden = 0 WHERE id = ?`).run(m.created_at, m.created_at, c.id);
      if (!otherUser.is_bot) notify(other, { title: `New message from ${req.user.name}`, body: text || 'Sent photos', link: '#/chat/' + c.id, icon: 'msg' });
    });
    if (otherUser.is_bot) scheduleBotReply(c, { text, images });
    res.status(201).json({ message: messageRow(db.prepare('SELECT * FROM messages WHERE id = ?').get(m.id)) });
  }));

  api.post('/chats/:id/read', needUser, (req, res) => {
    const c = myChat(req);
    db.prepare(`UPDATE chats SET ${c.buyer_id === req.user.id ? 'buyer_read' : 'seller_read'} = ? WHERE id = ?`).run(Date.now(), c.id);
    res.json({ ok: true });
  });

  api.delete('/chats/:id', needUser, (req, res) => {
    const c = myChat(req);
    db.prepare(`UPDATE chats SET ${c.buyer_id === req.user.id ? 'buyer_hidden' : 'seller_hidden'} = 1 WHERE id = ?`).run(c.id);
    res.json({ ok: true });
  });

  /* ------------------------------- finance ------------------------------- */
  api.post('/finance', needUser, wrap(async (req, res) => {
    const b = req.body;
    const name = str(b.name, 80), age = +b.age, mobile = String(b.mobile || '').replace(/\D/g, ''), city = str(b.city, 80), pin = str(b.pincode, 6);
    if (name.length < 2) throw bad('Enter your full name', 'name');
    if (!(age >= 18 && age <= 75)) throw bad('Age must be between 18 and 75', 'age');
    if (!PHONE_RE.test(mobile)) throw bad('Enter a valid 10 digit mobile number', 'mobile');
    if (city.length < 2) throw bad('Enter your city', 'city');
    if (!STATES.includes(b.state)) throw bad('Select your state', 'state');
    if (!/^[1-9]\d{5}$/.test(pin)) throw bad('Enter a valid 6 digit pincode', 'pincode');
    const l = db.prepare("SELECT id,title FROM listings WHERE id = ? AND status != 'removed'").get(str(b.listingId, 30));
    if (!l) throw new HttpError(404, 'This vehicle is no longer available');
    if (db.prepare('SELECT 1 FROM finance_requests WHERE user_id = ? AND listing_id = ? AND created_at > ?').get(req.user.id, l.id, Date.now() - 864e5)) {
      throw bad('You already requested finance for this vehicle today. Our team will call you soon.');
    }
    const id = uid('f_');
    db.prepare(`INSERT INTO finance_requests (id,user_id,listing_id,name,age,mobile,city,state,pincode,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, req.user.id, l.id, name, Math.trunc(age), mobile, city, b.state, pin, Date.now());
    notify(req.user.id, { title: 'Finance request received', body: `For ${l.title}. Our finance team will call you within 24 hours.`, link: '#/profile/finance', icon: 'bank' });
    res.status(201).json({ request: financeRow(db.prepare('SELECT * FROM finance_requests WHERE id = ?').get(id)) });
  }));

  /* -------------------------------- owner -------------------------------- */
  const owner = express.Router();
  api.use('/owner', needOwner, owner);

  owner.get('/overview', (req, res) => {
    const one = (sql, ...p) => db.prepare(sql).get(...p).c;
    const DAY = 864e5;
    res.json({
      users: one("SELECT COUNT(*) c FROM users WHERE role='user' AND is_bot=0"),
      newUsers7d: one("SELECT COUNT(*) c FROM users WHERE role='user' AND is_bot=0 AND created_at > ?", Date.now() - 7 * DAY),
      suspended: one("SELECT COUNT(*) c FROM users WHERE status='suspended'"),
      listingsActive: one("SELECT COUNT(*) c FROM listings WHERE status='active'"),
      listingsSold: one("SELECT COUNT(*) c FROM listings WHERE status='sold'"),
      listingsRemoved: one("SELECT COUNT(*) c FROM listings WHERE status='removed'"),
      chats: one('SELECT COUNT(*) c FROM chats'),
      messages: one('SELECT COUNT(*) c FROM messages'),
      financeNew: one("SELECT COUNT(*) c FROM finance_requests WHERE status='new'"),
      financeTotal: one('SELECT COUNT(*) c FROM finance_requests'),
      inventoryValue: one("SELECT COALESCE(SUM(price),0) c FROM listings WHERE status='active'"),
      recentUsers: db.prepare("SELECT * FROM users WHERE role='user' AND is_bot=0 ORDER BY created_at DESC LIMIT 6").all().map(userRow),
      recentListings: db.prepare("SELECT l.id,l.title,l.price,l.status,l.created_at,u.name seller FROM listings l JOIN users u ON u.id=l.seller_id ORDER BY l.created_at DESC LIMIT 6").all()
        .map((r) => ({ id: r.id, title: r.title, price: r.price, status: r.status, createdAt: r.created_at, seller: r.seller })),
    });
  });

  const like = (q) => `%${String(q || '').trim().replace(/[%_\\]/g, '\\$&')}%`;

  owner.get('/users', (req, res) => {
    const q = like(req.query.q);
    const rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM listings l WHERE l.seller_id = u.id) AS listing_count
      FROM users u WHERE u.role = 'user' AND u.is_bot = 0 AND (u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')
      ORDER BY u.created_at DESC LIMIT 300`).all(q, q, q);
    res.json({ users: rows.map((u) => ({ ...userRow(u), listingCount: u.listing_count, lastLogin: u.last_login })) });
  });

  const targetUser = (req) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw new HttpError(404, 'User not found');
    if (u.role === 'owner') throw new HttpError(403, 'Owner accounts cannot be changed here');
    return u;
  };

  owner.patch('/users/:id', (req, res) => {
    const u = targetUser(req);
    tx(() => {
      if (req.body.verified !== undefined) db.prepare('UPDATE users SET verified = ? WHERE id = ?').run(req.body.verified ? 1 : 0, u.id);
      if (req.body.status !== undefined) {
        if (!['active', 'suspended'].includes(req.body.status)) throw bad('Invalid status');
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run(req.body.status, u.id);
        if (req.body.status === 'suspended') destroyUserSessions(u.id);
        // listings of suspended sellers are hidden; bump so clients re-sync them
        db.prepare('UPDATE listings SET updated_at = ? WHERE seller_id = ?').run(Date.now(), u.id);
      }
    });
    res.json({ user: userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
  });

  owner.delete('/users/:id', (req, res) => {
    const u = targetUser(req);
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    res.json({ ok: true });
  });

  owner.get('/listings', (req, res) => {
    const q = like(req.query.q);
    const status = ['active', 'sold', 'removed'].includes(req.query.status) ? req.query.status : null;
    const rows = db.prepare(`SELECT l.id,l.title,l.price,l.status,l.city,l.state,l.views,l.created_at,l.category,l.subtype,l.seller_id,u.name seller_name
      FROM listings l JOIN users u ON u.id = l.seller_id
      WHERE (l.title LIKE ? ESCAPE '\\' OR l.id LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR l.city LIKE ? ESCAPE '\\') AND (? IS NULL OR l.status = ?)
      ORDER BY l.created_at DESC LIMIT 300`).all(q, q, q, q, status, status);
    res.json({ listings: rows.map((r) => ({ id: r.id, title: r.title, price: r.price, status: r.status, city: r.city, state: r.state, views: r.views, createdAt: r.created_at, category: r.category, subtype: r.subtype, sellerId: r.seller_id, sellerName: r.seller_name })) });
  });

  owner.patch('/listings/:id', (req, res) => {
    const l = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
    if (!l) throw new HttpError(404, 'Listing not found');
    if (!['active', 'sold', 'removed'].includes(req.body.status)) throw bad('Invalid status');
    db.prepare('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?').run(req.body.status, Date.now(), l.id);
    const seller = db.prepare('SELECT id,is_bot FROM users WHERE id = ?').get(l.seller_id);
    if (seller && !seller.is_bot && req.body.status !== l.status && (req.body.status === 'removed' || l.status === 'removed')) {
      notify(l.seller_id, req.body.status === 'removed'
        ? { title: 'Listing removed', body: `${l.title} (${l.id}) was removed by the Autoreboot team because it did not meet our listing guidelines.`, link: '#/profile', icon: 'info' }
        : { title: 'Listing restored', body: `${l.title} (${l.id}) is visible to buyers again.`, link: '#/v/' + l.id, icon: 'checkCircle' });
    }
    res.json({ ok: true });
  });

  owner.delete('/listings/:id', (req, res) => {
    db.prepare('DELETE FROM listings WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  owner.get('/finance', (req, res) => {
    const rows = db.prepare(`SELECT f.*, l.title listing_title, u.email user_email FROM finance_requests f
      LEFT JOIN listings l ON l.id = f.listing_id JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC LIMIT 300`).all();
    res.json({ requests: rows.map((r) => ({ ...financeRow(r), listingTitle: r.listing_title || 'Vehicle removed', userEmail: r.user_email })) });
  });

  owner.patch('/finance/:id', (req, res) => {
    const r = db.prepare('SELECT * FROM finance_requests WHERE id = ?').get(req.params.id);
    if (!r) throw new HttpError(404, 'Request not found');
    if (!['new', 'contacted', 'closed'].includes(req.body.status)) throw bad('Invalid status');
    db.prepare('UPDATE finance_requests SET status = ? WHERE id = ?').run(req.body.status, r.id);
    if (req.body.status === 'contacted' && r.status !== 'contacted') {
      const l = db.prepare('SELECT title FROM listings WHERE id = ?').get(r.listing_id);
      notify(r.user_id, { title: 'Finance team has reached out', body: `Update on your request for ${l ? l.title : 'your vehicle'}. Expect a call from our finance team.`, link: '#/profile/finance', icon: 'bank' });
    }
    res.json({ ok: true });
  });


  /* ---- owner: edit the "Sell your vehicle" form ---- */
  const fieldByKey = (key) => {
    const f = db.prepare('SELECT * FROM form_fields WHERE key = ?').get(key);
    if (!f) throw new HttpError(404, 'Field not found');
    return f;
  };
  const cleanOptions = (arr, min = 1) => {
    const seen = new Set();
    const opts = (Array.isArray(arr) ? arr : []).map((o) => str(o, 60)).filter((o) => o && !seen.has(o) && seen.add(o)).slice(0, 40);
    if (opts.length < min) throw bad(min > 1 ? `Add at least ${min} options` : 'Add at least one option', 'options');
    return opts;
  };

  owner.get('/form-fields', (req, res) => res.json({ fields: allFormFields() }));

  owner.post('/form-fields', (req, res) => {
    const label = str(req.body.label, 60);
    if (label.length < 2) throw bad('Enter a field name', 'label');
    const type = req.body.type;
    if (!CUSTOM_TYPES.includes(type)) throw bad('Choose a field type', 'type');
    const group = GROUPS.includes(req.body.group) && ['details', 'pricing'].includes(req.body.group) ? req.body.group : 'details';
    const options = type === 'select' ? cleanOptions(req.body.options, 2) : [];
    const sort = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM form_fields').get().m + 10;
    const key = 'x_' + uid('').slice(-10);
    db.prepare('INSERT INTO form_fields (key,label,type,grp,required,enabled,locked,builtin,placeholder,options,sort) VALUES (?,?,?,?,?,1,0,0,?,?,?)')
      .run(key, label, type, group, REQUIRABLE.includes(type) && req.body.required ? 1 : 0, str(req.body.placeholder, 80), JSON.stringify(options), sort);
    res.status(201).json({ fields: allFormFields() });
  });

  owner.patch('/form-fields/:key', (req, res) => {
    const f = fieldByKey(req.params.key); const b = req.body; const set = {};
    if (b.label !== undefined) { set.label = str(b.label, 60); if (set.label.length < 2) throw bad('Enter a field name', 'label'); }
    if (b.placeholder !== undefined) set.placeholder = str(b.placeholder, 80);
    if (b.options !== undefined && ['select', 'checks'].includes(f.type)) set.options = JSON.stringify(cleanOptions(b.options, f.type === 'select' ? 2 : 1));
    if (b.group !== undefined && !f.builtin && ['details', 'pricing'].includes(b.group)) set.grp = b.group;
    if (b.enabled !== undefined) {
      if (f.locked && !b.enabled) throw new HttpError(403, 'This field is needed for every listing and cannot be hidden');
      set.enabled = b.enabled ? 1 : 0;
    }
    if (b.required !== undefined) {
      if (f.locked && !b.required) throw new HttpError(403, 'This field is always required');
      set.required = REQUIRABLE.includes(f.type) && b.required ? 1 : 0;
    }
    const keys = Object.keys(set);
    if (keys.length) db.prepare(`UPDATE form_fields SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE key = ?`).run(...keys.map((k) => set[k]), f.key);
    res.json({ fields: allFormFields() });
  });

  owner.post('/form-fields/:key/move', (req, res) => {
    const f = fieldByKey(req.params.key);
    const dir = +req.body.dir < 0 ? -1 : 1;
    const peers = db.prepare('SELECT key,sort FROM form_fields WHERE grp = ? ORDER BY sort, key').all(f.grp);
    const i = peers.findIndex((p) => p.key === f.key); const j = i + dir;
    if (j >= 0 && j < peers.length) {
      tx(() => {
        const up = db.prepare('UPDATE form_fields SET sort = ? WHERE key = ?');
        up.run(-1, peers[i].key); up.run(peers[i].sort, peers[j].key); up.run(peers[j].sort, peers[i].key);
      });
    }
    res.json({ fields: allFormFields() });
  });

  owner.delete('/form-fields/:key', (req, res) => {
    const f = fieldByKey(req.params.key);
    if (f.builtin) throw new HttpError(403, 'Built-in fields can be hidden but not deleted');
    db.prepare('DELETE FROM form_fields WHERE key = ?').run(f.key);
    res.json({ fields: allFormFields() });
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));

  /* ------------------------------ static + errors ------------------------ */
  app.use(express.static(path.join(here, '..', 'public'), { extensions: ['html'], index: 'index.html' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large. Try fewer or smaller photos.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, field: err.field });
    if (String(err.message).includes('UNIQUE constraint')) return res.status(409).json({ error: 'That value is already in use' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}
