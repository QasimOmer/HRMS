import type { ComboOption } from '@/components/ui/combobox';

/** UTC offset of a time zone right now, e.g. "UTC+05:00". */
function utcOffset(tz: string): { text: string; minutes: number } {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(part ?? '');
    if (!m) return { text: 'UTC+00:00', minutes: 0 };
    const minutes = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    return { text: `UTC${m[1]}${m[2]}:${m[3]}`, minutes };
  } catch {
    return { text: '', minutes: 0 };
  }
}

let tzCache: ComboOption[] | null = null;

/** Every IANA time zone the browser knows, sorted by UTC offset, searchable by city, region or offset. */
export function timeZoneOptions(): ComboOption[] {
  if (tzCache) return tzCache;
  const zones: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC', 'Asia/Karachi'];
  if (!zones.includes('UTC')) zones.unshift('UTC');
  tzCache = zones
    .map((tz) => {
      const off = utcOffset(tz);
      const city = tz.split('/').pop()!.replace(/_/g, ' ');
      return { value: tz, label: tz.replace(/_/g, ' '), hint: off.text, keywords: `${city} ${off.text.replace('UTC', 'GMT')}`, minutes: off.minutes };
    })
    .sort((a, b) => a.minutes - b.minutes || a.label.localeCompare(b.label))
    .map(({ minutes: _m, ...o }) => o);
  return tzCache;
}

let curCache: ComboOption[] | null = null;

/** ISO currency codes with their names, e.g. "PKR – Pakistani Rupee". */
export function currencyOptions(): ComboOption[] {
  if (curCache) return curCache;
  const codes: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'SAR'];
  const names = new Intl.DisplayNames(['en'], { type: 'currency' });
  curCache = codes.map((c) => {
    const name = names.of(c) ?? c;
    return { value: c, label: `${c} – ${name}`, keywords: name };
  });
  // Most likely choices first.
  const top = ['PKR', 'USD', 'AED', 'SAR', 'GBP', 'EUR'];
  curCache.sort((a, b) => {
    const ia = top.indexOf(a.value);
    const ib = top.indexOf(b.value);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.value.localeCompare(b.value);
  });
  return curCache;
}
