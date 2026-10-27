import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

/** Return a stable, keyed identifier for the client IP without persisting the IP itself. */
export function getVisitorHash(request: Request): string | null {
  const forwardedFor = request.headers.get('x-vercel-forwarded-for')
    ?? request.headers.get('x-forwarded-for')
    ?? request.headers.get('x-real-ip');
  const ip = forwardedFor?.split(',')[0]?.trim();
  if (!ip || !isIP(ip)) return null;

  // A dedicated secret can be configured, while DATABASE_URL keeps this working
  // on deployments that have not added another environment variable.
  const secret = process.env.ANALYTICS_IP_HASH_SECRET ?? process.env.DATABASE_URL;
  if (!secret) return null;

  return createHmac('sha256', secret).update(`solar-visitor:${ip}`).digest('hex');
}
