'use client';

import { PERMISSION_INFO, permissionAllowed, type Permission } from '@hrms/shared';
import { Lock, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, LoadingRows, PageHeader } from '@/components/ui/display';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

interface RolesRes { permissions: string[]; roles: { role: string; label: string; editable: boolean; permissions: string[]; defaults: string[] }[] }

const info = (p: string) => PERMISSION_INFO[p as Permission] ?? { group: 'Other', label: p, description: '' };

/** On/off switch with a visible state for screen readers. */
function Switch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}

/** A1 – pick a role, then switch each permission on or off. */
export default function RolesPage() {
  const { can } = useAuth();
  const { data, isLoading } = useApi<RolesRes>('/access/roles');
  const [role, setRole] = useState<string>('');
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  useEffect(() => {
    if (!data) return;
    setDraft(Object.fromEntries(data.roles.map((r) => [r.role, new Set(r.permissions)])));
    setRole((cur) => cur || data.roles.find((r) => r.editable)?.role || '');
  }, [data]);
  const save = useAction<{ role: string; permissions: string[] }>('put', (v) => `/access/roles/${v.role}`, { invalidate: ['/access/roles'], success: 'Permissions saved', body: (v) => ({ permissions: v.permissions }) });

  const { me } = useAuth();
  const modules = me?.tenant.modules ?? [];
  // Permissions for modules outside the company's plan aren't shown (they couldn't be used anyway).
  const groups = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const p of data?.permissions ?? []) {
      if (!permissionAllowed(p as Permission, modules)) continue;
      g.set(info(p).group, [...(g.get(info(p).group) ?? []), p]);
    }
    return [...g];
  }, [data, modules]);

  if (isLoading || !data) return <Card><LoadingRows /></Card>;
  const editable = data.roles.filter((r) => r.editable);
  const current = editable.find((r) => r.role === role);
  const set = draft[role] ?? new Set<string>();
  const dirty = (r: string) => {
    const orig = new Set(data.roles.find((x) => x.role === r)!.permissions);
    const cur = draft[r] ?? new Set();
    return orig.size !== cur.size || [...cur].some((p) => !orig.has(p));
  };
  const toggle = (p: string) => setDraft((d) => { const s = new Set(d[role]); if (s.has(p)) s.delete(p); else s.add(p); return { ...d, [role]: s }; });

  return (
    <>
      <PageHeader title="Roles & permissions" description="Choose a role, then switch on what it can do. The Company Admin always has full access (within your plan). You can only grant permissions you hold yourself." />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Role">
        {editable.map((r) => (
          <button
            key={r.role}
            role="tab"
            aria-selected={r.role === role}
            onClick={() => setRole(r.role)}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
              r.role === role ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {r.label}
            <span className={cn('rounded-full px-1.5 text-xs', r.role === role ? 'bg-white/20' : 'bg-muted')}>{draft[r.role]?.size ?? 0}</span>
            {dirty(r.role) && <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-label="unsaved changes" />}
          </button>
        ))}
      </div>

      {current && (
        <Card>
          <CardHeader
            title={`${current.label} permissions`}
            description={`${set.size} of ${data.permissions.length} switched on`}
            action={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setDraft((d) => ({ ...d, [role]: new Set(current.defaults) }))}><RotateCcw className="h-3.5 w-3.5" /> Defaults</Button>
                <Button size="sm" disabled={!dirty(role)} loading={save.isPending} onClick={() => save.mutate({ role, permissions: [...set] })}><Save className="h-3.5 w-3.5" /> Save</Button>
              </div>
            }
          />
          {groups.map(([group, perms]) => (
            <section key={group} aria-labelledby={`g-${group}`}>
              <h3 id={`g-${group}`} className="flex items-center justify-between border-y bg-muted/40 px-5 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group}
                <span className="font-normal normal-case">{perms.filter((p) => set.has(p)).length}/{perms.length}</span>
              </h3>
              <ul className="divide-y">
                {perms.map((p) => {
                  const i = info(p);
                  const locked = !can(p as Permission);
                  return (
                    <li key={p} className="flex items-center justify-between gap-4 px-5 py-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          {i.label}
                          {current.defaults.includes(p) && <Badge>default</Badge>}
                          {locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="You don't hold this permission" />}
                        </p>
                        {i.description && <p className="mt-0.5 text-xs text-muted-foreground">{i.description}</p>}
                      </div>
                      <Switch checked={set.has(p)} disabled={locked} onChange={() => toggle(p)} label={`${current.label}: ${i.label}`} />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </Card>
      )}
    </>
  );
}
