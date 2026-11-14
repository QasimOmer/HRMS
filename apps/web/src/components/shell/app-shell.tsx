'use client';

import { MODULE_INFO, PERMISSIONS as P, ROLE_LABELS } from '@hrms/shared';
import { Bell, Lock, Menu, Moon, Sun, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth, useMedicalEligible } from '@/lib/auth';
import { cn, relative } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { activeItem, LogoutIcon, matches, NAV, type NavGroup, type NavItem } from '@/lib/nav';
import { BrandMark, CompanyLogo } from '../brand';
import { useTheme } from '../theme';
import { Button } from '../ui/button';
import { Avatar, Badge, Skeleton } from '../ui/display';
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '../ui/overlay';
import { useSiteName } from '@/lib/branding';

interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function NotificationBell() {
  const router = useRouter();
  const { data: count } = useApi<{ count: number }>('/notifications/unread-count', { refetchInterval: 60_000 });
  const { data: items } = useApi<Notification[]>('/notifications?limit=15');
  const read = useAction<string>('post', (id) => `/notifications/${id}/read`, { invalidate: ['/notifications'] });
  const readAll = useAction('post', '/notifications/read-all', { invalidate: ['/notifications'] });
  const n = count?.count ?? 0;
  return (
    <Dropdown
      trigger={
        <Button variant="ghost" size="icon" aria-label={`Notifications${n ? `, ${n} unread` : ''}`} className="relative">
          <Bell className="h-5 w-5" />
          {n > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
              {n > 99 ? '99+' : n}
            </span>
          )}
        </Button>
      }
    >
      <div className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-semibold">Notifications</span>
          {n > 0 && (
            <button className="text-xs text-primary hover:underline" onClick={() => readAll.mutate(undefined)}>
              Mark all read
            </button>
          )}
        </div>
        <DropdownSeparator />
        <div className="max-h-96 overflow-y-auto">
          {!items?.length && <p className="px-2 py-6 text-center text-sm text-muted-foreground">You're all caught up.</p>}
          {items?.map((i) => (
            <DropdownItem
              key={i.id}
              onSelect={() => {
                if (!i.readAt) read.mutate(i.id);
                if (i.link) router.push(i.link);
              }}
            >
              <div className="flex w-full gap-2 py-0.5">
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', i.readAt ? 'bg-transparent' : 'bg-primary')} aria-hidden />
                <div className="min-w-0">
                  <p className={cn('text-sm leading-snug', !i.readAt && 'font-medium')}>{i.title}</p>
                  {i.body && <p className="truncate text-xs text-muted-foreground">{i.body}</p>}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{relative(i.createdAt)}</p>
                </div>
              </div>
            </DropdownItem>
          ))}
        </div>
        <DropdownSeparator />
        <DropdownItem onSelect={() => router.push('/notifications')}>View all notifications</DropdownItem>
      </div>
    </Dropdown>
  );
}

