'use client';

import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  PROFILE_RECORD_SCHEMAS,
  QUALIFICATION_LABELS,
  QUALIFICATION_LEVELS,
  SOCIAL_LABELS,
  SOCIAL_NETWORKS,
  durationLabel,
  formatPhoneDisplay,
  isSafeHttpUrl,
  socialLinksSchema,
  type ProfileRecordKind,
  type SocialLinks,
} from '@hrms/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Award, Briefcase, Facebook, Globe, GraduationCap, Instagram, Link2, Linkedin, Lock, Paperclip, Pencil, Plus, Trash2, Twitter, UserRoundCheck, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, FormGrid, Input, IntlPhoneInput, Select, Textarea } from '@/components/ui/form';
import { Dialog, useConfirm } from '@/components/ui/overlay';
import { FileRow } from '@/components/file-preview';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { useApi } from '@/lib/hooks';

/** An attached document, shown like the Documents list: thumbnail, name and details, preview and download. */
function Attachment({ employeeId, file, detail, onRemove }: { employeeId: string; file: { id: string; name: string; mimeType?: string | null; size?: number | null }; detail?: string; onRemove?: () => void }) {
  const path = `/employees/${employeeId}/record-files/${file.id}`;
  return <FileRow path={path} downloadPath={`${path}?download=1`} name={file.name} mimeType={file.mimeType} size={file.size} detail={detail} onRemove={onRemove} />;
}

type Row = Record<string, unknown> & { id: string; file?: { id: string; name: string; mimeType?: string; size?: number } | null };

export interface ProfileRecords {
  noExperience: boolean;
  educationSubmittedAt: string | null;
  referencesSubmittedAt: string | null;
  canEdit: Record<ProfileRecordKind, boolean>;
  canChange: Record<ProfileRecordKind, boolean>;
  experience: Row[];
  education: Row[];
  certifications: Row[];
  references: (Row & { contactHidden: boolean })[];
}

/* ---------------- Field definitions ---------------- */

type FieldType = 'text' | 'textarea' | 'date' | 'select' | 'checkbox' | 'phone' | 'email' | 'number' | 'url' | 'file';
interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  wide?: boolean;
  hint?: string;
  /** Disabled while this checkbox field is ticked (e.g. completion date while "Currently studying"). */
  disabledBy?: string;
}

const FIELDS: Record<ProfileRecordKind, FieldDef[]> = {
  experience: [
    { key: 'companyName', label: 'Company name', type: 'text', required: true },
    { key: 'designation', label: 'Designation', type: 'text', required: true },
    { key: 'employmentType', label: 'Employment type', type: 'select', required: true, options: EMPLOYMENT_TYPES.map((v) => ({ value: v, label: EMPLOYMENT_TYPE_LABELS[v] })) },
    { key: 'department', label: 'Department', type: 'text' },
    { key: 'startDate', label: 'Start date', type: 'date', required: true },
    { key: 'endDate', label: 'End date', type: 'date', hint: 'Leave empty if you still work there' },
    { key: 'responsibilities', label: 'Key responsibilities', type: 'textarea', required: true, wide: true },
    { key: 'achievements', label: 'Achievements (optional)', type: 'textarea', wide: true },
    { key: 'reasonForLeaving', label: 'Reason for leaving', type: 'text', wide: true },
    { key: 'fileId', label: 'Supporting document (experience letter)', type: 'file', wide: true },
  ],
  education: [
    { key: 'qualificationLevel', label: 'Qualification level', type: 'select', required: true, options: QUALIFICATION_LEVELS.map((v) => ({ value: v, label: QUALIFICATION_LABELS[v] })) },
    { key: 'degreeTitle', label: 'Degree / certificate title', type: 'text', required: true },
    { key: 'fieldOfStudy', label: 'Field of study', type: 'text' },
    { key: 'institution', label: 'Institution', type: 'text', required: true },
    { key: 'board', label: 'Board / university', type: 'text' },
    { key: 'grade', label: 'Grade / CGPA', type: 'text' },
    { key: 'startDate', label: 'Start date', type: 'date', required: true },
    { key: 'completionDate', label: 'Completion date', type: 'date', disabledBy: 'currentlyStudying' },
    { key: 'currentlyStudying', label: 'Currently studying', type: 'checkbox', wide: true },
    { key: 'fileId', label: 'Degree / transcript', type: 'file', wide: true },
  ],
  certifications: [
    { key: 'name', label: 'Certification name', type: 'text', required: true },
    { key: 'issuer', label: 'Issuing organisation', type: 'text', required: true },
    { key: 'issueDate', label: 'Issue date', type: 'date', required: true },
    { key: 'expiryDate', label: 'Expiry date', type: 'date', hint: 'Leave empty if it does not expire' },
    { key: 'credentialId', label: 'Credential ID', type: 'text' },
    { key: 'verificationUrl', label: 'Verification link', type: 'url' },
    { key: 'description', label: 'Description', type: 'textarea', wide: true },
    { key: 'fileId', label: 'Certificate (PDF or image)', type: 'file', wide: true },
  ],
  references: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'designation', label: 'Designation', type: 'text' },
    { key: 'organisation', label: 'Organisation', type: 'text', required: true },
    { key: 'relationship', label: 'Relationship', type: 'text', required: true, hint: 'e.g. Former manager' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone', type: 'phone' },
    { key: 'yearsKnown', label: 'Years known', type: 'number' },
    { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ],
};

