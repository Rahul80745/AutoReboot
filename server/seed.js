import crypto from 'node:crypto';
import { db, tx, uid } from './db.js';
import { hashPassword, newSalt } from './security.js';
import { buildDemoListings } from './seed-listings.js';

const OWNER_COLOR = '#0F172A';

export async function createOwner({ email, password, name = 'Autoreboot Owner' }) {
  email = email.trim().toLowerCase();
  const salt = newSalt();
  const hash = await hashPassword(password, salt);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    db.prepare("UPDATE users SET role='owner', salt=?, pass_hash=?, status='active', is_bot=0 WHERE id=?").run(salt, hash, existing.id);
    return existing.id;
  }
  const id = uid('o_');
  db.prepare(`INSERT INTO users (id,role,name,email,phone,salt,pass_hash,color,verified,created_at)
              VALUES (?, 'owner', ?, ?, NULL, ?, ?, ?, 1, ?)`).run(id, name, email, salt, hash, OWNER_COLOR, Date.now());
  return id;
}

/** Make sure at least one owner account exists. Returns a message to print on first creation. */
export async function ensureOwner({ requirePassword = false } = {}) {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1").get()) return null;
  // In production never invent a password and print it into shared logs: the operator must provide one.
  if (requirePassword && !process.env.OWNER_PASSWORD) throw new Error('no owner exists yet. Set OWNER_EMAIL and OWNER_PASSWORD (8+ characters) in the environment and redeploy.');
  const email = (process.env.OWNER_EMAIL || 'owner@autoreboot.in').trim().toLowerCase();
  let password = process.env.OWNER_PASSWORD;
  let generated = false;
  if (!password) { password = crypto.randomBytes(9).toString('base64url'); generated = true; }
  if (password.length < 8) throw new Error('OWNER_PASSWORD must be at least 8 characters');
  await createOwner({ email, password, name: process.env.OWNER_NAME || 'Autoreboot Owner' });
  return { email, password: generated ? password : null };
}

const SELLERS = [
  ['u_venk', 'Venkatesh Trucks', 'Khammam', 'Telangana', new Date(2020, 8, 12), 4.7, 152],
  ['u_sai', 'Sri Sai Motors', 'Hyderabad', 'Telangana', new Date(2019, 4, 3), 4.5, 96],
  ['u_lak', 'Lakshmi Transport Co.', 'Vijayawada', 'Andhra Pradesh', new Date(2021, 1, 20), 4.6, 74],
  ['u_dec', 'Deccan Fleet Sales', 'Bengaluru', 'Karnataka', new Date(2018, 10, 8), 4.8, 210],
  ['u_rag', 'Raghav Earthmovers', 'Hyderabad', 'Telangana', new Date(2020, 2, 14), 4.4, 58],
  ['u_kis', 'Kisan Agro Traders', 'Nagpur', 'Maharashtra', new Date(2021, 6, 1), 4.6, 83],
  ['u_met', 'Metro Bus & Coach', 'Pune', 'Maharashtra', new Date(2019, 11, 9), 4.3, 41],
  ['u_gan', 'Ganesh Auto Point', 'Delhi', 'Delhi', new Date(2022, 3, 18), 4.5, 67],
  ['u_pat', 'Patil Logistics', 'Indore', 'Madhya Pradesh', new Date(2020, 9, 27), 4.7, 119],
];
const COLORS = ['#E5194D', '#2563EB', '#138A43', '#7C3AED', '#D97706', '#0891B2', '#DB2777', '#0F766E', '#9333EA'];

