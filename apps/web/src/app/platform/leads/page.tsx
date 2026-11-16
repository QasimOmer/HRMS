'use client';

import { PageHeader, Skeleton } from '@/components/ui/display';
import { Leads } from '../billing';
import { PlatformNav, usePlatformMe } from '../shared';

export default function LeadsPage() {
  const { data: me, isLoading } = usePlatformMe();
  if (isLoading || !me) return <Skeleton className="h-96" />;
  return (
    <>
      <PlatformNav me={me} />
      <PageHeader title="Leads" description="Demo visitors and website sign-ups, for follow-up." />
      <Leads />
    </>
  );
}
