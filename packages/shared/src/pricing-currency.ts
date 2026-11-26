/**
 * Prices are set in PKR (platform currency). Visitors pick a country and see the same price converted
 * to its currency; a company is invoiced in the currency it chose at sign-up.
 *
 * Rates are PKR per 1 unit of each currency. Update them here when exchange rates move
 * (source: mid-market rates, Nov 2026).
 */
export const BILLING_CURRENCIES = ['PKR', 'AED', 'SAR', 'GBP', 'USD', 'EUR'] as const;
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];

export const PKR_PER_UNIT: Record<BillingCurrency, number> = {
  PKR: 1,
  AED: 76.2,
  SAR: 74.6,
  GBP: 377,
  USD: 280,
  EUR: 330,
};

/** Countries offered in the pricing dropdown, with the currency each one pays in. */
export const PRICING_COUNTRIES: { code: string; name: string; currency: BillingCurrency }[] = [
  { code: 'PK', name: 'Pakistan', currency: 'PKR' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'EU', name: 'European Union', currency: 'EUR' },
  { code: 'OTHER', name: 'Other countries', currency: 'USD' },
];

export function isBillingCurrency(c: string | null | undefined): c is BillingCurrency {
  return !!c && (BILLING_CURRENCIES as readonly string[]).includes(c);
}

/** The currency a company is invoiced in: its own currency when supported, otherwise USD. */
export function billingCurrencyFor(currency: string | null | undefined): BillingCurrency {
  return isBillingCurrency(currency) ? currency : 'USD';
}

/** Converts an amount between supported currencies via PKR, rounded to 2 decimals (whole rupees for PKR). */
export function convertCurrency(amount: number, from: string, to: string): number {
  if (from === to) return amount;
  const fromRate = isBillingCurrency(from) ? PKR_PER_UNIT[from] : 1;
  const toRate = isBillingCurrency(to) ? PKR_PER_UNIT[to] : 1;
  const value = (amount * fromRate) / toRate;
  return to === 'PKR' ? Math.round(value) : Math.round(value * 100) / 100;
}

const EU_COUNTRIES = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']);

/** Best guess of a visitor's pricing country from the browser's time zone and language. */
export function guessPricingCountry(timeZone?: string, locale?: string): string {
  const tz = timeZone ?? '';
  if (tz === 'Asia/Karachi') return 'PK';
  if (tz === 'Asia/Dubai') return 'AE';
  if (tz === 'Asia/Riyadh') return 'SA';
  if (tz === 'Europe/London') return 'GB';
  const region = (locale ?? '').split('-')[1]?.toUpperCase();
  if (region && PRICING_COUNTRIES.some((c) => c.code === region)) return region;
  if (region && EU_COUNTRIES.has(region)) return 'EU';
  if (tz.startsWith('Europe/')) return 'EU';
  if (tz.startsWith('America/')) return 'US';
  return 'OTHER';
}
