'use client';

import type { BillingCycle } from '@hrms/shared';
import { cn } from '@/lib/format';

/** Monthly / yearly switch for prices (homepage, sign-up). */
export function CycleToggle({ value, onChange }: { value: BillingCycle; onChange: (c: BillingCycle) => void }) {
  return (
    <div className="inline-flex rounded-full border bg-card p-1 shadow-sm" role="group" aria-label="Billing cycle">
      {(['MONTHLY', 'ANNUAL'] as const).map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-pressed={value === c}
          className={cn('rounded-full px-4 py-1.5 text-sm font-medium transition', value === c ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground')}>
          {c === 'MONTHLY' ? 'Monthly' : <>Yearly <span className={cn('ml-1 rounded-full px-1.5 py-0.5 text-[10px]', value === c ? 'bg-white/20' : 'bg-success-soft text-success')}>save</span></>}
        </button>
      ))}
    </div>
  );
}