/** Nav entries this person may open, with groups that end up empty removed. */
function useVisibleNav(): NavGroup[] {
  const { can, isTeamLead, me, hasModule } = useAuth();
  const medicalEligible = useMedicalEligible();
  const visible = (i: NavItem) => {
    if (i.module && !hasModule(i.module)) return false;
    if (i.employeeOnly && !me?.employee) return false;
    if (i.teamLead && !isTeamLead) return false;
    if (i.any?.length && !can(...i.any)) return false;
    if (i.medical && !can(P.MEDICAL_MANAGE) && !medicalEligible) return false;
    return true;
  };
  return NAV.map((g) => {
    const items = g.items.filter(visible);
    // Main page hidden (e.g. staff can't open employee profiles): show the group under its limited name.
    const limited = g.limited && items[0] !== g.items[0] ? g.limited : null;
    return { ...g, items, ...(limited ? { label: limited.label, icon: limited.icon } : {}) };
  }).filter((g) => g.items.length > 0);
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = useVisibleNav();
  const { data: inbox } = useApi<unknown[]>('/approvals/inbox', { refetchInterval: 120_000 });
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
      <ul className="space-y-1">
        {groups.map((g) => {
          const active = g.items.some((i) => matches(pathname, i.href));
          return (
            <li key={g.label}>
              <Link
                href={g.items[0]!.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-active hover:text-sidebar-active-foreground',
                  active && 'bg-sidebar-active font-semibold text-sidebar-active-foreground',
                )}
              >
                <g.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                <span className="truncate">{g.label}</span>
                {g.label === 'Approvals' && !!inbox?.length && (
                  <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white">{inbox.length}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Pages of the current section as tabs (e.g. Community → Feed · Announcements · Birthdays). */
function SectionTabs() {
  const pathname = usePathname();
  const groups = useVisibleNav();
  const group = groups.find((g) => g.items.some((i) => matches(pathname, i.href)));
  if (!group || group.items.length < 2) return null;
  const current = activeItem(pathname, group.items);
  return (
    <nav aria-label={group.label} className="mb-6">
      {/* Wraps onto more lines instead of scrolling, so every page of the section stays visible. */}
      <ul className="flex flex-wrap gap-2">
        {group.items.map((i) => {
          const on = current?.href === i.href;
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
                  on ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                <i.icon className="h-3.5 w-3.5" aria-hidden />
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Pages of a module the company's plan doesn't include show a short explanation instead. */
function ModuleGate({ children }: { children: ReactNode }) {
  const siteName = useSiteName();
  const pathname = usePathname();
  const { hasModule } = useAuth();
  const item = activeItem(pathname, NAV.flatMap((g) => g.items));
  if (!item?.module || hasModule(item.module)) return <>{children}</>;
  return (
    <div className="mx-auto max-w-md rounded-xl border bg-card p-8 text-center">
      <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary"><Lock className="h-5 w-5" aria-hidden /></span>
      <h1 className="text-lg font-semibold">{MODULE_INFO[item.module].label} isn't in your plan</h1>
      <p className="mt-1 text-sm text-muted-foreground">{MODULE_INFO[item.module].description} Contact your {siteName} provider to add it.</p>
      <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">Back to dashboard</Link>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const siteName = useSiteName();
  const { me, loading, logout, can } = useAuth();
  const canPay = can(P.TENANT_SETTINGS);
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Gates: forced password change, onboarding documents (B2).
  useEffect(() => {
    if (!me) return;
    // The password change comes first and stays in force until done: while it's pending, never send
    // them on to onboarding (that used to bounce between the two pages forever).
    if (me.user.mustChangePassword) {
      if (pathname !== '/profile') router.replace('/profile?tab=security&force=1');
      return;
    }
    // Unpaid subscription: the Company Admin goes to Billing to pay; everyone else sees a notice.
    if (me.tenant.billingStatus === 'UNPAID') {
      if (canPay && pathname !== '/billing') router.replace('/billing');
      return;
    }
    if (me.onboardingRequired && pathname !== '/onboarding') router.replace('/onboarding');
  }, [me, pathname, router, canPay]);

  if (loading || !me) {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-64 bg-sidebar lg:block" />
        <div className="flex-1 space-y-4 p-8">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  const sidebar = (
    <div className="flex h-full flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <CompanyLogo name={me.tenant.name} logoFileId={me.tenant.logoFileId} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{me.tenant.name}</p>
          <p className="truncate text-[11px] text-sidebar-heading">{me.tenant.slug}</p>
        </div>
      </div>
      <SideNav onNavigate={() => setMobileOpen(false)} />
      <div className="border-t border-sidebar-border p-3">
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-danger-soft hover:text-danger">
          <LogoutIcon className="h-4 w-4" aria-hidden /> Log out
        </button>
        <p className="mt-2 flex items-center gap-1.5 px-3 text-[11px] text-sidebar-heading">
          <BrandMark className="h-4 w-4" /> Powered by {siteName}
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%]">{sidebar}</div>
          <Button variant="ghost" size="icon" className="absolute top-3 right-3 bg-card" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </Button>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-card/90 px-4 backdrop-blur sm:px-6">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
        <NotificationBell />
        <Dropdown
          trigger={
            <button className="ml-1 flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-muted" aria-label="Account menu">
              <Avatar name={me.employee?.fullName ?? me.user.email} fileId={me.employee?.avatarFileId} size="sm" />
              <span className="hidden text-sm font-medium sm:block">{me.employee?.fullName ?? me.user.email}</span>
            </button>
          }
        >
          <DropdownLabel>
            <span className="block text-sm font-medium text-foreground">{me.employee?.fullName ?? me.user.email}</span>
            <span className="block">{me.user.email}</span>
            <span className="mt-1 flex flex-wrap gap-1">
              {me.user.roles
                .filter((r) => r !== 'EMPLOYEE')
                .map((r) => (
                  <Badge key={r} tone="primary">
                    {ROLE_LABELS[r]}
                  </Badge>
                ))}
            </span>
          </DropdownLabel>
          <DropdownSeparator />
          <DropdownItem onSelect={() => router.push('/profile')}>
            <UserRound className="h-4 w-4" /> My profile
          </DropdownItem>
          <DropdownItem onSelect={logout} danger>
            <LogoutIcon className="h-4 w-4" /> Log out
          </DropdownItem>
        </Dropdown>
      </header>

      {me.tenant.isDemo && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-gradient-to-r from-primary to-indigo-600 px-4 py-2 text-center text-sm text-white">
          <span><span className="font-semibold">You're exploring a read-only demo.</span> Look around freely; changes are switched off.</span>
          <a href="/signup" className="rounded-full bg-white px-3 py-0.5 text-xs font-semibold text-primary hover:bg-blue-50">Start your own company</a>
        </div>
      )}
      {me.tenant.billingStatus === 'DUE' && canPay && pathname !== '/billing' && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning-soft px-4 py-2 text-center text-sm text-warning">
          <span><span className="font-semibold">Your subscription payment is due.</span> Please pay soon to keep using the workspace.</span>
          <a href="/billing" className="font-semibold underline underline-offset-2">Go to Billing</a>
        </div>
      )}
      <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
        {me.tenant.billingStatus === 'UNPAID' && !canPay ? (
          <div className="mx-auto mt-16 max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
            <p className="text-lg font-semibold">Workspace waiting for payment</p>
            <p className="mt-2 text-sm text-muted-foreground">{me.tenant.name}'s subscription isn't paid yet, so the workspace is paused. Your Company Admin can pay on the Billing page; everything will be back as soon as it's confirmed.</p>
          </div>
        ) : (
          <>
        <SectionTabs />
        <ModuleGate>{children}</ModuleGate>
          </>
        )}
      </main>
    </div>
  );
}
