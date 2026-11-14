'use client';

import { MODULE_INFO, signupSchema, type BillingCycle, type Module } from '@hrms/shared';
import { ArrowLeft, ArrowRight, Check, CreditCard, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { CycleToggle } from '@/components/cycle-toggle';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';
import { Card, CardBody, Skeleton } from '@/components/ui/display';
import { Field, FormGrid, Input, PhoneInput } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';
import { applyServerErrors, fieldError, useZodForm } from '@/lib/form';
import { cn, money } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useSiteName } from '@/lib/branding';

interface PublicPlan { id: string; name: string; description: string | null; priceMonthly: number; priceAnnual: number; currency: string; modules: Module[]; maxEmployees: number | null }

const signupFormSchema = signupSchema.omit({ planId: true, cycle: true });

function SignupInner() {
  const siteName = useSiteName();
  const params = useSearchParams();
  const { data: plans, isLoading } = useApi<PublicPlan[]>('/public/plans');
  const [planId, setPlanId] = useState(params.get('plan') ?? '');
  const [cycle, setCycle] = useState<BillingCycle>(params.get('cycle') === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY');
  const [step, setStep] = useState<1 | 2>(params.get('plan') ? 2 : 1);
  const [error, setError] = useState<string | null>(null);
  // Plan and cycle come from the picker (sent below), not from form fields: validating hidden copies of them
  // used to block "Create account and pay" silently when the page opened without a plan in the link.
  const form = useZodForm(signupFormSchema, { companyName: '', adminName: '', email: '', password: '' } as never);
  useEffect(() => {
    if (!planId && plans?.length) setPlanId(plans[Math.min(1, plans.length - 1)]!.id);
  }, [plans, planId]);
  const plan = plans?.find((p) => p.id === planId);
  const price = plan ? (cycle === 'ANNUAL' ? plan.priceAnnual : plan.priceMonthly) : 0;

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      if (!planId) {
        setStep(1);
        return setError('Choose a plan first.');
      }
      await api.post('/public/signup', { ...v, planId, cycle });
      window.location.href = '/billing';
    } catch (e) {
      if (!applyServerErrors(form, e)) setError(e instanceof ApiError ? e.message : 'Could not create your account');
    }
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Start your company on {siteName}</h1>
        <p className="mt-2 text-muted-foreground">Pick a plan, create your Company Admin account, then pay to activate your workspace.</p>
        <ol className="mt-6 flex items-center justify-center gap-3 text-sm" aria-label="Steps">
          {['Choose plan', 'Your details', 'Payment'].map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold', i + 1 <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{i + 1}</span>
              <span className={cn(i + 1 === step ? 'font-medium' : 'text-muted-foreground')}>{s}</span>
              {i < 2 && <span className="h-px w-6 bg-border" aria-hidden />}
            </li>
          ))}
        </ol>
      </div>

      {step === 1 ? (
        <div className="mt-8">
          <div className="flex justify-center"><CycleToggle value={cycle} onChange={setCycle} /></div>
          {isLoading ? <Skeleton className="mt-6 h-72" /> : (
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {plans?.map((p) => (
                <button key={p.id} type="button" onClick={() => setPlanId(p.id)} aria-pressed={planId === p.id}
                  className={cn('rounded-2xl border bg-card p-5 text-left transition hover:shadow-md', planId === p.id && 'border-primary ring-2 ring-primary')}>
                  <p className="font-semibold">{p.name}</p>
                  {p.description && <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>}
                  <p className="mt-4 text-2xl font-semibold tabular-nums">{money(cycle === 'ANNUAL' ? p.priceAnnual : p.priceMonthly, p.currency)}<span className="text-sm font-normal text-muted-foreground"> / {cycle === 'ANNUAL' ? 'year' : 'month'}</span></p>
                  <p className="text-xs text-muted-foreground">{p.maxEmployees ? `Up to ${p.maxEmployees} employees` : 'Unlimited employees'}</p>
                  <ul className="mt-4 space-y-1.5 text-sm">
                    {p.modules.map((m) => <li key={m} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {MODULE_INFO[m].label}</li>)}
                  </ul>
                </button>
              ))}
            </div>
          )}
          <div className="mt-6 flex justify-end"><Button size="lg" disabled={!planId} onClick={() => setStep(2)}>Continue <ArrowRight className="h-4 w-4" /></Button></div>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardBody>
              <form onSubmit={submit} className="space-y-4" noValidate>
                {error && <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}
                <Field label="Company name" required error={fieldError(form, 'companyName')}>{(a) => <Input {...a} autoComplete="organization" {...form.register('companyName')} />}</Field>
                <FormGrid>
                  <Field label="Your name" required error={fieldError(form, 'adminName')}>{(a) => <Input {...a} autoComplete="name" {...form.register('adminName')} />}</Field>
                  <Field label="Phone" error={fieldError(form, 'phone')}>{(a) => <PhoneInput {...a} value={(form.watch('phone') as string) ?? ''} onChange={(e) => form.setValue('phone', (e.target.value || undefined) as never, { shouldValidate: true })} />}</Field>
                </FormGrid>
                <Field label="Work email" required hint="You'll sign in with this as the Company Admin." error={fieldError(form, 'email')}>{(a) => <Input {...a} type="email" autoComplete="email" {...form.register('email')} />}</Field>
                <Field label="Password" required hint="At least 12 characters with upper and lower case letters and a number." error={fieldError(form, 'password')}>{(a) => <Input {...a} type="password" autoComplete="new-password" {...form.register('password')} />}</Field>
                <div className="flex flex-wrap justify-between gap-2 pt-2">
                  <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4" /> Change plan</Button>
                  <Button type="submit" size="lg" loading={form.formState.isSubmitting}>Create account and pay <ArrowRight className="h-4 w-4" /></Button>
                </div>
              </form>
            </CardBody>
          </Card>
          <aside className="space-y-4">
            <Card>
              <CardBody>
                <p className="text-sm text-muted-foreground">Your plan</p>
                <p className="text-lg font-semibold">{plan?.name}</p>
                <div className="mt-3"><CycleToggle value={cycle} onChange={setCycle} /></div>
                <p className="mt-4 text-3xl font-semibold tabular-nums">{plan ? money(price, plan.currency) : '—'}</p>
                <p className="text-sm text-muted-foreground">per {cycle === 'ANNUAL' ? 'year' : 'month'}</p>
              </CardBody>
            </Card>
            <div className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
              <p className="flex gap-2"><CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Next you'll see how to pay (bank transfer or mobile wallet). Your workspace opens once the payment is confirmed.</p>
              <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Your company's data is kept completely separate from every other company.</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

/** Website sign-up: plan and cycle → Company Admin account → Billing (pay). */
export default function SignupPage() {
  return (
    <PublicShell>
      <Suspense fallback={<Skeleton className="mx-auto mt-10 h-96 max-w-5xl" />}><SignupInner /></Suspense>
    </PublicShell>
  );
}
