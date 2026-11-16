'use client';

import { forgotPasswordSchema } from '@hrms/shared';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { fieldError, useZodForm } from '@/lib/form';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useZodForm(forgotPasswordSchema, { email: '' });
  const onSubmit = form.handleSubmit(async (v) => {
    await api.post('/auth/forgot-password', v).catch(() => undefined);
    setSent(true); // same response either way – no account enumeration
  });

  if (sent) {
    return (
      <div className="text-center">
        <MailCheck className="mx-auto h-10 w-10 text-primary" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">If an account exists for that email, we've sent a link to reset your password. It expires in 60 minutes.</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
      <p className="mt-1 text-sm text-muted-foreground">We'll email you a secure reset link.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        <Field label="Work email" error={fieldError(form, 'email')}>
          {(a) => <Input {...a} type="email" autoComplete="username" {...form.register('email')} />}
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
          Send reset link
        </Button>
      </form>
      <p className="mt-8 text-center text-sm">
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
