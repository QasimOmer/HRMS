'use client';

import { ShieldAlert } from 'lucide-react';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/display';
import { DataTable } from '@/components/ui/table';
import { dateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Violation { id: string; name: string; reason: string; level: number; removedBy: string | null; contentExcerpt: string | null; createdAt: string; disciplinary: boolean; postId: string | null }

/** F2: removed posts and comments, with warnings and disciplinary cases. */
export default function ModerationPage() {
  const { data, isLoading } = useApi<Violation[]>('/community/violations');
  const cases = (data ?? []).filter((v) => v.disciplinary);
  return (
    <>
      <PageHeader title="Moderation" description="Posts and comments removed for breaking the Community Guidelines. Two warnings, then the third removal within 12 months becomes a disciplinary case." />
      {cases.length > 0 && (
        <div role="status" className="mb-6 flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p><span className="font-medium">{new Set(cases.map((c) => c.name)).size} {cases.length === 1 ? 'person needs' : 'people need'} disciplinary action:</span> {[...new Set(cases.map((c) => c.name))].join(', ')}.</p>
        </div>
      )}
      <Card>
        <CardHeader title="Removals" />
        <DataTable loading={isLoading} rows={data} rowKey={(v) => v.id} empty="Nothing has been removed" columns={[
          { key: 'n', header: 'Author', cell: (v) => <span className="font-medium">{v.name}</span> },
          { key: 'l', header: 'Outcome', cell: (v) => (v.disciplinary ? <Badge tone="danger">Disciplinary ({v.level})</Badge> : <Badge tone="warning">Warning {v.level} of 2</Badge>) },
          { key: 'r', header: 'Reason', cell: (v) => <div className="max-w-sm"><p className="text-sm">{v.reason}</p>{v.contentExcerpt && <p className="truncate text-xs text-muted-foreground" title={v.contentExcerpt}>“{v.contentExcerpt}”</p>}</div> },
          { key: 'b', header: 'Removed by', hideOnMobile: true, cell: (v) => v.removedBy ?? '—' },
          { key: 'd', header: 'When', hideOnMobile: true, cell: (v) => dateTime(v.createdAt) },
        ]} />
      </Card>
    </>
  );
}
