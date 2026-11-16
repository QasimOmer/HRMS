'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';
import { ThemeProvider, useTheme } from './theme';
import { FaviconSync } from './favicon-sync';

/**
 * App-wide: any text cut off with "…" (Tailwind `truncate` / `line-clamp-*`) shows its full text as a
 * native tooltip on hover, so nothing is unreadable.
 */
function TruncatedTextTooltips() {
  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.truncate, [class*="line-clamp-"]');
      if (!el || el.hasAttribute('title')) return;
      const cut = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      const text = el.innerText.trim();
      if (cut && text) {
        el.setAttribute('title', text);
        el.dataset.autoTitle = '1';
      }
    };
    document.addEventListener('mouseover', onOver, { passive: true });
    return () => document.removeEventListener('mouseover', onOver);
  }, []);
  return null;
}

function Toasts() {
  const { theme } = useTheme();
  return <Toaster richColors closeButton position="top-right" theme={theme} />;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        {children}
        <Toasts />
        <TruncatedTextTooltips />
        <FaviconSync />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
