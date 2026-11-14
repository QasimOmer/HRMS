'use client';

import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Popover as P } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/format';

export interface ComboOption {
  value: string;
  label: string;
  /** Extra text shown on the right and included in search (e.g. "UTC+05:00"). */
  hint?: string;
  /** Extra search words that aren't shown. */
  keywords?: string;
}

/**
 * Searchable single-select dropdown. Type to filter, arrow keys to move, Enter to choose, Esc to close.
 * Accepts the same `id` / aria props a Field passes to its control.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches',
  disabled,
  id,
  className,
  renderValue,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  renderValue?: (o: ComboOption) => ReactNode;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.value} ${o.hint ?? ''} ${o.keywords ?? ''}`.toLowerCase().replace(/_/g, ' ');
      return terms.every((t) => hay.includes(t));
    });
  }, [q, options]);

  // Open on the selected item; reset the search each time.
  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [open, options, value]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (o: ComboOption | undefined) => {
    if (!o) return;
    onChange(o.value);
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(filtered[active]); }
  };
  const listId = `${id ?? 'combo'}-list`;

  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger',
            className,
          )}
        >
          <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground/70')} title={selected?.label}>
            {selected ? (renderValue ? renderValue(selected) : selected.label) : (value || placeholder)}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border bg-card shadow-lg"
          onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector('input')?.focus(); }}
        >
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={listId}
              aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
          </div>
          <ul ref={list} id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</li>}
            {filtered.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm', i === active && 'bg-muted')}
              >
                <Check className={cn('h-4 w-4 shrink-0 text-primary', o.value === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={o.label}>{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{o.hint}</span>}
              </li>
            ))}
          </ul>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
