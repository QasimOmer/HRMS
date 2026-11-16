import { z } from 'zod';
import { isoDate, optionalText, phone, trimmed, uuid } from './common';

/* ---------------- Safe links ---------------- */

/** Only http(s) links are accepted, so a stored link can never run script (javascript:, data:…). */
export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

const withScheme = (v: string) => (/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);

/** Optional web link: empty becomes undefined; "linkedin.com/in/x" gets https:// added. */
export const optionalUrl = z
  .string()
  .trim()
  .max(300, 'Keep the link to 300 characters or fewer')
  .optional()
  .transform((v) => (!v ? undefined : withScheme(v)))
  .refine((v) => v === undefined || isSafeHttpUrl(v), 'Enter a web link starting with http:// or https://');

/** Required web link (http/https only). */
export const requiredUrl = z
  .string()
  .trim()
  .min(1, 'Enter the link')
  .max(300, 'Keep the link to 300 characters or fewer')
  .transform(withScheme)
  .refine(isSafeHttpUrl, 'Enter a web link starting with http:// or https://');

export const SOCIAL_NETWORKS = ['linkedin', 'instagram', 'x', 'facebook', 'website'] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  x: 'X (Twitter)',
  facebook: 'Facebook',
  website: 'Portfolio / website',
};

export const socialLinksSchema = z.object({
  linkedin: optionalUrl,
  instagram: optionalUrl,
  x: optionalUrl,
  facebook: optionalUrl,
  website: optionalUrl,
  custom: z.array(z.object({ label: trimmed(1, 40), url: requiredUrl })).max(5).optional(),
});
export type SocialLinks = z.infer<typeof socialLinksSchema>;

/* ---------------- Dates ---------------- */

/** "2 yrs 3 mos" between two dates (end = today when missing). */
export function durationLabel(start: string | null | undefined, end?: string | null, today = new Date().toISOString().slice(0, 10)): string {
  if (!start) return '';
  const to = end || today;
  const [y1, m1, d1] = start.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = to.split('-').map(Number) as [number, number, number];
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months < 0) return '';
  if (months === 0) return 'Less than a month';
  const y = Math.floor(months / 12);
  months %= 12;
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', months ? `${months} mo${months > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ');
}

const notFuture = (d: string | undefined | null) => !d || d <= new Date(Date.now() + 14 * 3600_000).toISOString().slice(0, 10);

/* ---------------- Previous work experience ---------------- */

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'FREELANCE', 'OTHER'] as const;
export const EMPLOYMENT_TYPE_LABELS: Record<(typeof EMPLOYMENT_TYPES)[number], string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  INTERNSHIP: 'Internship',
  FREELANCE: 'Freelance',
  OTHER: 'Other',
};

export const experienceSchema = z
  .object({
    companyName: trimmed(2, 150),
    designation: trimmed(2, 120),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    department: optionalText(120),
    startDate: isoDate,
    endDate: isoDate.optional().nullable(),
    responsibilities: trimmed(2, 3000),
    achievements: optionalText(3000),
    reasonForLeaving: optionalText(1000),
    fileId: uuid.nullable().optional(),
  })
  .refine((e) => notFuture(e.startDate), { message: 'Start date cannot be in the future', path: ['startDate'] })
  .refine((e) => !e.endDate || e.endDate >= e.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] })
  .refine((e) => notFuture(e.endDate), { message: 'End date cannot be in the future', path: ['endDate'] });
export type ExperienceInput = z.infer<typeof experienceSchema>;

/* ---------------- Education ---------------- */

export const QUALIFICATION_LEVELS = ['MATRIC', 'O_LEVEL', 'INTERMEDIATE', 'A_LEVEL', 'DIPLOMA', 'BACHELORS', 'MASTERS', 'MPHIL', 'PHD', 'CERTIFICATE', 'OTHER'] as const;
export const QUALIFICATION_LABELS: Record<(typeof QUALIFICATION_LEVELS)[number], string> = {
  MATRIC: 'Matric / SSC',
  O_LEVEL: 'O Level',
  INTERMEDIATE: 'Intermediate / HSSC',
  A_LEVEL: 'A Level',
  DIPLOMA: 'Diploma',
  BACHELORS: "Bachelor's",
  MASTERS: "Master's",
  MPHIL: 'MPhil / MS',
  PHD: 'PhD',
  CERTIFICATE: 'Certificate',
  OTHER: 'Other',
};

export const educationSchema = z
  .object({
    qualificationLevel: z.enum(QUALIFICATION_LEVELS),
    degreeTitle: trimmed(2, 150),
    fieldOfStudy: optionalText(120),
    institution: trimmed(2, 150),
    board: optionalText(150),
    startDate: isoDate,
    completionDate: isoDate.optional().nullable(),
    currentlyStudying: z.boolean().default(false),
    grade: optionalText(30),
    fileId: uuid.nullable().optional(),
  })
  .refine((e) => notFuture(e.startDate), { message: 'Start date cannot be in the future', path: ['startDate'] })
  .refine((e) => e.currentlyStudying || !!e.completionDate, { message: 'Enter the completion date, or tick "Currently studying"', path: ['completionDate'] })
  .refine((e) => !e.completionDate || e.completionDate >= e.startDate, { message: 'Completion must be on or after the start date', path: ['completionDate'] });
export type EducationInput = z.infer<typeof educationSchema>;

/* ---------------- Certifications ---------------- */

export const certificationSchema = z
  .object({
    name: trimmed(2, 150),
    issuer: trimmed(2, 150),
    issueDate: isoDate,
    expiryDate: isoDate.optional().nullable(),
    credentialId: optionalText(100),
    verificationUrl: optionalUrl,
    description: optionalText(2000),
    fileId: uuid.nullable().optional(),
  })
  .refine((c) => notFuture(c.issueDate), { message: 'Issue date cannot be in the future', path: ['issueDate'] })
  .refine((c) => !c.expiryDate || c.expiryDate >= c.issueDate, { message: 'Expiry must be on or after the issue date', path: ['expiryDate'] });
export type CertificationInput = z.infer<typeof certificationSchema>;

/* ---------------- References ---------------- */

export const referenceSchema = z.object({
  name: trimmed(2, 120),
  designation: optionalText(120),
  organisation: trimmed(2, 150),
  relationship: trimmed(2, 80),
  email: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined))
    .pipe(z.email().optional()),
  phone: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(phone.optional()),
  yearsKnown: z.coerce.number().int().min(0).max(80).optional(),
  notes: optionalText(1000),
});
export type ReferenceInput = z.infer<typeof referenceSchema>;

/* ---------------- Records API ---------------- */

export const PROFILE_RECORD_KINDS = ['experience', 'education', 'certifications', 'references'] as const;
export type ProfileRecordKind = (typeof PROFILE_RECORD_KINDS)[number];

export const PROFILE_RECORD_SCHEMAS = {
  experience: experienceSchema,
  education: educationSchema,
  certifications: certificationSchema,
  references: referenceSchema,
} as const;

/** "Add more" sends every new entry at once; each becomes its own record. */
export const recordBatchSchema = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item).min(1, 'Add at least one entry').max(20) });
