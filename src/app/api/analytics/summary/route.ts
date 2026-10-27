import { NextResponse } from 'next/server';
import { getSolarAnalyticsPool } from '@/lib/server/solar-analytics-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isProductionVercel() {
  return process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production';
}

export async function GET() {
  if (!isProductionVercel()) {
    return NextResponse.json({ error: 'Analytics are only available on the production deployment' }, { status: 404 });
  }

  try {
    const pool = getSolarAnalyticsPool();
    const result = await pool.query(
      `WITH bounds AS (
         SELECT
           date_trunc('day', now() AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'Asia/Tehran' AS today_start,
           date_trunc('week', now() AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'Asia/Tehran' AS week_start,
           date_trunc('month', now() AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'Asia/Tehran' AS month_start
       )
       SELECT
         (SELECT count(*)::int FROM solar_unique_presence WHERE last_seen_at >= now() - interval '2 minutes') AS "onlineNow",
         (SELECT count(DISTINCT visitor_hash)::int FROM solar_unique_visits, bounds WHERE visited_at >= bounds.today_start) AS today,
         (SELECT count(DISTINCT visitor_hash)::int FROM solar_unique_visits, bounds WHERE visited_at >= bounds.week_start) AS week,
         (SELECT count(DISTINCT visitor_hash)::int FROM solar_unique_visits, bounds WHERE visited_at >= bounds.month_start) AS month`,
    );

    return NextResponse.json(result.rows[0] ?? { onlineNow: 0, today: 0, week: 0, month: 0 }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch {
    return NextResponse.json({ error: 'Analytics service unavailable' }, { status: 503 });
  }
}
