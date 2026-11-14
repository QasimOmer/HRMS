'use client';

import { Mail, Phone, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DepartmentSelect, useDirectory } from '@/components/domain';
import { Avatar, Badge, Card, EmptyState, LoadingRows, PageHeader } from '@/components/ui/display';
import { Input } from '@/components/ui/form';

export default function DirectoryPage() {
  const { data, isLoading } = useDirectory();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const rows = useMemo(() => {
    const s = q.toLowerCase();
    return (data ?? []).filter((e) => (!dept || e.departmentId === dept) && (!s || `${e.fullName} ${e.designation} ${e.departmentName} ${e.email}`.toLowerCase().includes(s)));
  }, [data, q, dept]);

  return (
    <>
      <PageHeader title="Employee directory" description={`${data?.length ?? 0} people across the company`} />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="Search people, roles, departments…" aria-label="Search directory" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <DepartmentSelect includeAll="All departments" aria-label="Department" className="w-auto" value={dept} onChange={(e) => setDept(e.target.value)} />
      </div>
      {isLoading ? (
        <Card><LoadingRows /></Card>
      ) : !rows.length ? (
        <Card><EmptyState icon={Users} title="No one matches your search" /></Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((e) => (
            <li key={e.id}>
              <Card className="h-full p-4">
                <div className="flex gap-3">
                  <Avatar name={e.fullName} fileId={e.avatarFileId} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{e.fullName}</p>
                    <p className="truncate text-sm text-muted-foreground">{e.designation}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge tone="primary">{e.level}</Badge>
                      <Badge>{e.departmentName}</Badge>
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-1.5 text-sm">
                  <a href={`mailto:${e.email}`} className="flex items-center gap-2 truncate text-muted-foreground hover:text-primary"><Mail className="h-3.5 w-3.5 shrink-0" aria-hidden /> {e.email}</a>
                  {e.contactNo && <a href={`tel:${e.contactNo}`} className="flex items-center gap-2 text-muted-foreground hover:text-primary"><Phone className="h-3.5 w-3.5" aria-hidden /> {e.contactNo}</a>}
                  {e.reportingManagerName && <p className="text-xs text-muted-foreground">Reports to {e.reportingManagerName}</p>}
                </div>
                {e.since && <p className="mt-3 border-t pt-2.5 text-xs text-muted-foreground" title={e.tenure}>{e.since}</p>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
