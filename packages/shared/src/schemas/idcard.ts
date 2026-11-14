import { z } from 'zod';

/** Employee ID card template, set by the Company Admin (Settings → ID card). Every company starts from the default. */
export const ID_CARD_FIELDS = ['department', 'email', 'phone', 'bloodGroup', 'joiningDate', 'emergencyContact'] as const;
export type IdCardField = (typeof ID_CARD_FIELDS)[number];
export const ID_CARD_FIELD_LABELS: Record<IdCardField, string> = {
  department: 'Department',
  email: 'Email',
  phone: 'Phone',
  bloodGroup: 'Blood group',
  joiningDate: 'Joining date',
  emergencyContact: 'Emergency contact',
};

export const idCardTemplateSchema = z.object({
  /** Brand colour for the header band, as #rrggbb. */
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1d4ed8'),
  layout: z.enum(['VERTICAL', 'HORIZONTAL']),
  /** Optional details shown on the card (photo, name, job title, employee ID and company are always shown). */
  fields: z.array(z.enum(ID_CARD_FIELDS)).max(ID_CARD_FIELDS.length),
  /** Who signs the card, e.g. "Sara Ahmed", "Head of HR". */
  issuerName: z.string().trim().max(80),
  issuerTitle: z.string().trim().max(80),
  /** Card is valid this many years from the issue date (0 = no expiry shown). */
  validityYears: z.coerce.number().int().min(0).max(10),
  /** Back of the card: return-if-found note, address, etc. */
  backText: z.string().trim().max(400),
});
export type IdCardTemplate = z.infer<typeof idCardTemplateSchema>;

export const DEFAULT_ID_CARD: IdCardTemplate = {
  accentColor: '#1d4ed8',
  layout: 'VERTICAL',
  fields: ['department', 'email', 'phone', 'bloodGroup'],
  issuerName: '',
  issuerTitle: 'Human Resources',
  validityYears: 2,
  backText: 'This card is the property of the company and must be returned on leaving. If found, please return it to the HR department.',
};

/** Saved template merged over the default (older or partial settings still work). */
export function idCardTemplate(saved?: Partial<IdCardTemplate> | null): IdCardTemplate {
  return { ...DEFAULT_ID_CARD, ...(saved ?? {}) };
}
