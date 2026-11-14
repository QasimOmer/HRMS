'use client';

import { Download, Eye, FileText, Paperclip } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AuthImage } from '@/components/ui/auth-image';
import { Dialog } from '@/components/ui/overlay';
import { api, downloadFile } from '@/lib/api';
import { cn } from '@/lib/format';

const isImageName = (name: string) => /\.(png|jpe?g|webp|gif)$/i.test(name);
const isPdfName = (name: string) => /\.pdf$/i.test(name);

/** Shows an image or PDF from a URL (object URL or data URL), full size. Shared by every preview. */
export function MediaView({ url, isPdf, title }: { url: string; isPdf: boolean; title: string }) {
  return isPdf
    ? <iframe src={url} title={title} className="h-[70vh] w-full rounded-md border" />
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={url} alt={title} className="mx-auto max-h-[70vh] w-auto rounded-md object-contain" />;
}

/** Full-size viewer for a private file (fetched with the session): images inline, PDFs in a frame. */
export function FilePreviewDialog({ path, name, open, onOpenChange }: { path: string; name: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [type, setType] = useState('');
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let made: string | null = null;
    api.blob(path).then((b) => {
      if (!alive) return;
      made = URL.createObjectURL(b);
      setType(b.type);
      setUrl(made);
    }).catch((e: Error) => { toast.error(e.message); onOpenChange(false); });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [open, path, onOpenChange]);
  const pdf = type === 'application/pdf' || isPdfName(name);
  const image = type.startsWith('image/') || isImageName(name);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={name} size="lg"
      footer={<Button variant="outline" onClick={() => downloadFile(path, name).catch((e) => toast.error(e.message))}><Download className="h-4 w-4" /> Download</Button>}>
      {!url ? (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Loading preview…</div>
      ) : pdf || image ? (
        <MediaView url={url} isPdf={pdf} title={name} />
      ) : (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"><FileText className="h-8 w-8" /> No preview for this file type. Use Download.</div>
      )}
    </Dialog>
  );
}

/** Small thumbnail (images) or file icon that opens the preview. */
export function FileThumb({ path, name, className }: { path: string; name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Preview ${name}`}
        className={cn('group relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40', className)}>
        {isImageName(name)
          ? <AuthImage src={`/api/v1${path}`} alt="" className="h-full w-full object-cover" loading="lazy" fallback={<FileText className="h-5 w-5 text-primary" />} />
          : <FileText className="h-5 w-5 text-primary" aria-hidden />}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100"><Eye className="h-4 w-4" aria-hidden /></span>
      </button>
      <FilePreviewDialog path={path} name={name} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** "Files (2)" chip list for attachments stored by index, e.g. /kpi/submissions/:id/files/:i. */
export function AttachmentLinks({ base, count, label = 'File' }: { base: string; count: number; label?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!count) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {Array.from({ length: count }, (_, i) => (
        <button key={i} type="button" onClick={() => setOpen(i)} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-muted">
          <Paperclip className="h-3 w-3" aria-hidden /> {label} {i + 1}
        </button>
      ))}
      {open !== null && <FilePreviewDialog path={`${base}/${open}`} name={`${label} ${open + 1}`} open onOpenChange={(o) => !o && setOpen(null)} />}
    </div>
  );
}
