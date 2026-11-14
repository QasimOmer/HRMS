import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { SITE } from '@/lib/site';
import './globals.css';

/** Platform name set by the Super Admin (cached for a minute; falls back quickly if the API is slow). */
async function platformName(): Promise<string> {
  try {
    // On Vercel the API is served from the same deployment (vercel.json rewrites /api/* to it).
    const api = process.env.API_INTERNAL_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:4000');
    const r = await fetch(`${api}/api/v1/public/branding`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(1500) });
    if (r.ok) return ((await r.json()) as { siteName?: string | null }).siteName || SITE.name;
  } catch {
    /* API unreachable: use the default name */
  }
  return SITE.name;
}

export async function generateMetadata(): Promise<Metadata> {
  const name = await platformName();
  return {
    title: { default: name, template: `%s · ${name}` },
    description: SITE.tagline,
    robots: { index: false, follow: false },
    // Served by the API: the Super Admin's favicon, or the built-in icon.
    icons: { icon: '/api/v1/public/favicon' },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading headers makes every page dynamic so the CSP nonce is applied to Next's scripts.
  await headers();
  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla's cz-shortcut-listen) add attributes to <body>. */}
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
