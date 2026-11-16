import { z } from 'zod';
import { money, optionalText, period, trimmed, uuid, isoDate } from './common';

export const salaryComponentSchema = z
  .object({
    kind: z.enum(['ALLOWANCE', 'DEDUCTION']),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/),
    label: trimmed(2, 80),
    amount: money,
    isPercentOfBasic: z.boolean().default(false),
    employeeId: uuid.nullable().optional(),
    departmentId: uuid.nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((v) => !v.isPercentOfBasic || v.amount <= 100, { message: 'Percentage must be ≤ 100', path: ['amount'] });

export const payrollRunSchema = z.object({ period });

export const payslipAdjustmentSchema = z.object({
  kind: z.enum(['ALLOWANCE', 'DEDUCTION', 'BONUS']),
  label: trimmed(2, 80),
  amount: money,
});

export const loanSchema = z.object({
  employeeId: uuid,
  principal: money.refine((v) => v > 0, 'Must be positive'),
  installment: money.refine((v) => v > 0, 'Must be positive'),
  startPeriod: period,
  reason: optionalText(500),
});

/** LON-04: employee-initiated loan request (documents optional). */
export const loanRequestSchema = z.object({
  principal: money.refine((v) => v > 0, 'Must be positive'),
  installment: money.refine((v) => v > 0, 'Must be positive'),
  startPeriod: period,
  reason: trimmed(5, 1000),
});

/** HR may adjust the instalment or start month when approving. */
export const loanDecisionSchema = z.object({
  approve: z.boolean(),
  installment: money.optional(),
  startPeriod: period.optional(),
  comment: optionalText(1000),
});

/** PAY-08: approved payroll is locked; HR must give a reason to reopen it. */
export const payrollReopenSchema = z.object({
  reason: trimmed(5, 1000),
});

export const loanRepaymentSchema = z.object({
  amount: money.refine((v) => v > 0, 'Must be positive'),
  paidOn: isoDate,
  note: optionalText(300),
});

export const medicalClaimSchema = z.object({
  amount: money.refine((v) => v > 0, 'Must be positive'),
  claimDate: isoDate,
  description: trimmed(5, 1000),
});

export const medicalDecisionSchema = z.object({
  approve: z.boolean(),
  approvedAmount: money.optional(),
  comment: optionalText(1000),
});

export const foodAllowanceRuleSchema = z.object({
  departmentId: uuid,
  dailyAmount: money,
  minWorkedMinutes: z.coerce.number().int().min(0).max(24 * 60),
  excludeWorkFromHome: z.boolean().default(true),
  excludeEarlyLeave: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
