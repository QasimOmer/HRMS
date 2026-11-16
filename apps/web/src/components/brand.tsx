'use client';

import { cn, initials } from '@/lib/format';
import { useBranding } from '@/lib/branding';
import { AuthImage } from './ui/auth-image';
import { useId } from 'react';

/**
 * Product mark: two people side by side, joined at the middle so together they form an "H"
 * (people + HRMS). Kept in one place so the favicon (app/icon.svg) and every screen match.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  // A unique gradient id per logo: with one shared id, a logo hidden on small screens (display:none) takes
  // the gradient with it and every other logo on the page loses its blue background.
  const gradientId = `brand-gradient-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 32 32" className={cn('h-8 w-8 shrink-0', className)} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gradientId})`} />
      <g fill="#fff">
        <circle cx="10.5" cy="9.5" r="3" />
        <circle cx="21.5" cy="9.5" r="3" />
        <rect x="7.5" y="14" width="6" height="12" rx="3" />
        <rect x="18.5" y="14" width="6" height="12" rx="3" />
        <rect x="12" y="17.75" width="8" height="3.5" rx="1.75" />
      </g>
    </svg>
  );
}

/** Mark + product name, for headers. `inverted` for use on dark/colored backgrounds. */
export function BrandLogo({ className, inverted, size = 'md' }: { className?: string; inverted?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const { logoUrl, siteName } = useBranding();
  if (logoUrl) {
    // The Super Admin's own logo (usually includes the name). On coloured backgrounds it sits on a light chip.
    return (
      <span className={cn('inline-flex items-center', inverted && 'rounded-lg bg-white/95 px-2 py-1', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt={siteName} className={cn('w-auto max-w-44 object-contain', size === 'sm' && 'h-7', size === 'md' && 'h-8', size === 'lg' && 'h-10')} />
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BrandMark className={cn(size === 'sm' && 'h-7 w-7', size === 'md' && 'h-8 w-8', size === 'lg' && 'h-10 w-10', inverted && 'ring-2 ring-white/30 rounded-lg')} />
      <span className={cn('font-semibold tracking-tight', size === 'lg' ? 'text-xl' : 'text-base', inverted ? 'text-white' : 'text-foreground')}>{siteName}</span>
    </span>
  );
}

/** The client company's own logo, or its initials when none has been uploaded (or it can't be loaded). */
export function CompanyLogo({ name, logoFileId, className }: { name: string; logoFileId?: string | null; className?: string }) {
  const fallback = (
    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-sm font-semibold text-primary', className)} aria-hidden>
      {initials(name)}
    </span>
  );
  return logoFileId ? (
    <AuthImage src={`/api/v1/company/logo/${logoFileId}`} alt={`${name} logo`} className={cn('h-9 w-9 shrink-0 rounded-lg border bg-white object-contain p-0.5', className)} fallback={fallback} />
  ) : (
    fallback
  );
}
