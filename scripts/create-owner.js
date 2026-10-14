// Create or reset an owner account:  npm run create-owner -- you@example.com 'a-strong-password' ["Display Name"]
import { createOwner } from '../server/seed.js';

const [email, password, name] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: npm run create-owner -- <email> <password> [name]");
  process.exit(1);
}
if (password.length < 8) { console.error('Password must be at least 8 characters'); process.exit(1); }
await createOwner({ email, password, name });
console.log(`Owner account ready: ${email.toLowerCase()}`);
