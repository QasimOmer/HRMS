'use client';

import { auditActionLabel } from '@hrms/shared';
import type { Paginated } from '@hrms/shared';
import { useState } from 'react';
import { Badge, Card, PageHeader } from '@/components/ui/display';
import { Input } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { DataTable, Pagination } from '@/components/ui/table';
import { qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Log { id: number; actorLabel: string | null; action: string; entityType: string | null; entityId: string | null; method: string | null; path: string | null; statusCode: number | null; ip: string | null; metadata: unknown; createdAt: string }

type Changes = Record<string, { old: unknown; new: unknown }>;
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** AUD-04: old and new values of each changed field. */
function ChangeTable({ log }: { log: Log | null }) {
  const changes = (log?.metadata as { changes?: Changes } | null)?.changes;
  if (!changes || !Object.keys(changes).length) return null;
  return (
    <div className="mb-4 overflow-x-auto rounded-md border">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/60"><tr><th className="p-2 font-medium">Field</th><th className="p-2 font-medium">Old value</th><th className="p-2 font-medium">New value</th></tr></thead>
        <tbody className="divide-y">
          {Object.entries(changes).map(([k, v]) => (
            <tr key={k}><td className="p-2 font-mono">{k}</td><td className="p-2 text-danger break-all">{show(v.old)}</td><td className="p-2 text-success break-all">{show(v.new)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** F5 – every action with timestamp and history. */
export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<Log | null>(null);
  const { data, isLoading, error } = useApi<Paginated<Log>>(`/access/audit${qs({ page, pageSize: 50, action, from, to })}`);
  return (
    <>
      <PageHeader title="Audit trail" description="An append-only record of every change: who, what, when and from where." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Input className="max-w-xs" placeholder="Filter by area, e.g. leave, payroll, login" aria-label="Action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
          <Input type="date" className="w-auto" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" className="w-auto" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <DataTable loading={isLoading} error={error} rows={data?.items} rowKey={(r) => String(r.id)} onRowClick={setOpen} empty="No audit entries" columns={[
          { key: 't', header: 'When', cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{dateTime(r.createdAt)}</span> },
          { key: 'a', header: 'Who', cell: (r) => r.actorLabel ?? <Badge>anonymous</Badge> },
          { key: 'x', header: 'Action', cell: (r) => <span title={r.action}>{auditActionLabel(r.action)}</span> },
          { key: 'e', header: 'Record', hideOnMobile: true, cell: (r) => <span className="text-xs text-muted-foreground">{r.entityType ?? '—'}</span> },
          { key: 'ip', header: 'IP', hideOnMobile: true, cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.ip ?? '—'}</span> },
        ]} />
        {data && <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />}
      </Card>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open ? auditActionLabel(open.action) : ''} size="lg">
        <ChangeTable log={open} />
        <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(open, null, 2)}</pre>
      </Dialog>
    </>
  );
}
