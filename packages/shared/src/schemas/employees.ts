import { z } from 'zod';
import { BLOOD_GROUPS, EMPLOYMENT_STATUSES, HIERARCHY_TIERS, DOC_CATEGORIES } from '../enums';
import { ROLES } from '../permissions';
import { cnic, isoDate, money, optionalText, password, phone, trimmed, uuid } from './common';

/** B1 – fields the employee may edit themselves. */
export const selfProfileSchema = z.object({
  fullName: trimmed(2, 120),
  cnic: cnic.optional(),
  fatherName: trimmed(2, 120).optional(),
  fatherCnic: cnic.optional(),
  bloodGroup: z.enum(BLOOD_GROUPS).optional(),
  emergencyContact: phone.optional(),
  contactNo: phone.optional(),
});
export type SelfProfileInput = z.infer<typeof selfProfileSchema>;

/** What an employee may send for their own profile: their details, plus date of birth once (only while HR hasn't set it). */
export const selfProfileUpdateSchema = selfProfileSchema.partial().extend({ dateOfBirth: isoDate.optional() });
export type SelfProfileUpdateInput = z.infer<typeof selfProfileUpdateSchema>;

/** HR-managed employee record (B1 non-editable fields + B7 salary). */
export const employeeSchema = selfProfileSchema.extend({
  email: z.email().toLowerCase(),
  departmentId: uuid,
  levelId: uuid,
  designation: trimmed(2, 120),
  reportingManagerId: uuid.nullable().optional(),
  joiningDate: isoDate,
  dateOfBirth: isoDate.optional(),
  basicSalary: money.optional(), // defaults from level (B7)
  hierarchyTier: z.enum(HIERARCHY_TIERS).default('MEMBER'),
  /** D3: whether this person may claim medical expenses. */
  medicalEligible: z.boolean().optional(),
  workScheduleId: uuid.nullable().optional(),
  roles: z.array(z.enum(ROLES)).default(['EMPLOYEE']),
  sendInvite: z.boolean().default(true),
  /** Without an invitation, HR sets the first password (optional otherwise). */
  password: password.optional(),
  mustChangePassword: z.boolean().default(true),
});
export type EmployeeInput = z.infer<typeof employeeSchema>;

export const employeeUpdateSchema = employeeSchema
  .omit({ roles: true, sendInvite: true, password: true, mustChangePassword: true })
  .partial()
  .extend({ employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional() });
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;

export const employeeListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(100).optional(),
  departmentId: uuid.optional(),
  status: z.enum(EMPLOYMENT_STATUSES).optional(),
});

export const departmentSchema = z.object({
  name: trimmed(2, 80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,12}$/),
  headEmployeeId: uuid.nullable().optional(),
  foodAllowanceEnabled: z.boolean().default(false),
  paidOvertimeEnabled: z.boolean().default(false),
  workScheduleId: uuid.nullable().optional(),
  isActive: z.boolean().default(true),
});
export type DepartmentInput = z.infer<typeof departmentSchema>;

export const levelSchema = z
  .object({
    departmentId: uuid,
    code: z.string().trim().toUpperCase().regex(/^L\d{1,2}$/, 'Use L0, L1, …'),
    title: trimmed(2, 80),
    description: optionalText(500),
    defaultSalary: money,
    minSalary: money.optional(),
    maxSalary: money.optional(),
    isActive: z.boolean().default(true),
  })
  .refine((l) => l.minSalary === undefined || l.maxSalary === undefined || l.minSalary <= l.maxSalary, {
    message: 'Minimum must not exceed maximum',
    path: ['minSalary'],
  });
export type LevelInput = z.infer<typeof levelSchema>;

export const reorderLevelsSchema = z.object({ levelIds: z.array(uuid).min(1) });

export const teamSchema = z.object({
  name: trimmed(2, 80),
  departmentId: uuid,
  leadEmployeeId: uuid,
});

export const addTeamMemberSchema = z.object({
  employeeId: uuid,
  reason: optionalText(500),
});

/** B8 promotion. */
export const promotionSchema = z.object({
  levelId: uuid,
  departmentId: uuid.optional(),
  designation: trimmed(2, 120).optional(),
  effectiveDate: isoDate,
  salary: money.optional(),
  notes: optionalText(1000),
});
export type PromotionInput = z.infer<typeof promotionSchema>;

export const resignationSchema = z.object({
  reason: trimmed(10, 3000),
  requestedLastWorkingDate: isoDate,
});

export const resignationDecisionSchema = z.object({
  approve: z.boolean(),
  comment: optionalText(1000),
  lastWorkingDate: isoDate.optional(),
});

export const documentUploadSchema = z.object({
  category: z.enum(DOC_CATEGORIES),
  title: optionalText(150),
});

/** Bring a former employee back: status ACTIVE again, optionally with their login restored. */
export const reactivateSchema = z.object({ restoreLogin: z.boolean().default(true) });

export const terminateSchema = z.object({
  exitDate: isoDate,
  reason: trimmed(5, 2000),
});
