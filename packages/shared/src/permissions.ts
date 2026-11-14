/**
 * Permission catalogue (A1, F4, H2).
 * Permissions are plain strings so tenants can re-assign them to roles at runtime.
 */
export const ROLES = ['SUPER_ADMIN', 'HR', 'OPERATIONS', 'TEAM_LEAD', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Company Admin', // top role inside one company (the platform owner is the Super Admin)
  HR: 'HR',
  OPERATIONS: 'Operations',
  TEAM_LEAD: 'Team Lead',
  EMPLOYEE: 'Employee',
};

export const PERMISSIONS = {
  // Access & roles (A1)
  ROLES_MANAGE: 'roles.manage',
  USERS_MANAGE_ACCESS: 'users.manage_access',
  TENANT_SETTINGS: 'tenant.settings',
  AUDIT_READ: 'audit.read',
  /** Permanently delete records (policies, surveys, unused departments…). Super Admin grants it to other roles. */
  DATA_DELETE: 'data.delete',

  // Employees (B)
  EMPLOYEES_READ_ALL: 'employees.read.all',
  EMPLOYEES_READ_TEAM: 'employees.read.team',
  EMPLOYEES_MANAGE: 'employees.manage',
  EMPLOYEE_DOCS_MANAGE: 'employee_docs.manage',
  EMPLOYMENT_DOCS_MANAGE: 'employment_docs.manage',
  DEPARTMENTS_MANAGE: 'departments.manage',
  TEAMS_MANAGE: 'teams.manage',
  TEAMS_MANAGE_OWN: 'teams.manage_own',
  TEAM_TRANSFER_APPROVE: 'team_transfer.approve',
  PROMOTIONS_MANAGE: 'promotions.manage',
  RESIGNATION_APPROVE_TL: 'resignation.approve.tl',
  RESIGNATION_APPROVE_HR: 'resignation.approve.hr',
  HEADCOUNT_READ: 'headcount.read',
  DIRECTORY_SETTINGS: 'directory.settings',

  // Attendance, overtime, leave, calendar (C)
  ATTENDANCE_READ_ALL: 'attendance.read.all',
  ATTENDANCE_READ_TEAM: 'attendance.read.team',
  ATTENDANCE_MANAGE: 'attendance.manage',
  ATTENDANCE_CORRECTION_APPROVE_TL: 'attendance_correction.approve.tl',
  ATTENDANCE_CORRECTION_APPROVE_HR: 'attendance_correction.approve.hr',
  OVERTIME_APPROVE_TL: 'overtime.approve.tl',
  COMPENSATION_APPROVE_TL: 'compensation.approve.tl',
  COMPENSATION_APPROVE_HR: 'compensation.approve.hr',
  LEAVE_APPROVE_TL: 'leave.approve.tl',
  LEAVE_APPROVE_HR: 'leave.approve.hr',
  LEAVE_MANAGE: 'leave.manage',
  HOLIDAYS_MANAGE: 'holidays.manage',
  CALENDAR_MANAGE: 'calendar.manage',

  // Payroll (D)
  PAYROLL_READ_ALL: 'payroll.read.all',
  PAYROLL_PROCESS: 'payroll.process',
  PAYROLL_APPROVE_HR: 'payroll.approve.hr',
  PAYROLL_APPROVE_OPS: 'payroll.approve.ops',
  LOANS_MANAGE: 'loans.manage',
  MEDICAL_MANAGE: 'medical.manage',
  FOOD_ALLOWANCE_MANAGE: 'food_allowance.manage',

  // Performance (E)
  KPI_APPROVE_TL: 'kpi.approve.tl',
  KPI_APPROVE_HR: 'kpi.approve.hr',
  KPI_TARGETS_MANAGE: 'kpi.targets.manage',
  INCENTIVES_MANAGE: 'incentives.manage',

  // Compliance (F)
  POLICIES_MANAGE: 'policies.manage',
  GUIDELINES_MANAGE: 'guidelines.manage',
  COMPLAINTS_MANAGE: 'complaints.manage',
  QUERIES_RESPOND: 'queries.respond',
  QUERIES_READ_ALL: 'queries.read.all',
  SURVEYS_MANAGE: 'surveys.manage',
  SURVEYS_MANAGE_TEAM: 'surveys.manage_team',

  // Community (G)
  COMMUNITY_MODERATE: 'community.moderate',
  COMMUNITY_POSTING_MANAGE: 'community.posting.manage',
  ANNOUNCEMENTS_PUBLISH: 'announcements.publish',

  // Reports
  REPORTS_READ: 'reports.read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

const P = PERMISSIONS;

/** Default permission sets per role (tenants may customise; A1). */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: [...ALL_PERMISSIONS],
  HR: [
    P.USERS_MANAGE_ACCESS, P.ROLES_MANAGE, P.AUDIT_READ,
    P.EMPLOYEES_READ_ALL, P.EMPLOYEES_MANAGE, P.EMPLOYEE_DOCS_MANAGE, P.EMPLOYMENT_DOCS_MANAGE,
    P.DEPARTMENTS_MANAGE, P.TEAMS_MANAGE, P.TEAM_TRANSFER_APPROVE, P.PROMOTIONS_MANAGE,
    P.RESIGNATION_APPROVE_HR, P.HEADCOUNT_READ,
    P.ATTENDANCE_READ_ALL, P.ATTENDANCE_MANAGE, P.ATTENDANCE_CORRECTION_APPROVE_HR,
    P.COMPENSATION_APPROVE_HR, P.LEAVE_APPROVE_HR, P.LEAVE_MANAGE, P.HOLIDAYS_MANAGE, P.CALENDAR_MANAGE,
    P.PAYROLL_READ_ALL, P.PAYROLL_PROCESS, P.PAYROLL_APPROVE_HR, P.LOANS_MANAGE, P.MEDICAL_MANAGE,
    P.FOOD_ALLOWANCE_MANAGE,
    P.KPI_APPROVE_HR, P.KPI_TARGETS_MANAGE, P.INCENTIVES_MANAGE,
    P.POLICIES_MANAGE, P.GUIDELINES_MANAGE, P.COMPLAINTS_MANAGE, P.QUERIES_READ_ALL, P.SURVEYS_MANAGE,
    P.COMMUNITY_MODERATE, P.COMMUNITY_POSTING_MANAGE, P.ANNOUNCEMENTS_PUBLISH,
    P.REPORTS_READ,
  ],
  OPERATIONS: [
    P.USERS_MANAGE_ACCESS, P.EMPLOYEES_READ_ALL, P.HEADCOUNT_READ, P.DIRECTORY_SETTINGS,
    P.ATTENDANCE_READ_ALL, P.ATTENDANCE_MANAGE,
    P.PAYROLL_READ_ALL, P.PAYROLL_PROCESS, P.PAYROLL_APPROVE_OPS, P.LOANS_MANAGE, P.FOOD_ALLOWANCE_MANAGE,
    P.COMMUNITY_POSTING_MANAGE, P.REPORTS_READ,
  ],
  TEAM_LEAD: [
    P.EMPLOYEES_READ_TEAM, P.TEAMS_MANAGE_OWN, P.RESIGNATION_APPROVE_TL,
    P.ATTENDANCE_READ_TEAM, P.ATTENDANCE_CORRECTION_APPROVE_TL, P.OVERTIME_APPROVE_TL,
    P.COMPENSATION_APPROVE_TL, P.LEAVE_APPROVE_TL,
    P.KPI_APPROVE_TL, P.QUERIES_RESPOND, P.SURVEYS_MANAGE_TEAM,
  ],
  EMPLOYEE: [],
};

