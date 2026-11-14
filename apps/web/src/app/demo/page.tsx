'use client';

import { demoRequestSchema } from '@hrms/shared';
import { ArrowRight, Eye, Lock, Sparkles } from 'lucide-react';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/display';
import { Field, Input, PhoneInput } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';
import { fieldError, useZodForm } from '@/lib/form';
import { useState } from 'react';
import { useSiteName } from '@/lib/branding';

/** "Try the demo": a few details first (so we can follow up), then a read-only tour of a sample company. */
export default function DemoPage() {
  const siteName = useSiteName();
  const form = useZodForm(demoRequestSchema, { name: '', email: '', company: '' } as never);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    setNotice(null);
    try {
      await api.post('/public/demo', v);
      window.location.href = '/dashboard';
    } catch (e) {
      // Demo company not set up yet: the details were still saved, so thank them instead of showing an error.
      if (e instanceof ApiError && e.code === 'DEMO_UNAVAILABLE') return setNotice(e.message);
      setError(e instanceof ApiError ? e.message : 'Could not open the demo');
    }
  });
  return (
    <PublicShell>
      <div className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary"><Sparkles className="h-3.5 w-3.5" /> Live demo</span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">See {siteName} with a real sample company</h1>
          <p className="mt-3 text-muted-foreground">Explore attendance, leave, payroll, KPIs and more as a Company Admin. Tell us who you are and you'll be inside in a second.</p>
          <ul className="mt-6 space-y-3 text-sm">
            <li className="flex gap-3"><Eye className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> Every screen, filled with sample data.</li>
            <li className="flex gap-3"><Lock className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> Read-only: nothing you click can change or break anything.</li>
            <li className="flex gap-3"><ArrowRight className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> Ready for your own company? Sign up from inside the demo.</li>
          </ul>
        </div>
        <Card>
          <CardBody>
            <form onSubmit={submit} className="space-y-4" noValidate>
              {notice && <div role="status" className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">{notice}</div>}
              {error && <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}
              <Field label="Your name" required error={fieldError(form, 'name')}>{(a) => <Input {...a} autoComplete="name" {...form.register('name')} />}</Field>
              <Field label="Work email" required error={fieldError(form, 'email')}>{(a) => <Input {...a} type="email" autoComplete="email" {...form.register('email')} />}</Field>
              <Field label="Company" required error={fieldError(form, 'company')}>{(a) => <Input {...a} autoComplete="organization" {...form.register('company')} />}</Field>
              <Field label="Phone" error={fieldError(form, 'phone')}>{(a) => <PhoneInput {...a} value={(form.watch('phone') as string) ?? ''} onChange={(e) => form.setValue('phone', (e.target.value || undefined) as never, { shouldValidate: true })} />}</Field>
              <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>Open the demo <ArrowRight className="h-4 w-4" /></Button>
              <p className="text-center text-xs text-muted-foreground">We'll only use these details to follow up about {siteName}.</p>
            </form>
          </CardBody>
        </Card>
      </div>
    </PublicShell>
  );
}
