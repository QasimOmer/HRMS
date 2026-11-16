'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandLogo } from '@/components/brand';
import { SiteCopyright } from '@/components/site-copyright';
import { ThemeToggle } from '@/components/theme-toggle';

/** Frame for public pages outside the app (sign-up, demo): logo, theme switch, sign-in link. */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" aria-label="Home"><BrandLogo /></Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login" className="rounded-full border px-4 py-1.5 text-sm font-medium hover:bg-muted">Sign in</Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t py-5 text-center text-xs text-muted-foreground"><SiteCopyright /></footer>
    </div>
  );
}
