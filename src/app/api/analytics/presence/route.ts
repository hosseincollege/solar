import { NextResponse } from 'next/server';
import { getSolarAnalyticsPool } from '@/lib/server/solar-analytics-db';
import { getVisitorHash } from '@/lib/server/visitor-hash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isProductionVercel() {
  return process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production';
}

export async function POST(request: Request) {
  if (!isProductionVercel()) return new Response(null, { status: 204 });
  const visitorHash = getVisitorHash(request);
  if (!visitorHash) return new Response(null, { status: 204 });

  try {
    const pool = getSolarAnalyticsPool();
    await pool.query(
      `INSERT INTO solar_unique_presence (visitor_hash, last_seen_at)
       VALUES ($1, now())
       ON CONFLICT (visitor_hash) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
      [visitorHash],
    );
    await pool.query(
      `INSERT INTO solar_unique_visits (visitor_hash, visited_day, visited_at)
       VALUES ($1, (now() AT TIME ZONE 'Asia/Tehran')::date, now())
       ON CONFLICT (visitor_hash, visited_day) DO NOTHING`,
      [visitorHash],
    );

    return new Response(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Analytics service unavailable' }, { status: 503 });
  }
}