const META: Record<ProfileRecordKind, { title: string; icon: typeof Briefcase; addMore: string; empty: string; description: string; fileLabel: string }> = {
  experience: { title: 'Previous work experience', icon: Briefcase, addMore: 'Add More Experience', empty: 'No previous experience recorded.', description: 'Jobs before joining the company.', fileLabel: 'Experience letter' },
  education: { title: 'Education', icon: GraduationCap, addMore: 'Add More Education Details', empty: 'No education details yet.', description: 'Schools, colleges and universities.', fileLabel: 'Degree / transcript' },
  certifications: { title: 'Certifications', icon: Award, addMore: 'Add More Certifications', empty: 'No certifications yet.', description: 'Optional: professional certificates and licences.', fileLabel: 'Certificate' },
  references: { title: 'References', icon: UserRoundCheck, addMore: 'Add More References', empty: 'No references yet.', description: 'Optional: people who can vouch for the work. Contact details are visible to HR only.', fileLabel: 'Document' },
};

const FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

type Draft = Record<string, unknown> & { _key: string; _fileName?: string; _fileType?: string; _fileSize?: number };
const blank = (kind: ProfileRecordKind): Draft => ({ _key: Math.random().toString(36).slice(2), ...(kind === 'education' ? { currentlyStudying: false } : {}) });

/** Form values → API body: empty strings dropped, numbers converted, helper keys removed. */
function toBody(kind: ProfileRecordKind, d: Draft) {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[kind]) {
    const v = d[f.key];
    if (v === '' || v === undefined || v === null) continue;
    if (f.disabledBy && d[f.disabledBy]) continue;
    out[f.key] = f.type === 'number' ? Number(v) : v;
  }
  return out;
}

function validate(kind: ProfileRecordKind, d: Draft): Record<string, string> {
  const r = PROFILE_RECORD_SCHEMAS[kind].safeParse(toBody(kind, d));
  if (r.success) return {};
  const errs: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? '');
    if (k && !errs[k]) errs[k] = i.message;
  }
  return errs;
}

/* ---------------- One form ---------------- */

