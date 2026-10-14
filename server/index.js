import { createApp } from './app.js';
import { ensureOwner, seedDemo } from './seed.js';
import { purgeExpiredSessions } from './security.js';

const PORT = +process.env.PORT || 3000;
const demo = (process.env.SEED_DEMO ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) !== 'false';

const owner = await ensureOwner();
if (owner) {
  console.log('\n┌─ Owner account created ───────────────────────────────');
  console.log(`│  email:    ${owner.email}`);
  console.log(`│  password: ${owner.password ?? '(from OWNER_PASSWORD)'}`);
  console.log('│  Sign in at /#/owner/login — change it with: npm run create-owner');
  console.log('└────────────────────────────────────────────────────────\n');
}
if (demo && (await seedDemo())) console.log('Seeded demo listings and demo user (demo@spidy.in / demo1234).');

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 3600_000).unref();

createApp({ demo }).listen(PORT, () => console.log(`Spidy running on http://localhost:${PORT}`));
