# votebook-management-system

React + Vite + Tailwind CSS frontend with a Node/Express + PostgreSQL backend for local development in VS Code.

## Getting Started

- Install dependencies: `pnpm install`
- Database (Docker): `docker start votebook-db` (Postgres 17 on port 5433, database/user `votebook`)
- Seed the database: `pnpm seed` (idempotent — creates tables, reference data, and demo users)
- Start both servers: `pnpm dev` (API on port 4000, Vite on `$PORT`/8443; `/api` requests are proxied to the API)
- Backend only: `pnpm server` · seed only: `pnpm seed`
- Production build: `pnpm build`
- Preview the production build: `pnpm preview`
- Format: `pnpm format`

## Architecture

- `src/` — React frontend; all data comes from the API (`/api/*`, proxied to http://localhost:4000)
- `src/api.ts` — typed fetch client and shared types (`SessionUser`, `VoteItem`, `CashbookEntry`, `CashbookState`)
- `server/` — Express API with JWT auth (`server/index.js`), pg pool (`server/db.js`)
- `server/schema.sql`, `server/seed.sql`, `server/seed.js` — idempotent schema and seed data
- `server/.env` — `DATABASE_URL` and `JWT_SECRET` (gitignored — never commit)
- Database: dedicated `votebook-db` Docker container (Postgres 17, port 5433, database `votebook`)

## Data model

- `stations` — police stations (seeded with the six Pemba stations)
- `users` — bcrypt-hashed credentials; roles: `admin` / `officer`; each account carries its assigned `station` (admins are always `Central Finance`)
- `vote_items` — votebook master list
- `cashbook_entries` — shared cashbook ledger; the running `balance` is computed server-side inside a transaction guarded by a Postgres advisory lock
- `cashbook_settings` — single row holding the opening balance

## Permission model (enforced server-side)

- All stations share one cashbook; officers post payment (debit) entries against the shared balance
- Credits (top-ups) and opening-balance changes require an admin session with station `Central Finance`
- Payment amounts are validated against the real balance server-side; overdrafts are rejected
- **User management is admin-only** (`GET/POST/PUT/DELETE /api/users`, Central Finance sessions only): the administrator creates officer accounts and assigns each officer a station. Officers sign in with just username + password — the station comes from the account, so an officer can no longer pick any station at login

## Dependencies

- Frontend runtime: React 19, React DOM 19; Tailwind CSS v4 via `@tailwindcss/vite`
- Backend: Express 5, pg, bcryptjs, jsonwebtoken
- Build tooling: Vite 8, TypeScript 5.9, `@vitejs/plugin-react`, concurrently
- Formatting: oxfmt

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. No Tailwind config file or PostCSS config is needed.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.

## Code quality

- Use double quotes for strings containing apostrophes (`"We're here to help"`), or escape them in single-quoted strings. An unescaped apostrophe in a single-quoted string breaks the build.
- Ensure JSX tags are closed and braces are balanced.
- Export components as default exports.
- API rules live in `server/index.js` — never bypass or duplicate them client-side.

## Deployment (Render free tier)

- `render.yaml` at the repo root is a Render Blueprint: one free web service (serves the built frontend and the API from one process) plus one free PostgreSQL database wired in as `DATABASE_URL`.
- Deploy: push the repo to GitHub/GitLab → Render dashboard → **New + → Blueprint** → select the repo → Apply.
- `JWT_SECRET` is auto-generated; `node server/seed.js` runs at every start (idempotent, waits for the DB) so the database bootstraps itself.
- Free-tier notes: the web service sleeps after ~15 minutes idle (first request wakes it in ~30–60s); free Postgres expires after 30 days unless upgraded; change the seeded demo passwords before real use.