function RecordForm({ kind, employeeId, value, onChange, errors }: { kind: ProfileRecordKind; employeeId: string; value: Draft; onChange: (d: Draft) => void; errors: Record<string, string> }) {
  const [uploading, setUploading] = useState(false);
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  const upload = async (f: File) => {
    if (!FILE_TYPES.includes(f.type)) return toast.error('Attach a PDF, PNG, JPG or WebP file');
    if (f.size > 10 * 1024 * 1024) return toast.error('The file is larger than 10 MB');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set('file', f);
      const r = await api.post<{ fileId: string; name: string; mimeType: string; size: number }>(`/employees/${employeeId}/record-files`, fd);
      onChange({ ...value, fileId: r.fileId, _fileName: r.name, _fileType: r.mimeType, _fileSize: r.size });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const s = (k: string) => (value[k] == null ? '' : String(value[k]));
  return (
    <FormGrid>
      {FIELDS[kind].map((f) => {
        const disabled = !!(f.disabledBy && value[f.disabledBy]);
        const wrap = (node: ReactNode) => <div key={f.key} className={f.wide ? 'sm:col-span-2' : undefined}>{node}</div>;
        if (f.type === 'checkbox') return wrap(<Checkbox label={f.label} checked={!!value[f.key]} onChange={(e) => set(f.key, e.target.checked)} />);
        if (f.type === 'file') {
          return wrap(
            <Field label={f.label} hint="PDF, PNG, JPG or WebP, up to 10 MB" error={errors[f.key]}>
              {(a) => (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-muted">
                    <Paperclip className="h-4 w-4" aria-hidden /> {uploading ? 'Uploading…' : value.fileId ? 'Replace file' : 'Choose file'}
                    <input {...a} type="file" className="sr-only" accept={FILE_TYPES.join(',')} disabled={uploading} onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) void upload(x); }} />
                  </label>
                  {!!value.fileId && (
                    <Attachment employeeId={employeeId} file={{ id: String(value.fileId), name: value._fileName ?? 'Attached document', mimeType: value._fileType, size: value._fileSize }} detail="Not submitted yet" onRemove={() => onChange({ ...value, fileId: null, _fileName: undefined, _fileType: undefined, _fileSize: undefined })} />
                  )}
                </div>
              )}
            </Field>,
          );
        }
        return wrap(
          <Field label={f.label} required={f.required} hint={f.hint} error={errors[f.key]}>
            {(a) =>
              f.type === 'textarea' ? <Textarea {...a} rows={3} value={s(f.key)} onChange={(e) => set(f.key, e.target.value)} />
              : f.type === 'select' ? (
                <Select {...a} value={s(f.key)} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">Select…</option>
                  {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              )
              : f.type === 'phone' ? <IntlPhoneInput {...a} value={s(f.key)} onChange={(v) => set(f.key, v)} />
              : <Input {...a} disabled={disabled} type={f.type === 'url' ? 'url' : f.type} min={f.type === 'number' ? 0 : undefined} value={disabled ? '' : s(f.key)} onChange={(e) => set(f.key, e.target.value)} placeholder={f.type === 'url' ? 'https://' : undefined} />
            }
          </Field>,
        );
      })}
      {kind === 'experience' && !!value.startDate && (
        <p className="text-sm text-muted-foreground sm:col-span-2">Duration: <strong className="text-foreground">{durationLabel(String(value.startDate), value.endDate ? String(value.endDate) : null) || '—'}</strong></p>
      )}
    </FormGrid>
  );
}

/* ---------------- Viewing a saved record ---------------- */

