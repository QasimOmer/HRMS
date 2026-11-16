/**
 * International dialling codes and per-country phone validation. Numbers are stored and shown in
 * international form: "+<code> <national number>", e.g. "+92 3001234567".
 */
export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 code. */
  iso: string;
  name: string;
  /** Dialling code without the "+". */
  dial: string;
  /** Allowed length of the national number (digits after the code, no leading trunk 0). */
  min: number;
  max: number;
}

export const DEFAULT_PHONE_COUNTRY = 'PK';

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { iso: 'PK', name: 'Pakistan', dial: '92', min: 9, max: 10 },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971', min: 8, max: 9 },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966', min: 9, max: 9 },
  { iso: 'QA', name: 'Qatar', dial: '974', min: 8, max: 8 },
  { iso: 'KW', name: 'Kuwait', dial: '965', min: 8, max: 8 },
  { iso: 'OM', name: 'Oman', dial: '968', min: 8, max: 8 },
  { iso: 'BH', name: 'Bahrain', dial: '973', min: 8, max: 8 },
  { iso: 'GB', name: 'United Kingdom', dial: '44', min: 9, max: 10 },
  { iso: 'US', name: 'United States', dial: '1', min: 10, max: 10 },
  { iso: 'CA', name: 'Canada', dial: '1', min: 10, max: 10 },
  { iso: 'AU', name: 'Australia', dial: '61', min: 9, max: 9 },
  { iso: 'NZ', name: 'New Zealand', dial: '64', min: 8, max: 10 },
  { iso: 'IN', name: 'India', dial: '91', min: 10, max: 10 },
  { iso: 'BD', name: 'Bangladesh', dial: '880', min: 10, max: 10 },
  { iso: 'LK', name: 'Sri Lanka', dial: '94', min: 9, max: 9 },
  { iso: 'NP', name: 'Nepal', dial: '977', min: 8, max: 10 },
  { iso: 'AF', name: 'Afghanistan', dial: '93', min: 9, max: 9 },
  { iso: 'CN', name: 'China', dial: '86', min: 10, max: 11 },
  { iso: 'HK', name: 'Hong Kong', dial: '852', min: 8, max: 8 },
  { iso: 'SG', name: 'Singapore', dial: '65', min: 8, max: 8 },
  { iso: 'MY', name: 'Malaysia', dial: '60', min: 9, max: 10 },
  { iso: 'ID', name: 'Indonesia', dial: '62', min: 9, max: 12 },
  { iso: 'PH', name: 'Philippines', dial: '63', min: 10, max: 10 },
  { iso: 'TH', name: 'Thailand', dial: '66', min: 9, max: 9 },
  { iso: 'JP', name: 'Japan', dial: '81', min: 9, max: 10 },
  { iso: 'KR', name: 'South Korea', dial: '82', min: 9, max: 10 },
  { iso: 'TR', name: 'Türkiye', dial: '90', min: 10, max: 10 },
  { iso: 'IR', name: 'Iran', dial: '98', min: 10, max: 10 },
  { iso: 'IQ', name: 'Iraq', dial: '964', min: 10, max: 10 },
  { iso: 'JO', name: 'Jordan', dial: '962', min: 9, max: 9 },
  { iso: 'EG', name: 'Egypt', dial: '20', min: 10, max: 10 },
  { iso: 'MA', name: 'Morocco', dial: '212', min: 9, max: 9 },
  { iso: 'NG', name: 'Nigeria', dial: '234', min: 10, max: 10 },
  { iso: 'KE', name: 'Kenya', dial: '254', min: 9, max: 9 },
  { iso: 'ZA', name: 'South Africa', dial: '27', min: 9, max: 9 },
  { iso: 'DE', name: 'Germany', dial: '49', min: 10, max: 11 },
  { iso: 'FR', name: 'France', dial: '33', min: 9, max: 9 },
  { iso: 'IT', name: 'Italy', dial: '39', min: 9, max: 10 },
  { iso: 'ES', name: 'Spain', dial: '34', min: 9, max: 9 },
  { iso: 'NL', name: 'Netherlands', dial: '31', min: 9, max: 9 },
  { iso: 'BE', name: 'Belgium', dial: '32', min: 8, max: 9 },
  { iso: 'CH', name: 'Switzerland', dial: '41', min: 9, max: 9 },
  { iso: 'SE', name: 'Sweden', dial: '46', min: 7, max: 9 },
  { iso: 'NO', name: 'Norway', dial: '47', min: 8, max: 8 },
  { iso: 'DK', name: 'Denmark', dial: '45', min: 8, max: 8 },
  { iso: 'IE', name: 'Ireland', dial: '353', min: 9, max: 9 },
  { iso: 'PT', name: 'Portugal', dial: '351', min: 9, max: 9 },
  { iso: 'PL', name: 'Poland', dial: '48', min: 9, max: 9 },
  { iso: 'RU', name: 'Russia', dial: '7', min: 10, max: 10 },
  { iso: 'BR', name: 'Brazil', dial: '55', min: 10, max: 11 },
  { iso: 'MX', name: 'Mexico', dial: '52', min: 10, max: 10 },
];

