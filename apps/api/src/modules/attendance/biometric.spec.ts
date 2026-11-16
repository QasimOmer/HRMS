import { parseHikvisionEvents, parseZkAttlog, zkHandshake } from './biometric';

describe('ZKTeco ADMS', () => {
  it('parses ATTLOG lines in company local time and maps status codes', () => {
    const body = '1001\t2026-11-10 09:02:11\t0\t1\t0\t0\n1001\t2026-11-10 18:05:00\t1\t1\t0\t0\n\n7\t2026-11-10 13:00:00\t2\t15\n';
    const r = parseZkAttlog(body, 'Asia/Karachi');
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ deviceUserId: '1001', at: new Date('2026-11-10T04:02:11Z'), type: 'IN' });
    expect(r[1]!.type).toBe('OUT');
    expect(r[2]).toMatchObject({ deviceUserId: '7', type: 'BREAK_START' });
  });

  it('skips malformed lines', () => {
    expect(parseZkAttlog('garbage\nOPLOG 4\t0\t2026', 'Asia/Karachi')).toEqual([]);
  });

  it('builds the handshake with the UTC offset in hours', () => {
    const h = zkHandshake('ABC123', 300);
    expect(h).toContain('GET OPTION FROM: ABC123');
    expect(h).toContain('TimeZone=5');
    expect(h).toContain('Realtime=1');
  });
});

describe('Hikvision ISAPI', () => {
  const event = {
    ipAddress: '192.168.1.20',
    dateTime: '2026-11-10T09:02:11+05:00',
    eventType: 'AccessControllerEvent',
    AccessControllerEvent: { majorEventType: 5, subEventType: 75, employeeNoString: '1001', attendanceStatus: 'checkIn' },
  };

  it('parses a JSON event', () => {
    expect(parseHikvisionEvents(event)).toEqual([{ deviceUserId: '1001', at: new Date('2026-11-10T04:02:11Z'), type: 'IN' }]);
  });

  it('parses the JSON string inside a multipart field', () => {
    const r = parseHikvisionEvents({ event_log: JSON.stringify({ ...event, AccessControllerEvent: { ...event.AccessControllerEvent, attendanceStatus: 'checkOut' } }) });
    expect(r[0]?.type).toBe('OUT');
  });

  it('ignores heartbeats and door events without a person', () => {
    expect(parseHikvisionEvents({ eventType: 'heartBeat', dateTime: event.dateTime })).toEqual([]);
    expect(parseHikvisionEvents({ ...event, AccessControllerEvent: { majorEventType: 3, subEventType: 1024 } })).toEqual([]);
  });
});
