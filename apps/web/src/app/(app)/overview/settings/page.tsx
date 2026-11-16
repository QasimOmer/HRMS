'use client';

import { MODULE_INFO, PERMISSIONS as P, type Module } from '@hrms/shared';
import { Building2, Clock, CreditCard, Globe2, IdCard, Mail, Package, Sparkles, Timer } from 'lucide-react';
import { QuickActions, type QuickAction } from '@/components/overview';
import { Badge, Card, CardBody, CardHeader, KeyValue, PageHeader, Stat } from '@/components/ui/display';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';

interface Schedule { id: string; name: string; startTime: string; endTime: string; isDefault: boolean }

/** Settings overview: the company's key settings at a glance, then shortcuts to each settings tab. */
export default function SettingsOverviewPage() {
  const { can, me, hasModule } = useAuth();
  const t = me?.tenant;
  const { data: schedules } = useApi<Schedule[]>(can(P.ATTENDANCE_MANAGE) ? '/work-schedules' : null);
  const def = schedules?.find((s) => s.isDefault);

  const actions: QuickAction[] = [
    ...(can(P.TENANT_SETTINGS, P.DIRECTORY_SETTINGS) ? [{ href: '/settings?tab=company', label: 'Company', description: 'Name, time zone, logo, rules', icon: Building2 }] : []),
    ...(can(P.ATTENDANCE_MANAGE) ? [{ href: '/settings?tab=schedules', label: 'Working hours', description: 'Shifts and working days', icon: Clock }] : []),
    ...(can(P.TENANT_SETTINGS) ? [{ href: '/settings?tab=id-card', label: 'ID card', description: 'Card design and fields', icon: IdCard }] : []),
    ...(can(P.TENANT_SETTINGS) && hasModule('COMMUNITY') ? [{ href: '/settings?tab=community', label: 'Community', description: 'Birthday post template', icon: Sparkles }] : []),
    ...(can(P.TENANT_SETTINGS) ? [{ href: '/billing', label: 'Billing & plan', description: 'Invoices and payments', icon: CreditCard }] : []),
  ];

  return (
    <>
      <PageHeader title="Settings" description="Your company setup at a glance." />
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Time zone" icon={Globe2} value={<span className="text-base">{t?.timezone ?? '—'}</span>} hint={`Currency ${t?.currency ?? '—'}`} />
          <Stat label="Modules in plan" icon={Package} tone="info" value={t?.modules.length ?? 0} hint={t?.maxEmployees ? `Up to ${t.maxEmployees} active employees` : 'No employee limit'} />
          <Stat label="Email domains" icon={Mail} tone="success" value={t?.emailDomains.length ?? 0} hint={t?.emailDomain ? `@${t.emailDomain}` : 'Any email allowed'} />
          {can(P.ATTENDANCE_MANAGE) && <Stat label="Working schedules" icon={Timer} tone="warning" value={schedules?.length ?? '—'} hint={def ? `Default ${def.startTime.slice(0, 5)}–${def.endTime.slice(0, 5)}` : 'No default set'} />}
        </div>
        <QuickActions actions={actions} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Company" />
            <CardBody>
              <KeyValue items={[
                ['Name', t?.name],
                ['Workspace', t?.slug],
                ['Login email domains', t?.emailDomains.length ? t.emailDomains.map((d) => `@${d}`).join(', ') : 'Any'],
                ['Joining date in directory', t?.settings.directoryShowJoinDate ? 'Shown' : 'Hidden'],
                ['Medical yearly limit', t ? `${t.settings.medicalAnnualLimit.toLocaleString()} ${t.currency}` : null],
              ]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Modules in your plan" description="Ask your provider to add more." />
            <CardBody className="flex flex-wrap gap-2">
              {(t?.modules ?? []).map((m) => <Badge key={m} tone="primary">{MODULE_INFO[m as Module]?.label ?? m}</Badge>)}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
