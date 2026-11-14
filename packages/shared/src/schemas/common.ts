import { z } from 'zod';

/**
 * Plain-language defaults for validation messages (shown in forms and API errors), instead of
 * library wording like "Too small: expected string to have >=2 characters". Schemas with their own
 * message keep it.
 */
z.config({
  customError: (iss) => {
    const n = Number(iss.minimum ?? iss.maximum);
    if (iss.code === 'too_small' && iss.origin === 'string') return n <= 1 ? 'This field is required' : `Enter at least ${n} characters`;
    if (iss.code === 'too_big' && iss.origin === 'string') return `Keep it to ${n} characters or fewer`;
    if (iss.code === 'too_small' && iss.origin === 'number') return `Must be at least ${n}`;
    if (iss.code === 'too_big' && iss.origin === 'number') return `Must be ${n} or less`;
    if (iss.code === 'too_small' && iss.origin === 'array') return n <= 1 ? 'Choose at least one' : `Choose at least ${n}`;
    if (iss.code === 'invalid_type' && iss.input === undefined) return 'This field is required';
    if (iss.code === 'invalid_type' && iss.expected === 'number') return 'Enter a number';
    if (iss.code === 'invalid_format' && iss.format === 'email') return 'Enter a valid email address';
    if (iss.code === 'invalid_format' && iss.format === 'date') return 'Enter a valid date';
    if (iss.code === 'invalid_value') return 'Choose one of the options';
    return undefined;
  },
});

export const uuid = z.uuid();
export const isoDate = z.iso.date(); // YYYY-MM-DD
export const isoDateTime = z.iso.datetime({ offset: true });
export const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');
export const money = z.coerce.number().min(0).max(1_000_000_000);
export const trimmed = (min = 1, max = 200) => z.string().trim().min(min).max(max);
export const optionalText = (max = 2000) =>
  z.string().trim().max(max).optional().transform((v) => (v === '' ? undefined : v));

/** Pakistani CNIC: 13 digits, optionally formatted 12345-1234567-1. */
export const cnic = z
  .string()
  .trim()
  .regex(/^\d{5}-?\d{7}-?\d$/, 'CNIC must be 13 digits (e.g. 35202-1234567-1)')
  .transform((v) => {
    const d = v.replace(/-/g, '');
    return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
  });

/**
 * Phone numbers: Pakistani local (0 + 9–10 digits, e.g. 0300 1234567 or 042 1234567), +92 + 10 digits,
 * or another country's number starting with + (8–15 digits). Spaces, dashes and brackets are ignored.
 */
export function phoneProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/[^0-9+ ()-]/.test(v) || v.indexOf('+') > 0) return 'Use digits only, e.g. 0300 1234567';
  const d = v.replace(/[^0-9+]/g, '');
  if (d.startsWith('+92')) return /^\+92\d{10}$/.test(d) ? null : 'A +92 number has 10 digits after +92, e.g. +92 300 1234567';
  if (d.startsWith('+')) return /^\+\d{8,15}$/.test(d) ? null : 'Enter the full international number, e.g. +44 7911 123456';
  if (!d.startsWith('0')) return 'Start with 0 (e.g. 0300 1234567) or a country code like +92';
  if (d.length < 10) return 'This number is too short, e.g. 0300 1234567';
  if (d.length > 11) return 'This number is too long, e.g. 0300 1234567';
  return null;
}

export const phone = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    const problem = v ? phoneProblem(v) : 'Enter a phone number';
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

export const password = z
  .string()
  .min(12, 'At least 12 characters')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), 'Use upper and lower case letters and a number');

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(100).optional(),
});
export type Pagination = z.infer<typeof pagination>;

export const decision = z.object({
  approve: z.boolean(),
  comment: optionalText(1000),
});
export type DecisionInput = z.infer<typeof decision>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** A real IANA time zone, e.g. "Asia/Karachi" (checked with the runtime's time zone database). */
export const timeZone = z
  .string()
  .min(1)
  .max(60)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Choose a time zone from the list');

/** Email domain such as "prepecom.com" (lower case, no @). */
export const emailDomain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{3,100}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, 'Enter a domain like company.com');

/** Every domain a company's login emails may use: the main one first, then the extra ones. */
export const companyEmailDomains = (t: { emailDomain?: string | null; extraEmailDomains?: string[] | null }): string[] =>
  [...new Set([t.emailDomain, ...(t.extraEmailDomains ?? [])].filter((d): d is string => !!d))];

/** Suggested company email domain from its name: "Prep Ecom Align" → "prepecomalign.com". */
export const suggestEmailDomain = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60) || 'company'}.com`;

/** ISO 4217 currency code, e.g. "PKR". */
export const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Choose a currency from the list');
