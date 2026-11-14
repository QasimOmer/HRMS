'use client';

import { PERMISSIONS as P, SURVEY_KINDS, SURVEY_QUESTION_TYPES } from '@hrms/shared';
import { BarChart3, Plus, Trash2, Vote } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { DepartmentSelect } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatusBadge } from '@/components/ui/display';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, humanize } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { DeleteButton } from '@/components/delete-button';

interface Q { id: string; type: (typeof SURVEY_QUESTION_TYPES)[number]; label: string; options?: string[]; required: boolean }
interface Survey { id: string; title: string; description: string | null; kind: string; audience: string; audienceId: string | null; anonymous: boolean; questions: Q[]; status: string; createdAt: string; responses?: number }
interface Team { id: string; name: string }

const newQ = (): Q => ({ id: Math.random().toString(36).slice(2, 10), type: 'RATING', label: '', required: true });

function Builder({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing?: Survey }) {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const hr = can(P.SURVEYS_MANAGE);
  const { data: teams } = useApi<Team[]>('/teams');
  const myTeams = hr ? teams : teams?.filter((t) => me?.user.ledTeamIds.includes(t.id));
  const [s, setS] = useState<Omit<Survey, 'id' | 'status' | 'createdAt'>>(() => editing ?? { title: '', description: '', kind: hr ? 'GENERAL' : 'TEAM', audience: hr ? 'ALL' : 'TEAM', audienceId: null, anonymous: false, questions: [newQ()] });
  const [busy, setBusy] = useState(false);
  const setQ = (i: number, patch: Partial<Q>) => setS((x) => ({ ...x, questions: x.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...s, description: s.description || undefined, questions: s.questions.map((q) => ({ ...q, options: q.type.includes('CHOICE') ? q.options?.filter(Boolean) : undefined })) };
      if (editing) await api.put(`/surveys/${editing.id}`, body);
      else await api.post('/surveys', body);
      toast.success('Survey saved as draft. Open it when you are ready.');
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/surveys') });
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={editing ? 'Edit survey' : 'New survey'} size="xl"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={busy} onClick={save} disabled={!s.title || s.questions.some((q) => !q.label)}>Save draft</Button></>}>
      <div className="space-y-5">
        <FormGrid>
          <Field label="Title" required>{(a) => <Input {...a} value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} />}</Field>
          <Field label="Kind">{(a) => <Select {...a} value={s.kind} onChange={(e) => setS({ ...s, kind: e.target.value })}>{SURVEY_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</Select>}</Field>
        </FormGrid>
        <Field label="Description">{(a) => <Textarea {...a} rows={2} value={s.description ?? ''} onChange={(e) => setS({ ...s, description: e.target.value })} />}</Field>
        <FormGrid>
          <Field label="Audience">{(a) => (
            <Select {...a} value={s.audience} onChange={(e) => setS({ ...s, audience: e.target.value, audienceId: null })}>
              {hr && <option value="ALL">Everyone</option>}
              {hr && <option value="DEPARTMENT">A department</option>}
              <option value="TEAM">A team</option>
            </Select>
          )}</Field>
          {s.audience === 'DEPARTMENT' && <Field label="Department">{(a) => <DepartmentSelect {...a} value={s.audienceId ?? ''} onChange={(e) => setS({ ...s, audienceId: e.target.value || null })} />}</Field>}
          {s.audience === 'TEAM' && <Field label="Team">{(a) => <Select {...a} value={s.audienceId ?? ''} onChange={(e) => setS({ ...s, audienceId: e.target.value || null })}><option value="">Select…</option>{myTeams?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>}
        </FormGrid>
        <Checkbox label="Anonymous responses (respondents' names are never shown)" checked={s.anonymous} onChange={(e) => setS({ ...s, anonymous: e.target.checked })} />
        <div className="space-y-3">
          <p className="text-sm font-medium">Questions</p>
          {s.questions.map((q, i) => (
            <div key={q.id} className="space-y-3 rounded-md border p-3">
              <div className="flex gap-2">
                <Input aria-label={`Question ${i + 1}`} placeholder={`Question ${i + 1}`} value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} />
                <Select aria-label="Question type" className="w-44" value={q.type} onChange={(e) => setQ(i, { type: e.target.value as Q['type'], options: e.target.value.includes('CHOICE') ? (q.options ?? ['', '']) : undefined })}>
                  <option value="RATING">Rating 1–5</option><option value="TEXT">Text</option><option value="SINGLE_CHOICE">Single choice</option><option value="MULTI_CHOICE">Multiple choice</option>
                </Select>
                <Button variant="ghost" size="icon" aria-label="Remove question" disabled={s.questions.length === 1} onClick={() => setS({ ...s, questions: s.questions.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
              {q.type.includes('CHOICE') && (
                <div className="space-y-2 pl-2">
                  {(q.options ?? []).map((o, k) => <Input key={k} aria-label={`Option ${k + 1}`} placeholder={`Option ${k + 1}`} value={o} onChange={(e) => setQ(i, { options: q.options!.map((x, j) => (j === k ? e.target.value : x)) })} />)}
                  <Button size="sm" variant="ghost" onClick={() => setQ(i, { options: [...(q.options ?? []), ''] })}><Plus className="h-3.5 w-3.5" /> Option</Button>
                </div>
              )}
              <Checkbox label="Required" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setS({ ...s, questions: [...s.questions, newQ()] })}><Plus className="h-3.5 w-3.5" /> Add question</Button>
        </div>
      </div>
    </Dialog>
  );
}

/** E3 / F7 – performance, team and department surveys. */
export default function SurveysPage() {
  const { can } = useAuth();
  const manager = can(P.SURVEYS_MANAGE, P.SURVEYS_MANAGE_TEAM);
  const { data: available } = useApi<Survey[]>('/surveys/available');
  const { data: managed, isLoading } = useApi<Survey[]>(manager ? '/surveys/manage' : null);
  const [builder, setBuilder] = useState<{ open: boolean; editing?: Survey }>({ open: false });
  const openS = useAction<string>('post', (id) => `/surveys/${id}/open`, { invalidate: ['/surveys'], success: 'Survey opened and participants notified' });
  const closeS = useAction<string>('post', (id) => `/surveys/${id}/close`, { invalidate: ['/surveys'], success: 'Survey closed' });
  return (
    <>
      <PageHeader title="Surveys" description="Share your feedback, or create surveys for your team." actions={manager && <Button onClick={() => setBuilder({ open: true })}><Plus className="h-4 w-4" /> New survey</Button>} />
      <Tabs tabs={[
        {
          value: 'todo', label: `To answer${available?.length ? ` (${available.length})` : ''}`,
          content: !available?.length ? <Card><EmptyState icon={Vote} title="No surveys waiting for you" /></Card> : (
            <div className="grid gap-4 md:grid-cols-2">
              {available.map((s) => (
                <Card key={s.id} className="p-5">
                  <div className="flex items-center gap-2"><Badge tone="primary">{humanize(s.kind)}</Badge>{s.anonymous && <Badge tone="info">anonymous</Badge>}</div>
                  <h3 className="mt-2 font-semibold">{s.title}</h3>
                  {s.description && <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">{s.questions.length} questions</p>
                  <Link href={`/surveys/${s.id}/respond`}><Button className="mt-4" size="sm">Start</Button></Link>
                </Card>
              ))}
            </div>
          ),
        },
        {
          value: 'manage', label: 'Manage', hidden: !manager,
          content: (
            <Card>
              <CardHeader title="Surveys you manage" />
              <DataTable loading={isLoading} rows={managed} rowKey={(s) => s.id} empty="No surveys yet" columns={[
                { key: 't', header: 'Survey', cell: (s) => <div><p className="font-medium">{s.title}</p><p className="text-xs text-muted-foreground">{humanize(s.kind)} · {humanize(s.audience)}{s.anonymous ? ' · anonymous' : ''}</p></div> },
                { key: 'r', header: 'Responses', cell: (s) => s.responses ?? 0 },
                { key: 'c', header: 'Created', hideOnMobile: true, cell: (s) => date(s.createdAt) },
                { key: 's', header: 'Status', cell: (s) => <StatusBadge status={s.status} /> },
                { key: 'a', header: '', cell: (s) => (
                  <div className="flex gap-1.5">
                    {s.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => setBuilder({ open: true, editing: s })}>Edit</Button>}
                    {s.status !== 'OPEN' && <Button size="sm" onClick={() => openS.mutate(s.id)}>Open</Button>}
                    {s.status === 'OPEN' && <Button size="sm" variant="outline" onClick={() => closeS.mutate(s.id)}>Close</Button>}
                    <Link href={`/surveys/${s.id}/results`}><Button size="sm" variant="ghost"><BarChart3 className="h-3.5 w-3.5" /> Results</Button></Link>
                    <DeleteButton iconOnly path={`/surveys/${s.id}`} what={`the survey "${s.title}"`} invalidate={['/surveys']} detail="The survey and all its responses are deleted. This cannot be undone." />
                  </div>
                ) },
              ]} />
            </Card>
          ),
        },
      ]} />
      {builder.open && <Builder key={builder.editing?.id ?? 'new'} open={builder.open} editing={builder.editing} onOpenChange={(o) => setBuilder({ open: o })} />}
    </>
  );
}
