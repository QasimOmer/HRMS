'use client';

import { DOC_CATEGORY_LABELS, type DocCategory } from '@hrms/shared';
import { AlertTriangle, Camera, CheckCircle2, Eye, FileText, ImageUp, RefreshCw, Upload, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import type { Doc } from '@/components/employee-panels';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/overlay';
import { FileThumb, MediaView } from '@/components/file-preview';
import { api } from '@/lib/api';
import { cn, fileSize } from '@/lib/format';

const MAX_MB = 10;

/* ------------------------------------------------------------------ */
/* Sample illustrations (generic, not a real card)                     */
/* ------------------------------------------------------------------ */

function CnicFrontSample() {
  return (
    <svg viewBox="0 0 172 108" className="h-full w-full" role="img" aria-label="Sample: front of an identity card, whole card visible">
      <rect x="1" y="1" width="170" height="106" rx="8" fill="#ecfdf5" stroke="#10b981" strokeWidth="1.5" />
      <rect x="1" y="1" width="170" height="20" rx="8" fill="#10b981" />
      <rect x="1" y="13" width="170" height="8" fill="#10b981" />
      <text x="86" y="15" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff" fontFamily="sans-serif">IDENTITY CARD</text>
      <rect x="10" y="30" width="38" height="46" rx="3" fill="#d1fae5" stroke="#6ee7b7" />
      <circle cx="29" cy="46" r="8" fill="#94a3b8" />
      <path d="M15 75c2-10 8-14 14-14s12 4 14 14" fill="#94a3b8" />
      {[32, 42, 52, 62].map((y, i) => (
        <g key={y}>
          <rect x="56" y={y} width="22" height="3" rx="1.5" fill="#6ee7b7" />
          <rect x="82" y={y} width={[60, 48, 70, 40][i]} height="3" rx="1.5" fill="#94a3b8" />
        </g>
      ))}
      <rect x="56" y="74" width="80" height="6" rx="2" fill="#334155" />
      <path d="M120 92c6-6 10 2 16-3s8 1 14-2" stroke="#334155" strokeWidth="1.2" fill="none" />
      <text x="10" y="96" fontSize="6" fill="#64748b" fontFamily="sans-serif">00000-0000000-0</text>
    </svg>
  );
}

function CnicBackSample() {
  return (
    <svg viewBox="0 0 172 108" className="h-full w-full" role="img" aria-label="Sample: back of an identity card with barcode, whole card visible">
      <rect x="1" y="1" width="170" height="106" rx="8" fill="#ecfdf5" stroke="#10b981" strokeWidth="1.5" />
      {[14, 22, 30, 38, 46].map((y, i) => <rect key={y} x="10" y={y} width={[110, 90, 120, 70, 100][i]} height="3" rx="1.5" fill="#94a3b8" />)}
      <rect x="128" y="12" width="34" height="34" rx="2" fill="#fff" stroke="#334155" />
      {[0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => ((r + c) % 2 === 0 || r === c) && <rect key={`${r}${c}`} x={131 + c * 7.5} y={15 + r * 7.5} width="6" height="6" fill="#334155" />))}
      <g fill="#334155">
        {Array.from({ length: 38 }, (_, i) => <rect key={i} x={10 + i * 4} y="62" width={i % 3 === 0 ? 2.4 : 1.2} height="30" />)}
      </g>
    </svg>
  );
}

function PhotoSample() {
  return (
    <svg viewBox="0 0 108 132" className="h-full w-full" role="img" aria-label="Sample: passport-style photo, face straight on a plain white background">
      <rect x="1" y="1" width="106" height="130" rx="6" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
      <ellipse cx="54" cy="54" rx="22" ry="27" fill="none" stroke="#60a5fa" strokeDasharray="3 3" />
      <ellipse cx="54" cy="52" rx="17" ry="21" fill="#e2b48c" />
      <path d="M37 46c0-14 8-21 17-21s17 7 17 21c-4-6-10-9-17-9s-13 3-17 9z" fill="#3f2d20" />
      <circle cx="47" cy="53" r="1.8" fill="#1f2937" />
      <circle cx="61" cy="53" r="1.8" fill="#1f2937" />
      <path d="M49 63c3 2 7 2 10 0" stroke="#9a3412" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M18 131c3-24 18-36 36-36s33 12 36 36z" fill="#1e3a8a" />
      <path d="M46 96l8 10 8-10" fill="#fff" />
    </svg>
  );
}

