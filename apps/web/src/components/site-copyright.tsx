'use client';

import { defaultCopyright, useBranding } from '@/lib/branding';

/** Sign-in page footer; the text is set by the Super Admin (Platform settings → General). */
export function SiteCopyright({ className }: { className?: string }) {
  const { copyright, siteName } = useBranding();
  return <p className={className}>{copyright || defaultCopyright(siteName)}</p>;
}
