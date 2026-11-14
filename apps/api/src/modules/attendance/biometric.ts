/**
 * Biometric device protocols (SRS 5.2, BIO-01).
 *
 *  - ZKTeco ADMS / Push SDK ("Cloud Server" setting): the device calls GET/POST /iclock/cdata with its
 *    serial number and uploads attendance logs (ATTLOG) as tab-separated text in device local time.
 *  - Hikvision ISAPI event notification ("HTTP listening"): the device POSTs AccessControllerEvent JSON
 *    (often inside multipart/form-data with a picture) to a URL that carries the device key.
 *
 * Hikvision ISUP 5.0 is a binary TCP protocol and needs a separate gateway; it is not handled here.
 */
import type { PunchType } from '@hrms/shared';
import { zonedInstant } from '../../common/tz';

export interface DevicePunch {
  /** User / PIN as enrolled on the device. Mapped to an employee by HR (BIO-04). */
  deviceUserId: string;
  at: Date;
  type: PunchType | null;
}

/** ZKTeco attendance state codes: 0 check-in, 1 check-out, 2 break-out, 3 break-in, 4/5 overtime in/out. */
const ZK_STATUS: Record<string, PunchType | null> = { '0': 'IN', '1': 'OUT', '2': 'BREAK_START', '3': 'BREAK_END', '4': 'IN', '5': 'OUT' };

/**
 * Parses an ADMS ATTLOG upload. Each line: PIN \t YYYY-MM-DD HH:MM:SS \t status \t verify \t workcode …
 * Times are wall-clock in the company's timezone.
 */
export function parseZkAttlog(body: string, tz: string): DevicePunch[] {
  const out: DevicePunch[] = [];
  for (const line of body.split(/\r?\n/)) {
    const cols = line.split('\t').map((c) => c.trim());
    if (cols.length < 2 || !cols[0]) continue;
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(cols[1] ?? '');
    if (!m) continue;
    const at = new Date(zonedInstant(m[1]!, `${m[2]}:${m[3]}`, tz).getTime() + Number(m[4] ?? 0) * 1000);
    out.push({ deviceUserId: cols[0].slice(0, 40), at, type: ZK_STATUS[cols[2] ?? ''] ?? null });
  }
  return out;
}

/** Device options returned on the ADMS handshake. `TimeZone` is the UTC offset in hours. */
export function zkHandshake(serial: string, utcOffsetMinutes: number): string {
  return [
    `GET OPTION FROM: ${serial}`,
    'ATTLOGStamp=None',
    'OPERLOGStamp=9999',
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog',
    `TimeZone=${Math.round(utcOffsetMinutes / 60)}`,
    'Realtime=1',
    'Encrypt=None',
    '',
  ].join('\n');
}

const HIK_STATUS: Record<string, PunchType | null> = {
  checkIn: 'IN',
  checkOut: 'OUT',
  breakOut: 'BREAK_START',
  breakIn: 'BREAK_END',
  overtimeIn: 'IN',
  overtimeOut: 'OUT',
};

interface HikEvent {
  eventType?: string;
  dateTime?: string;
  AccessControllerEvent?: { employeeNoString?: string; employeeNo?: number | string; attendanceStatus?: string; serialNo?: number };
}

/** Accepts the parsed JSON body or the multipart field values the device sent. */
export function parseHikvisionEvents(payload: unknown): DevicePunch[] {
  const candidates: unknown[] = [];
  const collect = (v: unknown) => {
    if (typeof v === 'string') {
      try {
        collect(JSON.parse(v));
      } catch {
        /* not JSON (e.g. a picture field) */
      }
    } else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') {
      if ('eventType' in v) candidates.push(v);
      else Object.values(v).forEach(collect);
    }
  };
  collect(payload);

  const out: DevicePunch[] = [];
  for (const raw of candidates as HikEvent[]) {
    if (raw.eventType !== 'AccessControllerEvent' || !raw.AccessControllerEvent || !raw.dateTime) continue;
    const ev = raw.AccessControllerEvent;
    const user = String(ev.employeeNoString ?? ev.employeeNo ?? '').trim();
    const at = new Date(raw.dateTime);
    // Events without a person (door opened by button, alarms…) are door events, not attendance (BIO-05).
    if (!user || Number.isNaN(at.getTime())) continue;
    out.push({ deviceUserId: user.slice(0, 40), at, type: HIK_STATUS[ev.attendanceStatus ?? ''] ?? null });
  }
  return out;
}

/** A device counts as online when it called in recently (ADMS polls every few seconds; BIO-07). */
export const ONLINE_WINDOW_MS = 5 * 60_000;
