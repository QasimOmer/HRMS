import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { isValidElement, type ReactNode } from 'react';
import { cn } from '@/lib/format';
import { Button } from './button';
import { EmptyState, ErrorState, LoadingRows } from './display';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Secondary column: hidden in the table on small screens and behind "More details" on phone cards. */
  hideOnMobile?: boolean;
  /** Override where this column goes on phone cards (default: worked out from the column). */
  mobile?: 'badge' | 'fact' | 'more' | 'action' | 'hidden';
}

/** Responsive data table with loading, empty and error states. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  empty = 'Nothing here yet',
  emptyDescription,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (r: T) => string;
  loading?: boolean;
  error?: Error | null;
  empty?: string;
  emptyDescription?: string;
  onRowClick?: (r: T) => void;
}) {
  if (loading) return <LoadingRows />;
  if (error) return <ErrorState message={error.message} />;
  if (!rows?.length) return <EmptyState title={empty} description={emptyDescription} />;
  // Phones: cards that put the important content first.
  //  - header: first column (who / what) with the status badge beside it
  //  - key facts: the other columns in a compact 2-column grid
  //  - columns marked hideOnMobile are secondary and sit behind "More details"
  //  - action columns (no header) go in a footer
  const pick = (c: Column<T>) => c.mobile ?? (isStatus(c) ? 'badge' : !hasHeader(c.header) ? 'action' : c.hideOnMobile ? 'more' : 'fact');
  const [title, ...rest] = columns.filter((c) => c.mobile !== 'hidden');
  const badges = rest.filter((c) => pick(c) === 'badge');
  const facts = rest.filter((c) => pick(c) === 'fact');
  const more = rest.filter((c) => pick(c) === 'more');
  const actions = rest.filter((c) => pick(c) === 'action');
  return (
    <>
      <ul className="space-y-3 bg-muted/40 p-3 md:hidden">
        {rows.map((r) => (
          <li
            key={rowKey(r)}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
            onKeyDown={onRowClick ? (e) => (e.key === 'Enter' ? onRowClick(r) : undefined) : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            className={cn('rounded-xl border bg-card text-sm shadow-xs', onRowClick && 'cursor-pointer transition-colors active:bg-muted/50')}
          >
            <div className="flex items-start justify-between gap-3 p-3.5 pb-2.5">
              {title && <div className="min-w-0 flex-1 font-medium">{title.cell(r)}</div>}
              {badges.length > 0 && <div className="flex shrink-0 flex-col items-end gap-1">{badges.map((c) => <div key={c.key}>{c.cell(r)}</div>)}</div>}
            </div>
            {facts.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-3.5 pb-3">
                {facts.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{c.header}</dt>
                    <dd className="mt-0.5 break-words">{c.cell(r)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {more.length > 0 && (
              <details className="group border-t px-3.5 py-2" onClick={(e) => e.stopPropagation()}>
                <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-primary">
                  More details
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5 pb-1">
                  {more.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{c.header}</dt>
                      <dd className="mt-0.5 break-words">{c.cell(r)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            {actions.length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t px-3.5 py-2" onClick={(e) => e.stopPropagation()}>
                {actions.map((c) => <div key={c.key}>{c.cell(r)}</div>)}
              </div>
            )}
          </li>
        ))}
      </ul>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-4 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === 'Enter' ? onRowClick(r) : undefined) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cn('border-b last:border-0', onRowClick && 'cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-4 py-3 align-middle', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

/** Column has a visible header (screen-reader-only headers count as none, e.g. action columns). */
const hasHeader = (h: ReactNode) => {
  if (h === '' || h === null || h === undefined || h === false) return false;
  if (isValidElement<{ className?: string }>(h) && String(h.props.className ?? '').includes('sr-only')) return false;
  return true;
};
const isStatus = <T,>(c: Column<T>) => typeof c.header === 'string' && /^status$/i.test(c.header.trim());

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav className="flex items-center justify-between border-t px-4 py-3 text-sm" aria-label="Pagination">
      <span className="text-muted-foreground">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
