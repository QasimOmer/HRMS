import { PERMISSIONS, type Permission } from './permissions';

/**
 * Approval workflow definitions (H1).
 * Each step names the permission an approver needs. For TEAM_LEAD steps the approver must
 * also lead the requester's team (enforced server-side).
 */
export type ApprovalStepKey = 'TEAM_LEAD' | 'HR' | 'OPERATIONS';

export interface WorkflowStep {
  key: ApprovalStepKey;
  label: string;
  permission: Permission;
}

export const WORKFLOWS = {
  LEAVE: [
    { key: 'TEAM_LEAD', label: 'Team Lead', permission: PERMISSIONS.LEAVE_APPROVE_TL },
    { key: 'HR', label: 'HR', permission: PERMISSIONS.LEAVE_APPROVE_HR },
  ],
  ATTENDANCE_CORRECTION: [
    { key: 'TEAM_LEAD', label: 'Team Lead', permission: PERMISSIONS.ATTENDANCE_CORRECTION_APPROVE_TL },
    { key: 'HR', label: 'HR', permission: PERMISSIONS.ATTENDANCE_CORRECTION_APPROVE_HR },
  ],
  OVERTIME: [
    { key: 'TEAM_LEAD', label: 'Team Lead', permission: PERMISSIONS.OVERTIME_APPROVE_TL },
  ],
  COMPENSATION: [
    { key: 'TEAM_LEAD', label: 'Team Lead', permission: PERMISSIONS.COMPENSATION_APPROVE_TL },
    { key: 'HR', label: 'HR', permission: PERMISSIONS.COMPENSATION_APPROVE_HR },
  ],
  KPI: [
    { key: 'TEAM_LEAD', label: 'Team Lead', permission: PERMISSIONS.KPI_APPROVE_TL },
    { key: 'HR', label: 'HR', permission: PERMISSIONS.KPI_APPROVE_HR },
  ],
  RESIGNATION: [
    { key: 'TEAM_LEAD', label: 'Team Lead', permission: PERMISSIONS.RESIGNATION_APPROVE_TL },
    { key: 'HR', label: 'HR', permission: PERMISSIONS.RESIGNATION_APPROVE_HR },
  ],
  TEAM_TRANSFER: [
    { key: 'HR', label: 'HR', permission: PERMISSIONS.TEAM_TRANSFER_APPROVE },
  ],
  PAYROLL: [
    { key: 'HR', label: 'HR', permission: PERMISSIONS.PAYROLL_APPROVE_HR },
    { key: 'OPERATIONS', label: 'Operations', permission: PERMISSIONS.PAYROLL_APPROVE_OPS },
  ],
  MEDICAL_CLAIM: [
    { key: 'HR', label: 'HR', permission: PERMISSIONS.MEDICAL_MANAGE },
  ],
  /** LON-04: employee loan request from their own portal. */
  LOAN_REQUEST: [
    { key: 'HR', label: 'HR', permission: PERMISSIONS.LOANS_MANAGE },
  ],
} as const satisfies Record<string, readonly WorkflowStep[]>;

export type WorkflowType = keyof typeof WORKFLOWS;

export const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export function nextStep(type: WorkflowType, current: ApprovalStepKey | null): ApprovalStepKey | null {
  const steps = WORKFLOWS[type] as readonly WorkflowStep[];
  if (current === null) return steps[0]?.key ?? null;
  const idx = steps.findIndex((s) => s.key === current);
  return steps[idx + 1]?.key ?? null;
}

export function stepDef(type: WorkflowType, key: ApprovalStepKey): WorkflowStep | undefined {
  return (WORKFLOWS[type] as readonly WorkflowStep[]).find((s) => s.key === key);
}
