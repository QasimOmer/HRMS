import { rootDomainOf, workspaceFromHost } from '@hrms/shared';
import { NextResponse, type NextRequest } from 'next/server';

/** Per-request nonce-based Content Security Policy. */
export function proxy(request: NextRequest) {
  // A company subdomain (ecomalign.hrmsalign.com) opens the app, not the marketing home page.
  // The Cloudflare Worker passes the address the visitor used in x-hrms-host.
  if (request.nextUrl.pathname === '/') {
    const host = request.headers.get('x-hrms-host') ?? request.headers.get('host');
    if (workspaceFromHost(host, rootDomainOf(process.env.NEXT_PUBLIC_SITE_URL || 'https://hrmsalign.com'))) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV === 'development';
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self' data:`,
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    `frame-src 'self' blob:`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
