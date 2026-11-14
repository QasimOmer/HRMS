'use client';

import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { downloadFile } from '@/lib/api';
import { hours, money, monthLabel } from '@/lib/format';
import { Button } from './ui/button';
import { Badge } from './ui/display';

export interface PayslipLine { kind: 'EARNING' | 'ALLOWANCE' | 'BONUS' | 'DEDUCTION'; code: string; label: string; amount: number; manual?: boolean }
export interface Payslip {
  id: string;
  period: string;
  basicSalary: number;
  scheduledMinutes: number;
  payableMinutes: number;
  earnedBasic: number;
  totalAllowances: number;
  totalDeductions: number;
  gross: number;
  net: number;
  lines: PayslipLine[];
  snapshot: { fullName?: string; employeeCode?: string; designation?: string; departmentName?: string; level?: string; foodDays?: number; lateMinutes?: number; provisional?: boolean };
}

/** Web view of a salary slip (D1) with PDF download. */
export function PayslipView({ slip, currency, onRemoveLine }: { slip: Payslip; currency: string; onRemoveLine?: (index: number) => void }) {
  const earnings = slip.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.kind !== 'DEDUCTION');
  const deductions = slip.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.kind === 'DEDUCTION');
  const s = slip.snapshot;
  const Row = ({ l, i }: { l: PayslipLine; i: number }) => (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="flex items-center gap-1.5">{l.label}{l.manual && <Badge tone="info">adjustment</Badge>}</span>
      <span className="flex items-center gap-1 tabular-nums">
        {money(l.amount, currency)}
        {l.manual && onRemoveLine && <button className="ml-1 text-xs text-danger hover:underline" onClick={() => onRemoveLine(i)}>remove</button>}
      </span>
    </li>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{s.fullName}</p>
          <p className="text-sm text-muted-foreground">{s.employeeCode} · {s.designation} · {s.departmentName} · {s.level}</p>
          <p className="mt-1 text-sm text-muted-foreground">{monthLabel(slip.period)} · paid hours {hours(Math.min(slip.payableMinutes, slip.scheduledMinutes))} of {hours(slip.scheduledMinutes)}{s.lateMinutes ? ` · ${s.lateMinutes} min late this month` : ''}{s.provisional ? ' · provisional (month not finished)' : ''}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => downloadFile(`/payroll/payslips/${slip.id}/pdf`, `salary-slip-${slip.period}.pdf`).catch((e) => toast.error(e.message))}>
          <Download className="h-4 w-4" /> PDF
        </Button>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <section>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Earnings</h3>
          <ul className="divide-y">{earnings.map((x) => <Row key={x.i} {...x} />)}</ul>
          <p className="mt-2 flex justify-between border-t pt-2 text-sm font-semibold"><span>Gross</span><span className="tabular-nums">{money(slip.gross, currency)}</span></p>
        </section>
        <section>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Deductions</h3>
          <ul className="divide-y">{deductions.length ? deductions.map((x) => <Row key={x.i} {...x} />) : <li className="py-1.5 text-sm text-muted-foreground">None</li>}</ul>
          <p className="mt-2 flex justify-between border-t pt-2 text-sm font-semibold"><span>Total deductions</span><span className="tabular-nums">{money(slip.totalDeductions, currency)}</span></p>
        </section>
      </div>
      <div className="flex items-center justify-between rounded-md bg-primary px-4 py-3 text-primary-foreground">
        <span className="font-medium">Net pay</span>
        <span className="text-xl font-semibold tabular-nums">{money(slip.net, currency)}</span>
      </div>
    </div>
  );
}
