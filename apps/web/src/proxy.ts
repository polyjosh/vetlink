import { NextResponse, type NextRequest } from 'next/server';

/**
 * Route guard (UX only, §8.0): signed-out visitors to app pages go to the login page. Every API
 * call is authorized by the API itself; this never protects data.
 */
export function proxy(req: NextRequest) {
  const signedIn = req.cookies.get('vl_signed_in')?.value === '1';
  if (!signedIn) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/farmer/:path*',
    '/vet/:path*',
    '/admin/:path*',
    '/onboarding/:path*',
    '/settings/:path*',
  ],
};
