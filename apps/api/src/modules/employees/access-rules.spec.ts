// Controllers read upload limits from config when they are loaded; unit tests need no real environment.
jest.mock('../../config', () => ({ onVercel: false, config: () => ({ MAX_UPLOAD_MB: 10, STORAGE_DIR: './storage', STORAGE_DRIVER: 'disk' }) }));

import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS as P, type Permission } from '@hrms/shared';
import { als, type AuthUser } from '../../common/context';
import { csvFile } from '../../common/util';
import { employeeEducations, employeeExperiences, employeeReferences, employees, employeeCertifications } from '../../db/schema';
import { isSalesDept, salesAccess } from '../performance/sales.controller';
import { EmployeesService } from './employees.service';
import { ProfileRecordsController } from './profile-records.controller';

const EMP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function user(perms: Permission[], employeeId: string | null = EMP, extra: Partial<AuthUser> = {}): AuthUser {
  return {
    userId: 'u-1', tenantId: 't-1', email: 'x@y.test', employeeId, roles: ['EMPLOYEE'], permissions: new Set(perms),
    ledTeamIds: [], canPost: false, modules: ['PERFORMANCE', 'LEAVE'], billingStatus: 'PAID', isDemo: false, ...extra,
  };
}
const as = <T>(u: AuthUser, fn: () => T) => als.run({ user: u, tenantId: u.tenantId }, fn);

/** Minimal chainable Drizzle stand-in: queries resolve to rows registered per table. */
function mockTx(rows: Map<unknown, unknown[]>) {
  const writes: { op: string; table: unknown; value: unknown }[] = [];
  const chain = (start: { table?: unknown; result?: () => unknown }) => {
    const b: Record<string, unknown> = {};
    let table = start.table;
    for (const m of ['innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'groupBy', 'returning']) b[m] = () => b;
    b.from = (t: unknown) => ((table = t), b);
    b.values = (v: unknown) => (writes.push({ op: 'insert', table, value: v }), (b.result = () => v), b);
    b.set = (v: unknown) => (writes.push({ op: 'update', table, value: v }), b);
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(start.result ? start.result() : b.result ? (b.result as () => unknown)() : (rows.get(table) ?? [])).then(res, rej);
    return b;
  };
  const tx = {
    select: () => chain({}),
    insert: (t: unknown) => chain({ table: t }),
    update: (t: unknown) => chain({ table: t, result: () => [{ id: 'r' }] }),
    delete: (t: unknown) => chain({ table: t, result: () => [{ id: 'r' }] }),
  };
  return { tx, writes };
}

describe('employee profile redaction', () => {
  const svc = new EmployeesService(null as never, null as never, null as never, null as never);
  const redact = (row: Record<string, unknown>, u: AuthUser) => (svc as unknown as { redact: (r: unknown, u: AuthUser) => Record<string, unknown> }).redact(row, u);
  const row = { id: EMP, contactNo: '+92 3001234567', hidePhone: true, dependents: 2, cnic: '35202-1234567-1', fatherCnic: null, basicSalary: 1000 };

  it('HR (manage employees) sees everything, including dependents and a hidden phone', () => {
    expect(redact(row, user(DEFAULT_ROLE_PERMISSIONS.HR, OTHER))).toMatchObject({ contactNo: '+92 3001234567', dependents: 2, cnic: '35202-1234567-1' });
  });

  it('Operations sees the hidden phone but not dependents', () => {
    expect(redact(row, user(DEFAULT_ROLE_PERMISSIONS.OPERATIONS, OTHER))).toMatchObject({ contactNo: '+92 3001234567', dependents: null });
  });

  it('the employee sees their own phone but not their dependents', () => {
    expect(redact(row, user([], EMP))).toMatchObject({ contactNo: '+92 3001234567', dependents: null, cnic: '35202-1234567-1' });
  });

  it('a team lead sees neither the hidden phone, dependents nor confidential fields', () => {
    expect(redact(row, user(DEFAULT_ROLE_PERMISSIONS.TEAM_LEAD, OTHER))).toMatchObject({ contactNo: null, dependents: null, cnic: null, basicSalary: null });
  });

  it('a visible phone stays visible to colleagues', () => {
    expect(redact({ ...row, hidePhone: false }, user(DEFAULT_ROLE_PERMISSIONS.TEAM_LEAD, OTHER)).contactNo).toBe('+92 3001234567');
  });
});

describe('sales revenue access', () => {
  const dept = (code: string, name: string, status = 'ACTIVE') => mockTx(new Map([[employees, [{ code, name, status }]]])).tx as never;

  it('recognises the Sales department by code or name', () => {
    expect(isSalesDept('SALES', 'Whatever')).toBe(true);
    expect(isSalesDept('sales', null)).toBe(true);
    expect(isSalesDept('BD', 'Sales & Marketing')).toBe(true);
    expect(isSalesDept('HR', 'Human Resources')).toBe(false);
    expect(isSalesDept('PRE', 'Presales-ish')).toBe(false);
  });

  it('is not granted to HR by default; the Company Admin holds every permission', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.HR).not.toContain(P.SALES_REVENUE_READ);
    expect(ALL_PERMISSIONS).toContain(P.SALES_REVENUE_READ);
  });

  it('allows a role with "View sales revenue"', async () => {
    await expect(salesAccess(dept('HR', 'HR'), user([P.SALES_REVENUE_READ], null))).resolves.toEqual({ allowed: true, via: 'permission' });
  });

  it('allows active Sales-department staff and nobody else', async () => {
    await expect(salesAccess(dept('SALES', 'Sales'), user([]))).resolves.toEqual({ allowed: true, via: 'department' });
    await expect(salesAccess(dept('HR', 'HR'), user(DEFAULT_ROLE_PERMISSIONS.HR))).resolves.toEqual({ allowed: false, via: null });
    await expect(salesAccess(dept('SALES', 'Sales', 'RESIGNED'), user([]))).resolves.toEqual({ allowed: false, via: null });
    await expect(salesAccess(dept('SALES', 'Sales'), user([], null))).resolves.toEqual({ allowed: false, via: null });
  });

  it('is closed when the plan has no Performance module, whatever the permission', async () => {
    await expect(salesAccess(dept('SALES', 'Sales'), user([P.SALES_REVENUE_READ], EMP, { modules: ['LEAVE'] }))).resolves.toEqual({ allowed: false, via: null });
  });
});