/** Roles allowed to grant/revoke a given role (Super Admin is only grantable by Super Admin). */
export function canAssignRole(actorRoles: Role[], target: Role): boolean {
  if (actorRoles.includes('SUPER_ADMIN')) return true;
  if (target === 'SUPER_ADMIN') return false;
  return actorRoles.includes('HR') || actorRoles.includes('OPERATIONS');
}

/** Human-friendly names for the permission catalogue (shown on Roles & permissions). */
export const PERMISSION_INFO: Record<Permission, { group: string; label: string; description: string }> = {
  'roles.manage': { group: 'Access & roles', label: 'Manage roles', description: 'Change what each role is allowed to do.' },
  'users.manage_access': { group: 'Access & roles', label: 'Manage user access', description: 'Assign roles, disable accounts, send reset links and set passwords.' },
  'tenant.settings': { group: 'Access & roles', label: 'Company settings', description: 'Edit company name, time zone, currency and system rules.' },
  'audit.read': { group: 'Access & roles', label: 'View audit trail', description: 'See the history of every change made in the system.' },
  'data.delete': { group: 'Access & roles', label: 'Delete records', description: 'Permanently delete policies, surveys, unused departments, levels, teams and other records they manage.' },

  'employees.read.all': { group: 'Employees', label: 'View all employees', description: 'Open every employee profile in the company.' },
  'employees.read.team': { group: 'Employees', label: 'View own team', description: 'Open profiles of the team they lead (salary hidden).' },
  'employees.manage': { group: 'Employees', label: 'Add & edit employees', description: 'Create employees, edit records and terminate employment.' },
  'employee_docs.manage': { group: 'Employees', label: 'Manage employee documents', description: 'Edit or delete documents employees uploaded (CNIC, photos…).' },
  'employment_docs.manage': { group: 'Employees', label: 'Issue employment letters', description: 'Upload offer, appointment, resignation and termination letters.' },
  'departments.manage': { group: 'Employees', label: 'Departments & levels', description: 'Create departments, levels and their salaries.' },
  'teams.manage': { group: 'Employees', label: 'Manage all teams', description: 'Create teams and move people between any teams.' },
  'teams.manage_own': { group: 'Employees', label: 'Manage own team', description: 'Add or remove members of the team they lead.' },
  'team_transfer.approve': { group: 'Employees', label: 'Approve team transfers', description: 'Approve requests to move a person into another team.' },
  'promotions.manage': { group: 'Employees', label: 'Record promotions', description: 'Promote employees and change their level and salary.' },
  'resignation.approve.tl': { group: 'Employees', label: 'Review resignations (Team Lead)', description: 'First review of resignations from their team.' },
  'resignation.approve.hr': { group: 'Employees', label: 'Approve resignations (HR)', description: 'Final approval of resignations.' },
  'headcount.read': { group: 'Employees', label: 'Headcount & reports', description: 'See workforce numbers, joiners and leavers.' },
  'directory.settings': { group: 'Employees', label: 'Directory & session settings', description: 'Show or hide joining dates in the directory and set the sign-out timeout.' },

  'attendance.read.all': { group: 'Attendance & leave', label: 'View all attendance', description: 'See everyone’s attendance and reports.' },
  'attendance.read.team': { group: 'Attendance & leave', label: 'View team attendance', description: 'See attendance of the team they lead.' },
  'attendance.manage': { group: 'Attendance & leave', label: 'Manage attendance', description: 'Register devices, import punches and mark work-from-home days.' },
  'attendance_correction.approve.tl': { group: 'Attendance & leave', label: 'Approve corrections (Team Lead)', description: 'First approval of attendance corrections from their team.' },
  'attendance_correction.approve.hr': { group: 'Attendance & leave', label: 'Approve corrections (HR)', description: 'Final approval of attendance corrections.' },
  'overtime.approve.tl': { group: 'Attendance & leave', label: 'Approve overtime', description: 'Approve team overtime and record the work done.' },
  'compensation.approve.tl': { group: 'Attendance & leave', label: 'Approve compensation (Team Lead)', description: 'First approval of requests to use overtime.' },
  'compensation.approve.hr': { group: 'Attendance & leave', label: 'Approve compensation (HR)', description: 'Final approval of requests to use overtime.' },
  'leave.approve.tl': { group: 'Attendance & leave', label: 'Approve leave (Team Lead)', description: 'First approval of leave from their team.' },
  'leave.approve.hr': { group: 'Attendance & leave', label: 'Approve leave (HR)', description: 'Final approval and cancellation of leave.' },
  'leave.manage': { group: 'Attendance & leave', label: 'Leave settings', description: 'Leave types, yearly allowance, carry-forward and balance adjustments.' },
  'holidays.manage': { group: 'Attendance & leave', label: 'Manage holidays', description: 'Add public and company holidays.' },
  'calendar.manage': { group: 'Attendance & leave', label: 'Manage calendar', description: 'Add company and department events.' },

  'payroll.read.all': { group: 'Payroll', label: 'View payroll', description: 'See payroll runs and everyone’s salary slips.' },
  'payroll.process': { group: 'Payroll', label: 'Process payroll', description: 'Run, adjust, submit and reopen monthly payroll.' },
  'payroll.approve.hr': { group: 'Payroll', label: 'Approve payroll (HR)', description: 'First approval of a payroll run.' },
  'payroll.approve.ops': { group: 'Payroll', label: 'Approve payroll (Operations)', description: 'Final approval before salary slips are released.' },
  'loans.manage': { group: 'Payroll', label: 'Manage loans', description: 'Record loans, approve loan requests and log repayments.' },
  'medical.manage': { group: 'Payroll', label: 'Manage medical claims', description: 'Review and approve medical claims.' },
  'food_allowance.manage': { group: 'Payroll', label: 'Food allowance rules', description: 'Set food allowance amount and required hours per department.' },

  'kpi.approve.tl': { group: 'Performance', label: 'Review KPIs (Team Lead)', description: 'Review team KPI submissions and add remarks.' },
  'kpi.approve.hr': { group: 'Performance', label: 'Approve KPIs (HR)', description: 'Final approval of KPI submissions.' },
  'kpi.targets.manage': { group: 'Performance', label: 'Set KPI targets', description: 'Assign targets and the incentive formula.' },
  'incentives.manage': { group: 'Performance', label: 'Manage incentives', description: 'View and void incentives.' },

  'policies.manage': { group: 'Compliance', label: 'Manage policies', description: 'Upload, publish and archive company policies.' },
  'guidelines.manage': { group: 'Compliance', label: 'Community guidelines', description: 'Edit the guidelines people accept before using the community.' },
  'complaints.manage': { group: 'Compliance', label: 'Handle complaints', description: 'Read and resolve anonymous complaints.' },
  'queries.respond': { group: 'Compliance', label: 'Answer queries', description: 'Reply to and resolve queries assigned to them.' },
  'queries.read.all': { group: 'Compliance', label: 'View all queries', description: 'Monitor queries across all departments.' },
  'surveys.manage': { group: 'Compliance', label: 'Manage all surveys', description: 'Create and edit surveys for any department or team.' },
  'surveys.manage_team': { group: 'Compliance', label: 'Team surveys', description: 'Create surveys for the team they lead.' },

  'community.moderate': { group: 'Community', label: 'Moderate community', description: 'Delete posts and comments that break the guidelines.' },
  'community.posting.manage': { group: 'Community', label: 'Control posting', description: 'Decide who may post and switch engagement features on or off.' },
  'announcements.publish': { group: 'Community', label: 'Publish announcements', description: 'Post official announcements to the feed and dashboards.' },

  'reports.read': { group: 'Reports', label: 'View reports', description: 'See company-wide reports and statistics.' },
};
