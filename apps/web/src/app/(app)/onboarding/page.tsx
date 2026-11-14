'use client';

import { BLOOD_GROUPS, REQUIRED_ONBOARDING_DOCS, phoneProblem, type DocCategory } from '@hrms/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Doc } from '@/components/employee-panels';
import { DocUploadCard } from '@/components/onboarding-docs';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui/display';
import { Field, FormGrid, Input, Select, CnicInput, PhoneInput } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import type { EmployeeDetail } from '../profile/page';
import { todayLocal } from '@/lib/format';

const OPTIONAL_DOCS: DocCategory[] = ['EDUCATION', 'OTHER_ONBOARDING'];

type DetailKey = 'cnic' | 'fatherName' | 'fatherCnic' | 'dateOfBirth' | 'bloodGroup' | 'contactNo' | 'emergencyContact';
const REQUIRED_DETAILS: DetailKey[] = ['cnic', 'emergencyContact'];
const DETAIL_KEYS: DetailKey[] = ['cnic', 'fatherName', 'fatherCnic', 'dateOfBirth', 'bloodGroup', 'contactNo', 'emergencyContact'];

/** B2 – first sign-in: documents plus every personal detail that is still missing. */
export default function OnboardingPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { me, refresh } = useAuth();
  const id = me?.employee?.id;
  const docsKey = id ? `/employees/${id}/documents` : null;
  const { data: docs } = useApi<Doc[]>(docsKey);
  const { data: emp } = useApi<EmployeeDetail>(id ? '/me/profile' : null);
  const [v, setV] = useState<Record<DetailKey, string>>({ cnic: '', fatherName: '', fatherCnic: '', dateOfBirth: '', bloodGroup: '', contactNo: '', emergencyContact: '' });
  const [finishing, setFinishing] = useState(false);

  // Start from what HR already entered, so only the gaps need filling.
  useEffect(() => {
    if (!emp) return;
    setV(Object.fromEntries(DETAIL_KEYS.map((k) => [k, (emp[k as keyof EmployeeDetail] as string | null) ?? ''])) as Record<DetailKey, string>);
  }, [emp]);

  // A document whose file was lost counts as not uploaded, so it can be sent again.
  const have = new Set(docs?.filter((d) => !d.missing).map((d) => d.category));
  const docsDone = REQUIRED_ONBOARDING_DOCS.filter((c) => have.has(c)).length;
  const missing = (k: DetailKey) => !emp?.[k as keyof EmployeeDetail];
  const missingCount = DETAIL_KEYS.filter((k) => missing(k)).length;
  const phoneErr = { contactNo: phoneProblem(v.contactNo), emergencyContact: phoneProblem(v.emergencyContact) };
  const detailsReady = REQUIRED_DETAILS.every((k) => v[k].trim()) && !phoneErr.contactNo && !phoneErr.emergencyContact;
  const ready = REQUIRED_ONBOARDING_DOCS.every((c) => have.has(c)) && detailsReady;
  const set = (k: DetailKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: e.target.value }));

  const label = (text: string, k: DetailKey) => (
    <span className="inline-flex items-center gap-2">
      {text}
      {missing(k) && <Badge tone={REQUIRED_DETAILS.includes(k) ? 'danger' : 'warning'}>{REQUIRED_DETAILS.includes(k) ? 'Required' : 'Missing'}</Badge>}
    </span>
  );

  const finish = async () => {
    setFinishing(true);
    try {
      // Send only what changed; date of birth only if it wasn't on record yet.
      const patch: Record<string, string> = {};
      for (const k of DETAIL_KEYS) {
        const value = v[k].trim();
        const before = (emp?.[k as keyof EmployeeDetail] as string | null) ?? '';
        if (value && value !== before && !(k === 'dateOfBirth' && before)) patch[k] = value;
      }
      if (Object.keys(patch).length) await api.patch('/me/profile', patch);
      await api.post('/me/onboarding/complete');
      await refresh();
      toast.success('Welcome aboard!');
      router.replace('/dashboard');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Welcome, ${me?.employee?.fullName.split(' ')[0] ?? ''}!`} description="Before you start, please upload your documents and complete your details. Documents are submitted once and can only be changed by HR afterwards." />

      <Card className="mb-6">
        <CardHeader title="1. Required documents" description={`${docsDone} of ${REQUIRED_ONBOARDING_DOCS.length} uploaded. Check each file in the preview before uploading.`} />
        <CardBody className="space-y-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={REQUIRED_ONBOARDING_DOCS.length} aria-valuenow={docsDone} aria-label="Documents uploaded">
            <div className="h-full rounded-full bg-success transition-all duration-500" style={{ width: `${(docsDone / REQUIRED_ONBOARDING_DOCS.length) * 100}%` }} />
          </div>
          {REQUIRED_ONBOARDING_DOCS.map((c) => (
            <DocUploadCard key={c} category={c} uploaded={docs?.find((d) => d.category === c && !d.missing)} onUploaded={() => qc.invalidateQueries({ queryKey: [docsKey] })} />
          ))}
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="2. Your details"
          description={missingCount ? `${missingCount} detail${missingCount === 1 ? ' is' : 's are'} still missing. CNIC and emergency contact are required; please fill in the rest too.` : 'Everything is filled in. Check that it is correct.'}
        />
        <CardBody className="space-y-6">
          <div>
            <p className="mb-3 text-sm font-semibold">Identity</p>
            <FormGrid>
              <Field label={label('CNIC number', 'cnic')} required hint="e.g. 35202-1234567-1">{(a) => <CnicInput {...a} value={v.cnic} onChange={set('cnic')} />}</Field>
              <Field label={label('Date of birth', 'dateOfBirth')} hint={emp?.dateOfBirth ? 'On record. Ask HR to change it.' : 'You can enter this once.'}>
                {(a) => <Input {...a} type="date" max={todayLocal()} value={v.dateOfBirth} onChange={set('dateOfBirth')} disabled={!!emp?.dateOfBirth} />}
              </Field>
              <Field label={label("Father's name", 'fatherName')}>{(a) => <Input {...a} value={v.fatherName} onChange={set('fatherName')} autoComplete="off" />}</Field>
              <Field label={label("Father's CNIC", 'fatherCnic')}>{(a) => <CnicInput {...a} value={v.fatherCnic} onChange={set('fatherCnic')} />}</Field>
              <Field label={label('Blood group', 'bloodGroup')}>
                {(a) => (
                  <Select {...a} value={v.bloodGroup} onChange={set('bloodGroup')}>
                    <option value="">Select…</option>
                    {BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}
                  </Select>
                )}
              </Field>
            </FormGrid>
          </div>
          <div className="border-t pt-5">
            <p className="mb-3 text-sm font-semibold">Contact</p>
            <FormGrid>
              <Field label={label('Your phone number', 'contactNo')} error={phoneErr.contactNo ?? undefined}>{(a) => <PhoneInput {...a} value={v.contactNo} onChange={set('contactNo')} />}</Field>
              <Field label={label('Emergency contact number', 'emergencyContact')} required error={phoneErr.emergencyContact ?? undefined} hint="Someone we can call if something happens at work">{(a) => <PhoneInput {...a} value={v.emergencyContact} onChange={set('emergencyContact')} />}</Field>
            </FormGrid>
          </div>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title="3. Additional documents (optional)" description="Education certificates or anything else HR asked for. You can skip this and upload later through HR." />
        <CardBody className="space-y-4">
          {OPTIONAL_DOCS.map((c) => (
            <DocUploadCard key={c} category={c} multiple={c === 'OTHER_ONBOARDING'} uploaded={docs?.find((d) => d.category === c && !d.missing)} uploads={docs?.filter((d) => d.category === c && !d.missing)} onUploaded={() => qc.invalidateQueries({ queryKey: [docsKey] })} />
          ))}
        </CardBody>
      </Card>

      <div className="flex flex-col items-end gap-2">
        {!ready && (
          <p className="text-sm text-muted-foreground">
            {docsDone < REQUIRED_ONBOARDING_DOCS.length ? `Upload ${REQUIRED_ONBOARDING_DOCS.length - docsDone} more required document${REQUIRED_ONBOARDING_DOCS.length - docsDone === 1 ? '' : 's'}` : ''}
            {docsDone < REQUIRED_ONBOARDING_DOCS.length && !detailsReady ? ' and ' : ''}
            {!detailsReady ? (phoneErr.contactNo || phoneErr.emergencyContact ? 'fix the phone numbers marked in red' : 'fill in your CNIC and emergency contact') : ''} to continue.
          </p>
        )}
        <Button size="lg" onClick={finish} loading={finishing} disabled={!ready}>Complete onboarding</Button>
      </div>
    </div>
  );
}
