/**
 * Product branding, set once per deployment through environment variables
 * (see .env.example → "Branding"). Nothing else needs editing to rebrand the SaaS.
 */
export const SITE = {
  name: process.env.NEXT_PUBLIC_APP_NAME || 'HRMS',
  tagline: process.env.NEXT_PUBLIC_APP_TAGLINE || 'People, payroll and attendance in one place.',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '',
} as const;
