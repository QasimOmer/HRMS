'use client';

import { MODULE_INFO, MODULES, type Module } from '@hrms/shared';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  ArrowRight, BarChart3, Bell, Building2, CalendarCheck2, CalendarDays, Check, CheckCircle2, ChevronDown, Clock, FileLock2, FileText,
  Fingerprint, KeyRound, LogIn, Megaphone, Menu, PlayCircle, ScrollText, ShieldCheck, Smartphone, Sparkles, Target, UserPlus, Users, Wallet, X, type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';
import type { BillingCycle } from '@hrms/shared';
import { CycleToggle } from '@/components/cycle-toggle';
import { BrandLogo } from '@/components/brand';
import { SiteCopyright } from '@/components/site-copyright';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn, money } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { SITE } from '@/lib/site';
import { useSiteName } from '@/lib/branding';

gsap.registerPlugin(ScrollTrigger);

interface PublicPlan { id: string; name: string; description: string | null; priceMonthly: number; priceAnnual: number; currency: string; modules: Module[]; maxEmployees: number | null }

const MODULE_ICONS: Record<Module, LucideIcon> = {
  ATTENDANCE: CalendarCheck2,
  LEAVE: CalendarDays,
  PAYROLL: Wallet,
  PERFORMANCE: Target,
  COMPLIANCE: ScrollText,
  COMMUNITY: Megaphone,
  BIOMETRIC: Fingerprint,
};

const CAPABILITIES = [
  'Biometric device sync', 'Overtime & late tracking', 'Leave balances', 'PDF salary slips', 'Loans & medical claims', 'KPI targets',
  'Anonymous complaints', 'Company announcements', 'Team Lead → HR approvals', 'Audit trail', 'Works on any phone', 'Light & dark mode',
];

const STEPS = [
  { icon: Building2, title: 'We set up your workspace', body: 'Your company gets its own private workspace, email domain and Company Admin account.' },
  { icon: UserPlus, title: 'Add your people', body: 'Departments, levels, salaries and teams. Invite employees or connect your biometric devices.' },
  { icon: BarChart3, title: 'Run HR on autopilot', body: 'Attendance, approvals and payroll flow through automatically, with salary slips at month end.' },
];

const ROLES: { key: string; label: string; icon: LucideIcon; headline: string; points: string[] }[] = [
  { key: 'admin', label: 'Company Admin', icon: ShieldCheck, headline: 'The whole company at a glance', points: ['Every permission HR and Operations have', 'Roles, access and audit trail', 'Company settings, logo and email domain', 'Delete records when you really need to'] },
  { key: 'hr', label: 'HR', icon: Users, headline: 'People operations without spreadsheets', points: ['Hire, promote, terminate and reactivate', 'Correct attendance directly', 'Approve leave, overtime and claims', 'Run payroll and publish salary slips'] },
  { key: 'lead', label: 'Team Lead', icon: Target, headline: 'Your team, nothing more', points: ['See your team’s attendance live', 'First approval on leave and corrections', 'Set and review KPI targets', 'Answer queries from your team'] },
  { key: 'employee', label: 'Employee', icon: Smartphone, headline: 'Self-service from any phone', points: ['Check-ins, hours and overtime', 'Apply for leave and see balances', 'Download salary slips', 'Raise complaints anonymously'] },
];

const SECURITY = [
  { icon: Building2, title: 'Every company fully separated', body: 'Each company’s data is walled off in the database itself, not just in the app.' },
  { icon: KeyRound, title: 'Role-based access', body: 'Company Admin, HR, Team Lead and Employee see only what their role allows.' },
  { icon: FileLock2, title: 'Encrypted sensitive fields', body: 'CNICs, salaries and complaints are encrypted at rest.' },
  { icon: ShieldCheck, title: 'Full audit trail', body: 'Every important change is recorded: who, what and when.' },
];

const STATS = [
  { value: 7, suffix: '', label: 'modules in one workspace' },
  { value: 4, suffix: '', label: 'roles with their own view' },
  { value: 100, suffix: '%', label: 'company data separation' },
  { value: 24, suffix: '/7', label: 'access from any device' },
];

