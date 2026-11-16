'use client';

import { PERMISSIONS as P } from '@hrms/shared';
import { Plus, Trash2, UserPlus, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { DecisionButtons, DepartmentSelect, EmployeeSelect } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Avatar, Card, CardHeader, EmptyState, LoadingRows, PageHeader, StatusBadge } from '@/components/ui/display';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Dialog, useConfirm } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { cn, date } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { DeleteButton } from '@/components/delete-button';

interface Team { id: string; name: string; departmentId: string; departmentName: string; leadEmployeeId: string; leadName: string; isActive: boolean; memberCount: number }
interface Member { employeeId: string; fullName: string; employeeCode: string; designation: string; avatarFileId: string | null; email: string; addedAt: string }
interface Transfer { id: string; employeeName: string; fromTeam: string | null; toTeam: string; reason: string | null; status: string; currentStep: string | null; createdAt: string }

export default function TeamsPage() {
  const { can, me } = useAuth();
  const admin = can(P.TEAMS_MANAGE);
  const { data: teams, isLoading } = useApi<Team[]>('/teams');
  const visibleTeams = admin ? teams : teams?.filter((t) => me?.user.ledTeamIds.includes(t.id));
  const [selected, setSelected] = useState('');
  const team = visibleTeams?.find((t) => t.id === selected) ?? visibleTeams?.[0];
  const { data: members, isLoading: mLoading } = useApi<Member[]>(team ? `/teams/${team.id}/members` : null);
  const { data: transfers } = useApi<Transfer[]>('/team-transfers');
  const [newTeam, setNewTeam] = useState(false);
  const [form, setForm] = useState({ name: '', departmentId: '', leadEmployeeId: '' });
  const [addOpen, setAddOpen] = useState(false);
  const [addId, setAddId] = useState('');
  const [reason, setReason] = useState('');
  const { confirm, node } = useConfirm();

  const create = useAction('post', '/teams', { invalidate: ['/teams'], success: 'Team created', onSuccess: () => { setNewTeam(false); setForm({ name: '', departmentId: '', leadEmployeeId: '' }); } });
  const add = useAction<{ employeeId: string; reason?: string }, { added: boolean; transferRequested: boolean; currentTeam?: string; currentLead?: string }>('post', () => `/teams/${team!.id}/members`, {
    invalidate: ['/teams', '/team-transfers'],
    onSuccess: (r) => {
      setAddOpen(false);
      setAddId('');
      setReason('');
      if (r.transferRequested && !r.added) toast.info(`This person is in ${r.currentTeam} (lead: ${r.currentLead}). A transfer request was sent for approval.`);
      else toast.success('Member added');
    },
  });
  const remove = useAction<string>('del', (id) => `/teams/${team!.id}/members/${id}`, { invalidate: ['/teams'], success: 'Member removed' });

  return (
    <>
      <PageHeader title="Teams" description="Team Leads manage their own team. Adding someone who's already in another team sends a transfer request." actions={admin && <Button onClick={() => setNewTeam(true)}><Plus className="h-4 w-4" /> New team</Button>} />
      {isLoading ? <Card><LoadingRows /></Card> : !visibleTeams?.length ? (
        <Card><EmptyState icon={UsersRound} title="No teams yet" description={admin ? 'Create a team and assign a Team Lead.' : "You don't lead a team yet."} /></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <Card className="h-fit">
            <ul className="p-2">
              {visibleTeams.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setSelected(t.id)} aria-current={team?.id === t.id} className={cn('w-full rounded-md px-3 py-2 text-left hover:bg-muted', team?.id === t.id && 'bg-primary-soft text-primary')}>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.departmentName} · {t.leadName} · {t.memberCount} members</p>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {team && (
            <Card>
              <CardHeader title={team.name} description={`Lead: ${team.leadName} · ${team.departmentName}`} action={<div className="flex flex-wrap gap-1"><Button size="sm" onClick={() => setAddOpen(true)}><UserPlus className="h-3.5 w-3.5" /> Add member</Button>{admin && <DeleteButton path={`/teams/${team.id}`} what={`the ${team.name} team`} invalidate={['/teams']} onDeleted={() => setSelected('')} detail="Members become unassigned. Teams with transfer history can't be deleted." />}</div>} />
              <DataTable loading={mLoading} rows={members} rowKey={(m) => m.employeeId} empty="No members yet" columns={[
                { key: 'n', header: 'Member', cell: (m) => <div className="flex items-center gap-3"><Avatar name={m.fullName} fileId={m.avatarFileId} size="sm" /><div><p className="font-medium">{m.fullName}</p><p className="text-xs text-muted-foreground">{m.designation}</p></div></div> },
                { key: 'c', header: 'ID', hideOnMobile: true, cell: (m) => <span className="font-mono text-xs">{m.employeeCode}</span> },
                { key: 'a', header: 'Since', hideOnMobile: true, cell: (m) => date(m.addedAt) },
                { key: 'x', header: <span className="sr-only">Remove</span>, cell: (m) => <Button size="icon" variant="ghost" aria-label={`Remove ${m.fullName}`} onClick={async () => { if (await confirm({ title: `Remove ${m.fullName} from ${team.name}?`, danger: true, confirmLabel: 'Remove' })) remove.mutate(m.employeeId); }}><Trash2 className="h-4 w-4 text-danger" /></Button> },
              ]} />
            </Card>
          )}
        </div>
      )}

      {!!transfers?.length && (
        <Card className="mt-6">
          <CardHeader title="Team transfer requests" />
          <DataTable rows={transfers} rowKey={(t) => t.id} columns={[
            { key: 'e', header: 'Employee', cell: (t) => <span className="font-medium">{t.employeeName}</span> },
            { key: 'm', header: 'Move', cell: (t) => <span className="text-sm">{t.fromTeam ?? '—'} → {t.toTeam}</span> },
            { key: 'r', header: 'Reason', hideOnMobile: true, cell: (t) => <span className="text-muted-foreground">{t.reason ?? '—'}</span> },
            { key: 's', header: 'Status', cell: (t) => <StatusBadge status={t.status} step={t.currentStep} /> },
            { key: 'a', header: '', cell: (t) => t.status === 'PENDING' && can(P.TEAM_TRANSFER_APPROVE) ? <DecisionButtons path={`/team-transfers/${t.id}/decision`} invalidate={['/team-transfers', '/teams']} /> : null },
          ]} />
        </Card>
      )}

      <Dialog open={newTeam} onOpenChange={setNewTeam} title="New team" footer={<><Button variant="outline" onClick={() => setNewTeam(false)}>Cancel</Button><Button loading={create.isPending} disabled={!form.name || !form.departmentId || !form.leadEmployeeId} onClick={() => create.mutate(form)}>Create</Button></>}>
        <div className="space-y-4">
          <Field label="Team name" required>{(a) => <Input {...a} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label="Department" required>{(a) => <DepartmentSelect {...a} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} />}</Field>
          <Field label="Team Lead" required hint="They'll get the Team Lead role automatically.">{(a) => <EmployeeSelect {...a} value={form.leadEmployeeId} onChange={(e) => setForm({ ...form, leadEmployeeId: e.target.value })} />}</Field>
        </div>
      </Dialog>
      <Dialog open={addOpen} onOpenChange={setAddOpen} title={`Add member to ${team?.name ?? ''}`} footer={<><Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button><Button loading={add.isPending} disabled={!addId} onClick={() => add.mutate({ employeeId: addId, reason: reason || undefined })}>Add</Button></>}>
        <div className="space-y-4">
          <Field label="Employee" required>{(a) => <EmployeeSelect {...a} value={addId} onChange={(e) => setAddId(e.target.value)} filter={(e) => e.id !== team?.leadEmployeeId && !members?.some((m) => m.employeeId === e.id)} />}</Field>
          <Field label="Reason" hint="Used if this person needs a transfer from another team.">{(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </div>
      </Dialog>
      {node}
    </>
  );
}
