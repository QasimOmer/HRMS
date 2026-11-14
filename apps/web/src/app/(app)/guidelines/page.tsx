'use client';

import { PERMISSIONS as P } from '@hrms/shared';
import { AlertTriangle, CheckCircle2, Pencil, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

interface G { version: number; content: string; publishedAt: string | null; acceptedAt: string | null }
interface Acc { version: number; items: { email: string; fullName: string | null; acceptedAt: string }[] }

/** Minimal, safe markdown rendering: headings, bold and numbered lists (no HTML injection). */
function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {text.split('\n').map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g).map((s, k) => (s.startsWith('**') ? <strong key={k}>{s.slice(2, -2)}</strong> : s));
        if (line.startsWith('# ')) return <h2 key={i} className="text-lg font-semibold">{line.slice(2)}</h2>;
        if (line.startsWith('## ')) return <h3 key={i} className="font-semibold">{line.slice(3)}</h3>;
        if (!line.trim()) return null;
        return <p key={i}>{parts}</p>;
      })}
    </div>
  );
}

/** F2 – community guidelines; acceptance required before using the community. */
/** Your own record: warnings you've had in the last 12 months (F2). */
function MyStanding() {
  const { data } = useApi<{ count: number; warningsAllowed: number; items: { reason: string; level: number; createdAt: string }[] }>('/community/my-standing');
  if (!data?.count) return null;
  const disciplinary = data.count > data.warningsAllowed;
  return (
    <div role="status" className={`mb-6 flex gap-3 rounded-lg border px-4 py-3 text-sm ${disciplinary ? 'border-danger/30 bg-danger-soft text-danger' : 'border-warning/30 bg-warning-soft text-warning'}`}>
      {disciplinary ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />}
      <div>
        <p className="font-medium">
          {disciplinary
            ? `You have ${data.count} guideline violations in the last 12 months. HR will follow up with disciplinary action.`
            : `You have ${data.count} of ${data.warningsAllowed} warnings in the last 12 months. ${data.count >= data.warningsAllowed ? 'One more removal leads to disciplinary action.' : ''}`}
        </p>
        <ul className="mt-1 space-y-0.5 text-xs opacity-90">
          {data.items.map((v, i) => <li key={i}>{dateTime(v.createdAt)}: {v.reason}</li>)}
        </ul>
      </div>
    </div>
  );
}

export default function GuidelinesPage() {
  const router = useRouter();
  const { can, refresh } = useAuth();
  const { data, isLoading } = useApi<G>('/community/guidelines');
  const { data: acc } = useApi<Acc>(can(P.GUIDELINES_MANAGE) ? '/community/guidelines/acceptances' : null);
  const [agree, setAgree] = useState(false);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState('');
  const accept = useAction('post', '/community/guidelines/accept', { invalidate: ['/community'], success: 'Thanks! Welcome to the community.', onSuccess: () => { refresh(); router.push('/community'); } });
  const publish = useAction('put', '/community/guidelines', { invalidate: ['/community'], success: 'New version published. Everyone must accept it again.', body: () => ({ content: draft }), onSuccess: () => setEdit(false) });
  if (isLoading || !data) return <Skeleton className="h-96" />;

  const guidelines = (
    <Card>
      <CardHeader title={`Version ${data.version}`} description={data.publishedAt ? `Published ${dateTime(data.publishedAt)}` : undefined} action={data.acceptedAt ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> Accepted {dateTime(data.acceptedAt)}</Badge> : undefined} />
      <CardBody>
        <Markdown text={data.content} />
        {!data.acceptedAt && (
          <div className="mt-6 space-y-3 border-t pt-4">
            <Checkbox label="I have read and agree to follow the Community Guidelines" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <Button disabled={!agree} loading={accept.isPending} onClick={() => accept.mutate(undefined)}>Accept and continue</Button>
          </div>
        )}
      </CardBody>
    </Card>
  );

  return (
    <>
      <PageHeader title="Community guidelines" description="You need to accept these before using the community feed." actions={can(P.GUIDELINES_MANAGE) && <Button variant="outline" onClick={() => { setDraft(data.content); setEdit(true); }}><Pencil className="h-4 w-4" /> Edit</Button>} />
      <MyStanding />
      {can(P.GUIDELINES_MANAGE) ? (
        <Tabs tabs={[
          { value: 'g', label: 'Guidelines', content: guidelines },
          { value: 'a', label: `Acceptances (${acc?.items.length ?? 0})`, content: <Card><DataTable rows={acc?.items} rowKey={(r) => r.email} empty="No one has accepted this version yet" columns={[
            { key: 'n', header: 'Name', cell: (r) => r.fullName ?? '—' },
            { key: 'e', header: 'Email', cell: (r) => r.email },
            { key: 't', header: 'Accepted', cell: (r) => dateTime(r.acceptedAt) },
          ]} /></Card> },
        ]} />
      ) : guidelines}
      <Dialog open={edit} onOpenChange={setEdit} title="Publish new guidelines" description="Publishing creates a new version. Everyone must accept it again before posting." size="xl"
        footer={<><Button variant="outline" onClick={() => setEdit(false)}>Cancel</Button><Button loading={publish.isPending} disabled={draft.trim().length < 20} onClick={() => publish.mutate(undefined)}>Publish</Button></>}>
        <Textarea aria-label="Guidelines" rows={18} className="font-mono text-xs" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <p className="mt-2 text-xs text-muted-foreground">Supports # headings and **bold**.</p>
      </Dialog>
    </>
  );
}
