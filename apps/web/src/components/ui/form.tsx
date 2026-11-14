import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/format';

const control =
  'w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(control, 'h-9', className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-24 py-2', className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(control, 'h-9 pr-8', className)} {...p}>
      {children}
    </select>
  );
});

export function Label({ children, htmlFor, className }: { children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('block text-sm font-medium text-foreground', className)}>
      {children}
    </label>
  );
}

/**
 * Field wrapper: label, control, hint and error with proper aria wiring.
 * The child receives `id`, `aria-invalid` and `aria-describedby` through the render prop.
 */
export function Field({
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (a: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const desc = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </Label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': desc })}
      {error ? (
        <p id={`${id}-err`} className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', className)}>
      <input type="checkbox" className="h-4 w-4 rounded border-input accent-[var(--primary)]" {...p} />
      <span>{label}</span>
    </label>
  );
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  return <div className={cn('grid gap-4', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-3')}>{children}</div>;
}

/* ---------------- Formatted inputs (digits only) ---------------- */

/** Pakistani CNIC: 13 digits shown as 35202-1234567-1. */
export function formatCnic(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

/**
 * Phone number: digits only, with an optional leading +.
 * Pakistani numbers are grouped as 0300 1234567 or +92 300 1234567; other countries keep +<digits>.
 */
export function formatPhone(v: string): string {
  const plus = v.trim().startsWith('+');
  const d = v.replace(/\D/g, '');
  if (d.startsWith('92') && (plus || d.length > 11)) {
    const r = d.slice(2, 12);
    return ['+92', r.slice(0, 3), r.slice(3)].filter(Boolean).join(' ');
  }
  if (plus) return `+${d.slice(0, 15)}`;
  if (d.startsWith('0')) {
    const r = d.slice(0, 11);
    return r.length > 4 ? `${r.slice(0, 4)} ${r.slice(4)}` : r;
  }
  return d.slice(0, 15);
}

/** Input that reformats as you type; works with react-hook-form `register` and with controlled values. */
function formatted(format: (v: string) => string, defaults: InputHTMLAttributes<HTMLInputElement>) {
  return forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function FormattedInput({ onChange, ...p }, ref) {
    return (
      <Input
        ref={ref}
        {...defaults}
        {...p}
        onChange={(e) => {
          e.target.value = format(e.target.value);
          onChange?.(e);
        }}
      />
    );
  });
}

export const CnicInput = formatted(formatCnic, { inputMode: 'numeric', placeholder: '35202-1234567-1', maxLength: 15, autoComplete: 'off' });
export const PhoneInput = formatted(formatPhone, { type: 'tel', inputMode: 'tel', placeholder: '0300 1234567', maxLength: 16, autoComplete: 'tel' });

/**
 * Company login email: the person types only the name part; "@<domain>" is fixed and can't be edited.
 * With several company domains (`domains`), the domain is picked from a list instead.
 * `value` / `onChange` work with the full address. Without a domain it's a normal email field.
 */
export function CompanyEmailInput({
  domain,
  domains,
  value,
  onChange,
  id,
  placeholder = 'firstname.lastname',
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
}: {
  domain: string | null | undefined;
  /** All allowed domains (main first). Takes precedence over `domain` when given. */
  domains?: string[] | null;
  value: string | undefined;
  onChange: (email: string) => void;
  id?: string;
  placeholder?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const list = domains?.length ? domains : domain ? [domain] : [];
  if (!list.length) {
    return <Input id={id} type="email" value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy} />;
  }
  const typedDomain = value?.toLowerCase().split('@')[1];
  const current = typedDomain && list.includes(typedDomain) ? typedDomain : list[0]!;
  const suffix = `@${current}`;
  const local = value ? (value.toLowerCase().endsWith(suffix) ? value.slice(0, -suffix.length) : value.split('@')[0]!) : '';
  const domainBox = 'flex shrink-0 items-center border-l bg-muted px-3 text-sm text-muted-foreground select-none';
  return (
    <div className={cn('flex h-9 w-full overflow-hidden rounded-md border border-input bg-card shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40', invalid && 'border-danger')}>
      <input
        id={id}
        value={local}
        onChange={(e) => {
          const clean = e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '');
          onChange(clean ? `${clean}${suffix}` : '');
        }}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className="min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
      />
      {list.length > 1 ? (
        <select
          aria-label="Email domain"
          value={current}
          onChange={(e) => onChange(local ? `${local}@${e.target.value}` : '')}
          className={cn(domainBox, 'cursor-pointer outline-none')}
          title="Company email domain (set by your provider)"
        >
          {list.map((d) => <option key={d} value={d}>@{d}</option>)}
        </select>
      ) : (
        <span className={domainBox} title="Company email domain (set by your provider)">{suffix}</span>
      )}
    </div>
  );
}
