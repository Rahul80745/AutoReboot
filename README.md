# Autoreboot — Commercial Vehicle Marketplace (full stack)

Buy and sell trucks, tippers, tractors, buses and machines. Express + SQLite backend, single-page frontend,
real accounts with two sign-in types:

| | **User** | **Owner** |
|---|---|---|
| Sign in at | `/#/login` (sign-up at `/#/signup`) | `/owner` (private URL, not linked anywhere on the site) |
| Account creation | Self-service sign-up (email, mobile, password) | Created by the administrator (first start / CLI) |
| Can | Browse, list vehicles, chat privately, save vehicles, request finance | Owner console: stats, verify / suspend / delete users, remove / restore / delete listings, work finance requests |

**Sell form:** tapping Sell asks "What are you selling?", then opens one form (truck type → brand → model number, then the details). The owner controls that form from **Owner dashboard → Sell form**: show/hide fields, make them required, rename them, edit dropdown options, reorder, and add or delete custom fields. Custom field answers show on the vehicle page. Core fields (type, brand, year, km, price, city, state) are always on.

The two sign-ins are separate: the normal login page has no owner option, and owner credentials are rejected there.

**Home banner:** the owner manages the slides at the top of the home page (photo, title, short description, optional button) from **Owner dashboard → Banners**. With no banners, the default slides are shown.

## Run it

Requires Node.js ≥ 22.13 (uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env     # optional
npm start                # http://localhost:3000
```

On first start an owner account is created and printed in the console (`OWNER_EMAIL` / `OWNER_PASSWORD`
from `.env`, otherwise a random password is generated and shown once). Demo listings and a demo user
(`demo@autoreboot.in` / `demo1234`) are seeded in development; set `SEED_DEMO=false` (the default when
`NODE_ENV=production`) to start empty.

Create or reset an owner later:

```bash
npm run create-owner -- you@example.com 'a-long-password' "Your Name"
```

## Architecture

```
public/index.html        SPA (hash routes). Reads from an in-memory cache hydrated by GET /api/bootstrap, polled every 6 s
server/app.js            Express routes: auth, listings, favourites, chats, notifications, finance, /api/owner/*
server/db.js             SQLite schema + row mappers      (data/autoreboot.db, WAL mode)
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

## Deploy to Railway (recommended)

1. **New Project → Deploy from GitHub repo** → pick `Rahul80745/AutoReboot` and the branch you want to deploy.
   Railway builds the included `Dockerfile` (config in `railway.json`, health check `/healthz`).
2. **Add a Volume** (service → *Settings → Volumes → New Volume*) mounted at `/data`.
   The app detects `RAILWAY_VOLUME_MOUNT_PATH` and keeps its SQLite database there, so users, listings and chats
   survive redeploys. Without a volume all data is lost on every deploy (the app logs a warning).
3. **Variables** (service → *Variables*):

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `OWNER_EMAIL` | your owner login email |
   | `OWNER_PASSWORD` | a strong password, 8+ characters (**required in production**) |
   | `GOOGLE_CLIENT_ID` | optional, enables “Continue with Google” (see below) |
   | `SEED_DEMO` | optional, `true` to start with demo listings |

4. **Generate a domain** (*Settings → Networking → Generate Domain*, port `3000`). This is a one-time click — Railway does not let a repo file create it. The link then stays the same across every redeploy, and each deploy's logs print `Live at https://…`. The owner signs in at `/owner`.

Only run **one replica**: SQLite and the in-memory live-chat streams belong to a single instance.

### E-mail alerts for finance requests
When a buyer submits the finance form (name, age, mobile, **email**, city, state, pincode) it appears instantly in
**Owner dashboard → Finance requests** (with a red counter on the tab and a pop-up) and, if configured, is e-mailed to you with all
the details; the buyer gets a confirmation copy.

1. Create a free account at [resend.com](https://resend.com) → **API Keys** → create a key.
2. Railway **Variables**: `RESEND_API_KEY` = the key, `NOTIFY_EMAIL` = your inbox (e.g. `you@gmail.com`; comma-separate several).
3. Redeploy. Each request row in the dashboard shows **Mail sent / Mail failed / No mail** so you can see if delivery worked.

Note: until you verify your own domain in Resend, mails come from `onboarding@resend.dev` and Resend only delivers to the e-mail address you
signed up with — so use that address for `NOTIFY_EMAIL` while testing (customer confirmation copies need a verified domain and `MAIL_FROM`).
HTTPS (not SMTP) is used on purpose, because Railway blocks SMTP on trial/hobby plans.

### Owner controls
- **Listing page:** show or hide any part of the vehicle page (quick-facts items, table rows, highlights, similar vehicles, view counter, buttons…).
- **Sell form:** fields buyers fill in. **Banners:** home-page slideshow.

### Continue with Google
1. [Google Cloud Console](https://console.cloud.google.com/) → *APIs & Services → Credentials → Create credentials → OAuth client ID* → **Web application**.
2. Add your site (for example `https://your-app.up.railway.app`, and `http://localhost:3000` for local testing) under **Authorized JavaScript origins**.
3. Copy the **Client ID** into the `GOOGLE_CLIENT_ID` variable and redeploy. The Google button then appears on the login and sign-up pages.

Google users are created as normal user accounts (matched to an existing account by verified e-mail). Owner accounts can never sign in through Google.

### Production notes
- **Live chat:** buyer ↔ seller messages are pushed instantly over a Server-Sent Events stream, with typing indicators and “seen” ticks; the page falls back to polling if the stream drops.
- **Backups:** a consistent copy of the database is written daily to `backups/` next to the database file (last 7 kept; `BACKUP_KEEP`, `BACKUPS=false`).
- **Security:** HSTS, CSP and other headers, hashed passwords and sessions, rate limits on login, messages and new listings, same-origin checks on writes, structured request logs, graceful shutdown on deploys.
- **Logs** are JSON lines; the owner password is never printed in production.

## Deploy to Render

**One click (Blueprint):** Render dashboard → **New → Blueprint** → select this repo and branch. Render reads
`render.yaml`, asks for `OWNER_EMAIL` and `OWNER_PASSWORD`, creates the web service and a 1 GB disk for the database
(paid *Starter* plan, because free instances have no persistent disk and would lose all data on restart).

**Manual (New → Web Service):**

| Setting | Value |
|---|---|
| Language | Node |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/healthz` |
| Environment | `NODE_VERSION=22.22.0`, `NODE_ENV=production`, `TRUST_PROXY=true`, `OWNER_EMAIL`, `OWNER_PASSWORD` |
| Persistent data | Add a Disk mounted at `/var/data` and set `DATABASE_FILE=/var/data/autoreboot.db` |

After deploying, the owner signs in at `https://<your-service>.onrender.com/owner`.