const FAQ = [
  ['How do we get started?', 'We create your company workspace with its own email domain and a Company Admin account. You add departments and employees, and you are live the same day.'],
  ['Can we use our biometric devices?', 'Yes. ZKTeco and Hikvision devices push punches straight into attendance. Unknown device users are held until HR links them.'],
  ['Can other companies see our data?', 'No. Each company is isolated in the database itself, so one company can never read or change another’s records.'],
  ['What happens when someone leaves?', 'Terminate them and their login stops at once. All their records are kept, and you can reactivate them later or delete them for good.'],
  ['Can we change plans later?', 'Yes. Moving to another plan switches the modules on or off right away. Your data stays where it is.'],
] as const;

/** Card that lights up under the pointer (see `.spotlight` in globals.css; the page tracks the pointer). */
function Spotlight({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('spotlight group rounded-2xl border bg-card shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg', className)} {...rest}>
      {children}
    </div>
  );
}

/** One listener for the whole page: feeds the pointer position to the `.spotlight` element under it. */
function trackSpotlight(e: React.PointerEvent) {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.spotlight');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div data-anim="reveal" className="mx-auto max-w-2xl text-center">
      <p className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">{eyebrow}</p>
      <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-pretty text-muted-foreground">{body}</p>}
    </div>
  );
}

function Header() {
  const siteName = useSiteName();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const links = [['#features', 'Features'], ['#roles', 'For your team'], ['#security', 'Security'], ['#pricing', 'Pricing'], ['#faq', 'FAQ'], ['/demo', 'Live demo']] as const;
  return (
    <header className={cn('sticky top-0 z-40 transition-all duration-300', scrolled ? 'border-b border-border/60 bg-background/80 shadow-sm backdrop-blur-md' : 'border-b border-transparent bg-transparent')}>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" aria-label={`${siteName} home`}><BrandLogo /></Link>
        <nav className="ml-6 hidden items-center gap-1 text-sm text-muted-foreground lg:flex" aria-label="Main">
          {links.map(([href, label]) => <a key={href} href={href} className="rounded-md px-3 py-1.5 transition-colors hover:bg-muted hover:text-foreground">{label}</a>)}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <Link href="/login" className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/30 transition hover:shadow-md hover:shadow-primary/40">
            <LogIn className="h-4 w-4" aria-hidden /> Sign in
          </Link>
          <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted lg:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t bg-background px-4 py-2 lg:hidden" aria-label="Main">
          {links.map(([href, label]) => <a key={href} href={href} onClick={() => setOpen(false)} className="block rounded-md px-2 py-2.5 text-sm hover:bg-muted">{label}</a>)}
        </nav>
      )}
    </header>
  );
}