const byDialLength = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

export const phoneCountry = (iso: string | null | undefined): PhoneCountry =>
  PHONE_COUNTRIES.find((c) => c.iso === iso) ?? PHONE_COUNTRIES[0]!;

/** The country whose dialling code starts these digits (longest code wins), if we know it. */
export function countryForDigits(digits: string): PhoneCountry | undefined {
  return byDialLength.find((c) => digits.startsWith(c.dial));
}

/**
 * Splits a stored or typed number into country + national digits. Legacy Pakistani local numbers
 * ("0300 1234567") are read as +92. `preferIso` picks between countries sharing a code (+1 US/CA).
 */
export function parsePhone(value: string | null | undefined, preferIso?: string): { country: PhoneCountry; national: string } {
  const v = (value ?? '').trim();
  const digits = v.replace(/\D/g, '');
  if (v.startsWith('+')) {
    const pref = preferIso ? phoneCountry(preferIso) : undefined;
    const c = pref && digits.startsWith(pref.dial) ? pref : countryForDigits(digits);
    if (c) return { country: c, national: digits.slice(c.dial.length) };
    return { country: phoneCountry(preferIso ?? DEFAULT_PHONE_COUNTRY), national: digits };
  }
  const country = phoneCountry(preferIso ?? DEFAULT_PHONE_COUNTRY);
  return { country, national: digits.replace(/^0+/, '') };
}

/** International form "+92 3001234567" (empty input stays empty). */
export function toInternationalPhone(value: string | null | undefined, preferIso?: string): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  const digits = v.replace(/\D/g, '');
  if (v.startsWith('+') && !countryForDigits(digits)) return digits ? `+${digits}` : '';
  const { country, national } = parsePhone(v, preferIso);
  return national ? `+${country.dial} ${national}` : '';
}

/** Readable international form for display: "+92 300 1234567". */
export function formatPhoneDisplay(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  if (v.startsWith('+') && !countryForDigits(v.replace(/\D/g, ''))) return v;
  const { country, national } = parsePhone(v);
  if (!national) return v;
  const groups = national.length > 7 ? [national.slice(0, 3), national.slice(3)] : [national];
  return `+${country.dial} ${groups.join(' ')}`;
}

/**
 * Problem with a phone number for its country, or null when it's fine (empty is fine; required-ness is
 * checked separately). Accepts "+<code> <number>" and Pakistani local numbers starting with 0.
 */
export function phoneProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/[^0-9+ ()-]/.test(v) || v.lastIndexOf('+') > 0) return 'Use digits only, e.g. 0300 1234567';
  const digits = v.replace(/\D/g, '');
  if (v.startsWith('+')) {
    const c = countryForDigits(digits);
    if (!c) return /^\d{8,15}$/.test(digits) ? null : 'Enter the full international number, e.g. +44 7911 123456';
    const n = digits.length - c.dial.length;
    if (n === 0) return 'Enter the phone number after the country code';
    const range = c.min === c.max ? `${c.min}` : `${c.min}–${c.max}`;
    if (n < c.min || n > c.max) return `A ${c.name} number has ${range} digits after +${c.dial}`;
    return null;
  }
  if (!digits.startsWith('0')) return 'Start with 0 (e.g. 0300 1234567) or a country code like +92';
  if (digits.length < 10) return 'This number is too short, e.g. 0300 1234567';
  if (digits.length > 11) return 'This number is too long, e.g. 0300 1234567';
  return null;
}