/** Demo marketplace content: listing-only "dealer" accounts (cannot sign in) + a demo buyer. */
export async function seedDemo() {
  if (db.prepare('SELECT 1 FROM listings LIMIT 1').get()) return false;
  const now = Date.now();
  const demoSalt = newSalt();
  const demoHash = await hashPassword('demo1234', demoSalt);

  tx(() => {
    const addUser = db.prepare(`INSERT INTO users
      (id,role,name,email,phone,salt,pass_hash,city,state,business,color,verified,rating,reviews,is_bot,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    SELLERS.forEach(([id, name, city, state, since, rating, reviews], i) => {
      addUser.run(id, 'user', name, `${id}@seller.autoreboot.in`, '90000000' + String(i).padStart(2, '0'), '', '!', city, state, name, COLORS[i], 1, rating, reviews, 1, since.getTime());
    });
    addUser.run('u_demo', 'user', 'Arjun Reddy', 'demo@autoreboot.in', '9876543210', demoSalt, demoHash, 'Hyderabad', 'Telangana', 'Reddy Builders', '#2563EB', 1, 4.9, 12, 0, new Date(2024, 0, 15).getTime());

    const addListing = db.prepare(`INSERT INTO listings
      (id,seller_id,category,subtype,brand,model,title,year,tyres,emission,fuel,transmission,km,engine,power,load,ownership,reg_no,body,city,state,price,negotiable,description,highlights,color,photos,status,views,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const l of buildDemoListings(now)) {
      addListing.run(l.id, l.sellerId, l.category, l.subtype, l.brand, l.model, l.title, l.year, l.tyres, l.emission, l.fuel, l.transmission, l.km,
        l.engine, l.power, l.load, l.ownership, l.regNo, l.body, l.city, l.state, l.price, l.negotiable ? 1 : 0, l.description,
        JSON.stringify(l.highlights), l.color, '[]', 'active', l.views, l.createdAt, l.createdAt);
    }

    // demo conversations
    const today = new Date();
    const at = (h, m) => { const d = new Date(today); d.setHours(h, m, 0, 0); return Math.min(d.getTime(), now - 60000); };
    const addChat = db.prepare('INSERT INTO chats (id,listing_id,buyer_id,seller_id,created_at,updated_at,buyer_read,seller_read) VALUES (?,?,?,?,?,?,?,?)');
    addChat.run('c_demo1', 'TIP123450', 'u_demo', 'u_venk', at(10, 28), at(10, 37), at(10, 37), 0);
    addChat.run('c_demo2', 'LOR123456', 'u_demo', 'u_venk', at(10, 32), at(10, 42), at(10, 40), 0);
    const addMsg = db.prepare('INSERT INTO messages (id,chat_id,sender_id,text,images,created_at) VALUES (?,?,?,?,?,?)');
    const M = (chat, sender, text, ts, images = []) => addMsg.run(uid('m_'), chat, sender, text, JSON.stringify(images), ts);
    M('c_demo1', 'u_demo', 'Hello, I am interested in your BharatBenz 2823C Tipper.\nIs it still available?', at(10, 28));
    M('c_demo1', 'u_venk', 'Yes, it is still available.\nTell me if you need more details.', at(10, 30));
    M('c_demo1', 'u_demo', 'Can you share the condition of the vehicle and service history?', at(10, 32));
    M('c_demo1', 'u_venk', 'Sure, the vehicle is in excellent condition.\nAll services are done regularly.\nYou can check the images for more details.', at(10, 34));
    M('c_demo1', 'u_venk', '', at(10, 34) + 1000, ['side', 'flip', 'interior', 'rear'].map(v => 'art:TIP123450:' + v));
    M('c_demo1', 'u_demo', 'Thank you. Please let me know the final price.', at(10, 35));
    M('c_demo1', 'u_venk', 'The price is ₹30,25,000 and slightly negotiable.\nYou can come and check the vehicle.', at(10, 36));
    M('c_demo1', 'u_demo', 'Okay, I will visit tomorrow. Thank you.', at(10, 37));
    M('c_demo2', 'u_demo', 'Hello, I am interested in your Tata LPT 1613.\nIs it still available?', at(10, 32));
    M('c_demo2', 'u_venk', 'Yes, it is still available.\nTell me if you need more details.', at(10, 35));
    M('c_demo2', 'u_demo', 'Can you share the condition and service history?', at(10, 36));
    M('c_demo2', 'u_venk', 'Sure, I will share all details with you.\nPlease check the images.', at(10, 38));
    M('c_demo2', 'u_venk', '', at(10, 39), ['side', 'rear', 'interior', 'flip'].map(v => 'art:LOR123456:' + v));
    M('c_demo2', 'u_demo', 'Thank you. Please let me know the final price.', at(10, 40));
    M('c_demo2', 'u_venk', 'The price is ₹12,50,000 and slightly negotiable.\nYou can come and check the vehicle.', at(10, 41));
    M('c_demo2', 'u_demo', 'Okay, I will visit tomorrow. Thank you.', at(10, 42));

    db.prepare("INSERT INTO favorites (user_id,listing_id,created_at) VALUES ('u_demo','TIP123450',?),('u_demo','LOR123456',?)").run(now, now);
    const H = 3600e3;
    const addNoti = db.prepare('INSERT INTO notifications (id,user_id,title,body,link,icon,read,created_at) VALUES (?,?,?,?,?,?,0,?)');
    addNoti.run(uid('n_'), 'u_demo', 'Price drop nearby', 'Ashok Leyland Ecomet 1615 in Nizamabad is now ₹9,80,000.', '#/list/trucks/lorries', 'tag', now - 5 * H);
    addNoti.run(uid('n_'), 'u_demo', 'New tippers in Telangana', '4 new tippers were listed near Hyderabad today.', '#/list/trucks/tippers', 'tipper', now - 7 * H);
    addNoti.run(uid('n_'), 'u_demo', 'Complete your profile', 'Add your business name so sellers know who they are talking to.', '#/profile/settings', 'user', now - 30 * H);
  });
  return true;
}
