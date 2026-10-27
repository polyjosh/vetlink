import { NextResponse } from 'next/server';
import { apiUrl, forwardedFor, isSameSiteCall, setSessionCookies } from '@/lib/session-cookie';

/** Verify the OTP with the API, keep the refresh token in an httpOnly cookie. */
export async function POST(req: Request) {
  if (!isSameSiteCall(req)) return NextResponse.json({ code: 'forbidden' }, { status: 403 });
  const { phone, code } = (await req.json()) as { phone?: string; code?: string };
  const res = await fetch(`${apiUrl()}/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...forwardedFor(req) },
    body: JSON.stringify({ phone, code, device: { platform: 'web', appVersion: 'web' } }),
  });
  const body = (await res.json()) as {
    accessToken?: string;
    accessTokenExpiresIn?: number;
    refreshToken?: string;
  };
  if (!res.ok || !body.refreshToken) return NextResponse.json(body, { status: res.status });
  await setSessionCookies(body.refreshToken);
  return NextResponse.json({ accessToken: body.accessToken, expiresIn: body.accessTokenExpiresIn });
}
