import { CalendarCheck2, ShieldCheck, Wallet } from 'lucide-react';
import { BrandLogo } from '@/components/brand';
import type { ReactNode } from 'react';
import { SiteCopyright } from '@/components/site-copyright';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:h-dvh lg:grid-cols-[1.1fr_1fr] lg:overflow-hidden">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-blue-700 via-blue-800 to-indigo-900 p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-12">
        <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <BrandLogo inverted size="lg" className="relative" />
        <div className="relative max-w-md">
          <h2 className="text-3xl leading-tight font-semibold">Your whole team, from first day to payday.</h2>
          <p className="mt-3 text-blue-100">Attendance, leave, payroll, performance and policies in one secure workspace.</p>
          <ul className="mt-8 space-y-4 text-sm text-blue-50">
            <li className="flex gap-3"><CalendarCheck2 className="h-5 w-5 text-blue-200" aria-hidden /> Biometric attendance with Team Lead → HR approvals</li>
            <li className="flex gap-3"><Wallet className="h-5 w-5 text-blue-200" aria-hidden /> Working-hours payroll with PDF salary slips</li>
            <li className="flex gap-3"><ShieldCheck className="h-5 w-5 text-blue-200" aria-hidden /> Role-based access, audit trail and anonymous complaints</li>
          </ul>
        </div>
        <SiteCopyright className="relative text-xs text-blue-200" />
      </section>
      <section className="flex items-center justify-center overflow-y-auto p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <BrandLogo className="mb-6 lg:hidden" />
          {children}
        </div>
      </section>
    </div>
  );
}
