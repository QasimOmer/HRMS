'use client';

import { PERMISSIONS as P, POLICY_CATEGORY_LABELS } from '@hrms/shared';
import { Archive, ArrowLeft, Send, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, ErrorState, PageHeader, Skeleton, StatusBadge } from '@/components/ui/display';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { Policy } from '../page';
import { DeleteButton } from '@/components/delete-button';

/**
 * F1 – read-only viewer. Right-click, copy, drag and printing are blocked and the
 * viewer's name is watermarked. That's a deterrent only: anything on screen can be captured.
 */
export default function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, me } = useAuth();
  const { data: p, isLoading, error } = useApi<Policy>(`/policies/${id}`);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const publish = useAction('post', `/policies/${id}/publish`, { invalidate: ['/policies'], success: 'Published and employees notified' });
  const archive = useAction('post', `/policies/${id}/archive`, { invalidate: ['/policies'], success: 'Archived' });

  useEffect(() => {
    if (!p?.fileId) return;
    let url: string | null = null;
    api.blob(`/policies/${id}/file`).then((b) => {
      url = URL.createObjectURL(b);
      setPdfUrl(url);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [p?.fileId, id]);

  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'c'].includes(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener('keydown', block);
    return () => window.removeEventListener('keydown', block);
  }, []);

  if (error) return <ErrorState message={error.message} />;
  if (isLoading || !p) return <Skeleton className="h-96" />;
  const watermark = `${me?.employee?.fullName ?? me?.user.email} · ${me?.user.email}`;

  return (
    <>
      <Link href="/policies" className="no-print mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Policies</Link>
      <PageHeader
        title={p.title}
        description={`${POLICY_CATEGORY_LABELS[p.category]} · version ${p.version}${p.publishedAt ? ` · published ${date(p.publishedAt)}` : ''}`}
        actions={can(P.POLICIES_MANAGE) && <>
          <StatusBadge status={p.status} />
          {p.status !== 'PUBLISHED' && <Button loading={publish.isPending} onClick={() => publish.mutate(undefined)}><Send className="h-4 w-4" /> Publish</Button>}
          {p.status === 'PUBLISHED' && <Button variant="outline" loading={archive.isPending} onClick={() => archive.mutate(undefined)}><Archive className="h-4 w-4" /> Archive</Button>}
          <DeleteButton path={`/policies/${id}`} what="this policy" invalidate={['/policies']} onDeleted={() => window.location.assign('/policies')} detail="The policy and its document are removed for everyone. This cannot be undone." />
        </>}
      />
      <p className="no-print mb-4 flex items-center gap-2 text-xs text-muted-foreground"><ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Confidential company document. Copying, printing and downloading are disabled.</p>
      <div className="no-print no-select relative" onContextMenu={(e) => e.preventDefault()} onCopy={(e) => e.preventDefault()} onDragStart={(e) => e.preventDefault()}>
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden opacity-[0.07]" aria-hidden>
          <div className="grid h-full w-full -rotate-12 grid-cols-2 gap-16 p-8 text-lg font-semibold whitespace-nowrap">
            {Array.from({ length: 16 }, (_, i) => <span key={i}>{watermark}</span>)}
          </div>
        </div>
        {p.summary && <Card className="mb-4"><CardBody><Badge tone="info" className="mb-2">Summary</Badge><p className="text-sm">{p.summary}</p></CardBody></Card>}
        {p.content && <Card className="mb-4"><CardBody><div className="text-sm leading-relaxed whitespace-pre-wrap">{p.content}</div></CardBody></Card>}
        {p.fileId && (
          <Card className="overflow-hidden">
            {pdfUrl ? <iframe src={`${pdfUrl}#toolbar=0&navpanes=0`} title={p.title} className="h-[75vh] w-full" /> : <Skeleton className="h-[75vh] rounded-none" />}
          </Card>
        )}
      </div>
    </>
  );
}
