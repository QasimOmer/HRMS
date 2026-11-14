'use client';

import { Eye, FileText, ImageIcon, UploadCloud, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { cn, fileSize } from '@/lib/format';
import { Button } from './button';


/** Does `file` match an accept string such as ".pdf,image/*"? */
function accepts(file: File, accept?: string) {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  return accept.split(',').map((a) => a.trim().toLowerCase()).some((a) =>
    a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? file.type.startsWith(a.slice(0, -1)) : file.type === a,
  );
}

const describe = (accept?: string) => {
  if (!accept) return 'Any file';
  const parts = [];
  if (/image/.test(accept) || /\.(png|jpe?g|webp)/.test(accept)) parts.push('images');
  if (/pdf/.test(accept)) parts.push('PDF');
  return parts.length ? parts.join(' or ').replace(/^./, (c) => c.toUpperCase()) : accept;
};

/** Opens a selected file in a new window/tab so the person can check it before submitting. */
function openPreview(url: string) {
  // The URL is a local blob of the person's own file, so no opener protection is needed.
  const w = window.open(url, '_blank');
  if (!w) toast.error('Allow pop-ups for this site to preview files');
}

/**
 * File picker with a clear call to action, drag & drop, thumbnails, preview in a new window and remove.
 * Controlled: pass the selected files and receive the new list.
 */
export function FileUpload({
  value,
  onChange,
  accept,
  multiple = false,
  maxFiles = multiple ? 5 : 1,
  maxSizeMB = 10,
  required,
  disabled,
  label = multiple ? 'Choose files' : 'Choose a file',
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  value: File[];
  onChange: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  maxSizeMB?: number;
  required?: boolean;
  disabled?: boolean;
  label?: string;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // One object URL per file for thumbnails and previews; released when the file is removed.
  const urls = useMemo(() => value.map((f) => URL.createObjectURL(f)), [value]);
  useEffect(() => () => {
    // Delay so a preview tab opened just before removal can still load.
    const old = urls;
    setTimeout(() => old.forEach((u) => URL.revokeObjectURL(u)), 60_000);
  }, [urls]);

  const add = (list: FileList | null) => {
    if (!list?.length) return;
    const picked = Array.from(list);
    const rejected: string[] = [];
    const ok = picked.filter((f) => {
      if (!accepts(f, accept)) return rejected.push(`${f.name}: ${describe(accept)} only`), false;
      if (f.size > maxSizeMB * 1024 * 1024) return rejected.push(`${f.name}: larger than ${maxSizeMB} MB`), false;
      return true;
    });
    let next = multiple ? [...value, ...ok.filter((f) => !value.some((v) => v.name === f.name && v.size === f.size))] : ok.slice(0, 1);
    if (next.length > maxFiles) {
      rejected.push(`Only ${maxFiles} file${maxFiles === 1 ? '' : 's'} allowed`);
      next = next.slice(0, maxFiles);
    }
    if (rejected.length) toast.error(rejected.join('\n'));
    onChange(next);
    if (input.current) input.current.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled) add(e.dataTransfer.files);
  };

  const full = value.length >= maxFiles;
  return (
    <div className="space-y-2">
      {!full && (
        <label
          htmlFor={inputId}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors',
            dragging ? 'border-primary bg-primary-soft' : 'border-input bg-muted/30 hover:border-primary/60 hover:bg-primary-soft/50',
            invalid && 'border-danger',
            disabled && 'pointer-events-none opacity-60',
          )}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary">
            <UploadCloud className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-sm">
            <span className="font-semibold text-primary">{label}</span>
            <span className="text-muted-foreground"> or drag {multiple ? 'them' : 'it'} here</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {describe(accept)} · up to {maxSizeMB} MB{multiple ? ` · max ${maxFiles} files` : ''}
            {multiple && value.length > 0 ? ` · ${maxFiles - value.length} more allowed` : ''}
          </span>
          <input
            ref={input}
            id={inputId}
            type="file"
            className="sr-only"
            accept={accept}
            multiple={multiple}
            required={required && value.length === 0}
            disabled={disabled}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(e) => add(e.target.files)}
          />
        </label>
      )}

      {value.length > 0 && (
        <ul className="space-y-2" aria-label="Selected files">
          {value.map((f, i) => {
            const isImage = f.type.startsWith('image/');
            const url = urls[i]!;
            return (
              <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-3 rounded-lg border bg-card p-2 pr-1.5">
                <button
                  type="button"
                  onClick={() => openPreview(url)}
                  className="h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                  aria-label={`Preview ${f.name} in a new window`}
                  title="Open preview in a new window"
                >
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-danger"><FileText className="h-6 w-6" aria-hidden /></span>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{f.name}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    {isImage ? <ImageIcon className="h-3 w-3" aria-hidden /> : <FileText className="h-3 w-3" aria-hidden />}
                    {fileSize(f.size)}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => openPreview(url)}>
                  <Eye className="h-4 w-4" /> <span className="hidden sm:inline">Preview</span>
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-danger" aria-label={`Remove ${f.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))} disabled={disabled}>
                  <X className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
          {multiple && value.length > 1 && (
            <li className="flex justify-end">
              <button type="button" className="text-xs text-muted-foreground hover:text-danger hover:underline" onClick={() => onChange([])}>Remove all</button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
