// Daily consistent snapshot of the SQLite database (VACUUM INTO), keeping the most recent copies.
import fs from 'node:fs';
import path from 'node:path';
import { db, dbPath } from './db.js';

const KEEP = +process.env.BACKUP_KEEP || 7;

export function backupNow() {
  if (dbPath === ':memory:') return null;
  const dir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(dir, `autoreboot-${stamp}.db`);
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('autoreboot-') && f.endsWith('.db')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP))) fs.rmSync(path.join(dir, old), { force: true });
  return out;
}

export function scheduleBackups() {
  if (process.env.BACKUPS === 'false' || dbPath === ':memory:') return;
  const run = () => { try { console.log('Database backup written:', backupNow()); } catch (e) { console.error('Backup failed:', e.message); } };
  setTimeout(run, 30_000).unref();
  setInterval(run, 24 * 3600_000).unref();
}
