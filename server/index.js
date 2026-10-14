import { createApp } from './app.js';
import { ensureOwner, seedDemo } from './seed.js';
import { purgeExpiredSessions } from './security.js';
import { db, dbPath } from './db.js';
import { scheduleBackups } from './backup.js';
import { closeAll } from './realtime.js';

const PORT = +process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
const demo = (process.env.SEED_DEMO ?? (isProd ? 'false' : 'true')) !== 'false';

console.log(`Database: ${dbPath}`);
if (isProd && dbPath !== ':memory:' && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DATABASE_FILE) {
  console.warn('WARNING: no persistent volume configured. Attach a volume (Railway) or set DATABASE_FILE, or data is lost on every deploy.');
}

try {
  const owner = await ensureOwner({ requirePassword: isProd });
  if (owner) {
    console.log('\n┌─ Owner account created ───────────────────────────────');
    console.log(`│  email:    ${owner.email}`);
    if (owner.password) console.log(`│  password: ${owner.password}`);
    console.log('│  Sign in at /owner — change it with: npm run create-owner');
    console.log('└────────────────────────────────────────────────────────\n');
  }
} catch (e) {
  console.error(`Owner setup skipped: ${e.message}`);
}
if (demo && (await seedDemo())) console.log('Seeded demo listings and demo user (demo@autoreboot.in / demo1234).');

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 3600_000).unref();
scheduleBackups();

const server = createApp({ demo }).listen(PORT, '0.0.0.0', () => console.log(`Autoreboot running on port ${PORT}${isProd ? '' : ` — http://localhost:${PORT}`}`));
server.on('listening', () => {
  // Railway sets RAILWAY_PUBLIC_DOMAIN once a public domain exists for the service
  if (process.env.RAILWAY_PUBLIC_DOMAIN) console.log(`\n  ➜ Live at https://${process.env.RAILWAY_PUBLIC_DOMAIN}  (owner sign-in: /owner)\n`);
  else if (process.env.RAILWAY_ENVIRONMENT) console.log('\n  No public link yet. In Railway: service → Settings → Networking → Generate Domain.\n');
});
server.keepAliveTimeout = 65_000; // longer than typical proxy idle timeouts
server.headersTimeout = 66_000;

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`${signal} received, shutting down…`);
  closeAll(); // end open realtime streams so the server can close
  server.close(() => {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => { console.error('uncaughtException', e); shutdown('uncaughtException'); });
