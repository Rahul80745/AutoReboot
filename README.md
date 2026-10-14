# Spidy — Commercial Vehicle Marketplace (full stack)

Buy and sell trucks, tippers, tractors, buses and machines. Express + SQLite backend, single-page frontend,
real accounts with two sign-in types:

| | **User** | **Owner** |
|---|---|---|
| Sign in at | `/#/login` (sign-up at `/#/signup`) | `/#/owner/login` |
| Account creation | Self-service sign-up (email, mobile, password) | Created by the administrator (first start / CLI) |
| Can | Browse, list vehicles, chat privately, save vehicles, request finance | Owner console: stats, verify / suspend / delete users, remove / restore / delete listings, work finance requests |

**Sell form:** tapping Sell asks "What are you selling?", then opens one form (truck type → brand → model number, then the details). The owner controls that form from **Owner dashboard → Sell form**: show/hide fields, make them required, rename them, edit dropdown options, reorder, and add or delete custom fields. Custom field answers show on the vehicle page. Core fields (type, brand, model, year, km, price, city, state) are always on.

The two sign-ins are separate: an owner's credentials are rejected on the user form and vice-versa.

## Run it

Requires Node.js ≥ 22.13 (uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env     # optional
npm start                # http://localhost:3000
```

On first start an owner account is created and printed in the console (`OWNER_EMAIL` / `OWNER_PASSWORD`
from `.env`, otherwise a random password is generated and shown once). Demo listings and a demo user
(`demo@spidy.in` / `demo1234`) are seeded in development; set `SEED_DEMO=false` (the default when
`NODE_ENV=production`) to start empty.

Create or reset an owner later:

```bash
npm run create-owner -- you@example.com 'a-long-password' "Your Name"
```

## Architecture

```
public/index.html        SPA (hash routes). Reads from an in-memory cache hydrated by GET /api/bootstrap, polled every 6 s
server/app.js            Express routes: auth, listings, favourites, chats, notifications, finance, /api/owner/*
server/db.js             SQLite schema + row mappers      (data/spidy.db, WAL mode)
server/security.js       scrypt password hashing, server-side sessions, rate limiting
server/seed*.js, bot.js  Demo data; demo dealers auto-reply in chat
test/api.test.js         Integration tests (npm test)
```

Database tables: `users` (role `user|owner`), `sessions`, `listings`, `favorites`, `chats`, `messages`,
`notifications`, `finance_requests`.

Security notes: passwords are scrypt-hashed with a per-user salt; sessions are random tokens stored hashed
server-side and sent in an `HttpOnly; SameSite=Lax` cookie (`Secure` over HTTPS — set `TRUST_PROXY=true`
behind a proxy); login endpoints are rate limited; mutating requests must be same-origin JSON; every
write checks role and ownership on the server; uploaded images are validated as data-URL images with size caps.
