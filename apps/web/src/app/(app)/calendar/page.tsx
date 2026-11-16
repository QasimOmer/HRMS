'use client';

import { PERMISSIONS as P, calendarEventSchema } from '@hrms/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { CalendarView } from '@/components/calendar-view';
import { DepartmentSelect, EmployeeSelect } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/display';
import { Field, FormGrid, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { useAuth } from '@/lib/auth';
import { fieldError, useZodForm } from '@/lib/form';
import { todayLocal } from '@/lib/format';
import { useAction } from '@/lib/hooks';

function EventDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const form = useZodForm(calendarEventSchema, { title: '', startDate: todayLocal(), endDate: todayLocal(), visibility: 'COMPANY', departmentId: null });
  const vis = form.watch('visibility');
  const add = useAction('post', '/calendar/events', { invalidate: ['/calendar'], success: 'Event added', onSuccess: () => { onOpenChange(false); form.reset(); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add calendar event" footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={add.isPending} onClick={form.handleSubmit((v) => add.mutate(v))}>Add event</Button></>}>
      <div className="space-y-4">
        <Field label="Title" required error={fieldError(form, 'title')}>{(a) => <Input {...a} {...form.register('title')} />}</Field>
        <FormGrid>
          <Field label="Starts" required error={fieldError(form, 'startDate')}>{(a) => <Input {...a} type="date" {...form.register('startDate')} />}</Field>
          <Field label="Ends" required error={fieldError(form, 'endDate')}>{(a) => <Input {...a} type="date" {...form.register('endDate')} />}</Field>
        </FormGrid>
        <FormGrid>
          <Field label="Visible to">{(a) => <Select {...a} {...form.register('visibility')}><option value="COMPANY">Whole company</option><option value="DEPARTMENT">One department</option></Select>}</Field>
          {vis === 'DEPARTMENT' && <Field label="Department" error={fieldError(form, 'departmentId')}>{(a) => <DepartmentSelect {...a} {...form.register('departmentId', { setValueAs: (v) => (v === '' ? null : v) })} />}</Field>}
        </FormGrid>
        <Field label="Description">{(a) => <Textarea {...a} rows={2} {...form.register('description')} />}</Field>
      </div>
    </Dialog>
  );
}

export default function CalendarPage() {
  const { can, me, isTeamLead } = useAuth();
  const [employeeId, setEmployeeId] = useState('');
  const [open, setOpen] = useState(false);
  const canPick = can(P.ATTENDANCE_READ_ALL) || isTeamLead;

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Your attendance, leave, holidays and company events."
        actions={<>
          {canPick && <EmployeeSelect aria-label="Show calendar for" className="w-56" placeholder={`Me (${me?.employee?.fullName ?? ''})`} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />}
          {can(P.CALENDAR_MANAGE) && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add event</Button>}
        </>}
      />
      <CalendarView employeeId={employeeId} />
      <EventDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
