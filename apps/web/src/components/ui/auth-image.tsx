'use client';

import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { refreshSession } from '@/lib/api';

/**
 * <img> for files that need the session (company logo, profile photos). Images can't renew an expired
 * sign-in token like API calls do, so on a failed load this renews it once and retries; if that fails
 * too, `fallback` is shown instead of a broken image.
 */
export function AuthImage({ src, fallback = null, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string; fallback?: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [src]);
  if (failed) return <>{fallback}</>;
  const url = attempt ? `${src}${src.includes('?') ? '&' : '?'}r=${attempt}` : src;
  return (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      {...rest}
      src={url}
      onError={async () => {
        if (attempt === 0 && (await refreshSession().catch(() => false))) setAttempt(Date.now());
        else setFailed(true);
      }}
    />
  );
}
