'use client';

import { idCardTemplate, type IdCardField, type IdCardTemplate } from '@hrms/shared';
import { Download, Printer } from 'lucide-react';
import { toPng } from 'html-to-image';
import { useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AuthImage } from '@/components/ui/auth-image';
import { useAuth } from '@/lib/auth';
import { cn, date, initials } from '@/lib/format';

export interface IdCardPerson {
  fullName: string;
  employeeCode: string;
  designation: string;
  departmentName?: string | null;
  email?: string | null;
  contactNo?: string | null;
  bloodGroup?: string | null;
  emergencyContact?: string | null;
  joiningDate?: string | null;
  avatarFileId?: string | null;
  /** When the person was registered: the card's issue date. */
  createdAt?: string | null;
}

/** Text that reads well on the accent colour (white on dark, near-black on light). */
function onColor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#0f172a' : '#ffffff';
}

function addYears(d: string, years: number) {
  const x = new Date(`${d.slice(0, 10)}T00:00:00`);
  x.setFullYear(x.getFullYear() + years);
  return x.toISOString().slice(0, 10);
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1 last:border-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-slate-800" title={value}>{value}</span>
    </div>
  );
}

/**
 * The employee ID card (front and back), drawn from the company's template. Always printed on white,
 * whatever the app theme, so downloads look like a real card.
 */
