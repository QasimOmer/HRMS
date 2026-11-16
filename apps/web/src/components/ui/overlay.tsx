'use client';

import { X } from 'lucide-react';
import { Dialog as D, DropdownMenu as DM, Tabs as T } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/format';
import { Button } from './button';

/* ---------------- Dialog ---------------- */

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <D.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-card shadow-2xl focus:outline-none',
            size === 'sm' && 'max-w-sm',
            size === 'md' && 'max-w-lg',
            size === 'lg' && 'max-w-2xl',
            size === 'xl' && 'max-w-4xl',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div>
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close" className="-mt-1 -mr-2 h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </D.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Confirm dialog for destructive / irreversible actions. */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; body?: string; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const confirm = (o: { title: string; body?: string; confirmLabel?: string; danger?: boolean }) => new Promise<boolean>((resolve) => setState({ ...o, resolve }));
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const node = (
    <Dialog
      open={!!state}
      onOpenChange={(o) => !o && close(false)}
      title={state?.title ?? ''}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {state?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{state?.body}</p>
    </Dialog>
  );
  return { confirm, node };
}

/* ---------------- Dropdown ---------------- */

export function Dropdown({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={6} className="z-50 min-w-48 rounded-md border bg-card p-1 shadow-lg">
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function DropdownItem({ children, onSelect, danger }: { children: ReactNode; onSelect?: () => void; danger?: boolean }) {
  return (
    <DM.Item
      onSelect={onSelect}
      className={cn('flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-muted', danger && 'text-danger')}
    >
      {children}
    </DM.Item>
  );
}

export const DropdownSeparator = () => <DM.Separator className="my-1 h-px bg-border" />;
export const DropdownLabel = ({ children }: { children: ReactNode }) => <DM.Label className="px-2 py-1.5 text-xs text-muted-foreground">{children}</DM.Label>;

/* ---------------- Tabs ---------------- */

export function Tabs({ tabs, value, onValueChange, defaultValue }: { tabs: { value: string; label: ReactNode; content: ReactNode; hidden?: boolean }[]; value?: string; onValueChange?: (v: string) => void; defaultValue?: string }) {
  const visible = tabs.filter((t) => !t.hidden);
  // A single tab needs no tab bar.
  if (visible.length === 1) return <>{visible[0]!.content}</>;
  return (
    <T.Root value={value} onValueChange={onValueChange} defaultValue={defaultValue ?? visible[0]?.value}>
      {/* Segmented control that wraps onto more lines on small screens (no sideways scrolling). */}
      <T.List className="mb-5 inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1" aria-label="Sections">
        {visible.map((t) => (
          <T.Trigger
            key={t.value}
            value={t.value}
            className="rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >
            {t.label}
          </T.Trigger>
        ))}
      </T.List>
      {visible.map((t) => (
        <T.Content key={t.value} value={t.value} className="focus:outline-none">
          {t.content}
        </T.Content>
      ))}
    </T.Root>
  );
}