function CertificateSample() {
  return (
    <svg viewBox="0 0 172 122" className="h-full w-full" role="img" aria-label="Sample: a certificate photographed or scanned flat, whole page visible">
      <rect x="1" y="1" width="170" height="120" rx="4" fill="#fffbeb" stroke="#f59e0b" strokeWidth="1.5" />
      <rect x="7" y="7" width="158" height="108" rx="2" fill="none" stroke="#fcd34d" strokeDasharray="4 2" />
      <text x="86" y="26" textAnchor="middle" fontSize="9" fontWeight="700" fill="#92400e" fontFamily="serif">CERTIFICATE</text>
      {[38, 48, 58].map((y, i) => <rect key={y} x={[46, 30, 52][i]} y={y} width={[80, 112, 68][i]} height="3" rx="1.5" fill="#94a3b8" />)}
      <rect x="56" y="68" width="60" height="6" rx="2" fill="#334155" />
      <circle cx="40" cy="96" r="10" fill="#fde68a" stroke="#f59e0b" />
      <path d="M110 98c6-6 10 2 16-3s8 1 14-2" stroke="#334155" strokeWidth="1.2" fill="none" />
      <rect x="108" y="102" width="40" height="1.5" fill="#94a3b8" />
    </svg>
  );
}

const GUIDE: Record<string, { sample: () => React.JSX.Element; tips: string[]; avoid: string[]; accept: string; aspect: string }> = {
  CNIC_FRONT: {
    sample: CnicFrontSample,
    tips: ['Whole card in the picture, all 4 corners visible', 'Photo, name and CNIC number clearly readable', 'Flat surface, good light'],
    avoid: ['Glare or flash reflections', 'Cut-off edges or blurry text'],
    accept: '.pdf,image/png,image/jpeg,image/webp',
    aspect: 'aspect-[172/108]',
  },
  CNIC_BACK: {
    sample: CnicBackSample,
    tips: ['Back side of the same card', 'Barcode and text fully visible', 'All 4 corners in the picture'],
    avoid: ['Fingers covering the card', 'Dark or blurry photo'],
    accept: '.pdf,image/png,image/jpeg,image/webp',
    aspect: 'aspect-[172/108]',
  },
  EDUCATION: {
    sample: CertificateSample,
    tips: ['Your highest degree or last certificate', 'Whole page visible and readable', 'A scan or PDF works best'],
    avoid: ['Photos at an angle', 'Pages cut off or folded'],
    accept: '.pdf,image/png,image/jpeg,image/webp',
    aspect: 'aspect-[172/122]',
  },
  OTHER_ONBOARDING: {
    sample: CertificateSample,
    tips: ['Anything else HR asked for (experience letter, domicile…)', 'Whole page visible and readable'],
    avoid: ['Blurry or dark photos'],
    accept: '.pdf,image/png,image/jpeg,image/webp',
    aspect: 'aspect-[172/122]',
  },
  PHOTO: {
    sample: PhotoSample,
    tips: ['Face straight to the camera, eyes open', 'Plain white background', 'Head and shoulders, recent photo'],
    avoid: ['Sunglasses, caps or filters', 'Selfies at an angle or group photos'],
    accept: 'image/png,image/jpeg,image/webp',
    aspect: 'aspect-[108/132]',
  },
};

/* ------------------------------------------------------------------ */
/* Simple photo checks (advice only, never blocking)                   */
/* ------------------------------------------------------------------ */

