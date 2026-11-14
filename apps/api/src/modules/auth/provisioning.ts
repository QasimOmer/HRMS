import { DEFAULT_ROLE_PERMISSIONS, ROLES } from '@hrms/shared';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from '../../db/db.service';
import {
  departments,
  foodAllowanceRules,
  guidelineVersions,
  leaveTypes,
  levels,
  rolePermissions,
  tenants,
  workSchedules,
} from '../../db/schema';

/** B7 suggested default ladder. */
const LADDER = [
  { code: 'L0', general: 'Intern', sales: 'Sales Intern', dev: 'Intern Developer', salary: 25000 },
  { code: 'L1', general: 'Associate', sales: 'Sales Associate', dev: 'Associate Developer', salary: 50000 },
  { code: 'L2', general: 'Executive', sales: 'Sales Executive', dev: 'Developer', salary: 80000 },
  { code: 'L3', general: 'Senior Executive', sales: 'Senior Sales Executive', dev: 'Senior Developer', salary: 120000 },
  { code: 'L4', general: 'Team Lead', sales: 'Sales Team Lead', dev: 'Lead Developer', salary: 160000 },
  { code: 'L5', general: 'Manager', sales: 'Sales Manager', dev: 'Development Manager', salary: 220000 },
  { code: 'L6', general: 'Head of Department', sales: 'Head of Sales', dev: 'Head of Development', salary: 300000 },
];

const DEPARTMENTS = [
  { code: 'MGMT', name: 'Management' },
  { code: 'HR', name: 'Human Resources' },
  { code: 'OPS', name: 'Operations' },
  { code: 'SALES', name: 'Sales', foodAllowanceEnabled: true, paidOvertimeEnabled: true },
  { code: 'DEV', name: 'Development' },
];

export const DEFAULT_GUIDELINES = `# Community Guidelines

Our community is a place to share updates, celebrate wins and connect with colleagues.

1. **Be respectful.** No harassment, hate speech, bullying or personal attacks.
2. **Keep it professional.** Avoid offensive, explicit or political content.
3. **Protect confidentiality.** Never post salaries, client data or internal documents.
4. **Stay on topic.** Share work updates, achievements and company news.
5. **No spam or self-promotion.**

HR may remove any post that does not follow these guidelines. Repeated violations may lead to disciplinary action.`;

/** Seed a new tenant with sensible defaults (all editable by HR afterwards). */
export async function provisionTenant(tx: Tx, tenantId: string, createdByUserId?: string) {
  await tx.insert(rolePermissions).values(
    ROLES.flatMap((role) => DEFAULT_ROLE_PERMISSIONS[role].map((permission) => ({ tenantId, role, permission }))),
  );

  const deptRows = await tx
    .insert(departments)
    .values(DEPARTMENTS.map((d) => ({ tenantId, ...d })))
    .returning();

  for (const d of deptRows) {
    await tx.insert(levels).values(
      LADDER.map((l, i) => ({
        tenantId,
        departmentId: d.id,
        code: l.code,
        rank: i,
        title: d.code === 'SALES' ? l.sales : d.code === 'DEV' ? l.dev : l.general,
        defaultSalary: l.salary,
        minSalary: Math.round(l.salary * 0.85),
        maxSalary: Math.round(l.salary * 1.25),
      })),
    );
  }

  const sales = deptRows.find((d) => d.code === 'SALES');
  if (sales) {
    await tx.insert(foodAllowanceRules).values({ tenantId, departmentId: sales.id, dailyAmount: 300, minWorkedMinutes: 480 });
  }

  await tx.insert(leaveTypes).values([
    { tenantId, code: 'CASUAL', name: 'Casual leave', annualAllowance: 14, color: '#1e3a8a' },
    { tenantId, code: 'SICK', name: 'Sick leave', annualAllowance: 7, color: '#0e7490' },
    { tenantId, code: 'COMPENSATION', name: 'Compensation leave', annualAllowance: 0, derivedFromOvertime: true, color: '#7c3aed' },
  ]);

  await tx.insert(workSchedules).values({
    tenantId,
    name: 'Standard (9–6)',
    startTime: '09:00',
    endTime: '18:00',
    breakMinutes: 60,
    workingDays: [1, 2, 3, 4, 5],
    isDefault: true,
  });

  await tx.insert(guidelineVersions).values({ tenantId, version: 1, content: DEFAULT_GUIDELINES, publishedByUserId: createdByUserId });

  return {
    management: deptRows.find((d) => d.code === 'MGMT')!,
  };
}

/** Atomically allocate the next employee code (EMP-0001 …). */
export async function nextEmployeeCode(tx: Tx, tenantId: string): Promise<string> {
  const [row] = await tx
    .update(tenants)
    .set({ employeeSeq: sql`${tenants.employeeSeq} + 1` })
    .where(eq(tenants.id, tenantId))
    .returning({ seq: tenants.employeeSeq });
  return `EMP-${String(row!.seq).padStart(4, '0')}`;
}
