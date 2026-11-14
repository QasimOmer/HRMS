'use client';

import { useEffect } from 'react';
import { useBranding } from '@/lib/branding';

/** Points the tab icon at the Super Admin's favicon (versioned, so a new upload shows at once). */
export function FaviconSync() {
  const { faviconUrl, loaded } = useBranding();
  useEffect(() => {
    if (!loaded) return;
    const href = faviconUrl ?? '/brand-icon.svg';
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (link.getAttribute('href') !== href) link.href = href;
  }, [faviconUrl, loaded]);
  return null;
}
