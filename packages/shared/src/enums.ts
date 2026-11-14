export const EMPLOYMENT_STATUSES = ['ACTIVE', 'INACTIVE', 'RESIGNED', 'TERMINATED'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

/** Organisational hierarchy tiers for the directory org chart (B5). */
export const HIERARCHY_TIERS = ['DIRECTOR', 'CEO', 'MANAGEMENT', 'DEPARTMENT_HEAD', 'TEAM_LEAD', 'MEMBER'] as const;
export type HierarchyTier = (typeof HIERARCHY_TIERS)[number];
export const HIERARCHY_LABELS: Record<HierarchyTier, string> = {
  DIRECTOR: 'Director',
  CEO: 'CEO',
  MANAGEMENT: 'Management',
  DEPARTMENT_HEAD: 'Department Head',
  TEAM_LEAD: 'Team Lead',
  MEMBER: 'Team Member',
};

/** B2 onboarding documents (uploaded once by the employee) and B3 HR-issued documents. */
export const ONBOARDING_DOC_CATEGORIES = ['CNIC_FRONT', 'CNIC_BACK', 'PHOTO', 'EDUCATION', 'OTHER_ONBOARDING'] as const;
export const EMPLOYMENT_DOC_CATEGORIES = [
  'OFFER_LETTER',
  'APPOINTMENT_LETTER',
  'RESIGNATION_LETTER',
  'TERMINATION_LETTER',
  'OTHER_EMPLOYMENT',
] as const;
export const DOC_CATEGORIES = [...ONBOARDING_DOC_CATEGORIES, ...EMPLOYMENT_DOC_CATEGORIES] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];
export const DOC_CATEGORY_LABELS: Record<DocCategory, string> = {
  CNIC_FRONT: 'CNIC (front)',
  CNIC_BACK: 'CNIC (back)',
  PHOTO: 'Photograph',
  EDUCATION: 'Education certificate',
  OTHER_ONBOARDING: 'Other document',
  OFFER_LETTER: 'Offer letter',
  APPOINTMENT_LETTER: 'Appointment letter',
  RESIGNATION_LETTER: 'Resignation letter',
  TERMINATION_LETTER: 'Termination letter',
  OTHER_EMPLOYMENT: 'Other employment document',
};
/** Documents an employee must upload before onboarding is complete. */
export const REQUIRED_ONBOARDING_DOCS: DocCategory[] = ['CNIC_FRONT', 'CNIC_BACK', 'PHOTO'];

/** C5 calendar colours. */
export const ATTENDANCE_STATUSES = [
  'PRESENT',
  'LATE',
  'ABSENT',
  'ON_LEAVE',
  'HALF_DAY',
  'HOLIDAY',
  'WEEKEND',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_COLORS: Record<AttendanceStatus, string> = {
  PRESENT: '#16a34a', // green: satisfactory
  LATE: '#eab308', // yellow: late / irregular
  ABSENT: '#dc2626', // red
  ON_LEAVE: '#1e3a8a', // navy blue
  HALF_DAY: '#1e3a8a',
  HOLIDAY: '#7c3aed',
  WEEKEND: '#94a3b8',
};

export const PUNCH_TYPES = ['IN', 'OUT', 'BREAK_START', 'BREAK_END'] as const;
export type PunchType = (typeof PUNCH_TYPES)[number];

export const COMPENSATION_TYPES = ['PAID', 'HALF_DAY', 'REDUCED_HOURS'] as const;
export type CompensationType = (typeof COMPENSATION_TYPES)[number];

export const POLICY_CATEGORIES = [
  'COMPANY',
  'HR',
  'LEAVE',
  'ATTENDANCE',
  'LATE_ARRIVAL',
  'STIPEND',
  'OTHER',
] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];
export const POLICY_CATEGORY_LABELS: Record<PolicyCategory, string> = {
  COMPANY: 'Company policies & procedures',
  HR: 'HR policies',
  LEAVE: 'Leave policy',
  ATTENDANCE: 'Attendance policy',
  LATE_ARRIVAL: 'Late arrival policy',
  STIPEND: 'Stipend policy',
  OTHER: 'Other company guidelines',
};

export const COMPLAINT_CATEGORIES = ['HARASSMENT', 'DISCRIMINATION', 'MISCONDUCT', 'SAFETY', 'FRAUD', 'OTHER'] as const;
export const COMPLAINT_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const QUERY_STATUSES = ['PENDING', 'IN_PROGRESS', 'RESOLVED'] as const;
export type QueryStatus = (typeof QUERY_STATUSES)[number];
export const QUERY_CATEGORIES = ['GENERAL', 'PAYROLL', 'ATTENDANCE', 'LEAVE', 'IT', 'OTHER'] as const;

export const SURVEY_QUESTION_TYPES = ['TEXT', 'RATING', 'SINGLE_CHOICE', 'MULTI_CHOICE'] as const;
export const SURVEY_KINDS = ['PERFORMANCE', 'TEAM', 'DEPARTMENT', 'GENERAL'] as const;
export const SURVEY_AUDIENCES = ['ALL', 'DEPARTMENT', 'TEAM'] as const;
export const SURVEY_STATUSES = ['DRAFT', 'OPEN', 'CLOSED'] as const;

export const PAYROLL_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID'] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export const POST_TYPES = ['POST', 'ANNOUNCEMENT', 'BIRTHDAY'] as const;
export const COMMUNITY_POSTING_MODES = ['EVERYONE', 'GRANTED_ONLY', 'STAFF_ONLY'] as const;
export type CommunityPostingMode = (typeof COMMUNITY_POSTING_MODES)[number];

export const INCENTIVE_TYPES = ['FIXED', 'PERCENT_OF_EXCESS'] as const;