describe('profile records: who may add, change and see what', () => {
  const exp = { companyName: 'Acme', designation: 'Rep', employmentType: 'FULL_TIME', startDate: '2019-01-01', responsibilities: 'Sales' };
  const edu = { qualificationLevel: 'BACHELORS', degreeTitle: 'BBA', institution: 'LUMS', startDate: '2013-09-01', completionDate: '2017-06-30' };
  const setup = (emp: Record<string, unknown>, extra: [unknown, unknown[]][] = []) => {
    const m = mockTx(new Map<unknown, unknown[]>([[employees, [{ id: EMP, noExperience: false, educationSubmittedAt: null, referencesSubmittedAt: null, ...emp }]], ...extra]));
    const scope = { assertCanView: jest.fn(async () => undefined) };
    const ctl = new ProfileRecordsController({ tx: m.tx } as never, scope as never, null as never);
    return { ctl, writes: m.writes, scope };
  };
  const self = user([], EMP);
  const hr = user(DEFAULT_ROLE_PERMISSIONS.HR, OTHER);
  const colleague = user([], OTHER);

  it('the employee submits several education entries once, and that locks it', async () => {
    const { ctl, writes } = setup({});
    await expect(as(self, () => ctl.add(EMP, 'education', { items: [edu, { ...edu, degreeTitle: 'MBA' }] }))).resolves.toMatchObject({ added: 2 });
    expect(writes.find((w) => w.op === 'insert')?.value).toHaveLength(2);
    expect(writes.find((w) => w.op === 'update' && w.table === employees)?.value).toHaveProperty('educationSubmittedAt');
  });

  it('a second education or reference submission by the employee is refused', async () => {
    await expect(as(self, () => setup({ educationSubmittedAt: new Date() }).ctl.add(EMP, 'education', { items: [edu] }))).rejects.toMatchObject({ status: 403 });
    await expect(as(self, () => setup({ referencesSubmittedAt: new Date() }).ctl.add(EMP, 'references', { items: [{ name: 'Ab', organisation: 'Org', relationship: 'Peer' }] }))).rejects.toMatchObject({ status: 403 });
  });

  it('HR adds after submission without using up the employee\'s turn', async () => {
    const { ctl, writes } = setup({ educationSubmittedAt: new Date() });
    await expect(as(hr, () => ctl.add(EMP, 'education', { items: [edu] }))).resolves.toMatchObject({ added: 1 });
    expect(writes.some((w) => w.op === 'update' && w.table === employees)).toBe(false);
  });

  it('once submitted, entries of every kind can only be edited or deleted by HR', async () => {
    const { ctl } = setup({});
    for (const kind of ['experience', 'education', 'certifications', 'references'] as const) {
      await expect(as(self, () => ctl.update(EMP, kind, 'r', kind === 'education' ? edu : exp))).rejects.toMatchObject({ status: 403 });
      await expect(as(self, () => ctl.remove(EMP, kind, 'r'))).rejects.toMatchObject({ status: 403 });
      await expect(as(hr, () => ctl.remove(EMP, kind, 'r'))).resolves.toMatchObject({ deleted: true });
    }
    await expect(as(hr, () => ctl.update(EMP, 'experience', 'r', exp))).resolves.toMatchObject({ recordId: 'r' });
  });

  it('employees can still add new experience after submitting earlier entries', async () => {
    await expect(as(self, () => setup({}).ctl.add(EMP, 'experience', { items: [exp] }))).resolves.toMatchObject({ added: 1 });
  });

  it('colleagues cannot add to someone else\'s profile', async () => {
    await expect(as(colleague, () => setup({}).ctl.add(EMP, 'experience', { items: [exp] }))).rejects.toMatchObject({ status: 403 });
  });

  it('"No previous experience" blocks adding experience', async () => {
    await expect(as(self, () => setup({ noExperience: true }).ctl.add(EMP, 'experience', { items: [exp] }))).rejects.toMatchObject({ status: 400 });
  });

  it('invalid entries are rejected with field errors', async () => {
    await expect(as(self, () => setup({}).ctl.add(EMP, 'experience', { items: [{ ...exp, endDate: '2000-01-01' }] }))).rejects.toMatchObject({ status: 400 });
    await expect(as(self, () => setup({}).ctl.add(EMP, 'experience', { items: [] }))).rejects.toMatchObject({ status: 400 });
  });

  it('reference contact details are returned to HR only', async () => {
    const ref = { id: 'ref', name: 'Rana', organisation: 'Acme', relationship: 'Manager', email: 'rana@acme.test', phone: '+92 3211112223' };
    const tables: [unknown, unknown[]][] = [[employeeReferences, [ref]], [employeeExperiences, []], [employeeEducations, []], [employeeCertifications, []]];
    const forHr = await as(hr, () => setup({}, tables).ctl.list(EMP));
    expect(forHr.references[0]).toMatchObject({ email: 'rana@acme.test', phone: '+92 3211112223', contactHidden: false });
    const forSelf = await as(self, () => setup({}, tables).ctl.list(EMP));
    expect(forSelf.references[0]).toMatchObject({ email: null, phone: null, contactHidden: true });
    expect(forSelf.canEdit).toEqual({ experience: true, education: true, certifications: true, references: true });
    expect(forSelf.canChange).toEqual({ experience: false, education: false, certifications: false, references: false });
    expect(forHr.canChange).toEqual({ experience: true, education: true, certifications: true, references: true });
  });

  it('viewing someone else\'s records goes through the data-scope check', async () => {
    const s = setup({}, [[employeeReferences, []]]);
    await as(colleague, () => s.ctl.list(EMP));
    expect(s.scope.assertCanView).toHaveBeenCalledWith(EMP, P.EMPLOYEES_READ_ALL, P.EMPLOYEES_READ_TEAM);
  });
});

describe('CSV exports', () => {
  const text = (rows: unknown[][]) => {
    const f = csvFile(rows, 'x.csv') as unknown as { getStream: () => { read: () => Buffer } };
    return f.getStream().read().toString('utf8');
  };

  it('quotes every cell, escapes quotes and starts with a BOM for Excel', () => {
    expect(text([['a', 'b "c"', null, 3]])).toBe('﻿"a","b ""c""","","3"\r\n');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(text([['=HYPERLINK("x")', '+92 300', '-1', '@cmd']])).toBe(`﻿"'=HYPERLINK(""x"")","'+92 300","'-1","'@cmd"\r\n`);
  });
});
