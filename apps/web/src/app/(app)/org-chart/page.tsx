'use client';

import { HIERARCHY_LABELS, HIERARCHY_TIERS, type HierarchyTier } from '@hrms/shared';
import { Minus, Network, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { CompanyLogo } from '@/components/brand';
import { useAuth } from '@/lib/auth';
import { useMemo, useState } from 'react';
import { Avatar, Card, EmptyState, LoadingRows, PageHeader } from '@/components/ui/display';
import { cn } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Node {
  id: string;
  fullName: string;
  designation: string;
  avatarFileId: string | null;
  departmentName: string;
  hierarchyTier: HierarchyTier;
  reportingManagerId: string | null;
}

function Person({ n, small }: { n: Node; small?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5 rounded-md border bg-card p-2.5 shadow-xs', small ? 'min-w-48' : 'min-w-56')}>
      <Avatar name={n.fullName} fileId={n.avatarFileId} size={small ? 'sm' : 'md'} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{n.fullName}</p>
        <p className="truncate text-xs text-muted-foreground">{n.designation} · {n.departmentName}</p>
      </div>
    </div>
  );
}

/** One person in the reporting tree: a card, with their reports below it (collapsible). */
function TreeNode({ node, all }: { node: Node; all: Map<string, Node[]> }) {
  const kids = all.get(node.id) ?? [];
  const [open, setOpen] = useState(true);
  return (
    <li>
      <div className="org-card relative flex w-52 flex-col items-center rounded-xl border bg-card px-3 pt-4 pb-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        <Avatar name={node.fullName} fileId={node.avatarFileId} size="lg" />
        <p className="mt-2 w-full truncate text-sm font-semibold" title={node.fullName}>{node.fullName}</p>
        <p className="w-full truncate text-xs text-muted-foreground" title={`${node.designation} · ${node.departmentName}`}>{node.designation}</p>
        <p className="w-full truncate text-xs text-muted-foreground">{node.departmentName}</p>
        <span className="mt-2 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">{HIERARCHY_LABELS[node.hierarchyTier]}</span>
        {kids.length > 0 && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? `Hide ${node.fullName}'s ${kids.length} reports` : `Show ${node.fullName}'s ${kids.length} reports`}
            className="absolute -bottom-3 left-1/2 z-10 flex h-6 min-w-6 -translate-x-1/2 items-center justify-center gap-0.5 rounded-full border bg-card px-1.5 text-[11px] font-medium text-muted-foreground shadow-sm hover:border-primary hover:text-primary">
            {open ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}{kids.length}
          </button>
        )}
      </div>
      {open && kids.length > 0 && <ul>{kids.map((k) => <TreeNode key={k.id} node={k} all={all} />)}</ul>}
    </li>
  );
}

/** B5 – company structure from Director/CEO down to team members. */
export default function OrgChartPage() {
  const { data, isLoading } = useApi<Node[]>('/directory/org-chart');
  const [view, setView] = useState<'tiers' | 'reporting'>('tiers');
  const [zoom, setZoom] = useState(1);
  const { me } = useAuth();
  const { byTier, roots, children } = useMemo(() => {
    const list = data ?? [];
    const ids = new Set(list.map((n) => n.id));
    const children = new Map<string, Node[]>();
    for (const n of list) if (n.reportingManagerId && ids.has(n.reportingManagerId)) children.set(n.reportingManagerId, [...(children.get(n.reportingManagerId) ?? []), n]);
    const order = (n: Node) => HIERARCHY_TIERS.indexOf(n.hierarchyTier);
    const roots = list.filter((n) => !n.reportingManagerId || !ids.has(n.reportingManagerId)).sort((a, b) => order(a) - order(b));
    const byTier = HIERARCHY_TIERS.map((t) => ({ tier: t, people: list.filter((n) => n.hierarchyTier === t) })).filter((g) => g.people.length);
    return { byTier, roots, children };
  }, [data]);

  return (
    <>
      <PageHeader
        title="Organisation chart"
        description="Company structure from top to bottom."
        actions={
          <div className="flex rounded-md border p-0.5" role="group" aria-label="View">
            {(['tiers', 'reporting'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={cn('rounded px-3 py-1 text-sm', view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                {v === 'tiers' ? 'By level' : 'Reporting lines'}
              </button>
            ))}
          </div>
        }
      />
      {isLoading ? (
        <Card><LoadingRows /></Card>
      ) : !data?.length ? (
        <Card><EmptyState icon={Network} title="No one here yet" /></Card>
      ) : view === 'tiers' ? (
        <div className="space-y-6">
          {byTier.map((g, i) => (
            <section key={g.tier} aria-label={HIERARCHY_LABELS[g.tier]}>
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">{i + 1}</span>
                <h2 className="text-sm font-semibold">{HIERARCHY_LABELS[g.tier]}</h2>
                <span className="text-xs text-muted-foreground">{g.people.length}</span>
              </div>
              <div className="flex flex-wrap gap-3">{g.people.map((n) => <Person key={n.id} n={n} />)}</div>
            </section>
          ))}
        </div>
      ) : (
        <Card className="relative overflow-hidden">
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-lg border bg-card/90 p-1 shadow-sm backdrop-blur">
            <button type="button" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(1)))} className="rounded p-1.5 hover:bg-muted" aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></button>
            <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(1)))} className="rounded p-1.5 hover:bg-muted" aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></button>
            <button type="button" onClick={() => setZoom(1)} className="rounded px-2 py-1 text-xs hover:bg-muted">Reset</button>
          </div>
          <div className="overflow-auto p-8 pt-14">
            <div className="org-tree mx-auto w-max origin-top transition-transform" style={{ transform: `scale(${zoom})` }}>
              <ul>
                <li>
                  {/* Everyone without a manager hangs under the company, so it reads as one tree. */}
                  <div className="flex w-56 items-center gap-3 rounded-xl border-2 border-primary/40 bg-primary-soft px-4 py-3 shadow-sm">
                    <CompanyLogo name={me?.tenant.name ?? 'Company'} logoFileId={me?.tenant.logoFileId} />
                    <div className="min-w-0 text-left">
                      <p className="truncate text-sm font-semibold">{me?.tenant.name}</p>
                      <p className="text-xs text-muted-foreground">{data.length} people</p>
                    </div>
                  </div>
                  <ul>{roots.map((r) => <TreeNode key={r.id} node={r} all={children} />)}</ul>
                </li>
              </ul>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
