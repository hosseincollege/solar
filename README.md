# Solar

Standalone Solar status-list tool built with Next.js, React, and TypeScript. Solar reports and drafts stay in the current browser's `localStorage`. Anonymous presence and aggregate visit counters use a small PostgreSQL database only on the Vercel production deployment.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploy with Vercel

Import `https://github.com/hosseincollege/solar` as a new Vercel project. The repository root is the project root; use the default Next.js framework settings and deploy.

Local browser storage is tied to each browser and device. It is not synchronized between visitors or devices.

## Production analytics

- Set `DATABASE_URL` in Vercel to the Prisma Postgres pooled TCP connection string (`pooled.db.prisma.io`). Keep the direct `db.prisma.io` connection for database administration and schema changes.
- Apply [`database/analytics.sql`](database/analytics.sql) once using the direct database connection before enabling analytics.
- Presence heartbeats are refreshed every 30 seconds and count as online for two minutes. Daily, weekly, and monthly totals count distinct client IPs within each `Asia/Tehran` calendar period, so repeat visits and refreshes from one IP count once per period.
- Analytics endpoints accept/write data only when `VERCEL=1` and `VERCEL_ENV=production`. Local development and Preview deployments do not write analytics.
- The database stores keyed HMAC hashes of client IP addresses plus timestamps, never raw IP addresses or paths. Set `ANALYTICS_IP_HASH_SECRET` in Vercel to a long random secret; if omitted, the database URL is used as the HMAC key.
