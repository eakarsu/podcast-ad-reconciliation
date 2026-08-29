# Deployment

## Topology decision (made)

| Piece | Hosts on | Why |
|---|---|---|
| **Web app** (vinext / Next.js in `app/`) | **Cloudflare Workers** via the existing `vinext build` + `@cloudflare/vite-plugin` setup | Already wired: `vite.config.ts` builds the RSC app for Workers, and the Sites pipeline (`@openai/sites-vite-plugin`) consumes it. No change needed. |
| **API** (`server/index.mjs`, Express) | **Node container** (Docker image in `server/Dockerfile`) on any container host: Fly.io, Railway, Render, Fly + Neon Postgres, RDS, etc. | The API is Postgres-specific (uuid-ossp, generated columns, ILIKE, views) — it will **not** run on Cloudflare Workers/D1. Node 22 is the runtime the repo already targets (`engines.node >= 22.13`). |
| **Postgres** | Managed Postgres (Neon, Supabase, RDS…) | Point `DATABASE_URL` at it; run migrations below. |
| **Aircheck uploads** | Local volume on the API container (`AIRCHECK_DIR`) | Works out of the box; for multi-instance or ephemeral hosts, mount a volume or move to object storage (R2/S3) later. |

The API is a plain Node server with no native dependencies — the same image runs anywhere containers run.

## Environment variables

### API container

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://…` connection string |
| `API_PORT` | no (default `4010`) | |
| `NODE_ENV` | recommend `production` | Enables secure cookies + terse error messages |
| `COOKIE_SECURE` | no | Set `false` only when terminating TLS in front of the container on plain HTTP |
| `CORS_ORIGIN` | yes in prod | Comma-separated origins of the web app, e.g. `https://app.example.com` |
| `AIRCHECK_DIR` | no (default `server/uploads`) | Where uploaded airchecks are stored |
| `RSS_SYNC_INTERVAL_MINUTES` | no (default `60`) | Automatic public RSS refresh interval; set `0` to disable |
| `SMTP_HOST`, `SMTP_PORT` | for invoice email | SMTP endpoint; port defaults to `587` |
| `SMTP_USER`, `SMTP_PASS` | provider-dependent | SMTP credentials, stored only as deployment secrets |
| `SMTP_FROM` | for invoice email | Sender address shown on emailed invoices |

### Web app (Workers / Sites pipeline)

| Var | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | yes in prod | Public URL of the API, e.g. `https://api.example.com` |
| `OPENROUTER_API_KEY` | yes | Used by the Sites tooling and the AI-insights feature. **Never commit**; set as a deploy secret. |
| `OPENROUTER_BASE_URL` | no | Defaults to `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | no | Defaults to `z-ai/glm-5.3-flash` |
| `OPENROUTER_IGNORE_PROVIDERS` | no | Provider slugs routed away from, comma-separated (currently `z-ai,novita,gmicloud`). Enforced server-side in `server/lib/openrouter.mjs` on every call. |

The API container needs `OPENROUTER_API_KEY` too (the AI insights endpoint calls OpenRouter server-side).

## Steps

1. **Migrate the database**
   ```sh
   DATABASE_URL=... psql -f database/schema.sql
   DATABASE_URL=... psql -f database/seed.sql   # optional demo data + demo admin
   ```
   Both scripts are idempotent. Seeding creates `admin@signalledger.local` / `demo1234` — **change or remove this account in production**.

2. **Build & ship the API image**
   ```sh
   docker build -f server/Dockerfile -t signalledger-api .
   docker run -p 4010:4010 \
     -e DATABASE_URL=... -e NODE_ENV=production \
     -e CORS_ORIGIN=https://app.example.com \
     -e OPENROUTER_API_KEY=... \
     -v airchecks:/app/server/uploads \
     signalledger-api
   ```
   Example Fly.io: `fly launch --dockerfile server/Dockerfile`, then `fly secrets set DATABASE_URL=… CORS_ORIGIN=… OPENROUTER_API_KEY=…` and `fly volumes create airchecks`.

3. **Build & deploy the web app** through the existing pipeline (`npm run build` / the Sites hosting flow), with `NEXT_PUBLIC_API_BASE_URL` pointing at the API's public URL.

4. **Auth model**: sign-in requires a session cookie. Admins manage organization defaults, integrations, and roles in Settings. Members run operations; viewers are read-only. The seed admin is for demonstrations only.

5. **Provider integrations**: create a hosting or ad-server record in Integrations. Store credentials in the API host as an environment variable, then enter only that variable name in SignalLedger. Generic ad-server endpoints return `{ "deliveries": [{ "io_number": "...", "date": "YYYY-MM-DD", "impressions": 123 }] }`.

6. **Production readiness check**: verify `/health`, run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. The web app must be built with the final public API URL; a localhost URL is intentionally not deployable for other users.

## Rejected alternatives

- **Express on Cloudflare Workers as-is** — not possible: `pg` needs raw TCP (Hyperdrive only supports it with wrappers), `node:crypto` scrypt sessions and the filesystem upload store assume Node. Moving to Workers would mean rewriting the API on a Workers-native stack (Hono + Hyperdrive/Postgres.js) — a future option, not a requirement.
- **D1/SQLite** — schema uses Postgres features (uuid-ossp, generated columns, `ILIKE`, views).

## Local development

```sh
npm install
npm run db:migrate && npm run db:seed   # needs DATABASE_URL in .env
npm run dev                              # web on :3000, API on :4010
npm test                                 # unit tests (no DB needed)
```
