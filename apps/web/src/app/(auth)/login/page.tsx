'use client';

import { loginSchema } from '@hrms/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';
import { applyServerErrors, fieldError, useZodForm } from '@/lib/form';
import { SITE } from '@/lib/site';
import { CompanyLogo } from '@/components/brand';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<{ slug: string; name: string }[] | null>(null);
  const form = useZodForm(loginSchema, { email: '', password: '' });
  // Rate limit: seconds until signing in is allowed again (counts down live).
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const signIn = async (values: { email: string; password: string; workspace?: string }) => {
    setError(null);
    try {
      await api.post('/auth/login', values);
      const next = params.get('next');
      // Only allow same-site relative redirects (no open redirect).
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CHOOSE_WORKSPACE') {
        setChoices((e.details?.workspaces as { slug: string; name: string }[]) ?? []);
        return;
      }
      if (e instanceof ApiError && e.code === 'TOO_MANY_REQUESTS') {
        setWait(Number(e.details?.retryAfter) || 60);
        return;
      }
      if (!applyServerErrors(form, e)) setError(e instanceof ApiError ? e.message : 'Could not sign in');
    }
  };
  const onSubmit = form.handleSubmit((v) => signIn(v));

  if (choices) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Choose a company</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your email is used in more than one company. Which one do you want to open?</p>
        <ul className="mt-6 space-y-2">
          {choices.map((c) => (
            <li key={c.slug}>
              <button type="button" disabled={form.formState.isSubmitting} onClick={() => signIn({ ...form.getValues(), workspace: c.slug })}
                className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary-soft/40">
                <CompanyLogo name={c.name} />
                <span className="min-w-0"><span className="block truncate font-medium">{c.name}</span><span className="block text-xs text-muted-foreground">{c.slug}</span></span>
              </button>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
        <button type="button" className="mt-6 text-sm text-primary hover:underline" onClick={() => setChoices(null)}>Back</button>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">Welcome back. Use your work email and password.</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {wait > 0 ? (
          <div role="alert" className="flex items-center gap-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            <span className="font-mono text-lg font-semibold tabular-nums">{Math.floor(wait / 60)}:{String(wait % 60).padStart(2, '0')}</span>
            <span>Too many sign-in attempts from this network. You can try again when the timer ends.</span>
          </div>
        ) : error && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        <Field label="Work email" error={fieldError(form, 'email')}>
          {(a) => <Input {...a} type="email" autoComplete="username" autoFocus {...form.register('email')} />}
        </Field>
        <Field label="Password" error={fieldError(form, 'password')}>
          {(a) => <Input {...a} type="password" autoComplete="current-password" {...form.register('password')} />}
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting} disabled={wait > 0}>
          {wait > 0 ? `Try again in ${wait}s` : 'Sign in'}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New company? <Link href="/signup" className="font-medium text-primary hover:underline">Create your workspace</Link> or <Link href="/demo" className="font-medium text-primary hover:underline">try the demo</Link>.
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
