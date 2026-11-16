'use client';

import { Download, HandCoins, Target, TrendingUp, Trophy, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { QuickActions } from '@/components/overview';
import { Bars } from '@/components/ui/charts';
import { Card, CardBody, CardHeader, ErrorState, PageHeader, Progress, Skeleton, Stat } from '@/components/ui/display';
import { Input } from '@/components/ui/form';
import { DataTable } from '@/components/ui/table';
import { downloadFile, qs } from '@/lib/api';
import { money, monthLabel, todayLocal } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface SalesOverview {
  currency: string;
  period: string;
  totals: { target: number; achieved: number; pending: number; progress: number | null; incentives: number; people: number };
  byEmployee: { employeeId: string; employeeCode: string; fullName: string; departmentName: string; target: number; achieved: number; pending: number; progress: number | null }[];
  trend: { period: string; target: number; achieved: number }[];
}

/**
 * Sales revenue overview. The server decides who may see it (Sales department and people given
 * "View sales revenue"); anyone else gets an error here and in the export.
 */
export default function SalesOverviewPage() {
  const [period, setPeriod] = useState(todayLocal().slice(0, 7));
  const { data, isLoading, error } = useApi<SalesOverview>(`/sales/overview${qs({ period })}`, { fresh: true });
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile(`/sales/export${qs({ period })}`, `sales-revenue-${period}.csv`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };
  const cur = data?.currency ?? 'PKR';

  return (
    <>
      <PageHeader
        title="Sales overview"
        description="Revenue from approved sales KPI results."
        actions={<Input type="month" aria-label="Month" className="w-44" value={period} max={todayLocal().slice(0, 7)} onChange={(e) => e.target.value && setPeriod(e.target.value)} />}
      />
      {error ? <ErrorState message={error.message} /> : isLoading || !data ? <Skeleton className="h-64" /> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={`Revenue · ${monthLabel(data.period)}`} icon={TrendingUp} tone="success" value={money(data.totals.achieved, cur)} hint={`${money(data.totals.pending, cur)} awaiting approval`} />
            <Stat label="Target" icon={Target} value={money(data.totals.target, cur)} hint={`${data.totals.people} people with sales targets`} />
            <Stat label="Achieved" icon={Trophy} tone="info" value={data.totals.progress === null ? '—' : `${data.totals.progress}%`} hint="Of the month's target" />
            <Stat label="Incentives earned" icon={HandCoins} tone="warning" value={money(data.totals.incentives, cur)} />
          </div>
          <QuickActions actions={[
            { onClick: () => void exportCsv(), label: exporting ? 'Exporting…' : 'Export CSV', description: `Sales report for ${monthLabel(data.period)}`, icon: Download },
            { href: '/kpi', label: 'KPI targets & results', description: 'Set targets, submit and approve results', icon: Target },
            { href: '/directory', label: 'Sales team', description: 'Contacts in the directory', icon: Users },
          ]} />
          <Card>
            <CardHeader title="Revenue trend" description="Approved revenue against target, last 6 months" />
            <CardBody>
              <Bars format={(n) => money(n, cur)} items={data.trend.map((t) => ({ label: monthLabel(t.period).slice(0, 3), value: t.achieved, target: t.target, title: `${monthLabel(t.period)}: ${money(t.achieved, cur)} of ${money(t.target, cur)}` }))} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="By salesperson" description={monthLabel(data.period)} />
            <DataTable
              rows={data.byEmployee}
              rowKey={(r) => r.employeeId}
              empty="No sales targets this month"
              emptyDescription="Set targets with a metric such as “Sales revenue” on the KPI page."
              columns={[
                { key: 'name', header: 'Name', cell: (r) => <div><p className="font-medium">{r.fullName}</p><p className="text-xs text-muted-foreground">{r.employeeCode} · {r.departmentName}</p></div> },
                { key: 'target', header: 'Target', cell: (r) => <span className="tabular-nums">{money(r.target, cur)}</span>, hideOnMobile: true },
                { key: 'achieved', header: 'Achieved', cell: (r) => <span className="tabular-nums">{money(r.achieved, cur)}</span> },
                { key: 'pending', header: 'Pending', cell: (r) => <span className="tabular-nums text-muted-foreground">{money(r.pending, cur)}</span>, hideOnMobile: true },
                { key: 'progress', header: 'Progress', cell: (r) => <div className="w-28"><Progress value={Math.min(100, r.progress ?? 0)} /><p className="mt-1 text-xs text-muted-foreground">{r.progress === null ? '—' : `${r.progress}%`}</p></div> },
              ]}
            />
          </Card>
        </div>
      )}
    </>
  );
}