/** Illustrative product preview built from UI pieces (no screenshots needed). */
function HeroPreview() {
  const bars = [62, 80, 74, 90, 86, 95, 70];
  return (
    <div className="relative mx-auto w-full max-w-lg [perspective:1200px]" data-anim="preview">
      <div className="absolute -inset-8 rounded-[2.5rem] bg-gradient-to-tr from-primary/30 via-indigo-500/20 to-fuchsia-500/10 blur-3xl" aria-hidden />
      <div data-anim="tilt" className="spotlight relative rounded-2xl border bg-card/95 p-5 shadow-2xl shadow-primary/10 backdrop-blur [transform-style:preserve-3d]">
        <div className="mb-4 flex items-center gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-danger/70" /><span className="h-2.5 w-2.5 rounded-full bg-warning/70" /><span className="h-2.5 w-2.5 rounded-full bg-success/70" />
          <span className="ml-3 h-5 flex-1 rounded-md bg-muted" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[['Present', 94, '%'], ['On leave', 6, ''], ['Overtime', 38, 'h']].map(([l, v, s]) => (
            <div key={l as string} className="spotlight rounded-xl border bg-background/60 p-3">
              <p className="text-[11px] text-muted-foreground">{l}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums"><span data-count={v}>{v}</span>{s}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border bg-background/60 p-3">
          <div className="flex items-center justify-between text-xs"><span className="font-medium">Attendance this week</span><span className="rounded-full bg-success-soft px-2 py-0.5 font-medium text-success">+3%</span></div>
          <div className="mt-3 flex h-24 items-end gap-2" aria-hidden>
            {bars.map((h, i) => <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-primary/70 to-primary" style={{ height: `${h}%` }} data-anim="bar" />)}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {[['Leave request · Ayesha', 'Approved'], ['Overtime · Sara', 'Pending']].map(([t, s]) => (
            <div key={t} className="flex items-center justify-between rounded-lg border bg-background/60 px-3 py-2 text-sm">
              <span className="truncate">{t}</span>
              <span className={cn('ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', s === 'Approved' ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>{s}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="absolute top-10 -left-6 spotlight hidden items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm shadow-lg sm:flex" data-anim="float">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft"><Fingerprint className="h-4 w-4 text-primary" aria-hidden /></span> 128 punches synced
      </div>
      <div className="absolute -right-5 bottom-24 spotlight hidden items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm shadow-lg sm:flex" data-anim="float">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-success-soft"><FileText className="h-4 w-4 text-success" aria-hidden /></span> 42 salary slips ready
      </div>
      <div className="absolute -bottom-6 left-10 spotlight hidden items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm shadow-lg sm:flex" data-anim="float">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-warning-soft"><Bell className="h-4 w-4 text-warning" aria-hidden /></span> 3 approvals waiting
      </div>
    </div>
  );
}

function Marquee() {
  const row = [...CAPABILITIES, ...CAPABILITIES];
  return (
    <div className="relative overflow-hidden border-y bg-muted/30 py-4 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]" aria-label="Capabilities">
      <ul data-anim="marquee" className="flex w-max gap-3">
        {row.map((c, i) => (
          <li key={i} aria-hidden={i >= CAPABILITIES.length} className="spotlight flex shrink-0 items-center gap-2 rounded-full border bg-card px-4 py-1.5 text-sm text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden /> {c}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Features() {
  const [first, ...rest] = MODULES;
  const FirstIcon = MODULE_ICONS[first];
  return (
    <section id="features" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="Everything HR needs" title="One platform, every part of the employee journey" body="Pick the modules each company needs. Everything shares the same people, roles and approvals." />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Spotlight data-anim="card" className="p-6 sm:col-span-2 lg:row-span-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/30"><FirstIcon className="h-5 w-5" aria-hidden /></div>
            <h3 className="mt-4 text-lg font-semibold">{MODULE_INFO[first].label}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{MODULE_INFO[first].description} Device punches, manual entries and corrections all land in one place.</p>
            <div className="mt-6 space-y-2.5" aria-hidden>
              {[['Check-in', '09:02', 'On time', 'success'], ['Lunch break', '13:00 – 13:45', '45 min', 'info'], ['Check-out', '18:31', '+31 min overtime', 'primary']].map(([a, b, c, tone]) => (
                <div key={a} className="spotlight flex items-center gap-3 rounded-xl border bg-background/60 px-3 py-2.5 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{a}</span>
                  <span className="text-muted-foreground tabular-nums">{b}</span>
                  <span className={cn('ml-auto rounded-full px-2 py-0.5 text-xs font-medium', tone === 'success' && 'bg-success-soft text-success', tone === 'info' && 'bg-muted text-muted-foreground', tone === 'primary' && 'bg-primary-soft text-primary')}>{c}</span>
                </div>
              ))}
            </div>
          </Spotlight>
          {rest.map((m) => {
            const Icon = MODULE_ICONS[m];
            return (
              <Spotlight key={m} data-anim="card" className="p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary transition duration-300 group-hover:scale-110 group-hover:rotate-3"><Icon className="h-5 w-5" aria-hidden /></div>
                <h3 className="mt-4 font-semibold">{MODULE_INFO[m].label}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{MODULE_INFO[m].description}</p>
              </Spotlight>
            );
          })}
          <Spotlight data-anim="card" className="border-dashed bg-card/60 p-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground"><CheckCircle2 className="h-5 w-5" aria-hidden /></div>
            <h3 className="mt-4 font-semibold">Approvals that move</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">Team Lead → HR workflows with notifications, so nothing waits in an inbox.</p>
          </Spotlight>
        </div>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section className="border-y bg-gradient-to-br from-primary/5 via-transparent to-indigo-500/5 py-14">
      <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 sm:px-6 lg:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} data-anim="reveal" className="spotlight rounded-2xl border bg-card/60 px-4 py-6 text-center shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg">
            <dt className="sr-only">{s.label}</dt>
            <dd className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
              <span className="bg-gradient-to-br from-primary to-indigo-500 bg-clip-text text-transparent"><span data-count={s.value}>{s.value}</span>{s.suffix}</span>
            </dd>
            <p className="mt-2 text-sm text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Roles() {
  const [active, setActive] = useState(ROLES[0]!.key);
  const panel = useRef<HTMLDivElement>(null);
  const role = ROLES.find((r) => r.key === active)!;
  const pick = (key: string) => {
    if (key === active) return;
    setActive(key);
    if (panel.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo(panel.current.querySelectorAll('[data-anim="point"]'), { x: 16, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, stagger: 0.06, ease: 'power2.out' });
    }
  };
  return (
    <section id="roles" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="For your whole team" title="Everyone sees exactly what they need" body="Four roles, each with their own home screen and permissions. Company Admins can fine-tune any role." />
        <div data-anim="reveal" className="mt-12 grid gap-6 lg:grid-cols-[280px_1fr]">
          <div role="tablist" aria-label="Roles" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {ROLES.map((r) => (
              <button key={r.key} role="tab" aria-selected={active === r.key} aria-controls="role-panel" onClick={() => pick(r.key)}
                className={cn('spotlight flex shrink-0 items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition', active === r.key ? 'border-primary bg-primary-soft text-primary shadow-sm' : 'bg-card hover:bg-muted')}>
                <r.icon className="h-4 w-4" aria-hidden /> {r.label}
              </button>
            ))}
          </div>
          <div ref={panel} id="role-panel" role="tabpanel" className="spotlight relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
            <div className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" aria-hidden />
            <p className="text-sm font-medium text-primary">{role.label}</p>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight">{role.headline}</h3>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {role.points.map((p) => (
                <li key={p} data-anim="point" className="spotlight flex items-start gap-3 rounded-xl border bg-background/60 p-4 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-soft text-success"><Check className="h-3.5 w-3.5" aria-hidden /></span> {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const [cycle, setCycle] = useState<BillingCycle>('MONTHLY');
  // Always fresh, so plan or currency edits by the Super Admin show on the next visit.
  const { data: plans, isLoading, isError, refetch, isFetching } = useApi<PublicPlan[]>('/public/plans', { fresh: true });
  const ref = useRef<HTMLDivElement>(null);
  const featured = plans && plans.length >= 3 ? Math.floor(plans.length / 2) : -1;
  useLayoutEffect(() => {
    if (!plans?.length || !ref.current) return;
    const ctx = gsap.context(() => {
      gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
        // Cards start hidden just below their place and rise into it once (never down-then-up).
        revealBatch(ref.current!.querySelectorAll('[data-anim="plan"]'), 40);
      });
    }, ref);
    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, [plans]);
  return (
    <>
    <div className="mt-10 flex justify-center"><CycleToggle value={cycle} onChange={setCycle} /></div>
    <div ref={ref} className="mt-10 grid items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
      {isLoading && [0, 1, 2].map((i) => <div key={i} className="h-96 animate-pulse rounded-2xl border bg-muted/40" />)}
      {isError && !plans && (
        <div className="col-span-full flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <p className="text-muted-foreground">We couldn’t load the plans just now.</p>
          <button type="button" onClick={() => refetch()} disabled={isFetching} className="inline-flex h-10 items-center rounded-full border px-5 text-sm font-medium transition hover:bg-muted disabled:opacity-60">{isFetching ? 'Loading…' : 'Try again'}</button>
        </div>
      )}
      {plans?.length === 0 && <p className="col-span-full text-center text-muted-foreground">Plans are being prepared. Contact us for pricing.</p>}
      {plans?.map((p, i) => {
        const hot = i === featured;
        return (
          <div key={p.id} data-anim="plan" className={cn('spotlight relative flex flex-col rounded-2xl border bg-card p-7 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl', hot && 'border-transparent bg-gradient-to-b from-primary/10 to-card shadow-xl shadow-primary/10 ring-2 ring-primary lg:-mt-4 lg:pb-11')}>
            {hot && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-primary to-indigo-500 px-3 py-1 text-xs font-medium text-white shadow">Most popular</span>}
            <h3 className="text-lg font-semibold">{p.name}</h3>
            {p.description && <p className="mt-1 min-h-10 text-sm text-muted-foreground">{p.description}</p>}
            <p className="mt-5 flex items-baseline gap-1"><span className="text-4xl font-semibold tracking-tight tabular-nums">{money(cycle === 'ANNUAL' ? p.priceAnnual : p.priceMonthly, p.currency)}</span><span className="text-sm text-muted-foreground">/ {cycle === 'ANNUAL' ? 'year' : 'month'}</span></p>
            {cycle === 'ANNUAL' && p.priceMonthly * 12 > p.priceAnnual && <p className="mt-1 text-xs font-medium text-success">Save {money(p.priceMonthly * 12 - p.priceAnnual, p.currency)} a year</p>}
            {cycle === 'MONTHLY' && <p className="mt-1 text-xs text-muted-foreground">or {money(p.priceAnnual, p.currency)} billed yearly</p>}
            <p className="mt-1 text-sm text-muted-foreground">{p.maxEmployees ? `Up to ${p.maxEmployees} employees` : 'Unlimited employees'}</p>
            <Link href={`/signup?plan=${p.id}&cycle=${cycle}`}
              className={cn('mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition', hot ? 'bg-primary text-primary-foreground shadow-md shadow-primary/30 hover:shadow-lg' : 'border hover:bg-muted')}>
              Get started <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <ul className="mt-7 space-y-3 border-t pt-6 text-sm">
              <li className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> Employees, departments and roles</li>
              {MODULES.map((m) => {
                const on = p.modules.includes(m);
                return (
                  <li key={m} className={cn('flex gap-2.5', !on && 'text-muted-foreground/60 line-through decoration-muted-foreground/30')}>
                    {on ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> : <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                    <span>{MODULE_INFO[m].label}<span className="sr-only">{on ? ' included' : ' not included'}</span></span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
    </>
  );
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 border-t bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeading eyebrow="Questions" title="Frequently asked questions" />
        <div className="mt-12 space-y-3">
          {FAQ.map(([q, a]) => (
            <details key={q} data-anim="card" className="spotlight group rounded-2xl border bg-card px-5 shadow-sm open:shadow-md">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium [&::-webkit-details-marker]:hidden">
                {q}
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180" aria-hidden />
              </summary>
              <p className="pb-5 text-sm text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Elements start hidden a little below their place and rise into it the first time they scroll into
 * view. They only ever move up, and anything already on screen (or scrolled past) is shown at once.
 */
function revealBatch(targets: ArrayLike<Element> | Element[], y: number) {
  const els = Array.from(targets);
  if (!els.length) return;
  gsap.set(els, { opacity: 0, y });
  ScrollTrigger.batch(els, {
    start: 'top 90%',
    once: true,
    onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out', overwrite: true }),
  });
}

export function HomePage() {
  const siteName = useSiteName();
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        // Hero: headline words rise in one by one, then the rest
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        tl.from('[data-anim="badge"]', { y: 20, opacity: 0, duration: 0.6 })
          .from('[data-anim="word"]', { yPercent: 110, opacity: 0, rotate: 4, duration: 0.8, stagger: 0.06 }, '-=0.3')
          .from('[data-anim="hero-rest"] > *', { y: 24, opacity: 0, duration: 0.7, stagger: 0.1 }, '-=0.5')
          .from('[data-anim="preview"]', { y: 60, opacity: 0, rotateX: 12, duration: 1 }, '-=0.8')
          .from('[data-anim="bar"]', { scaleY: 0, transformOrigin: 'bottom', duration: 0.6, stagger: 0.06 }, '-=0.6')
          .from('[data-anim="float"]', { opacity: 0, scale: 0.8, duration: 0.5, stagger: 0.15, ease: 'back.out(2)' }, '-=0.3');

        gsap.to('[data-anim="float"]', { y: -10, duration: 2.6, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: { each: 0.7, from: 'random' }, delay: 2 });
        gsap.to('[data-anim="blob-a"]', { x: 60, y: 40, scale: 1.15, duration: 9, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        gsap.to('[data-anim="blob-b"]', { x: -50, y: -30, scale: 0.9, duration: 11, ease: 'sine.inOut', yoyo: true, repeat: -1 });

        // Preview tilts toward the pointer
        const tilt = document.querySelector<HTMLElement>('[data-anim="tilt"]');
        const hero = document.querySelector<HTMLElement>('[data-anim="hero"]');
        const onMove = (e: PointerEvent) => {
          if (!tilt || !hero) return;
          const r = hero.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5;
          const y = (e.clientY - r.top) / r.height - 0.5;
          gsap.to(tilt, { rotateY: x * 8, rotateX: -y * 8, duration: 0.6, ease: 'power2.out' });
        };
        hero?.addEventListener('pointermove', onMove);

        // Endless capability strip
        const marquee = document.querySelector<HTMLElement>('[data-anim="marquee"]');
        if (marquee) gsap.to(marquee, { xPercent: -50, duration: 40, ease: 'none', repeat: -1 });

        // Count-up numbers when they come into view
        gsap.utils.toArray<HTMLElement>('[data-count]').forEach((el) => {
          const end = Number(el.dataset.count);
          const obj = { v: 0 };
          gsap.to(obj, { v: end, duration: 1.6, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 90%' }, onUpdate: () => { el.textContent = String(Math.round(obj.v)); } });
        });

        gsap.to('[data-anim="glow"]', { yPercent: 30, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: true } });
        // Sections and cards start just below their place and only ever move up into it.
        revealBatch(gsap.utils.toArray<HTMLElement>('[data-anim="reveal"]'), 32);
        revealBatch(gsap.utils.toArray<HTMLElement>('[data-anim="card"]:not([data-step])'), 40);
        revealBatch(gsap.utils.toArray<HTMLElement>('[data-anim="cta"]'), 40);

        // How it works: the line draws across the steps as you scroll.
        const line = document.querySelector<HTMLElement>('[data-anim="line"]');
        gsap.set(line, { scaleX: 0, transformOrigin: 'left center' });
        // Progress from the section's position: 0 when its top is 60% down the screen, 1 when its bottom
        // reaches 75%. A plain scroll listener keeps it exact in both directions.
        const how = document.querySelector<HTMLElement>('#how');
        let shown = -1;
        const onScroll = () => {
          if (!how) return;
          const r = how.getBoundingClientRect();
          const vh = window.innerHeight;
          const p = Math.min(1, Math.max(0, (vh * 0.6 - r.top) / Math.max(1, r.height - vh * 0.15)));
          if (Math.abs(p - shown) < 0.002) return;
          shown = p;
          gsap.to(line, { scaleX: p, duration: 0.35, ease: 'power1.out', overwrite: true });
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);

        return () => {
          hero?.removeEventListener('pointermove', onMove);
          window.removeEventListener('scroll', onScroll);
          window.removeEventListener('resize', onScroll);
        };
      });
    }, root);
    return () => ctx.revert();
  }, []);

  const headline = ['Your', 'whole', 'team,', 'from'];
  const accent = ['first', 'day', 'to', 'payday.'];

  return (
    <div ref={root} onPointerMove={trackSpotlight} className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <Header />

      {/* Hero */}
      <section data-anim="hero" className="relative -mt-16 pt-16">
        <div className="pointer-events-none absolute inset-0 -z-0 [background-image:radial-gradient(color-mix(in_oklab,var(--foreground)_12%,transparent)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black,transparent)]" aria-hidden />
        <div data-anim="glow" className="pointer-events-none absolute inset-0 -z-0" aria-hidden>
          <div data-anim="blob-a" className="absolute top-0 left-[10%] h-[28rem] w-[28rem] rounded-full bg-primary/20 blur-3xl" />
          <div data-anim="blob-b" className="absolute top-20 right-[5%] h-[24rem] w-[24rem] rounded-full bg-indigo-500/15 blur-3xl" />
        </div>
        <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-4 pt-14 pb-24 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24 lg:pb-32">
          <div>
            <span data-anim="badge" className="spotlight inline-flex items-center gap-2 rounded-full border bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-success" /></span>
              HR, attendance and payroll in one place
            </span>
            <h1 className="mt-6 text-4xl leading-[1.08] font-semibold tracking-tight sm:text-5xl lg:text-[3.6rem]">
              {headline.map((w) => <span key={w} className="inline-block overflow-hidden pb-1 align-bottom"><span data-anim="word" className="inline-block">{w}&nbsp;</span></span>)}
              {accent.map((w) => (
                <span key={w} className="inline-block overflow-hidden pb-1 align-bottom">
                  <span data-anim="word" className="inline-block bg-gradient-to-r from-primary via-indigo-500 to-violet-500 bg-clip-text text-transparent">{w}&nbsp;</span>
                </span>
              ))}
            </h1>
            <div data-anim="hero-rest">
              <p className="mt-6 max-w-xl text-lg text-pretty text-muted-foreground">
                {siteName} brings attendance, leave, payroll, performance and company policies into one secure workspace, so HR spends less time chasing and more time on people.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/login" className="group inline-flex h-12 items-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/30 transition hover:shadow-xl hover:shadow-primary/40">
                  Sign in to your workspace <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
                </Link>
                <Link href="/demo" className="inline-flex h-12 items-center gap-2 rounded-full border bg-card/80 px-6 text-sm font-medium backdrop-blur transition hover:bg-muted"><PlayCircle className="h-4 w-4 text-primary" aria-hidden /> Try the live demo</Link>
              </div>
              <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {['Biometric device sync', 'PDF salary slips', 'Works on any phone'].map((t) => (
                  <li key={t} className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> {t}</li>
                ))}
              </ul>
            </div>
          </div>
          <HeroPreview />
        </div>
      </section>

      <Marquee />
      <Features />
      <Stats />

      {/* How it works */}
      <section id="how" className="scroll-mt-20 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="How it works" title="Up and running in a day" />
          <div className="relative mt-16 grid gap-12 md:grid-cols-3">
            {/* Track (grey) and the progress line that draws across it. */}
            <div className="absolute top-[3.75rem] right-[16%] left-[16%] hidden h-1 rounded-full bg-border md:block" aria-hidden />
            <div data-anim="line" className="absolute top-[3.75rem] right-[16%] left-[16%] hidden h-1 rounded-full bg-gradient-to-r from-primary via-indigo-500 to-violet-500 shadow-[0_0_12px] shadow-primary/50 md:block" aria-hidden />
            {STEPS.map((s, i) => (
              <div key={s.title} data-anim="card" data-step className="spotlight relative rounded-2xl border bg-card px-6 pt-8 pb-7 text-center shadow-sm transition duration-500 hover:-translate-y-1 hover:shadow-lg">
                <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border-4 border-background bg-gradient-to-br from-primary to-indigo-500 text-white shadow-lg shadow-primary/30"><s.icon className="h-6 w-6" aria-hidden /></div>
                <p className="mt-5 text-xs font-semibold tracking-wider text-primary uppercase">Step {i + 1}</p>
                <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
                <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="border-t bg-muted/30"><Roles /></div>

      {/* Security */}
      <section id="security" className="scroll-mt-20 py-20 sm:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div data-anim="reveal">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Security and privacy</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Your company’s data stays your company’s</h2>
            <p className="mt-4 text-muted-foreground">Salaries, CNICs and complaints are sensitive. {siteName} is built so one company can never see another’s data, and every employee sees only what their role allows.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {SECURITY.map((s) => (
              <Spotlight key={s.title} data-anim="card" className="p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary"><s.icon className="h-5 w-5" aria-hidden /></span>
                <h3 className="mt-3 text-sm font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </Spotlight>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 border-t py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Pricing" title="Plans that grow with your team" body="Pay monthly, or yearly and save. Change plans any time; your data stays put." />
          <Pricing />
        </div>
      </section>

      <Faq />

      {/* Call to action: deep navy with soft aurora light, works on light and dark pages. */}
      <section id="contact" className="scroll-mt-20 px-4 py-20 sm:px-6">
        <div data-anim="cta" className="spotlight spotlight-light relative mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/10 bg-[#0b1224] px-6 py-16 text-white shadow-2xl shadow-primary/10 sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute -top-32 -left-20 h-80 w-80 rounded-full bg-[#3b82f6]/35 blur-[90px]" aria-hidden />
          <div className="pointer-events-none absolute -right-16 -bottom-32 h-80 w-80 rounded-full bg-[#14b8a6]/25 blur-[90px]" aria-hidden />
          <div className="pointer-events-none absolute top-1/2 left-1/2 h-64 w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#6366f1]/15 blur-[80px]" aria-hidden />
          <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" aria-hidden />
          <div className="relative grid items-center gap-10 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-sky-200"><Sparkles className="h-3.5 w-3.5" aria-hidden /> Set up in a day</span>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Ready to bring your team <span className="bg-gradient-to-r from-sky-300 via-cyan-200 to-teal-200 bg-clip-text text-transparent">together?</span></h2>
              <p className="mt-3 max-w-xl text-slate-300">Start your company in minutes, or look around a real sample company first. Already on {siteName}? Sign in to your workspace.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/signup" className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition hover:bg-sky-50">Start your company <ArrowRight className="h-4 w-4" aria-hidden /></Link>
                <Link href="/demo" className="inline-flex h-12 items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 text-sm font-medium backdrop-blur transition hover:bg-white/10"><PlayCircle className="h-4 w-4" aria-hidden /> Try the demo</Link>
                <Link href="/login" className="inline-flex h-12 items-center gap-2 px-3 text-sm font-medium text-slate-300 transition hover:text-white"><LogIn className="h-4 w-4" aria-hidden /> Sign in</Link>
              </div>
            </div>
            <ul className="grid gap-3 text-sm">
              {[[ShieldCheck, 'Your data walled off from every other company'], [Smartphone, 'Works on any phone, light or dark'], [Fingerprint, 'Connects to your biometric devices']].map(([Icon, text]) => {
                const I = Icon as LucideIcon;
                return (
                  <li key={text as string} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400/30 to-teal-400/20 text-sky-200"><I className="h-4 w-4" aria-hidden /></span>
                    <span className="text-slate-200">{text as string}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      <footer className="border-t bg-muted/20">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <BrandLogo />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">{SITE.tagline}</p>
          </div>
          <div>
            <p className="text-sm font-semibold">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {[['#features', 'Features'], ['#roles', 'For your team'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']].map(([h, l]) => <li key={h}><a href={h} className="hover:text-foreground">{l}</a></li>)}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Account</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><Link href="/login" className="hover:text-foreground">Sign in</Link></li>
              <li><Link href="/forgot-password" className="hover:text-foreground">Forgot password</Link></li>
              {SITE.supportEmail && <li><a href={`mailto:${SITE.supportEmail}`} className="hover:text-foreground">Support</a></li>}
            </ul>
          </div>
        </div>
        <div className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:px-6">
            <SiteCopyright />
            <p>Made for growing teams.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
