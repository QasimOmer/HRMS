'use client';

import { PRICING_COUNTRIES } from '@hrms/shared';
import { Check, ChevronDown, Globe } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/format';
import { Dropdown, DropdownItem } from './ui/overlay';

/** Small inline flags (no external images: the CSP only allows our own origin). */
const FLAGS: Record<string, ReactNode> = {
  PK: (
    <>
      <rect width="30" height="20" fill="#01411C" />
      <rect width="7.5" height="20" fill="#fff" />
      <circle cx="19" cy="10" r="5.4" fill="#fff" />
      <circle cx="20.6" cy="8.9" r="4.6" fill="#01411C" />
      <polygon points="22.6,6.2 23.1,7.6 24.6,7.6 23.4,8.5 23.8,9.9 22.6,9 21.4,9.9 21.8,8.5 20.6,7.6 22.1,7.6" fill="#fff" />
    </>
  ),
  AE: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <rect x="7.5" width="22.5" height="6.67" fill="#00732F" />
      <rect x="7.5" y="13.33" width="22.5" height="6.67" fill="#000" />
      <rect width="7.5" height="20" fill="#FF0000" />
    </>
  ),
  SA: (
    <>
      <rect width="30" height="20" fill="#006C35" />
      <rect x="8" y="6" width="14" height="3" rx="1.5" fill="#fff" />
      <rect x="8" y="12" width="14" height="1.2" rx="0.6" fill="#fff" />
    </>
  ),
  GB: (
    <>
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#C8102E" strokeWidth="1.6" />
      <path d="M15 0V20M0 10H30" stroke="#fff" strokeWidth="6" />
      <path d="M15 0V20M0 10H30" stroke="#C8102E" strokeWidth="3.4" />
    </>
  ),
  US: (
    <>
      <rect width="30" height="20" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <rect key={i} y={(i * 20) / 13} width="30" height={20 / 13} fill="#B22234" />
      ))}
      <rect width="12" height="10.77" fill="#3C3B6E" />
    </>
  ),
  EU: (
    <>
      <rect width="30" height="20" fill="#003399" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return <circle key={i} cx={15 + Math.cos(a) * 6} cy={10 + Math.sin(a) * 6} r="0.95" fill="#FFCC00" />;
      })}
    </>
  ),
};

export function CountryFlag({ code, className }: { code: string; className?: string }) {
  const flag = FLAGS[code];
  if (!flag) return <Globe className={cn('h-4 w-4 shrink-0 text-muted-foreground', className)} aria-hidden />;
  return (
    <svg viewBox="0 0 30 20" className={cn('h-3.5 w-5 shrink-0 overflow-hidden rounded-[3px] ring-1 ring-black/10', className)} aria-hidden>
      {flag}
    </svg>
  );
}

/** Country selector for prices (same pill style as the Monthly / Yearly switch). */
export function CountryPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const current = PRICING_COUNTRIES.find((c) => c.code === value) ?? PRICING_COUNTRIES[0]!;
  return (
    <Dropdown
      align="end"
      trigger={
        <button
          type="button"
          aria-label={`Prices in ${current.currency} for ${current.name}. Change country`}
          className="inline-flex rounded-full border bg-card p-1 shadow-sm transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium">
            <CountryFlag code={current.code} />
            <span>{current.name}</span>
            <span className="text-muted-foreground">{current.currency}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          </span>
        </button>
      }
    >
      {PRICING_COUNTRIES.map((c) => (
        <DropdownItem key={c.code} onSelect={() => onChange(c.code)}>
          <CountryFlag code={c.code} />
          <span className="flex-1">{c.name}</span>
          <span className="text-xs text-muted-foreground">{c.currency}</span>
          <Check className={cn('h-4 w-4 text-primary', c.code === current.code ? 'opacity-100' : 'opacity-0')} aria-hidden />
        </DropdownItem>
      ))}
    </Dropdown>
  );
}
