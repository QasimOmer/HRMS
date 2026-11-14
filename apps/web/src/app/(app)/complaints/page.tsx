'use client';

import { COMPLAINT_CATEGORIES, COMPLAINT_STATUSES, PERMISSIONS as P } from '@hrms/shared';
import { Copy, Lock, Paperclip, Search, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, KeyValue, PageHeader, StatusBadge } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { FileUpload } from '@/components/ui/file-upload';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, humanize } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

interface Complaint { id: string; category: string; description: string; status: string; resolutionNote: string | null; submittedOn: string; attachments: number }

function Submit() {
  const [v, setV] = useState({ category: 'OTHER', description: '' });
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [track, setTrack] = useState('');
  const [tracked, setTracked] = useState<{ category: string; status: string; resolutionNote: string | null; submittedOn: string } | null>(null);

  const submit = async () => {
    const fd = new FormData();
    fd.set('category', v.category);
    fd.set('description', v.description);
    for (const f of files) fd.append('files', f);
    setBusy(true);
    try {
      const r = await api.post<{ trackingCode: string }>('/complaints', fd);
      setCode(r.trackingCode);
      setV({ category: 'OTHER', description: '' });
      setFiles([]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doTrack = async () => {
    try {
      setTracked(await api.post('/complaints/track', { trackingCode: track.trim() }));
    } catch (e) {
      setTracked(null);
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader title="Submit a confidential complaint" description="Your name, account, IP address and time of submission are not stored." />
        <CardBody className="space-y-4">
          <div className="flex gap-3 rounded-md bg-info-soft p-3 text-sm text-info"><ShieldCheck className="h-5 w-5 shrink-0" aria-hidden /><p>Only authorised HR staff can read complaints. Avoid including details that identify you unless you want to.</p></div>
          <Field label="Category">{(a) => <Select {...a} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{COMPLAINT_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select>}</Field>
          <Field label="What happened?" required hint={`${v.description.trim().length}/20 characters minimum`}>{(a) => <Textarea {...a} rows={6} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />}</Field>
          <Field label="Evidence (optional)" hint="Photos or PDFs that support your complaint. Click a file to preview it in a new window.">{(a) => <FileUpload {...a} value={files} onChange={setFiles} multiple maxFiles={5} accept=".pdf,image/*" label="Upload evidence" />}</Field>
          <Button loading={busy} disabled={v.description.trim().length < 20} onClick={submit}><Lock className="h-4 w-4" /> Submit anonymously</Button>
        </CardBody>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Check status" description="Use the tracking code you received." />
        <CardBody className="space-y-3">
          <div className="flex gap-2">
            <Input aria-label="Tracking code" placeholder="CMP-…" value={track} onChange={(e) => setTrack(e.target.value)} />
            <Button variant="outline" onClick={doTrack} disabled={track.length < 10}><Search className="h-4 w-4" /></Button>
          </div>
          {tracked && <KeyValue items={[['Category', humanize(tracked.category)], ['Submitted', date(tracked.submittedOn)], ['Status', <StatusBadge key="s" status={tracked.status} />], ['HR response', tracked.resolutionNote ?? 'No response yet']]} />}
        </CardBody>
      </Card>
      <Dialog open={!!code} onOpenChange={() => setCode(null)} title="Complaint submitted" description="Save this tracking code now. It's the only way to check your complaint's status, and it can't be recovered." footer={<Button onClick={() => setCode(null)}>I've saved it</Button>}>
        <div className="flex gap-2">
          <Input readOnly value={code ?? ''} className="font-mono" aria-label="Tracking code" />
          <Button variant="outline" size="icon" aria-label="Copy code" onClick={() => navigator.clipboard.writeText(code ?? '').then(() => toast.success('Copied'))}><Copy className="h-4 w-4" /></Button>
        </div>
      </Dialog>
    </div>
  );
}

function Manage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const { data, isLoading } = useApi<Complaint[]>(`/complaints${status ? `?status=${status}` : ''}`);
  const [open, setOpen] = useState<Complaint | null>(null);
  const [upd, setUpd] = useState({ status: 'UNDER_REVIEW', resolutionNote: '' });
  const save = useAction('patch', () => `/complaints/${open!.id}`, { invalidate: ['/complaints'], success: 'Complaint updated', body: () => upd, onSuccess: () => { setOpen(null); qc.invalidateQueries({ queryKey: ['/dashboard'] }); } });
  return (
    <Card>
      <CardHeader title="Complaints" description="Submitter identity is never recorded." action={<Select className="w-auto" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{COMPLAINT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>} />
      <DataTable loading={isLoading} rows={data} rowKey={(c) => c.id} onRowClick={(c) => { setOpen(c); setUpd({ status: c.status === 'SUBMITTED' ? 'UNDER_REVIEW' : c.status, resolutionNote: c.resolutionNote ?? '' }); }} empty="No complaints" columns={[
        { key: 'd', header: 'Submitted', cell: (c) => date(c.submittedOn) },
        { key: 'c', header: 'Category', cell: (c) => <Badge>{humanize(c.category)}</Badge> },
        { key: 'x', header: 'Description', cell: (c) => <span className="line-clamp-2 text-muted-foreground">{c.description}</span> },
        { key: 'a', header: '', hideOnMobile: true, cell: (c) => (c.attachments ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Paperclip className="h-3 w-3" />{c.attachments}</span> : null) },
        { key: 's', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
      ]} />
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={`${humanize(open?.category)} complaint`} description={open ? `Submitted ${date(open.submittedOn)}` : ''} size="lg"
        footer={<><Button variant="outline" onClick={() => setOpen(null)}>Close</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
        {open && (
          <div className="space-y-4">
            <p className="text-sm whitespace-pre-wrap">{open.description}</p>
            {open.attachments > 0 && <div className="flex flex-wrap gap-2">{Array.from({ length: open.attachments }, (_, i) => <Button key={i} size="sm" variant="outline" onClick={() => downloadFile(`/complaints/${open.id}/files/${i}`, `evidence-${i + 1}`).catch((e) => toast.error(e.message))}><Paperclip className="h-3.5 w-3.5" /> Evidence {i + 1}</Button>)}</div>}
            <Field label="Status">{(a) => <Select {...a} value={upd.status} onChange={(e) => setUpd({ ...upd, status: e.target.value })}>{COMPLAINT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>}</Field>
            <Field label="Response to submitter" hint="Visible to the submitter via their tracking code">{(a) => <Textarea {...a} rows={4} value={upd.resolutionNote} onChange={(e) => setUpd({ ...upd, resolutionNote: e.target.value })} />}</Field>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

/** F3 – anonymous complaint management. */
export default function ComplaintsPage() {
  const { can } = useAuth();
  return (
    <>
      <PageHeader title="Complaints" description="Raise a concern confidentially. Only authorised HR staff can review complaints." />
      <Tabs tabs={[
        { value: 'submit', label: 'Report a concern', content: <Submit /> },
        { value: 'manage', label: 'Review complaints', hidden: !can(P.COMPLAINTS_MANAGE), content: <Manage /> },
      ]} />
    </>
  );
}