function summary(kind: ProfileRecordKind, r: Row): { title: string; sub: string; lines: [string, ReactNode][] } {
  const d = (x: unknown) => (x ? date(String(x)) : null);
  switch (kind) {
    case 'experience':
      return {
        title: `${r.designation} · ${r.companyName}`,
        sub: `${EMPLOYMENT_TYPE_LABELS[r.employmentType as keyof typeof EMPLOYMENT_TYPE_LABELS] ?? r.employmentType}${r.department ? ` · ${r.department}` : ''} · ${d(r.startDate)} – ${d(r.endDate) ?? 'Present'} (${r.duration ?? durationLabel(String(r.startDate), r.endDate as string | null)})`,
        lines: [['Responsibilities', r.responsibilities as string], ['Achievements', r.achievements as string], ['Reason for leaving', r.reasonForLeaving as string]],
      };
    case 'education':
      return {
        title: `${r.degreeTitle}${r.fieldOfStudy ? ` (${r.fieldOfStudy})` : ''}`,
        sub: `${QUALIFICATION_LABELS[r.qualificationLevel as keyof typeof QUALIFICATION_LABELS] ?? r.qualificationLevel} · ${r.institution}${r.board ? ` · ${r.board}` : ''} · ${d(r.startDate)} – ${r.currentlyStudying ? 'Currently studying' : (d(r.completionDate) ?? '')}`,
        lines: [['Grade / CGPA', r.grade as string]],
      };
    case 'certifications':
      return {
        title: String(r.name),
        sub: `${r.issuer} · issued ${d(r.issueDate)}${r.expiryDate ? ` · expires ${d(r.expiryDate)}` : ''}`,
        lines: [
          ['Credential ID', r.credentialId as string],
          ['Verify', isSafeHttpUrl(r.verificationUrl as string) ? <a href={String(r.verificationUrl)} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">{String(r.verificationUrl)}</a> : null],
          ['Description', r.description as string],
        ],
      };
    case 'references':
      return {
        title: String(r.name),
        sub: [r.designation, r.organisation, r.relationship].filter(Boolean).join(' · ') + (r.yearsKnown != null ? ` · known ${r.yearsKnown} yr${r.yearsKnown === 1 ? '' : 's'}` : ''),
        lines: r.contactHidden
          ? [['Contact', <span key="h" className="inline-flex items-center gap-1 text-muted-foreground"><Lock className="h-3 w-3" aria-hidden /> Visible to HR only</span>]]
          : [['Email', r.email ? <a href={`mailto:${r.email}`} className="text-primary hover:underline">{String(r.email)}</a> : null], ['Phone', r.phone ? formatPhoneDisplay(String(r.phone)) : null], ['Notes', r.notes as string]],
      };
  }
}

function toDraft(kind: ProfileRecordKind, r: Row): Draft {
  const d: Draft = { _key: r.id, _fileName: r.file?.name, _fileType: r.file?.mimeType, _fileSize: r.file?.size };
  for (const f of FIELDS[kind]) d[f.key] = r[f.key] ?? (f.type === 'checkbox' ? false : '');
  return d;
}

/* ---------------- A section (one kind) ---------------- */

function RecordSection({ kind, employeeId, data, self, hr }: { kind: ProfileRecordKind; employeeId: string; data: ProfileRecords; self: boolean; hr: boolean }) {
  const qc = useQueryClient();
  const rows = data[kind] as Row[];
  const meta = META[kind];
  const canAdd = data.canEdit[kind] && !(kind === 'experience' && data.noExperience);
  const canChange = data.canChange[kind];
  // One form open by default when nothing is recorded yet; "Add more" appends independent forms.
  const [drafts, setDrafts] = useState<Draft[]>(() => (rows.length ? [] : [blank(kind)]));
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const { confirm, node: confirmNode } = useConfirm();
  // Employees can't change an entry after submitting it; education and references can only be submitted once.
  const lockAfterSubmit = !hr && self;
  const submitOnce = lockAfterSubmit && (kind === 'education' || kind === 'references');
  const refresh = () => qc.invalidateQueries({ queryKey: [`/employees/${employeeId}/records`] });

  const save = async () => {
    const errs = Object.fromEntries(drafts.map((d) => [d._key, validate(kind, d)]));
    setErrors(errs);
    if (Object.values(errs).some((e) => Object.keys(e).length)) return toast.error('Please fix the fields marked in red');
    if (lockAfterSubmit && !(await confirm({
      title: `Submit your ${meta.title.toLowerCase()}?`,
      body: submitOnce
        ? 'You can submit these once. Check every entry and document first: afterwards only HR can change or remove them.'
        : 'Check every entry and document first (use Preview). After submitting, only HR can change or remove these entries; you can still add new ones.',
      confirmLabel: 'Submit',
    }))) return;
    setSaving(true);
    try {
      await api.post(`/employees/${employeeId}/records/${kind}`, { items: drafts.map((d) => toBody(kind, d)) });
      toast.success(drafts.length > 1 ? `${drafts.length} entries saved` : 'Saved');
      setDrafts([]);
      setErrors({});
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const errs = validate(kind, editing);
    setEditErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await api.patch(`/employees/${employeeId}/records/${kind}/${editing._key}`, toBody(kind, editing));
      toast.success('Updated');
      setEditing(null);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (r: Row) => {
    if (!(await confirm({ title: 'Delete this entry?', body: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.del(`/employees/${employeeId}/records/${kind}/${r.id}`);
      toast.success('Deleted');
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const toggleNoExperience = async (on: boolean) => {
    try {
      if (hr && !self) await api.patch(`/employees/${employeeId}`, { noExperience: on });
      else await api.patch('/me/profile', { noExperience: on });
      if (on) setDrafts([]);
      else if (!rows.length) setDrafts([blank(kind)]);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const lockedNote =
    !hr && (kind === 'education' || kind === 'references') && (kind === 'education' ? data.educationSubmittedAt : data.referencesSubmittedAt)
      ? `Submitted ${date(kind === 'education' ? data.educationSubmittedAt : data.referencesSubmittedAt)}. Only HR can change these now.`
      : null;

  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><meta.icon className="h-4 w-4 text-primary" aria-hidden /> {meta.title}</span>}
        description={lockedNote ?? meta.description}
        action={lockedNote ? <Badge tone="neutral"><Lock className="mr-1 inline h-3 w-3" aria-hidden />Read-only</Badge> : undefined}
      />
      <CardBody className="space-y-4">
        {kind === 'experience' && (data.canEdit.experience || data.noExperience) && (
          <Checkbox
            label="No previous experience"
            checked={data.noExperience}
            disabled={!data.canEdit.experience || (!data.noExperience && rows.length > 0)}
            title={!data.noExperience && rows.length > 0 ? 'Delete the entries below first' : undefined}
            onChange={(e) => void toggleNoExperience(e.target.checked)}
          />
        )}
        {kind === 'experience' && data.noExperience && <p className="text-sm text-muted-foreground">Marked as having no previous work experience.</p>}

        {rows.length === 0 && drafts.length === 0 && !(kind === 'experience' && data.noExperience) && <EmptyState icon={meta.icon} title={meta.empty} />}
        {rows.map((r) => {
          const x = summary(kind, r);
          return (
            <div key={r.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{x.title}</p>
                  <p className="text-sm text-muted-foreground">{x.sub}</p>
                </div>
                {canChange && (
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" aria-label="Edit entry" onClick={() => { setEditErrors({}); setEditing(toDraft(kind, r)); }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Delete entry" className="text-danger" onClick={() => void remove(r)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                )}
              </div>
              <dl className="mt-2 space-y-1 text-sm">
                {x.lines.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
                  <div key={k} className="grid gap-1 sm:grid-cols-[10rem_1fr]"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words whitespace-pre-line">{v}</dd></div>
                ))}
              </dl>
              {r.file && <div className="mt-3"><Attachment employeeId={employeeId} file={r.file} detail={META[kind].fileLabel} /></div>}
            </div>
          );
        })}

        {canAdd && drafts.map((d, i) => (
          <div key={d._key} className="rounded-lg border border-dashed bg-muted/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium">New entry {drafts.length > 1 ? i + 1 : ''}</p>
              {(drafts.length > 1 || rows.length > 0) && (
                <Button size="sm" variant="ghost" onClick={() => setDrafts((x) => x.filter((y) => y._key !== d._key))}><X className="h-3.5 w-3.5" /> Remove</Button>
              )}
            </div>
            <RecordForm kind={kind} employeeId={employeeId} value={d} errors={errors[d._key] ?? {}} onChange={(nd) => setDrafts((x) => x.map((y) => (y._key === d._key ? nd : y)))} />
          </div>
        ))}
        {canAdd && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setDrafts((x) => [...x, blank(kind)])}><Plus className="h-4 w-4" /> {meta.addMore}</Button>
            {drafts.length > 0 && <Button size="sm" loading={saving} onClick={() => void save()}>{lockAfterSubmit ? 'Submit' : 'Save'}{drafts.length > 1 ? ` ${drafts.length} entries` : ''}</Button>}
          </div>
        )}
        {lockAfterSubmit && canAdd && <p className="text-xs text-muted-foreground">{submitOnce ? 'You can submit these once. Add every entry before submitting; afterwards only HR can change them.' : 'Check each entry and its document (Preview) before submitting. After that, only HR can change or remove it.'}</p>}
        {lockAfterSubmit && rows.length > 0 && !lockedNote && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" aria-hidden /> Submitted entries are read-only. Ask HR if something needs to change.</p>}
      </CardBody>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={`Edit ${meta.title.toLowerCase()}`} size="lg"
        footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => void saveEdit()}>Save</Button></>}>
        {editing && <RecordForm kind={kind} employeeId={employeeId} value={editing} errors={editErrors} onChange={setEditing} />}
      </Dialog>
      {confirmNode}
    </Card>
  );
}

/** Experience, education, certifications and references for one employee (profile and HR view). */
export function useProfileRecords(employeeId: string) {
  return useApi<ProfileRecords>(`/employees/${employeeId}/records`);
}

export function RecordsPanel({ kind, employeeId, self, hr }: { kind: ProfileRecordKind; employeeId: string; self: boolean; hr: boolean }) {
  const { data, isLoading, error } = useProfileRecords(employeeId);
  if (error) return <p className="text-sm text-danger">{error.message}</p>;
  if (isLoading || !data) return <Skeleton className="h-40" />;
  return <RecordSection kind={kind} employeeId={employeeId} data={data} self={self} hr={hr} />;
}

/* ---------------- Social links ---------------- */

const SOCIAL_ICONS = { linkedin: Linkedin, instagram: Instagram, x: Twitter, facebook: Facebook, website: Globe } as const;

/** Safe clickable icons: only http(s) links, opened with noopener/noreferrer. */
export function SocialLinkIcons({ links }: { links: SocialLinks | null | undefined }) {
  const items = [
    ...SOCIAL_NETWORKS.filter((n) => isSafeHttpUrl(links?.[n])).map((n) => ({ key: n, label: SOCIAL_LABELS[n], url: links![n]!, Icon: SOCIAL_ICONS[n] })),
    ...(links?.custom ?? []).filter((c) => isSafeHttpUrl(c.url)).map((c, i) => ({ key: `c${i}`, label: c.label, url: c.url, Icon: Link2 })),
  ];
  if (!items.length) return <p className="text-sm text-muted-foreground">No social links added.</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map(({ key, label, url, Icon }) => (
        <li key={key}>
          <a href={url} target="_blank" rel="noopener noreferrer" title={`${label}: ${url}`} aria-label={label} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm hover:border-primary/40 hover:text-primary">
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Edit social links; `save` sends the cleaned links (PATCH /me/profile or /employees/:id). */
export function SocialLinksCard({ links, editable, save }: { links: SocialLinks | null | undefined; editable: boolean; save: (links: SocialLinks) => Promise<unknown> }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<{ label: string; url: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const start = () => {
    setV(Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, links?.[n] ?? ''])));
    setCustom(links?.custom ?? []);
    setErrors({});
    setEdit(true);
  };
  const submit = async () => {
    const r = socialLinksSchema.safeParse({ ...v, custom: custom.filter((c) => c.label || c.url) });
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setBusy(true);
    try {
      await save(r.data as SocialLinks);
      toast.success('Social links saved');
      setEdit(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Social links" description="Optional. Shown as links on the profile." action={editable && !edit ? <Button size="sm" variant="outline" onClick={start}><Pencil className="h-3.5 w-3.5" /> Edit</Button> : undefined} />
      <CardBody>
        {!edit ? <SocialLinkIcons links={links} /> : (
          <div className="space-y-4">
            <FormGrid>
              {SOCIAL_NETWORKS.map((n) => (
                <Field key={n} label={SOCIAL_LABELS[n]} error={errors[n]}>{(a) => <Input {...a} type="url" placeholder="https://" value={v[n] ?? ''} onChange={(e) => setV((x) => ({ ...x, [n]: e.target.value }))} />}</Field>
              ))}
            </FormGrid>
            <div className="space-y-2">
              <p className="text-sm font-medium">Custom links</p>
              {custom.map((c, i) => (
                <div key={i} className="flex flex-wrap items-start gap-2">
                  <Input aria-label="Link name" className="w-40" placeholder="Name, e.g. GitHub" value={c.label} onChange={(e) => setCustom((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
                  <div className="min-w-0 flex-1">
                    <Input aria-label="Link address" type="url" placeholder="https://" value={c.url} aria-invalid={!!errors[`custom.${i}.url`]} onChange={(e) => setCustom((x) => x.map((y, j) => (j === i ? { ...y, url: e.target.value } : y)))} />
                    {(errors[`custom.${i}.url`] || errors[`custom.${i}.label`]) && <p className="mt-1 text-xs text-danger">{errors[`custom.${i}.url`] ?? errors[`custom.${i}.label`]}</p>}
                  </div>
                  <Button size="icon" variant="ghost" aria-label="Remove link" onClick={() => setCustom((x) => x.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
                </div>
              ))}
              {custom.length < 5 && <Button size="sm" variant="ghost" onClick={() => setCustom((x) => [...x, { label: '', url: '' }])}><Plus className="h-3.5 w-3.5" /> Add custom link</Button>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEdit(false)}>Cancel</Button>
              <Button loading={busy} onClick={() => void submit()}>Save links</Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