/** Looks at the picture's edges: a passport-style photo has a bright, plain background and is taller than wide. */
async function checkPhoto(file: File): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const bmp = await createImageBitmap(file);
    if (bmp.width > bmp.height) warnings.push('This photo is wider than it is tall. A head-and-shoulders portrait works best.');
    const w = 80;
    const h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(bmp, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      let sum = 0;
      let n = 0;
      const sample = (x: number, y: number) => {
        const i = (y * w + x) * 4;
        sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
        n++;
      };
      // Top band and the upper parts of both sides: where the background shows around the head.
      for (let x = 0; x < w; x++) for (let y = 0; y < Math.max(2, Math.round(h * 0.08)); y++) sample(x, y);
      for (let y = 0; y < Math.round(h * 0.6); y++) for (let x = 0; x < Math.max(2, Math.round(w * 0.08)); x++) { sample(x, y); sample(w - 1 - x, y); }
      if (n && sum / n < 200) warnings.push('The background doesn’t look white. Please use a plain white background.');
    }
    bmp.close();
  } catch {
    /* Unknown format: the server checks the file anyway. */
  }
  return warnings;
}

/* ------------------------------------------------------------------ */
/* Upload card                                                          */
/* ------------------------------------------------------------------ */

function Preview({ url, isPdf, alt, className, onOpen }: { url: string | null; isPdf: boolean; alt: string; className?: string; onOpen?: () => void }) {
  return (
    <button type="button" onClick={onOpen} disabled={!onOpen} className={cn('group relative flex items-center justify-center overflow-hidden rounded-lg border bg-muted/40', className)} aria-label={`Preview ${alt}`}>
      {isPdf || !url ? (
        <span className="flex flex-col items-center gap-1 text-muted-foreground"><FileText className="h-8 w-8" aria-hidden /><span className="text-xs">{isPdf ? 'PDF' : 'Loading…'}</span></span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="h-full w-full object-contain" />
      )}
      {onOpen && <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100"><Eye className="h-5 w-5" aria-hidden /></span>}
    </button>
  );
}

/**
 * One required onboarding document: a sample of what is expected, tips, a preview of the chosen file
 * before it is uploaded, and a preview of the uploaded file afterwards.
 */
export function DocUploadCard({ category, uploaded: single, uploads = [], multiple = false, onUploaded }: { category: DocCategory; uploaded?: Doc; uploads?: Doc[]; multiple?: boolean; onUploaded: () => void }) {
  // `multiple`: several files of this kind (e.g. "Other document"); the card never locks.
  const uploaded = multiple ? undefined : single;
  const [title, setTitle] = useState('');
  const guide = GUIDE[category]!;
  const Sample = guide.sample;
  const label = DOC_CATEGORY_LABELS[category];
  const inputId = useId();
  const cameraId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [remoteType, setRemoteType] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<{ url: string; isPdf: boolean } | null>(null);

  // Preview of the chosen (not yet uploaded) file.
  useEffect(() => {
    if (!file) return setLocalUrl(null);
    const url = URL.createObjectURL(file);
    setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Preview of the uploaded file, fetched with the session (documents are private).
  useEffect(() => {
    if (!uploaded) return;
    let url: string | null = null;
    let alive = true;
    api.blob(`/documents/${uploaded.id}/file`).then((b) => {
      if (!alive) return;
      url = URL.createObjectURL(b);
      setRemoteType(b.type);
      setRemoteUrl(url);
    }).catch(() => undefined);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [uploaded]);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) return toast.error(`The file is larger than ${MAX_MB} MB`);
    setFile(f);
    setWarnings(category === 'PHOTO' && f.type.startsWith('image/') ? await checkPhoto(f) : []);
  };

  const upload = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.set('file', file);
    fd.set('category', category);
    if (multiple && title.trim()) fd.set('title', title.trim());
    setBusy(true);
    try {
      await api.post('/me/documents', fd);
      toast.success(`${label} uploaded`);
      setFile(null);
      setTitle('');
      onUploaded();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fileIsPdf = !!file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  const remoteIsPdf = remoteType === 'application/pdf' || !!uploaded?.fileName.toLowerCase().endsWith('.pdf');
  const previewBox = cn('w-full max-w-56', guide.aspect);

  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        {uploaded || (multiple && uploads.length) ? <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> : <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-muted-foreground/40" aria-hidden />}
        <h3 className="font-semibold">{label}</h3>
        {uploaded && <span className="ml-auto rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">Uploaded</span>}
        {multiple && uploads.length > 0 && <span className="ml-auto rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">{uploads.length} uploaded</span>}
      </div>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,13rem)_1fr]">
        {/* Left: sample, or the actual file */}
        <div className="space-y-1.5">
          {uploaded ? (
            <Preview url={remoteUrl} isPdf={remoteIsPdf} alt={label} className={previewBox} onOpen={remoteUrl ? () => setZoom({ url: remoteUrl, isPdf: remoteIsPdf }) : undefined} />
          ) : file ? (
            <Preview url={localUrl} isPdf={fileIsPdf} alt={`Selected ${label}`} className={previewBox} onOpen={localUrl ? () => setZoom({ url: localUrl, isPdf: fileIsPdf }) : undefined} />
          ) : (
            <div className={cn('relative rounded-lg border border-dashed bg-muted/30 p-2', previewBox)}>
              <Sample />
              <span className="absolute top-2 right-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary-foreground">SAMPLE</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{uploaded ? 'Your uploaded file. Click to view.' : file ? 'Your file. Check it before uploading.' : 'How it should look'}</p>
        </div>

        {/* Right: guidance and actions */}
        <div className="min-w-0 space-y-4">
          {!uploaded && (
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <ul className="space-y-1.5">
                {guide.tips.map((t) => <li key={t} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> {t}</li>)}
              </ul>
              <ul className="space-y-1.5">
                {guide.avoid.map((t) => <li key={t} className="flex gap-2 text-muted-foreground"><X className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden /> {t}</li>)}
              </ul>
            </div>
          )}

          {multiple && uploads.length > 0 && (
            <ul className="space-y-2">
              {uploads.map((d) => (
                <li key={d.id} className="flex items-center gap-3 rounded-lg border px-2 py-1.5 text-sm">
                  <FileThumb path={`/documents/${d.id}/file`} name={d.fileName} className="h-9 w-9" />
                  <span className="min-w-0 flex-1 truncate">{d.title || d.fileName}</span>
                </li>
              ))}
            </ul>
          )}

          {file && !uploaded && (
            <div className="space-y-2">
              {multiple && (
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="What is this document? e.g. Experience letter"
                  aria-label="Document name" className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none" />
              )}
              <p className="truncate text-sm"><span className="font-medium">{file.name}</span> <span className="text-muted-foreground">· {fileSize(file.size)}</span></p>
              {warnings.map((w) => (
                <p key={w} className="flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {w}</p>
              ))}
            </div>
          )}

          {uploaded ? (
            <p className="text-sm text-muted-foreground">Submitted as <span className="font-medium text-foreground">{uploaded.fileName}</span>. Ask HR if it needs to be replaced.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {file ? (
                <>
                  <Button onClick={upload} loading={busy}><Upload className="h-4 w-4" aria-hidden /> Upload</Button>
                  <label htmlFor={inputId} className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"><RefreshCw className="h-4 w-4" aria-hidden /> Choose another</label>
                </>
              ) : (
                <>
                  <label htmlFor={inputId} className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"><ImageUp className="h-4 w-4" aria-hidden /> {multiple && uploads.length ? 'Add another' : 'Choose file'}</label>
                  <label htmlFor={cameraId} className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted sm:hidden"><Camera className="h-4 w-4" aria-hidden /> Take photo</label>
                </>
              )}
              <input id={inputId} type="file" className="sr-only" accept={guide.accept} onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
              <input id={cameraId} type="file" className="sr-only" accept="image/*" capture={category === 'PHOTO' ? 'user' : 'environment'} onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          )}
          {!uploaded && <p className="text-xs text-muted-foreground">{category === 'PHOTO' ? 'JPG, PNG or WebP' : 'JPG, PNG, WebP or PDF'}, up to {MAX_MB} MB.</p>}
        </div>
      </div>

      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)} title={label} size="lg">
        {zoom && <MediaView url={zoom.url} isPdf={zoom.isPdf} title={label} />}
      </Dialog>
    </div>
  );
}
