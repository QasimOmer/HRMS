'use client';

import { rootDomainOf, workspaceFromHost, workspaceOrigin } from '@hrms/shared';
import { useEffect, useState } from 'react';

/** Main site address; company workspaces live on its subdomains (ecomalign.hrmsalign.com). */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://hrmsalign.com';

/** Send new companies to their own subdomain (needs the wildcard DNS / Cloudflare Worker to be live). */
export const SUBDOMAINS_ON = process.env.NEXT_PUBLIC_TENANT_SUBDOMAINS === '1';

/** Company workspace from the address bar ("ecomalign" on ecomalign.hrmsalign.com), or null on the main site. */
export function currentWorkspace(): string | null {
  if (typeof window === 'undefined') return null;
  return workspaceFromHost(window.location.hostname, rootDomainOf(SITE_URL));
}

/** Same as currentWorkspace(), read after the first render so server and browser HTML match. */
export function useHostWorkspace(): string | null {
  const [ws, setWs] = useState<string | null>(null);
  useEffect(() => setWs(currentWorkspace()), []);
  return ws;
}

/** Full address inside a company's workspace, e.g. workspaceAddress('ecomalign', '/login'). */
export function workspaceAddress(slug: string, path = ''): string {
  return workspaceOrigin(slug, SITE_URL) + path;
}
