import { cookies } from 'next/headers';

/** Server only. The refresh token lives in an httpOnly cookie that page scripts cannot read. */
export const REFRESH_COOKIE = 'vl_rt';
/** A readable hint for the route guard (UX only; never trusted for access). */
export const SIGNED_IN_COOKIE = 'vl_signed_in';

const THIRTY_DAYS_S = 30 * 24 * 3600;
const secure = process.env.NODE_ENV === 'production';

export const apiUrl = () => process.env.API_URL ?? 'http://localhost:4000';

export async function setSessionCookies(refreshToken: string): Promise<void> {
  const jar = await cookies();
  jar.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api/session',
    maxAge: THIRTY_DAYS_S,
  });
  jar.set(SIGNED_IN_COOKIE, '1', { secure, sameSite: 'lax', path: '/', maxAge: THIRTY_DAYS_S });
}

export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: REFRESH_COOKIE, path: '/api/session' });
  jar.delete({ name: SIGNED_IN_COOKIE, path: '/' });
}

/** Only our own pages may call the session routes (a custom header forces a CORS preflight). */
export function isSameSiteCall(req: Request): boolean {
  return req.headers.get('x-vetlink-csrf') === '1';
}

/** Pass the caller's address on so the API's per-IP limits see the farmer, not this server. */
export function forwardedFor(req: Request): Record<string, string> {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip');
  return ip ? { 'x-forwarded-for': ip } : {};
}
