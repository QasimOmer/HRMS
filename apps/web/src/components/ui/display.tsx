import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn, humanize, initials } from '@/lib/format';
import { AuthImage } from './auth-image';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-lg border bg-card text-card-foreground shadow-xs', className)}>{children}</div>;
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b px-5 py-3.5', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export const CardBody = ({ className, children }: { className?: string; children: ReactNode }) => <div className={cn('p-5', className)}>{children}</div>;

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const tones = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

const STATUS_TONES: Record<string, Tone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  INVITED: 'info',
  DISABLED: 'danger',
  RESIGNED: 'warning',
  TERMINATED: 'danger',
  PRESENT: 'success',
  LATE: 'warning',
  ABSENT: 'danger',
  ON_LEAVE: 'info',
  HALF_DAY: 'info',
  HOLIDAY: 'primary',
  WEEKEND: 'neutral',
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  PAID: 'success',
  PUBLISHED: 'success',
  ARCHIVED: 'neutral',
  OPEN: 'success',
  CLOSED: 'neutral',
  SUBMITTED: 'warning',
  UNDER_REVIEW: 'info',
  RESOLVED: 'success',
  DISMISSED: 'neutral',
  IN_PROGRESS: 'info',
  VOID: 'neutral',
  REQUESTED: 'warning',
  NOT_IN_YET: 'neutral',
  NO_RECORD: 'neutral',
};

const STEP_LABEL: Record<string, string> = { TEAM_LEAD: 'Team Lead', HR: 'HR', OPERATIONS: 'Operations' };

/** Request status with the step it's waiting on, e.g. "Pending · Team Lead". */
export function StatusBadge({ status, step }: { status: string; step?: string | null }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'}>
      {humanize(status)}
      {status === 'PENDING' && step ? ` · ${STEP_LABEL[step] ?? step}` : ''}
    </Badge>
  );
}

export function Avatar({ name, fileId, size = 'md', className }: { name?: string | null; fileId?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const dim = { sm: 'h-7 w-7 text-[10px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm', xl: 'h-20 w-20 text-xl' }[size];
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft font-semibold text-primary', dim, className)} aria-hidden={!name}>
      {fileId ? (
        <AuthImage src={`/api/v1/avatars/${fileId}`} alt={name ? `${name}'s photo` : ''} className="h-full w-full object-cover" loading="lazy" fallback={initials(name)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} aria-hidden />;
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-muted p-3">
        <Icon className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message?: string }) {
  return (
    <div role="alert" className="m-4 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      {message ?? 'Could not load this data. Please try again.'}
    </div>
  );
}

export function Stat({ label, value, hint, icon: Icon, tone = 'primary' }: { label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: Tone }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {Icon && (
          <span className={cn('rounded-md p-2', tones[tone])}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
    </Card>
  );
}

/** Simple, accessible horizontal bar list (no chart library needed). */
export function BarList({ items, format = (n: number) => String(n) }: { items: { label: string; value: number; color?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="truncate text-muted-foreground">{i.label}</span>
            <span className="font-medium tabular-nums">{format(i.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted" role="presentation">
            <div className="h-2 rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? 'var(--primary)' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-2 rounded-full bg-muted', className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-2 rounded-full', v >= 100 ? 'bg-success' : 'bg-primary')} style={{ width: `${v}%` }} />
    </div>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 truncate text-sm">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
