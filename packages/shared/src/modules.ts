import { PERMISSION_INFO, type Permission } from './permissions';

/**
 * Sellable feature modules. A company only gets the modules its plan includes; everything else is core
 * (dashboard, employees & org structure, access & roles, settings, calendar & holidays, notifications).
 */
export const MODULES = ['ATTENDANCE', 'LEAVE', 'PAYROLL', 'PERFORMANCE', 'COMPLIANCE', 'COMMUNITY', 'BIOMETRIC'] as const;
export type Module = (typeof MODULES)[number];

export const MODULE_INFO: Record<Module, { label: string; description: string }> = {
  ATTENDANCE: { label: 'Attendance & overtime', description: 'Daily attendance, corrections, late minutes, overtime and compensation.' },
  LEAVE: { label: 'Leave', description: 'Leave requests, balances, carry-forward and approvals.' },
  PAYROLL: { label: 'Payroll', description: 'Monthly payroll, salary slips, loans, medical claims and food allowance.' },
  PERFORMANCE: { label: 'KPI & performance', description: 'KPI targets and submissions, incentives.' },
  COMPLIANCE: { label: 'Compliance', description: 'Policies, anonymous complaints, queries and surveys.' },
  COMMUNITY: { label: 'Community', description: 'Feed, announcements, birthdays and guidelines.' },
  BIOMETRIC: { label: 'Biometric devices', description: 'ZKTeco / Hikvision device integration and punch import.' },
};

/** Which module a permission belongs to (permissions not listed are core). */
const GROUP_MODULE: Record<string, Module> = {
  Payroll: 'PAYROLL',
  Performance: 'PERFORMANCE',
  Compliance: 'COMPLIANCE',
  Community: 'COMMUNITY',
};

export function permissionModule(p: Permission): Module | null {
  if (p.startsWith('leave.')) return 'LEAVE';
  if (p.startsWith('attendance') || p.startsWith('overtime') || p.startsWith('compensation')) return 'ATTENDANCE';
  return GROUP_MODULE[PERMISSION_INFO[p]?.group ?? ''] ?? null;
}

/** A permission is usable only when the company's plan includes its module. */
export const permissionAllowed = (p: Permission, modules: readonly string[]) => {
  const m = permissionModule(p);
  return !m || modules.includes(m);
};
