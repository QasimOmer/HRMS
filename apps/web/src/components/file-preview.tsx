'use client';

import { Download, Eye, FileText, X } from 'lucide-react';
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

/** Small thumbnail (images, from the name or MIME type) or file icon that opens the preview. */
export function FileThumb({ path, name, mimeType, className }: { path: string; name: string; mimeType?: string | null; className?: string }) {
  const [open, setOpen] = useState(false);
  const image = isImageName(name) || !!mimeType?.startsWith('image/');
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Preview ${name}`}
        className={cn('group relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40', className)}>
        {image
          ? <AuthImage src={`/api/v1${path}`} alt="" className="h-full w-full object-cover" loading="lazy" fallback={<FileText className="h-5 w-5 text-primary" />} />
          : <FileText className="h-5 w-5 text-primary" aria-hidden />}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100"><Eye className="h-4 w-4" aria-hidden /></span>
      </button>
      <FilePreviewDialog path={path} name={name} open={open} onOpenChange={setOpen} />
    </>
  );
}

const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const typeLabel = (mime?: string | null, name = '') => (mime === 'application/pdf' || isPdfName(name) ? 'PDF' : mime?.startsWith('image/') ? mime.slice(6).toUpperCase().replace('JPEG', 'JPG') : (name.split('.').pop() ?? '').toUpperCase());

/**
 * One uploaded document, the same everywhere: thumbnail, name and details, then preview (eye) and download.
 * `downloadPath` defaults to `path`; `onRemove` adds a remove button (e.g. before a form is submitted).
 */
export function FileRow({ path, downloadPath, name, mimeType, size, detail, onRemove }: { path: string; downloadPath?: string; name: string; mimeType?: string | null; size?: number | null; detail?: string; onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  const meta = [detail, typeLabel(mimeType, name), size ? sizeLabel(size) : null].filter(Boolean).join(' · ');
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
      <FileThumb path={path} name={name} mimeType={mimeType} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={name}>{name}</p>
        {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
      </div>
      <Button size="icon" variant="ghost" aria-label={`Preview ${name}`} onClick={() => setOpen(true)}><Eye className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" aria-label={`Download ${name}`} onClick={() => downloadFile(downloadPath ?? path, name).catch((e) => toast.error(e.message))}><Download className="h-4 w-4" /></Button>
      {onRemove && <Button size="icon" variant="ghost" aria-label={`Remove ${name}`} onClick={onRemove}><X className="h-4 w-4" /></Button>}
      <FilePreviewDialog path={path} name={name} open={open} onOpenChange={setOpen} />
    </div>
  );
}

/**
 * Numbered attachments (KPI proof, medical claims, loans, complaint evidence): a thumbnail per file that opens
 * the preview, which has its own Download button. `rows` shows full rows instead (for detail views).
 */
export function AttachmentLinks({ base, count, label = 'File', rows = false }: { base: string; count: number; label?: string; rows?: boolean }) {
  if (!count) return null;
  if (rows) {
    return (
      <div className="space-y-2">
        {Array.from({ length: count }, (_, i) => <FileRow key={i} path={`${base}/${i}`} name={`${label} ${i + 1}`} />)}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: count }, (_, i) => <FileThumb key={i} path={`${base}/${i}`} name={`${label} ${i + 1}`} className="h-9 w-9" />)}
    </div>
  );
}
