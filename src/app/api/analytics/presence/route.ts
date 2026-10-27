import { NextResponse } from 'next/server';
import { getSolarAnalyticsPool } from '@/lib/server/solar-analytics-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isProductionVercel() {
  return process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production';
}

export async function POST(request: Request) {
  if (!isProductionVercel()) return new Response(null, { status: 204 });

  let payload: { sessionId?: unknown; visitId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { sessionId, visitId } = payload;
  if (typeof sessionId !== 'string' || !UUID_PATTERN.test(sessionId)
    || (visitId !== undefined && (typeof visitId !== 'string' || !UUID_PATTERN.test(visitId)))) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const pool = getSolarAnalyticsPool();
    await pool.query(
      `INSERT INTO solar_presence (session_id, last_seen_at)
       VALUES ($1::uuid, now())
       ON CONFLICT (session_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
      [sessionId],
    );

    if (typeof visitId === 'string') {
      await pool.query(
        `INSERT INTO solar_visits (visit_id, session_id, visited_at)
         VALUES ($1::uuid, $2::uuid, now())
         ON CONFLICT (visit_id) DO NOTHING`,
        [visitId, sessionId],
      );
    }

    return new Response(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Analytics service unavailable' }, { status: 503 });
  }
}
