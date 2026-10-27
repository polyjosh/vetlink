import { NextResponse } from 'next/server';
import { apiUrl, clearSessionCookies, isSameSiteCall } from '@/lib/session-cookie';

/** End the session at the API (revokes it everywhere) and drop the cookies. */
export async function POST(req: Request) {
  if (!isSameSiteCall(req)) return NextResponse.json({ code: 'forbidden' }, { status: 403 });
  const auth = req.headers.get('authorization');
  if (auth) {
    await fetch(`${apiUrl()}/v1/auth/logout`, {
      method: 'POST',
      headers: { authorization: auth },
    }).catch(() => undefined);
  }
  await clearSessionCookies();
  return new NextResponse(null, { status: 204 });
}
