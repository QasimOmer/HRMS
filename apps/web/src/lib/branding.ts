'use client';

import { useApi } from './hooks';
import { SITE } from './site';

export interface Branding {
  siteName: string | null;
  copyright: string | null;
  logoVersion: string | null;
  faviconVersion: string | null;
}

/** Platform branding set by the Super Admin (Platform settings → General). Public, cached. */
export function useBranding() {
  const { data } = useApi<Branding>('/public/branding');
  return {
    /** Platform name set by the Super Admin, or the deployment default. */
    siteName: data?.siteName || SITE.name,
    copyright: data?.copyright ?? null,
    logoUrl: data?.logoVersion ? `/api/v1/public/logo?v=${data.logoVersion}` : null,
    faviconUrl: data?.faviconVersion ? `/api/v1/public/favicon?v=${data.faviconVersion}` : null,
    loaded: !!data,
  };
}

/** The product name to show anywhere in the UI (set in Super Admin → Platform settings → General). */
export function useSiteName(): string {
  return useBranding().siteName;
}

/** "© 2026 Acme HR": the default footer when the Super Admin hasn't written one. */
export function defaultCopyright(siteName: string): string {
  return `© ${new Date().getFullYear()} ${siteName}`;
}
