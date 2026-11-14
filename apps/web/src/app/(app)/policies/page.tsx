'use client';

import { PERMISSIONS as P, POLICY_CATEGORIES, POLICY_CATEGORY_LABELS, type PolicyCategory } from '@hrms/shared';
import { FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, LoadingRows, PageHeader, StatusBadge } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { FileUpload } from '@/components/ui/file-upload';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date } from '@/lib/format';
import { useApi } from '@/lib/hooks';

export interface Policy { id: string; category: PolicyCategory; title: string; summary: string | null; content: string | null; fileId: string | null; status: string; version: number; publishedAt: string | null; updatedAt: string }

/** F1 – company policies & documents. */
export default function PoliciesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can(P.POLICIES_MANAGE);
  const { data, isLoading } = useApi<Policy[]>('/policies');
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ category: 'COMPANY' as PolicyCategory, title: '', summary: '', content: '' });
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const create = async () => {
    const fd = new FormData();
    Object.entries(v).forEach(([k, x]) => x && fd.set(k, x));
    const f = files[0];
    if (f) fd.set('file', f);
    setBusy(true);
    try {
      await api.post('/policies', fd);
      toast.success('Saved as draft. Publish it to make it visible to employees.');
      setOpen(false);
      setV({ category: 'COMPANY', title: '', summary: '', content: '' });
      setFiles([]);
      qc.invalidateQueries({ queryKey: ['/policies'] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const grouped = POLICY_CATEGORIES.map((c) => ({ c, items: data?.filter((p) => p.category === c) ?? [] })).filter((g) => g.items.length);
  return (
    <>
      <PageHeader title="Policies & documents" description="Company rules, HR policies and guidelines." actions={manage && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New policy</Button>} />
      {isLoading ? <Card><LoadingRows /></Card> : !grouped.length ? <Card><EmptyState icon={FileText} title="No policies published yet" /></Card> : (
        <div className="space-y-6">
          {grouped.map((g) => (
            <Card key={g.c}>
              <CardHeader title={POLICY_CATEGORY_LABELS[g.c]} />
              <ul className="divide-y">
                {g.items.map((p) => (
                  <li key={p.id}>
                    <Link href={`/policies/${p.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50">
                      <FileText className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{p.title}</p>
                        {p.summary && <p className="truncate text-sm text-muted-foreground">{p.summary}</p>}
                      </div>
                      <span className="hidden text-xs text-muted-foreground sm:block">v{p.version} · {date(p.publishedAt ?? p.updatedAt)}</span>
                      {manage && <StatusBadge status={p.status} />}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen} title="New policy" description="Write the policy text, attach a PDF, or both." size="lg"
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={v.title.length < 3} onClick={create}>Save draft</Button></>}>
        <div className="space-y-4">
          <Field label="Category">{(a) => <Select {...a} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as PolicyCategory })}>{POLICY_CATEGORIES.map((c) => <option key={c} value={c}>{POLICY_CATEGORY_LABELS[c]}</option>)}</Select>}</Field>
          <Field label="Title" required>{(a) => <Input {...a} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />}</Field>
          <Field label="Summary">{(a) => <Input {...a} value={v.summary} onChange={(e) => setV({ ...v, summary: e.target.value })} />}</Field>
          <Field label="Policy text">{(a) => <Textarea {...a} rows={8} value={v.content} onChange={(e) => setV({ ...v, content: e.target.value })} />}</Field>
          <Field label="PDF document (optional)">{(a) => <FileUpload {...a} value={files} onChange={setFiles} accept="application/pdf" label="Upload policy PDF" />}</Field>
        </div>
      </Dialog>
    </>
  );
}
