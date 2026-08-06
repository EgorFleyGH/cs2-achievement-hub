# CS2 Achievement Hub

A community hub for Counter-Strike 2 players to create, publish, and track
custom in-game challenges. Build a challenge, share it with the community,
like the ones you enjoy, and mark them as completed once you've pulled them off.

## 🚧 Status: Open Beta

This project is currently in **Open Beta**. Expect occasional bugs and
rough edges — feedback is very welcome.

- 🌐 **Language:** Russian only for now. English localization is planned
  for a future update.
- 🛠️ **Want to help with development?** Reach out on Discord: **egorfleisky**

## Features

- Create custom CS2 challenges with a title, description, icon, and rarity
- Publish challenges to a shared feed — visible to every user, on every device
- Like challenges and mark them as completed (per-account, not per-browser)
- User accounts with real registration/login (hashed passwords, server-side sessions)
- Personal profile with stats and rank progression, computed live from shared data
- Owner badge for the site's creator account

## Tech stack

- **Frontend:** Vanilla HTML/CSS/JS (no framework, single-page tab layout)
- **Backend:** Node.js + Express
- **Auth:** bcrypt password hashing, httpOnly session cookies, rate-limited login/register
- **Database:** PostgreSQL, hosted on Supabase (free tier, persists across deploys)

## Running locally

Requires Node.js 18+ and a Supabase project (see below).

```bash
npm install
cp .env.example .env
# open .env and fill in SESSION_SECRET and DATABASE_URL
npm start
```

The site will be available at http://localhost:3000. On first start, the
server automatically creates the required tables in your database.

## Setting up the database (Supabase)

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **Connect** (top of the project dashboard) → **Session pooler** →
   copy the connection string (URI)
3. Replace `[YOUR-PASSWORD]` in that string with your database password
4. Put the full string into `DATABASE_URL` — locally in `.env`, and on
   Render as an Environment Variable (never commit it to Git)

Tables (`users`, `challenges`) are created automatically on first server
start — no manual SQL needed.

## How authentication works

- `POST /api/register` — { username, password } → creates a user; the
  password is hashed with bcrypt and never stored in plain text
- `POST /api/login` — { username, password } → verifies credentials, starts a session
- `POST /api/logout` — ends the session
- `GET /api/me` — returns the currently logged-in user based on the session cookie

Sessions are stored in an httpOnly cookie, which JavaScript cannot read
directly — this protects against session theft via XSS.

Rate limit: 20 login/register attempts per 15 minutes per IP (brute-force protection).

## Deploying to Render

1. Push this folder (`cs2-server/`) to a GitHub repository (or a
   subfolder of an existing one — in that case set Root Directory in
   Render's settings).
2. On render.com → New → Web Service → connect the repository.
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment → Add Variable:**
     - `SESSION_SECRET` = a long random string
     - `NODE_ENV` = `production`
     - `DATABASE_URL` = your Supabase connection string (Session pooler)
4. Deploy. Render assigns the port automatically via the `PORT` env variable.

Because data now lives in Supabase (not on Render's disk), redeploying
the service no longer wipes user accounts or published challenges.

## Contact / Contributing

This is a solo hobby project currently in open beta. If you'd like to help
with development, report a bug, or suggest a feature, message **egorfleisky** on Discord.
