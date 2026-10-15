import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  REFRESH_COOKIE,
  apiUrl,
  clearSessionCookies,
  forwardedFor,
  isSameSiteCall,
  setSessionCookies,
} from '@/lib/session-cookie';

/** Rotate the refresh token (the client calls this single-flight, across tabs). */
export async function POST(req: Request) {
  if (!isSameSiteCall(req)) return NextResponse.json({ code: 'forbidden' }, { status: 403 });
  const token = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (!token) return NextResponse.json({ code: 'unauthenticated' }, { status: 401 });
  const res = await fetch(`${apiUrl()}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...forwardedFor(req) },
    body: JSON.stringify({ refreshToken: token }),
  });
  const body = (await res.json()) as {
    accessToken?: string;
    accessTokenExpiresIn?: number;
    refreshToken?: string;
  };
  if (!res.ok || !body.refreshToken) {
    if (res.status === 401) await clearSessionCookies();
    return NextResponse.json(body, { status: res.status });
  }
  await setSessionCookies(body.refreshToken);
  return NextResponse.json({ accessToken: body.accessToken, expiresIn: body.accessTokenExpiresIn });
}
