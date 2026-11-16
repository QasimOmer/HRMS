'use client';

import { COMMUNITY_POSTING_MODES, PERMISSIONS as P } from '@hrms/shared';
import { Heart, Megaphone, MessageCircle, ScrollText, Settings2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, CardBody, EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/ui/display';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/form';
import { Dialog, useConfirm } from '@/components/ui/overlay';
import { useAuth } from '@/lib/auth';
import { cn, relative } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

interface Post { id: string; type: 'POST' | 'ANNOUNCEMENT' | 'BIRTHDAY'; title: string | null; body: string; createdAt: string; pinned: boolean; departmentName: string | null; authorName: string | null; authorAvatarFileId: string | null; authorDesignation: string | null; subjectAvatarFileId: string | null; likes: number; comments: number; liked: boolean; canDelete: boolean; mine: boolean; system: boolean }
interface Comment { id: string; body: string; createdAt: string; fullName: string | null; avatarFileId: string | null; canDelete: boolean; mine: boolean }
interface Settings { postingMode: string; engagementEnabled: boolean; canPost: boolean }

const REASONS = ['Harassment or personal attack', 'Offensive or explicit content', 'Confidential information', 'Spam or self-promotion', 'Off-topic'];

/**
 * F2: a moderator removing someone else's post or comment says why. The author is told the reason;
 * two warnings, then disciplinary action on the third.
 */
function RemoveDialog({ what, path, open, onOpenChange, invalidate }: { what: 'post' | 'comment'; path: string; open: boolean; onOpenChange: (o: boolean) => void; invalidate: string[] }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  const remove = useAction<undefined, { violation: { level: number; warning: boolean; disciplinary: boolean } | null }>('post', path, {
    invalidate,
    body: () => ({ reason: reason.trim() }),
    success: (r) => (!r.violation ? 'Removed' : r.violation.disciplinary ? `Removed. This was their ${r.violation.level}rd violation – HR has been alerted for disciplinary action.` : `Removed. The author got warning ${r.violation.level} of 2.`),
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Remove this ${what}?`} description="The author is notified with your reason. Two warnings, then the third removal within 12 months is escalated to HR for disciplinary action." size="sm"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="danger" loading={remove.isPending} disabled={reason.trim().length < 5} onClick={() => remove.mutate(undefined)}>Remove and notify</Button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className={cn('rounded-full border px-2.5 py-1 text-xs', reason === r ? 'border-danger bg-danger-soft text-danger' : 'hover:bg-muted')}>{r}</button>
          ))}
        </div>
        <Field label="Reason" required hint="Shown to the author. Be specific and refer to the guideline it breaks.">{(a) => <Textarea {...a} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function Comments({ postId, enabled }: { postId: string; enabled: boolean }) {
  const { data } = useApi<Comment[]>(`/community/posts/${postId}/comments`);
  const [text, setText] = useState('');
  const add = useAction('post', `/community/posts/${postId}/comments`, { invalidate: [`/community`], body: () => ({ body: text }), onSuccess: () => setText('') });
  const del = useAction<string>('del', (id) => `/community/comments/${id}`, { invalidate: ['/community'] });
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <div className="space-y-3 border-t bg-muted/30 px-5 py-3">
      {data?.map((c) => (
        <div key={c.id} className="flex gap-2">
          <Avatar name={c.fullName} fileId={c.avatarFileId} size="sm" />
          <div className="min-w-0 flex-1 rounded-md bg-card px-3 py-2">
            <p className="text-xs font-medium">{c.fullName} <span className="font-normal text-muted-foreground">· {relative(c.createdAt)}</span></p>
            <p className="text-sm whitespace-pre-wrap">{c.body}</p>
          </div>
          {c.canDelete && <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={c.mine ? 'Delete comment' : 'Remove comment'} onClick={() => (c.mine ? del.mutate(c.id) : setRemoving(c.id))}><Trash2 className="h-3.5 w-3.5" /></Button>}
        </div>
      ))}
      {removing && <RemoveDialog what="comment" path={`/community/comments/${removing}/remove`} open onOpenChange={(o) => !o && setRemoving(null)} invalidate={['/community']} />}
      {enabled && (
        <div className="flex gap-2">
          <Textarea rows={1} className="min-h-9" placeholder="Write a comment…" aria-label="Write a comment" value={text} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" className="self-end" disabled={!text.trim()} loading={add.isPending} onClick={() => add.mutate(undefined)}>Post</Button>
        </div>
      )}
    </div>
  );
}

function PostCard({ p, engagement }: { p: Post; engagement: boolean }) {
  const [open, setOpen] = useState(false);
  const like = useAction('post', `/community/posts/${p.id}/like`, { invalidate: ['/community/feed'] });
  const del = useAction('del', `/community/posts/${p.id}`, { invalidate: ['/community/feed'], success: 'Post removed' });
  const [removing, setRemoving] = useState(false);
  // Own posts and system posts (birthdays) are deleted directly; someone else's needs a reason.
  const needsReason = !p.mine && !p.system;
  const { confirm, node } = useConfirm();
  const isAnn = p.type === 'ANNOUNCEMENT';
  const isBday = p.type === 'BIRTHDAY';
  return (
    <Card className={cn(isAnn && 'border-primary/40', isBday && 'border-pink-300 dark:border-pink-900')}>
      <CardBody className="space-y-3">
        <div className="flex items-start gap-3">
          {isBday ? <Avatar name={p.title ?? ''} fileId={p.subjectAvatarFileId} size="lg" /> : <Avatar name={p.authorName} fileId={p.authorAvatarFileId} />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{isBday ? 'Birthday' : p.authorName ?? 'HR'}{!isBday && p.authorDesignation && <span className="font-normal text-muted-foreground"> · {p.authorDesignation}</span>}</p>
            <p className="text-xs text-muted-foreground">{relative(p.createdAt)}{p.departmentName ? ` · ${p.departmentName}` : ''}</p>
          </div>
          <div className="flex items-center gap-1">
            {p.pinned && <Badge tone="primary">Pinned</Badge>}
            {isAnn && <Badge tone="primary"><Megaphone className="h-3 w-3" /> Announcement</Badge>}
            {p.canDelete && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Delete post" onClick={async () => { if (needsReason) return setRemoving(true); if (await confirm({ title: 'Remove this post?', danger: true, confirmLabel: 'Remove' })) del.mutate(undefined); }}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        </div>
        {p.title && <h3 className={cn('font-semibold', isBday && 'text-lg')}>{p.title}</h3>}
        <p className="text-sm whitespace-pre-wrap">{p.body}</p>
        <div className="flex gap-1 border-t pt-2">
          <Button size="sm" variant="ghost" disabled={!engagement} onClick={() => like.mutate(undefined)} aria-pressed={p.liked} className={cn(p.liked && 'text-danger')}>
            <Heart className={cn('h-4 w-4', p.liked && 'fill-current')} /> {p.likes}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}><MessageCircle className="h-4 w-4" /> {p.comments}</Button>
        </div>
      </CardBody>
      {open && <Comments postId={p.id} enabled={engagement} />}
      {node}
      <RemoveDialog what="post" path={`/community/posts/${p.id}/remove`} open={removing} onOpenChange={setRemoving} invalidate={['/community/feed']} />
    </Card>
  );
}

/** G1 – employee community. */
export default function CommunityPage() {
  const { can, me } = useAuth();
  const [type, setType] = useState('');
  const { data: posts, isLoading, error } = useApi<Post[]>(`/community/feed${type ? `?type=${type}` : ''}`);
  const { data: settings } = useApi<Settings>('/community/settings');
  const [text, setText] = useState('');
  const [deptOnly, setDeptOnly] = useState(false);
  const [cfg, setCfg] = useState(false);
  const [mode, setMode] = useState('');
  const [eng, setEng] = useState(true);
  const post = useAction('post', '/community/posts', { invalidate: ['/community/feed'], success: 'Posted', body: () => ({ body: text, departmentId: deptOnly ? me?.employee?.departmentId : null }), onSuccess: () => setText('') });
  const saveCfg = useAction('patch', '/community/settings', { invalidate: ['/community'], success: 'Community settings saved', body: () => ({ postingMode: mode, engagementEnabled: eng }), onSuccess: () => setCfg(false) });

  if (error?.status === 403) {
    return (
      <>
        <PageHeader title="Community" />
        <Card><EmptyState icon={ScrollText} title="Please accept the Community Guidelines" description="Before joining the conversation, read and accept our guidelines." action={<Link href="/guidelines"><Button>Read guidelines</Button></Link>} /></Card>
      </>
    );
  }
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Community" description="Updates, wins and celebrations from across the company." actions={can(P.COMMUNITY_POSTING_MANAGE) && <Button variant="outline" onClick={() => { setMode(settings?.postingMode ?? 'GRANTED_ONLY'); setEng(settings?.engagementEnabled ?? true); setCfg(true); }}><Settings2 className="h-4 w-4" /> Settings</Button>} />
      {settings?.canPost ? (
        <Card className="mb-4">
          <CardBody className="space-y-3">
            <Textarea rows={3} placeholder="Share an update with your colleagues…" aria-label="New post" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
            <div className="flex items-center justify-between">
              <Checkbox label={`Only ${me?.employee?.departmentName ?? 'my department'}`} checked={deptOnly} onChange={(e) => setDeptOnly(e.target.checked)} />
              <Button disabled={!text.trim()} loading={post.isPending} onClick={() => post.mutate(undefined)}>Post</Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Posting is limited to people HR has given access. You can still read, like and comment.</p>
      )}
      <div className="mb-4 flex gap-1" role="group" aria-label="Filter">
        {[['', 'All'], ['ANNOUNCEMENT', 'Announcements'], ['POST', 'Posts'], ['BIRTHDAY', 'Birthdays']].map(([v, l]) => (
          <Button key={v} size="sm" variant={type === v ? 'primary' : 'ghost'} aria-pressed={type === v} onClick={() => setType(v!)}>{l}</Button>
        ))}
      </div>
      {isLoading ? <Card><LoadingRows /></Card> : error ? <ErrorState message={error.message} /> : !posts?.length ? <Card><EmptyState title="Nothing posted yet" /></Card> : (
        <div className="space-y-4">{posts.map((p) => <PostCard key={p.id} p={p} engagement={settings?.engagementEnabled ?? true} />)}</div>
      )}
      <Dialog open={cfg} onOpenChange={setCfg} title="Community settings" footer={<><Button variant="outline" onClick={() => setCfg(false)}>Cancel</Button><Button loading={saveCfg.isPending} onClick={() => saveCfg.mutate(undefined)}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="Who can post?" hint="Grant individual posting access from Users & access, or per user in the API.">{(a) => (
            <Select {...a} value={mode} onChange={(e) => setMode(e.target.value)}>
              {COMMUNITY_POSTING_MODES.map((m) => <option key={m} value={m}>{m === 'EVERYONE' ? 'Everyone' : m === 'GRANTED_ONLY' ? 'Only people HR has granted access' : 'HR & Operations only'}</option>)}
            </Select>
          )}</Field>
          <Checkbox label="Allow likes and comments" checked={eng} onChange={(e) => setEng(e.target.checked)} />
        </div>
      </Dialog>
    </div>
  );
}
