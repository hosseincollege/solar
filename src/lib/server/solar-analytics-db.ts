import { Pool } from 'pg';

declare global {
  // Reuse one connection pool across Next.js hot reloads and warm serverless invocations.
  var solarAnalyticsPool: Pool | undefined;
}

export function getSolarAnalyticsPool() {
  const connectionString = process.env.DATABASE_URL
    ?? process.env.POSTGRES_URL
    ?? process.env.PRISMA_DATABASE_URL;
  if (!connectionString) throw new Error('Solar analytics database is not configured');

  globalThis.solarAnalyticsPool ??= new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  return globalThis.solarAnalyticsPool;
}