export function IdCard({ person, template: saved, company, className }: { person: IdCardPerson; template?: Partial<IdCardTemplate> | null; company: { name: string; logoFileId?: string | null }; className?: string }) {
  const t = idCardTemplate(saved);
  const fg = onColor(t.accentColor);
  const issued = (person.createdAt ?? person.joiningDate ?? new Date().toISOString()).slice(0, 10);
  const validUntil = t.validityYears ? addYears(issued, t.validityYears) : null;
  const vertical = t.layout === 'VERTICAL';
  const show = (f: IdCardField) => t.fields.includes(f);
  const dims = vertical ? 'w-[300px] h-[476px]' : 'w-[476px] h-[300px]';
  const front = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const render = async (node: HTMLDivElement) => toPng(node, { pixelRatio: 3, cacheBust: true, skipFonts: true, backgroundColor: '#ffffff' });
  const fileBase = `id-card-${person.employeeCode || person.fullName}`.replace(/[^\w-]+/g, '-');

  /** One PDF, two card-sized pages (85.6 × 54 mm, the standard ID card size): front, then back. */
  const download = async () => {
    if (!front.current || !back.current) return;
    setBusy(true);
    try {
      const [f, b] = await Promise.all([render(front.current), render(back.current)]);
      const { jsPDF } = await import('jspdf'); // loaded only when needed
      const [w, h] = vertical ? [54, 85.6] : [85.6, 54];
      const pdf = new jsPDF({ orientation: vertical ? 'portrait' : 'landscape', unit: 'mm', format: [w, h] });
      pdf.setProperties({ title: `${person.fullName} – ID card`, subject: company.name });
      pdf.addImage(f, 'PNG', 0, 0, w, h);
      pdf.addPage([w, h], vertical ? 'portrait' : 'landscape');
      pdf.addImage(b, 'PNG', 0, 0, w, h);
      pdf.save(`${fileBase}.pdf`);
    } catch {
      toast.error('Could not create the PDF. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const print = async () => {
    setBusy(true);
    try {
      const [f, b] = await Promise.all([render(front.current!), render(back.current!)]);
      const w = window.open('', '_blank');
      if (!w) return toast.error('Allow pop-ups for this site to print');
      w.document.title = `${person.fullName} – ID card`;
      w.document.body.style.cssText = 'margin:0;display:flex;gap:24px;justify-content:center;align-items:flex-start;padding:24px;flex-wrap:wrap';
      for (const src of [f, b]) {
        const img = w.document.createElement('img');
        img.src = src;
        img.style.cssText = vertical ? 'width:54mm;height:85.6mm' : 'width:85.6mm;height:54mm';
        w.document.body.appendChild(img);
      }
      setTimeout(() => w.print(), 400);
    } catch {
      toast.error('Could not prepare the card for printing.');
    } finally {
      setBusy(false);
    }
  };

  const logo = company.logoFileId
    ? <AuthImage src={`/api/v1/company/logo/${company.logoFileId}`} alt="" className="h-9 w-9 shrink-0 rounded-md bg-white object-contain p-0.5" fallback={<Initials text={company.name} />} />
    : <Initials text={company.name} />;

  const photo = (
    <div className={cn('relative z-10 shrink-0 overflow-hidden rounded-xl border-4 border-white bg-slate-100 shadow-md', vertical ? 'h-28 w-28' : 'h-28 w-24')}>
      {person.avatarFileId
        ? <AuthImage src={`/api/v1/avatars/${person.avatarFileId}`} alt="" className="h-full w-full object-cover" fallback={<span className="flex h-full w-full items-center justify-center text-2xl font-semibold text-slate-400">{initials(person.fullName)}</span>} />
        : <span className="flex h-full w-full items-center justify-center text-2xl font-semibold text-slate-400">{initials(person.fullName)}</span>}
    </div>
  );

  const details = (
    <div className="w-full text-[11px]">
      {show('department') && <Row label="Department" value={person.departmentName} />}
      {show('email') && <Row label="Email" value={person.email} />}
      {show('phone') && <Row label="Phone" value={person.contactNo} />}
      {show('bloodGroup') && <Row label="Blood group" value={person.bloodGroup} />}
      {show('joiningDate') && <Row label="Joined" value={person.joiningDate ? date(person.joiningDate) : null} />}
    </div>
  );

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap gap-5">
        {/* Front */}
        <div ref={front} className={cn('relative flex flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-xl ring-1 ring-slate-200', dims)}>
          <div className="relative px-4 pt-4 pb-10" style={{ background: `linear-gradient(135deg, ${t.accentColor}, ${t.accentColor}cc)`, color: fg }}>
            <div className="flex items-center gap-2.5">
              {logo}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">{company.name}</p>
                <p className="text-[10px] font-medium tracking-[0.18em] uppercase opacity-80">Employee ID card</p>
              </div>
            </div>
          </div>
          {vertical ? (
            <div className="-mt-8 flex flex-1 flex-col items-center px-5 pb-4 text-center">
              {photo}
              <p className="mt-3 text-lg leading-tight font-semibold">{person.fullName}</p>
              <p className="text-xs text-slate-500">{person.designation}</p>
              <p className="mt-2 rounded-full px-3 py-1 font-mono text-xs font-semibold" style={{ background: `${t.accentColor}14`, color: t.accentColor }}>{person.employeeCode}</p>
              <div className="mt-3 w-full">{details}</div>
            </div>
          ) : (
            <div className="-mt-8 flex flex-1 gap-4 px-4 pb-4">
              {photo}
              <div className="min-w-0 flex-1 pt-9">
                <p className="truncate text-lg leading-tight font-semibold">{person.fullName}</p>
                <p className="truncate text-xs text-slate-500">{person.designation}</p>
                <p className="mt-1.5 inline-block rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold" style={{ background: `${t.accentColor}14`, color: t.accentColor }}>{person.employeeCode}</p>
                <div className="mt-2">{details}</div>
              </div>
            </div>
          )}
          <div className="h-1.5 w-full" style={{ background: t.accentColor }} />
        </div>

        {/* Back */}
        <div ref={back} className={cn('relative flex flex-col overflow-hidden rounded-2xl bg-white p-5 text-[11px] text-slate-700 shadow-xl ring-1 ring-slate-200', dims)}>
          <div className="flex items-center gap-2">
            {logo}
            <p className="truncate text-sm font-semibold text-slate-900">{company.name}</p>
          </div>
          <div className="mt-4 space-y-0.5">
            <Row label="Employee ID" value={person.employeeCode} />
            <Row label="Issued" value={date(issued)} />
            {validUntil && <Row label="Valid until" value={date(validUntil)} />}
            {show('emergencyContact') && <Row label="Emergency contact" value={person.emergencyContact} />}
          </div>
          {t.backText && <p className="mt-4 leading-relaxed text-slate-500">{t.backText}</p>}
          <div className="mt-auto pt-4">
            <div className="h-8 border-b border-slate-400" aria-hidden />
            <p className="mt-1 font-semibold text-slate-900">{t.issuerName || 'Authorised signature'}</p>
            <p className="text-slate-500">{t.issuerTitle ? `${t.issuerTitle}, ` : ''}{company.name}</p>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: t.accentColor }} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={download} loading={busy}><Download className="h-4 w-4" /> Download PDF</Button>
        <Button variant="outline" onClick={print} disabled={busy}><Printer className="h-4 w-4" /> Print</Button>
      </div>
    </div>
  );
}

function Initials({ text }: { text: string }): ReactNode {
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/90 text-xs font-bold text-slate-700">{initials(text)}</span>;
}

/** The signed-in company's template and details, for convenience. */
export function useIdCardContext() {
  const { me } = useAuth();
  return {
    template: (me?.tenant.settings as { idCard?: Partial<IdCardTemplate> } | undefined)?.idCard ?? null,
    company: { name: me?.tenant.name ?? '', logoFileId: me?.tenant.logoFileId ?? null },
  };
}
