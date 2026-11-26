// Full workflow test against a running local API. Usage: node scripts/e2e-flows.mjs
import { randomBytes } from 'node:crypto';
import { Client, createCompany, expect, platformClient, testPassword } from './smoke.mjs';

// Same server as the rest of the tests (API_URL), also for device endpoints outside /api/v1.
const ORIGIN = (process.env.API_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');
const TZ = 'Asia/Karachi';
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const today = ymd(new Date());
const addDays = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dow = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
const prevWeekday = (s, skip = 1) => {
  let d = s;
  let n = 0;
  while (n < skip) {
    d = addDays(d, -1);
    if (dow(d) >= 1 && dow(d) <= 5) n++;
  }
  return d;
};
const nextMonday = (() => {
  let d = addDays(today, 1);
  while (dow(d) !== 1) d = addDays(d, 1);
  return d;
})();
const pk = (date, hhmm) => `${date}T${hhmm}:00+05:00`;

async function login(workspace, email, password) {
  const c = new Client();
  await c.get('/auth/csrf');
  const r = await c.post('/auth/login', { workspace, email, password });
  expect(r.status === 200, `login ${email}`, r);
  return c;
}

async function main() {
  const ws = `e2e-${randomBytes(3).toString('hex')}`;
  const pw = testPassword();
  const platform = await platformClient();
  const admin = await createCompany(platform, { companyName: 'E2E Ltd', workspace: ws, adminName: 'Sam Super', email: `sam@${ws}.test`, password: pw });

  const depts = (await admin.get('/departments')).data;
  const sales = depts.find((d) => d.code === 'SALES');
  const hrDept = depts.find((d) => d.code === 'HR');
  const opsDept = depts.find((d) => d.code === 'OPS');
  const levels = (await admin.get(`/levels?departmentId=${sales.id}`)).data;
  const lvl = (code, list = levels) => list.find((l) => l.code === code);
  const hrLevels = (await admin.get(`/levels?departmentId=${hrDept.id}`)).data;
  const opsLevels = (await admin.get(`/levels?departmentId=${opsDept.id}`)).data;
  expect(levels.length === 7 && lvl('L2').title === 'Sales Executive', 'default B7 ladder provisioned');

  const joined = addDays(today, -60);
  const mk = async (name, email, deptId, levelId, roles, extra = {}) => {
    const r = await admin.post('/employees', { fullName: name, email, departmentId: deptId, levelId, designation: name.split(' ')[1] ?? 'Staff', joiningDate: joined, roles, sendInvite: false, ...extra });
    expect(r.status === 201, `create employee ${name}`, r);
    const p = await admin.post(`/access/users/${r.data.userId}/password`, { password: pw, mustChange: false });
    expect(p.status === 201, `set password ${name}`, p);
    return r.data;
  };
  const hr = await mk('Hina HR', `hina@${ws}.test`, hrDept.id, lvl('L3', hrLevels).id, ['HR']);
  const ops = await mk('Omar Ops', `omar@${ws}.test`, opsDept.id, lvl('L3', opsLevels).id, ['OPERATIONS']);
  const tl = await mk('Tariq Lead', `tariq@${ws}.test`, sales.id, lvl('L4').id, ['TEAM_LEAD']);
  const emp = await mk('Esha Exec', `esha@${ws}.test`, sales.id, lvl('L2').id, ['EMPLOYEE'], { dateOfBirth: `1995-${today.slice(5)}` });
  expect(emp.basicSalary === lvl('L2').defaultSalary, 'salary auto-filled from level (B7)');

  const team = await admin.post('/teams', { name: 'Sales Alpha', departmentId: sales.id, leadEmployeeId: tl.id });
  expect(team.status === 201, 'team created');
  expect((await admin.post(`/teams/${team.data.id}/members`, { employeeId: emp.id })).data.added === true, 'employee added to team');

  const HR = await login(ws, `hina@${ws}.test`, pw);
  const OPS = await login(ws, `omar@${ws}.test`, pw);
  const TL = await login(ws, `tariq@${ws}.test`, pw);
  let E = await login(ws, `esha@${ws}.test`, pw);

  // ---- Access control & data scope (F4)
  expect((await E.get('/employees')).status === 403, 'employee cannot list employees');
  expect((await E.get('/payroll/runs')).status === 403, 'employee cannot see payroll runs');
  expect((await E.get(`/employees/${tl.id}`)).status === 403, 'employee cannot open another profile');
  const tlView = await TL.get(`/employees/${emp.id}`);
  expect(tlView.status === 200 && tlView.data.basicSalary === null, 'team lead sees member profile with salary redacted');
  expect((await TL.get(`/employees/${hr.id}`)).status === 403, 'team lead cannot see non-members');
  const selfEdit = await E.req('PATCH', '/me/profile', { contactNo: '+92 300 1234567', bloodGroup: 'O+' });
  expect(selfEdit.status === 200, 'employee edits own allowed fields (B1)');

  // ---- Password help from Edit employee
  const eUser = (await HR.get(`/employees/${emp.id}`)).data.userId;
  expect((await HR.post(`/access/users/${eUser}/reset-link`, {})).status === 201, 'HR emails a reset link from Edit employee');
  expect((await HR.post(`/access/users/${eUser}/password`, { password: pw, mustChange: false })).status === 201, 'HR resets an employee password from Edit employee');
  E = await login(ws, `esha@${ws}.test`, pw); // a new password signs them out everywhere
  expect((await HR.post(`/access/users/${(await admin.get("/auth/me")).data.user.id}/password`, { password: pw, mustChange: false })).status === 403, 'HR cannot reset the Company Admin password');
  const eLink = await E.post(`/access/users/${eUser}/reset-link`, {});
  expect(eLink.status === 403, 'employees cannot send reset links', eLink);

  // ---- Leave: Team Lead → HR (C3)
  const types = (await E.get('/leave/types')).data;
  const casual = types.find((t) => t.code === 'CASUAL');
  const lr = await E.post('/leave/requests', { leaveTypeId: casual.id, startDate: nextMonday, endDate: addDays(nextMonday, 1), reason: 'Family event' });
  expect(lr.status === 201 && lr.data.status === 'PENDING' && lr.data.currentStep === 'TEAM_LEAD', 'leave submitted to team lead', lr);
  expect((await HR.post(`/leave/requests/${lr.data.id}/decision`, { approve: true })).status === 403, 'HR cannot skip the team lead step');
  const inbox = (await TL.get('/approvals/inbox')).data;
  expect(inbox.some((i) => i.id === lr.data.id), 'leave appears in team lead inbox');
  expect((await TL.post(`/leave/requests/${lr.data.id}/decision`, { approve: true, comment: 'OK' })).data.currentStep === 'HR', 'team lead approval forwards to HR');
  expect((await HR.post(`/leave/requests/${lr.data.id}/decision`, { approve: true })).data.status === 'APPROVED', 'HR final approval');
  const bal = (await E.get('/leave/balances')).data.find((b) => b.code === 'CASUAL');
  expect(bal.used === 2 && bal.available === 12, 'leave balance updated (14 → 12)', bal);
  const cal = await E.get(`/calendar?month=${nextMonday.slice(0, 7)}`);
  expect(cal.data.leaves.some((l) => l.id === lr.data.id && l.status === 'APPROVED'), 'approved leave shows on calendar (C5)');
  const cancel = await E.post(`/leave/requests/${lr.data.id}/cancel`, { reason: 'Plans changed' });
  expect(cancel.data.cancellationStatus === 'REQUESTED', 'cancellation goes to HR', cancel);
  expect((await HR.post(`/leave/requests/${lr.data.id}/cancellation-decision`, { approve: true })).data.cancelled === true, 'HR cancels leave');
  const notif = (await E.get('/notifications/unread-count')).data;
  expect(notif.count >= 3, 'employee received notifications (G4)', notif);

  // ---- Biometric attendance & overtime (C1, C2)
  const dev = await admin.post('/attendance/devices', { name: 'Front door' });
  expect(dev.status === 201 && dev.data.apiKey, 'device registered', dev);
  const d1 = prevWeekday(today, 1);
  const d2 = prevWeekday(today, 2);
  const devRes = await fetch(ORIGIN + '/api/v1/attendance/device/punches', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-key': dev.data.apiKey },
    body: JSON.stringify({ punches: [
      { employeeCode: emp.employeeCode, at: pk(d1, '09:00') }, { employeeCode: emp.employeeCode, at: pk(d1, '13:00') },
      { employeeCode: emp.employeeCode, at: pk(d1, '14:00') }, { employeeCode: emp.employeeCode, at: pk(d1, '20:00') },
      { employeeCode: emp.employeeCode, at: pk(d2, '09:40') }, { employeeCode: emp.employeeCode, at: pk(d2, '18:40') },
      { employeeCode: 'NOPE-1', at: pk(d2, '09:00') },
    ] }),
  });
  const devJson = await devRes.json();
  expect(devRes.status === 200 && devJson.inserted === 6 && devJson.unknownEmployeeCodes[0] === 'NOPE-1', 'device push accepted', devJson);
  const badDev = await fetch(ORIGIN + '/api/v1/attendance/device/punches', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-key': `${dev.data.apiKey.slice(0, 37)}wrong-secret-value-xx` }, body: JSON.stringify({ punches: [{ employeeCode: emp.employeeCode, at: pk(d1, '09:00') }] }) });
  expect(badDev.status === 401, 'invalid device key rejected');
  const days = (await E.get(`/attendance/days?from=${d2}&to=${d1}`)).data;
  const day1 = days.find((d) => d.date === d1);
  const day2 = days.find((d) => d.date === d2);
  expect(day1?.status === 'PRESENT' && day1.overtimeMinutes === 120, 'present day with 2h overtime', day1);
  expect(day2?.status === 'LATE' && day2.lateMinutes === 40, 'late arrival flagged', day2);
  const ot = (await TL.get('/attendance/overtime?status=PENDING')).data.find((o) => o.date === d1);
  expect(ot && ot.canDecide, 'overtime awaits team lead');
  expect((await TL.post(`/attendance/overtime/${ot.id}/decision`, { approve: true })).status === 400, 'overtime approval requires work description');
  expect((await TL.post(`/attendance/overtime/${ot.id}/decision`, { approve: true, workDescription: 'Client demo preparation' })).data.status === 'APPROVED', 'team lead approves overtime');
  const otBal = (await E.get('/attendance/compensation/balance')).data;
  expect(otBal.availableMinutes === 120, 'overtime balance available for compensation', otBal);
  const comp = await E.post('/attendance/compensation', { type: 'PAID', minutes: 120, reason: 'Paid compensation please' });
  expect(comp.status === 201, 'paid compensation requested (Sales has paid overtime)', comp);
  await TL.post(`/attendance/compensation/${comp.data.id}/decision`, { approve: true });
  expect((await HR.post(`/attendance/compensation/${comp.data.id}/decision`, { approve: true })).data.status === 'APPROVED', 'compensation approved TL → HR');

  // ---- KPI → incentive (E1, E2)
  const month = today.slice(0, 7);
  const target = await HR.post('/kpi/targets', { employeeId: emp.id, period: month, metric: 'Sales revenue', unit: 'PKR', targetValue: 1000000, incentiveType: 'PERCENT_OF_EXCESS', incentiveValue: 5 });
  expect(target.status === 201, 'HR sets KPI target');
  const sub = await E.post('/kpi/submissions', { targetId: target.data.id, period: month, metric: 'Sales revenue', achievedValue: 1200000 });
  await TL.post(`/kpi/submissions/${sub.data.id}/decision`, { approve: true, remarks: 'Great month' });
  expect((await HR.post(`/kpi/submissions/${sub.data.id}/decision`, { approve: true })).data.status === 'APPROVED', 'KPI approved TL → HR');
  const incs = (await E.get('/kpi/incentives?mine=true')).data;
  expect(incs.length === 1 && incs[0].amount === 10000, 'incentive = 5% of 200k excess', incs);

  // ---- Payroll: HR processes, HR + Operations approve (D1, H1)
  const run = await HR.post('/payroll/runs', { period: month });
  expect(run.status === 201 && run.data.employeeCount >= 5, 'payroll run calculated', run);
  expect((await HR.post(`/payroll/runs/${run.data.id}/submit`)).data.status === 'PENDING_APPROVAL', 'run submitted');
  expect((await HR.post(`/payroll/runs/${run.data.id}/decision`, { approve: true })).status === 403, 'maker cannot approve own payroll');
  expect((await OPS.post(`/payroll/runs/${run.data.id}/decision`, { approve: true })).status === 403, 'operations cannot approve before HR');
  expect((await admin.post(`/payroll/runs/${run.data.id}/decision`, { approve: true })).data.status === 'PENDING_APPROVAL', 'HR-stage approval by another approver');
  expect((await OPS.post(`/payroll/runs/${run.data.id}/decision`, { approve: true })).data.status === 'APPROVED', 'operations final approval');
  const slips = (await E.get('/payroll/me/payslips')).data;
  expect(slips.length === 1, 'employee sees their payslip');
  const slip = (await E.get(`/payroll/payslips/${slips[0].id}`)).data;
  const codes = slip.lines.map((l) => l.code);
  expect(codes.includes('INCENTIVE') && codes.includes('OVERTIME'), 'slip includes incentive and paid overtime', slip.lines);
  const pdf = await E.req('GET', `/payroll/payslips/${slips[0].id}/pdf`, undefined, { raw: true });
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  expect(pdf.headers.get('content-type') === 'application/pdf' && pdfBytes.subarray(0, 5).toString() === '%PDF-', 'salary slip PDF generated');
  const otherSlip = (await HR.get(`/payroll/runs/${run.data.id}`)).data.payslips.find((p) => p.employeeId !== emp.id);
  expect((await E.get(`/payroll/payslips/${otherSlip.id}`)).status === 403, 'employee cannot read another payslip');

  // ---- SRS v1.1: individual attendance dashboard (ADB), late minutes (ATT-03)
  const dash = (await E.get(`/attendance/me/dashboard?month=${d2.slice(0, 7)}`)).data;
  expect(dash.counts.late >= 1 && dash.figures.lateMinutes >= 40 && dash.trend.length === 6 && dash.latest.length <= 5, 'attendance dashboard: donut counts, late minutes, 6-month trend, latest 5', dash);

  // ---- PAY-08: approved payroll is locked; HR reopens with a reason
  expect((await HR.post(`/payroll/payslips/${otherSlip.id}/adjustments`, { kind: 'BONUS', label: 'Late bonus', amount: 100 })).status === 400, 'approved payroll is locked');
  expect((await HR.post(`/payroll/runs/${run.data.id}/reopen`, {})).status === 400, 'reopen needs a reason');
  expect((await E.post(`/payroll/runs/${run.data.id}/reopen`, { reason: 'Not mine to reopen' })).status === 403, 'employee cannot reopen payroll');
  expect((await HR.post(`/payroll/runs/${run.data.id}/reopen`, { reason: 'Missed an Eid bonus' })).data.status === 'DRAFT', 'HR reopens approved payroll');
  const reopenAudit = (await admin.get('/access/audit?action=payroll.run_reopened')).data.items[0];
  expect(reopenAudit?.metadata?.changes?.status?.old === 'APPROVED' && reopenAudit.metadata.changes.status.new === 'DRAFT', 'reopen audited with old and new values (AUD-04)', reopenAudit);

  // ---- LON-04: employee loan request → HR
  const nextMonth = addDays(`${month}-28`, 7).slice(0, 7);
  const loanReq = await E.post('/payroll/loans/requests', { principal: 60000, installment: 5000, startPeriod: nextMonth, reason: 'Family emergency' });
  expect(loanReq.status === 201 && loanReq.data.status === 'PENDING', 'employee requests a loan', loanReq);
  expect((await E.post('/payroll/loans/requests', { principal: 1000, installment: 500, startPeriod: nextMonth, reason: 'Second request' })).status === 400, 'only one pending loan request');
  expect((await HR.post(`/payroll/loans/${loanReq.data.id}/decision`, { approve: true, installment: 6000 })).data.status === 'ACTIVE', 'HR approves loan request');
  const myLoans = (await E.get('/payroll/loans')).data;
  expect(myLoans.some((l) => l.id === loanReq.data.id && l.installment === 6000 && l.outstanding === 60000), 'employee sees approved loan and balance', myLoans);

  // ---- BIO-01..04: ZKTeco ADMS push, duplicates, unknown users held for HR
  const sn = `ZK${randomBytes(4).toString('hex').toUpperCase()}`;
  expect((await admin.post('/attendance/devices', { name: 'Gate ZK', protocol: 'ZKTECO_ADMS', location: 'Main gate' })).status === 400, 'ZKTeco device needs a serial number');
  expect((await admin.post('/attendance/devices', { name: 'Gate ZK', protocol: 'ZKTECO_ADMS', serialNumber: sn, location: 'Main gate' })).status === 201, 'ZKTeco device registered with serial and location');
  const hs = await fetch(`${ORIGIN}/iclock/cdata?SN=${sn}&options=all&pushver=2.4.1`);
  expect(hs.status === 200 && (await hs.text()).includes(`GET OPTION FROM: ${sn}`), 'ADMS handshake');
  const d3 = prevWeekday(today, 3);
  // Status codes: 0 check-in, 2 break-out, 3 break-in, 1 check-out.
  const attlog = [`${emp.employeeCode}\t${d3} 09:00:00\t0\t1`, `${emp.employeeCode}\t${d3} 13:00:00\t2\t1`, `${emp.employeeCode}\t${d3} 14:00:00\t3\t1`, `${emp.employeeCode}\t${d3} 18:00:00\t1\t1`, `9999\t${d3} 09:05:00\t0\t1`, ''].join('\n');
  const up1 = await fetch(`${ORIGIN}/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=1`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: attlog });
  expect(up1.status === 200 && (await up1.text()) === 'OK: 5', 'ADMS ATTLOG upload acknowledged');
  const up2 = await fetch(`${ORIGIN}/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=1`, { method: 'POST', body: attlog });
  expect(up2.status === 200, 'late re-upload after outage accepted');
  const d3day = (await E.get(`/attendance/days?from=${d3}&to=${d3}`)).data[0];
  expect(d3day?.status === 'PRESENT' && d3day.workedMinutes === 480 && d3day.breakMinutes === 60, 'device punches became attendance without duplicates', d3day);
  expect((await fetch(`${ORIGIN}/iclock/getrequest?SN=UNKNOWN${sn}`)).status === 403, 'unregistered device rejected');
  const heldList = (await admin.get('/attendance/held-punches')).data;
  const held9999 = heldList.find((h) => h.deviceUserId === '9999');
  expect(held9999?.punches === 1 && heldList.some((h) => h.deviceUserId === 'NOPE-1') && !Number.isNaN(Date.parse(held9999.firstAt)), 'unknown device users held for HR', heldList);
  const mapped = await admin.post('/attendance/held-punches/assign', { deviceUserId: '9999', employeeId: tl.id });
  expect(mapped.data.released === 1 && !(await admin.get('/attendance/held-punches')).data.some((h) => h.deviceUserId === '9999'), 'HR links device user; held punch released', mapped);
  expect((await admin.post('/attendance/held-punches/discard', { deviceUserId: 'NOPE-1' })).data.discarded === 1, 'HR discards unknown punches');
  const zkDev = (await admin.get('/attendance/devices')).data.find((d) => d.serialNumber === sn);
  expect(zkDev?.online === true && zkDev.lastSyncAt, 'device shows online with last sync (BIO-07)', zkDev);

  // ---- Hikvision ISAPI listener
  const hik = await admin.post('/attendance/devices', { name: 'Lobby Hik', protocol: 'HIKVISION_ISAPI' });
  const d4 = prevWeekday(today, 4);
  const hikRes = await fetch(`${ORIGIN}/api/v1/attendance/hikvision/${hik.data.apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dateTime: `${d4}T09:00:00+05:00`, eventType: 'AccessControllerEvent', AccessControllerEvent: { employeeNoString: emp.employeeCode, attendanceStatus: 'checkIn' } }),
  });
  expect(hikRes.status === 200 && (await hikRes.json()).received === 1, 'Hikvision event accepted');

  // ---- SEC-03: Operations sets the inactivity timeout
  expect((await OPS.req('PATCH', '/settings', { sessionIdleMinutes: 45 })).status === 200, 'operations sets session timeout');
  expect((await OPS.req('PATCH', '/settings', { medicalAnnualLimit: 1 })).status === 403, 'operations cannot change other settings');

  // ---- Anonymous complaint (F3)
  const fd = new FormData();
  fd.set('category', 'MISCONDUCT');
  fd.set('description', 'Something inappropriate happened in the meeting room on Monday.');
  const cRes = await fetch(ORIGIN + '/api/v1/complaints', {
    method: 'POST',
    headers: { cookie: [...E.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-csrf-token': E.jar.get('hrms_csrf') },
    body: fd,
  });
  const cJson = await cRes.json();
  expect(cRes.status === 201 && cJson.trackingCode?.startsWith('CMP-'), 'complaint submitted with tracking code', cJson);
  const audit = (await admin.get('/access/audit?action=complaint.submitted')).data.items[0];
  expect(audit && audit.actorUserId === null && audit.ip === null && audit.metadata === null, 'complaint audit entry has no identity', audit);
  expect((await HR.get('/complaints')).data.length === 1, 'HR sees complaint');
  expect((await TL.get('/complaints')).status === 403, 'team lead cannot see complaints');
  expect((await E.post('/complaints/track', { trackingCode: cJson.trackingCode })).data.status === 'SUBMITTED', 'submitter can track status');

  // ---- Community (F2, G1)
  expect((await E.get('/community/feed')).status === 403, 'feed blocked until guidelines accepted');
  await E.post('/community/guidelines/accept');
  expect((await E.get('/community/feed')).status === 200, 'feed opens after acceptance');
  expect((await E.post('/community/posts', { body: 'Hello team!' })).status === 403, 'posting needs a grant');
  await HR.req('PUT', `/community/posting/${emp.userId}`, { canPost: true });
  const relog = await login(ws, `esha@${ws}.test`, pw);
  expect((await relog.post('/community/posts', { body: 'Hello team!' })).status === 201, 'granted employee can post');

  // ---- Moderation: reason required, two warnings, then disciplinary action
  const strikes = [];
  for (let i = 1; i <= 3; i++) {
    const post = await relog.post('/community/posts', { body: `Off-topic post ${i}` });
    expect((await HR.del(`/community/posts/${post.data.id}`)).status === 400, `removing someone else's post needs a reason (${i})`);
    const removed = await HR.post(`/community/posts/${post.data.id}/remove`, { reason: 'Off-topic: please keep posts work related' });
    expect(removed.status === 201 || removed.status === 200, `HR removes post ${i} with a reason`, removed);
    strikes.push(removed.data.violation);
  }
  expect(strikes[0].warning && strikes[0].level === 1 && strikes[1].warning && strikes[2].disciplinary, 'warning 1, warning 2, then disciplinary action', strikes);
  const standing = (await relog.get('/community/my-standing')).data;
  expect(standing.count === 3, 'author sees their violations');
  const warned = (await relog.get('/notifications')).data;
  const titles = (warned.items ?? warned).map((n) => n.title).join(' | ');
  expect(/Warning 1 of 2/.test(titles) && /Disciplinary action/.test(titles), 'author was notified with the reason', titles);
  expect((await HR.get('/community/violations')).data.some((v) => v.disciplinary), 'HR sees the disciplinary case');

  // ---- Birthday post template (Company Admin)
  const tpl = await admin.patch('/settings', { birthdayPostTitle: 'Happy birthday {firstName}!', birthdayPostBody: '{name} from {department}, have a great day.' });
  expect(tpl.status === 200 && tpl.data.settings.birthdayPostTitle === 'Happy birthday {firstName}!', 'Company Admin sets the birthday post template', tpl);

  // ---- Survey (F7) & queries (F6)
  const sv = await HR.post('/surveys', { title: 'Pulse check', kind: 'GENERAL', audience: 'ALL', anonymous: true, questions: [{ id: 'q1', type: 'RATING', label: 'How happy are you?', required: true }] });
  await HR.post(`/surveys/${sv.data.id}/open`);
  expect((await E.post(`/surveys/${sv.data.id}/responses`, { answers: { q1: 4 } })).status === 201, 'survey answered');
  expect((await E.post(`/surveys/${sv.data.id}/responses`, { answers: { q1: 5 } })).status === 409, 'cannot answer twice');
  const res = (await HR.get(`/surveys/${sv.data.id}/results`)).data;
  expect(res.questions[0].average === 4, 'survey results aggregated');
  const q = await E.post('/queries', { subject: 'Payslip question', body: 'Why is my food allowance zero?' });
  expect(q.data.assignedToEmployeeId === tl.id, 'query auto-assigned to team lead');
  await TL.post(`/queries/${q.data.id}/messages`, { body: 'Checking with HR.' });
  expect((await E.get(`/queries/${q.data.id}`)).data.status === 'IN_PROGRESS', 'query moves to in progress on reply');

  // ======== Profile, privacy, sales access and survey members ========
  const upload = async (c, path, bytes, name, type) => {
    const fd = new FormData();
    fd.set('file', new Blob([bytes], { type }), name);
    const cookie = [...c.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(ORIGIN + '/api/v1' + path, { method: 'POST', headers: { cookie, 'x-csrf-token': c.jar.get('hrms_csrf') ?? '' }, body: fd });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const raw = async (c, path) => {
    const cookie = [...c.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(ORIGIN + '/api/v1' + path, { headers: { cookie } });
    return { status: r.status, type: r.headers.get('content-type') ?? '', disposition: r.headers.get('content-disposition'), text: await r.text() };
  };
  const zara = await mk('Zara Colleague', `zara@${ws}.test`, hrDept.id, lvl('L1', hrLevels).id, ['EMPLOYEE'], { contactNo: '0300 7654321' });
  expect(zara.contactNo === '+92 3007654321', 'phone stored in international format (+92 default)', zara.contactNo);
  const Z = await login(ws, `zara@${ws}.test`, pw);
  const badCountryPhone = await admin.post('/employees', { fullName: 'Bad Phone', email: `badphone@${ws}.test`, departmentId: hrDept.id, levelId: lvl('L1', hrLevels).id, designation: 'X', joiningDate: joined, roles: ['EMPLOYEE'], sendInvite: false, contactNo: '+92 30012' });
  expect(badCountryPhone.status === 400, 'phone validated for the selected country (+92 needs 9–10 digits)', badCountryPhone.data);
  const ukPhone = await Z.req('PATCH', '/me/profile', { emergencyContact: '+44 7911 123456' });
  expect(ukPhone.status === 200 && ukPhone.data.emergencyContact === '+44 7911123456', 'other country codes accepted and stored internationally', ukPhone.data);

  // Phone privacy: hidden from colleagues, Team Leads, directory search and CSV; HR and the person still see it.
  const hide = await E.req('PATCH', '/me/profile', { contactNo: '+92 333 5551234', hidePhone: true });
  expect(hide.status === 200 && hide.data.hidePhone === true, 'employee hides their phone number');
  expect((await E.get('/me/profile')).data.contactNo === '+92 3335551234', 'employee still sees their own hidden number');
  expect((await HR.get(`/employees/${emp.id}`)).data.contactNo === '+92 3335551234', 'HR still sees a hidden number');
  expect((await TL.get(`/employees/${emp.id}`)).data.contactNo === null, 'team lead does not see a hidden number');
  const zDir = (await Z.get('/directory')).data;
  expect(zDir.find((d) => d.id === emp.id)?.contactNo === null && zDir.find((d) => d.id === zara.id)?.contactNo === '+92 3007654321', 'directory hides the number but shows visible ones');
  expect(!(await Z.get('/directory?search=5551234')).data.some((d) => d.id === emp.id), 'directory search cannot find a hidden number');
  expect((await HR.get('/directory?search=5551234')).data.some((d) => d.id === emp.id), 'HR directory search finds the number');
  const zCsv = await raw(Z, '/directory/export');
  expect(zCsv.status === 200 && zCsv.type.includes('text/csv') && zCsv.text.includes('Esha Exec') && !zCsv.text.includes('3335551234'), 'directory CSV export hides the number', zCsv.text.slice(0, 200));
  expect((await raw(HR, '/directory/export')).text.includes('3335551234'), 'HR CSV export includes the number');
  expect((await HR.patch(`/employees/${emp.id}`, { hidePhone: false })).data.hidePhone === false, 'HR can switch the privacy setting');
  expect((await Z.get('/directory')).data.find((d) => d.id === emp.id)?.contactNo === '+92 3335551234', 'number visible again once shown');
  await E.req('PATCH', '/me/profile', { hidePhone: true });

  // Dependents: HR / Company Admin only.
  expect((await HR.patch(`/employees/${emp.id}`, { dependents: -1 })).status === 400, 'dependents cannot be negative');
  expect((await HR.patch(`/employees/${emp.id}`, { dependents: 2 })).data.dependents === 2, 'HR records number of dependents');
  expect((await HR.get(`/employees/${emp.id}`)).data.dependents === 2, 'HR sees dependents');
  expect((await E.get('/me/profile')).data.dependents === null, 'employee profile API hides dependents');
  expect((await TL.get(`/employees/${emp.id}`)).data.dependents === null, 'team lead does not see dependents');
  expect((await OPS.get(`/employees/${emp.id}`)).data.dependents === null, 'operations (no employee management) does not see dependents');
  expect(!('dependents' in ((await Z.get('/directory')).data[0] ?? {})), 'directory never includes dependents');
  expect((await E.req('PATCH', '/me/profile', { dependents: 5 })).data.dependents === null && (await HR.get(`/employees/${emp.id}`)).data.dependents === 2, 'employees cannot set or read their own dependents');

  // Social links: http(s) only.
  const badLink = await E.req('PATCH', '/me/profile', { socialLinks: { x: 'javascript:alert(1)' } });
  expect(badLink.status === 400, 'unsafe social link rejected', badLink.data);
  const links = await E.req('PATCH', '/me/profile', { socialLinks: { linkedin: 'linkedin.com/in/esha', custom: [{ label: 'GitHub', url: 'https://github.com/esha' }] } });
  expect(links.status === 200 && links.data.socialLinks.linkedin === 'https://linkedin.com/in/esha', 'social links saved with https', links.data.socialLinks);

  // Previous experience: several entries at once, edit, delete, "No experience".
  const rec = (id) => `/employees/${id}/records`;
  const expBad = await E.post(`${rec(emp.id)}/experience`, { items: [{ companyName: 'Acme', designation: 'Rep', employmentType: 'FULL_TIME', startDate: '2022-05-01', endDate: '2021-01-01', responsibilities: 'Sales' }] });
  expect(expBad.status === 400, 'experience end date before start is rejected');
  const exp2 = await E.post(`${rec(emp.id)}/experience`, { items: [
    { companyName: 'Acme', designation: 'Sales Rep', employmentType: 'FULL_TIME', startDate: '2019-01-01', endDate: '2021-06-30', responsibilities: 'Field sales', reasonForLeaving: 'Growth' },
    { companyName: 'Beta Ltd', designation: 'Intern', employmentType: 'INTERNSHIP', startDate: '2018-06-01', endDate: '2018-08-31', responsibilities: 'Support' },
  ] });
  expect(exp2.status === 201 && exp2.data.added === 2, '"Add more experience" saves independent records', exp2);
  let mine = (await E.get(rec(emp.id))).data;
  expect(mine.experience.length === 2 && mine.experience.find((x) => x.companyName === 'Acme').duration === '2 yrs 5 mos', 'experience duration calculated', mine.experience.map((x) => x.duration));
  const acme = mine.experience.find((x) => x.companyName === 'Acme');
  const acmeEdit = { companyName: 'Acme', designation: 'Senior Sales Rep', employmentType: 'FULL_TIME', startDate: '2019-01-01', endDate: '2021-06-30', responsibilities: 'Field sales and key accounts' };
  expect((await E.patch(`${rec(emp.id)}/experience/${acme.id}`, acmeEdit)).status === 403, 'employee cannot edit submitted experience');
  expect((await E.del(`${rec(emp.id)}/experience/${acme.id}`)).status === 403, 'employee cannot delete submitted experience');
  expect((await HR.patch(`${rec(emp.id)}/experience/${acme.id}`, acmeEdit)).status === 200, 'HR edits submitted experience');
  expect((await E.get(rec(emp.id))).data.experience.find((x) => x.id === acme.id).designation === 'Senior Sales Rep', 'edit saved');
  expect((await E.req('PATCH', '/me/profile', { noExperience: true })).status === 400, '"No experience" refused while entries exist');
  for (const x of mine.experience) expect((await HR.del(`${rec(emp.id)}/experience/${x.id}`)).status === 200, 'HR deletes an experience entry');
  expect((await E.req('PATCH', '/me/profile', { noExperience: true })).data.noExperience === true, 'employee ticks "No experience"');
  expect((await E.post(`${rec(emp.id)}/experience`, { items: [{ companyName: 'X Co', designation: 'Y', employmentType: 'OTHER', startDate: '2020-01-01', responsibilities: 'Z' }] })).status === 400, '"No experience" disables adding experience');
  await E.req('PATCH', '/me/profile', { noExperience: false });

  // Education: submitted once by the employee, then read-only for them; HR edits and deletes.
  const eduItems = [
    { qualificationLevel: 'BACHELORS', degreeTitle: 'BBA', institution: 'LUMS', startDate: '2013-09-01', completionDate: '2017-06-30', grade: '3.4' },
    { qualificationLevel: 'MASTERS', degreeTitle: 'MBA', institution: 'IBA', startDate: '2023-09-01', currentlyStudying: true },
  ];
  expect((await E.post(`${rec(emp.id)}/education`, { items: [{ ...eduItems[0], completionDate: undefined }] })).status === 400, 'education needs a completion date unless currently studying');
  const edu = await E.post(`${rec(emp.id)}/education`, { items: eduItems });
  expect(edu.status === 201 && edu.data.added === 2, 'employee submits several education entries at once');
  const eduAgain = await E.post(`${rec(emp.id)}/education`, { items: [eduItems[0]] });
  expect(eduAgain.status === 403, 'employee cannot submit education a second time', eduAgain.data);
  mine = (await E.get(rec(emp.id))).data;
  expect(mine.canEdit.education === false && mine.canChange.education === false, 'education is read-only for the employee after submitting');
  const bba = mine.education.find((x) => x.degreeTitle === 'BBA');
  expect((await E.patch(`${rec(emp.id)}/education/${bba.id}`, { ...eduItems[0], grade: '4.0' })).status === 403, 'employee cannot edit submitted education');
  expect((await E.del(`${rec(emp.id)}/education/${bba.id}`)).status === 403, 'employee cannot delete submitted education');
  expect((await HR.patch(`${rec(emp.id)}/education/${bba.id}`, { ...eduItems[0], grade: '3.6' })).status === 200, 'HR edits submitted education');
  expect((await HR.post(`${rec(emp.id)}/education`, { items: [{ qualificationLevel: 'INTERMEDIATE', degreeTitle: 'FSc', institution: 'GC', startDate: '2011-09-01', completionDate: '2013-06-30' }] })).status === 201, 'HR adds education after submission');
  expect((await HR.del(`${rec(emp.id)}/education/${bba.id}`)).status === 200, 'HR deletes education');

  // References: once by the employee; contact details only for HR / Company Admin (API and everything built on it).
  const refs = await E.post(`${rec(emp.id)}/references`, { items: [{ name: 'Rana Ref', organisation: 'Acme', relationship: 'Former manager', email: 'rana@acme.test', phone: '0321 1112223', yearsKnown: 3 }] });
  expect(refs.status === 201, 'employee submits references');
  expect((await E.post(`${rec(emp.id)}/references`, { items: [{ name: 'Second', organisation: 'Org', relationship: 'Peer' }] })).status === 403, 'employee cannot add references after submitting');
  const eRefs = (await E.get(rec(emp.id))).data.references;
  expect(eRefs[0].email === null && eRefs[0].phone === null && eRefs[0].contactHidden, 'employee API does not return reference contact details');
  expect((await E.del(`${rec(emp.id)}/references/${eRefs[0].id}`)).status === 403, 'employee cannot delete a submitted reference');
  const tlRefs = (await TL.get(rec(emp.id))).data.references;
  expect(tlRefs[0].email === null && tlRefs[0].phone === null, 'team lead does not see reference contact details');
  const hrRefs = (await HR.get(rec(emp.id))).data.references;
  expect(hrRefs[0].email === 'rana@acme.test' && hrRefs[0].phone === '+92 3211112223', 'HR sees reference contact details');
  expect((await Z.get(rec(emp.id))).status === 403, 'colleagues cannot open another person\'s records');

  // Certifications with a validated attachment.
  const notPdf = await upload(E, `/employees/${emp.id}/record-files`, new TextEncoder().encode('just text'), 'cert.pdf', 'application/pdf');
  expect(notPdf.status === 400, 'attachment content is checked (fake PDF refused)', notPdf.data);
  const certPdf = await upload(E, `/employees/${emp.id}/record-files`, new TextEncoder().encode('%PDF-1.4\n%test\n'), 'cert.pdf', 'application/pdf');
  expect(certPdf.status === 201 && certPdf.data.fileId, 'certificate PDF uploaded', certPdf.data);
  const draftPreview = await raw(E, `/employees/${emp.id}/record-files/${certPdf.data.fileId}`);
  expect(draftPreview.status === 200 && draftPreview.text.startsWith('%PDF') && draftPreview.disposition?.startsWith('inline'), 'uploader previews the document before submitting', draftPreview.disposition);
  expect((await raw(Z, `/employees/${emp.id}/record-files/${certPdf.data.fileId}`)).status === 403, 'others cannot open a document that is not submitted yet');
  expect((await upload(Z, `/employees/${emp.id}/record-files`, new TextEncoder().encode('%PDF-1.4\n'), 'x.pdf', 'application/pdf')).status === 403, 'colleagues cannot upload to someone else\'s profile');
  expect((await E.post(`${rec(emp.id)}/certifications`, { items: [{ name: 'CSM', issuer: 'Scrum Alliance', issueDate: '2022-01-10', verificationUrl: 'ftp://bad.example' }] })).status === 400, 'certification link must be http(s)');
  const cert = await E.post(`${rec(emp.id)}/certifications`, { items: [{ name: 'CSM', issuer: 'Scrum Alliance', issueDate: '2022-01-10', expiryDate: '2025-01-10', verificationUrl: 'https://verify.example/123', fileId: certPdf.data.fileId }, { name: 'Excel Expert', issuer: 'Microsoft', issueDate: '2021-03-01' }] });
  expect(cert.status === 201 && cert.data.added === 2, '"Add more certifications" saves each one');
  const certFile = await raw(HR, `/employees/${emp.id}/record-files/${certPdf.data.fileId}`);
  expect(certFile.status === 200 && certFile.text.startsWith('%PDF'), 'HR previews the certificate attachment');
  const certDownload = await raw(E, `/employees/${emp.id}/record-files/${certPdf.data.fileId}?download=1`);
  expect(certDownload.status === 200 && certDownload.disposition?.startsWith('attachment'), 'employee downloads their submitted document', certDownload.disposition);
  const certRows = (await E.get(rec(emp.id))).data.certifications;
  expect((await E.del(`${rec(emp.id)}/certifications/${certRows[0].id}`)).status === 403, 'employee cannot delete a submitted certification');
  expect((await raw(Z, `/employees/${emp.id}/record-files/${certPdf.data.fileId}`)).status === 403, 'colleagues cannot download the attachment');

  // Sales revenue: Sales department or an explicitly permitted role only, checked live.
  expect((await E.get('/sales/overview')).status === 200, 'Sales-department employee sees sales revenue');
  const salesView = (await E.get('/sales/overview')).data;
  expect(salesView.totals.achieved === 1200000 && salesView.totals.target === 1000000 && salesView.totals.incentives === 10000, 'sales revenue totals from approved KPI results', salesView.totals);
  expect((await admin.get('/sales/overview')).status === 200, 'Company Admin sees sales revenue');
  expect((await HR.get('/sales/overview')).status === 403, 'HR without the permission cannot see sales revenue');
  expect((await HR.get('/sales/export')).status === 403, 'HR cannot export sales revenue');
  expect((await Z.get('/sales/overview')).status === 403 && (await raw(Z, '/sales/export')).status === 403, 'other departments cannot see or export sales revenue');
  expect(!('sales' in (await Z.get('/dashboard')).data) && 'sales' in (await E.get('/dashboard')).data, 'dashboard sales metrics only for permitted users');
  const salesCsv = await raw(E, '/sales/export');
  expect(salesCsv.status === 200 && salesCsv.text.includes('Esha Exec') && salesCsv.text.includes('1200000'), 'sales CSV export for permitted users');
  expect((await Z.get('/sales/access')).data.allowed === false, 'access endpoint says no for other departments');
  const zSales = await HR.patch(`/employees/${zara.id}`, { departmentId: sales.id, levelId: lvl('L1').id });
  expect(zSales.status === 200 && (await Z.get('/sales/overview')).status === 200, 'moving into Sales grants access immediately');
  await HR.patch(`/employees/${zara.id}`, { departmentId: hrDept.id, levelId: lvl('L1', hrLevels).id });
  expect((await Z.get('/sales/overview')).status === 403, 'moving out of Sales removes access immediately');
  const hrRole = (await admin.get('/access/roles')).data.roles.find((r) => r.role === 'HR');
  expect((await admin.put('/access/roles/HR', { permissions: [...hrRole.permissions, 'sales.revenue.read'] })).status === 200, 'Company Admin grants HR "View sales revenue"');
  expect((await HR.get('/sales/overview')).status === 200, 'role change grants access immediately');
  await admin.put('/access/roles/HR', { permissions: hrRole.permissions });
  expect((await HR.get('/sales/overview')).status === 403, 'role change removes access immediately');

  // Survey members: teams of 0, 1 and many eligible members.
  const yusuf = await mk('Yusuf Two', `yusuf@${ws}.test`, opsDept.id, lvl('L1', opsLevels).id, ['EMPLOYEE']);
  const waqas = await mk('Waqas Three', `waqas@${ws}.test`, opsDept.id, lvl('L1', opsLevels).id, ['EMPLOYEE']);
  const emptyTeam = (await admin.post('/teams', { name: 'Empty Team', departmentId: hrDept.id, leadEmployeeId: tl.id })).data;
  const soloTeam = (await admin.post('/teams', { name: 'Solo Team', departmentId: hrDept.id, leadEmployeeId: tl.id })).data;
  const duoTeam = (await admin.post('/teams', { name: 'Duo Team', departmentId: opsDept.id, leadEmployeeId: ops.id })).data;
  await admin.post(`/teams/${soloTeam.id}/members`, { employeeId: zara.id });
  await admin.post(`/teams/${duoTeam.id}/members`, { employeeId: yusuf.id });
  await admin.post(`/teams/${duoTeam.id}/members`, { employeeId: waqas.id });
  const aud = async (teamId) => (await HR.get(`/surveys/audience?audience=TEAM&audienceId=${teamId}`)).data;
  expect((await aud(emptyTeam.id)).count === 0, 'survey members: team of 0 shows nobody');
  const solo = await aud(soloTeam.id);
  expect(solo.count === 1 && solo.members[0].id === zara.id, 'survey members: team of exactly 1 shows that member', solo);
  const duo = await aud(duoTeam.id);
  expect(duo.count === 2 && duo.members.map((m) => m.id).sort().join() === [yusuf.id, waqas.id].sort().join(), 'survey members: team of many shows everyone', duo);
  expect((await TL.get(`/surveys/audience?audience=TEAM&audienceId=${duoTeam.id}`)).status === 403, 'team leads cannot list other teams');
  const soloSurvey = await HR.post('/surveys', { title: 'Solo pulse', kind: 'TEAM', audience: 'TEAM', audienceId: soloTeam.id, questions: [{ id: 'q1', type: 'RATING', label: 'Rate', required: true }] });
  await HR.post(`/surveys/${soloSurvey.data.id}/open`);
  expect((await Z.get('/surveys/available')).data.some((s) => s.id === soloSurvey.data.id), 'the single member receives the team survey');
  expect((await Z.post(`/surveys/${soloSurvey.data.id}/responses`, { answers: { q1: 5 } })).status === 201, 'the single member can answer it');
  expect((await HR.get(`/surveys/${soloSurvey.data.id}/results`)).data.audience === 1, 'survey results count an audience of 1');

  // Work from home: applied from Leave, approved Team Lead → HR like leave; approved days count as worked.
  const wfhFuture = addDays(nextMonday, 7);
  const wfh = await E.post('/leave/wfh', { startDate: wfhFuture, endDate: addDays(wfhFuture, 1), reason: 'Internet installation at home' });
  expect(wfh.status === 201 && wfh.data.status === 'PENDING' && wfh.data.currentStep === 'TEAM_LEAD' && wfh.data.days === 2, 'work from home request goes to the team lead first', wfh.data);
  expect((await E.post('/leave/wfh', { startDate: addDays(wfhFuture, 1), endDate: addDays(wfhFuture, 1), reason: 'Again' })).status === 409, 'overlapping work from home is refused');
  const sat = (() => { let d = wfhFuture; while (dow(d) !== 6) d = addDays(d, 1); return d; })();
  expect((await E.post('/leave/wfh', { startDate: sat, endDate: addDays(sat, 1), reason: 'Weekend only' })).status === 400, 'weekend-only work from home is refused');
  expect((await E.post('/leave/wfh', { startDate: wfhFuture, endDate: addDays(wfhFuture, 40), reason: 'Too long' })).status === 400, 'work from home is limited to 31 days at a time');
  expect((await HR.post(`/leave/wfh/${wfh.data.id}/decision`, { approve: true })).status === 403, 'HR cannot skip the team lead step for work from home');
  expect((await E.post(`/leave/wfh/${wfh.data.id}/decision`, { approve: true })).status === 403, 'employees cannot approve their own work from home');
  expect((await TL.get('/approvals/inbox')).data.some((i) => i.workflow === 'WORK_FROM_HOME' && i.id === wfh.data.id), 'work from home appears in the team lead inbox');
  expect((await TL.post(`/leave/wfh/${wfh.data.id}/decision`, { approve: true })).data.currentStep === 'HR', 'team lead approval forwards work from home to HR');
  expect((await HR.get('/approvals/inbox')).data.some((i) => i.workflow === 'WORK_FROM_HOME' && i.id === wfh.data.id), 'work from home then waits in the HR inbox');
  expect((await HR.post(`/leave/wfh/${wfh.data.id}/decision`, { approve: true })).data.status === 'APPROVED', 'HR gives final approval for work from home');
  const wfhCal = (await E.get(`/calendar?month=${wfhFuture.slice(0, 7)}`)).data;
  expect(wfhCal.wfh?.some((w) => w.id === wfh.data.id && w.status === 'APPROVED'), 'approved work from home shows on the calendar');
  const mineWfh = (await E.get('/leave/wfh?mine=true')).data.find((w) => w.id === wfh.data.id);
  expect(mineWfh?.canCancel === true, 'upcoming approved work from home can still be cancelled');
  expect((await TL.post(`/leave/wfh/${wfh.data.id}/cancel`, { reason: 'Not mine to cancel' })).status === 403, 'only the employee cancels their work from home');
  expect((await E.post(`/leave/wfh/${wfh.data.id}/cancel`, { reason: 'Installation moved' })).data.status === 'CANCELLED', 'employee cancels upcoming work from home');

  const wfhDay = prevWeekday(today, 12); // a day no other flow punches
  const pastWfh = await E.post('/leave/wfh', { startDate: wfhDay, endDate: wfhDay, reason: 'Worked from home, forgot to apply' });
  expect(pastWfh.status === 201, 'work from home can be applied for a past day', pastWfh.data);
  await TL.post(`/leave/wfh/${pastWfh.data.id}/decision`, { approve: true });
  const rej = await E.post('/leave/wfh', { startDate: addDays(wfhFuture, 14), endDate: addDays(wfhFuture, 14), reason: 'Will be rejected' });
  expect((await TL.post(`/leave/wfh/${rej.data.id}/decision`, { approve: false, comment: 'Team offsite that day' })).data.status === 'REJECTED', 'team lead can reject work from home');
  expect((await HR.post(`/leave/wfh/${pastWfh.data.id}/decision`, { approve: true })).data.status === 'APPROVED', 'past work from home approved by HR');
  const wfhAtt = (await E.get(`/attendance/days?from=${wfhDay}&to=${wfhDay}`)).data.find((d) => d.date === wfhDay);
  expect(wfhAtt?.status === 'PRESENT' && wfhAtt.workFromHome === true && wfhAtt.workedMinutes > 0, 'approved work from home day counts as present, marked WFH', wfhAtt);
  expect((await E.post(`/leave/wfh/${pastWfh.data.id}/cancel`, { reason: 'Too late now' })).status === 400, 'started work from home cannot be cancelled by the employee');
  expect((await Z.get('/leave/wfh')).data.every((w) => w.employeeId === zara.id), 'employees only see their own work from home requests');
  const hrWfh = (await HR.get('/leave/wfh')).data;
  expect(hrWfh.some((w) => w.id === pastWfh.data.id && w.employeeName === 'Esha Exec'), 'HR sees work from home requests company-wide');

  // Punch clock: sign in from home with the app, then only valid next actions
  expect((await Z.get('/attendance/me/clock')).data.state === 'NOT_STARTED', 'punch clock starts not signed in');
  expect((await Z.post('/attendance/me/clock', { type: 'BREAK_START' })).status === 400, 'cannot take a break before signing in');
  const zin = await Z.post('/attendance/me/clock', { type: 'IN', workFromHome: true });
  expect(zin.status === 201 && zin.data.state === 'WORKING' && zin.data.allowed.includes('BREAK_START') && zin.data.allowed.includes('OUT'), 'signed in from the app: Take break and Sign out offered', zin.data);
  expect(zin.data.workFromHome?.status === 'PENDING' && zin.data.workFromHome.currentStep === 'TEAM_LEAD', 'signing in from home asks the Team Lead for work-from-home approval', zin.data.workFromHome);
  expect((await TL.get('/approvals/inbox')).data.some((i) => i.workflow === 'WORK_FROM_HOME' && i.employeeName === 'Zara Colleague'), 'the home sign-in request reaches the team lead');
  const zAgain = await Z.post('/attendance/me/clock', { type: 'IN' });
  expect(zAgain.status === 400 && zAgain.data.code === 'CLOCK_STATE', 'cannot sign in twice', zAgain.data);
  expect((await Z.post('/attendance/me/clock', { type: 'BREAK_END' })).data.code === 'CLOCK_STATE', 'cannot end a break that was not started');
  const tooSoon = await Z.post('/attendance/me/clock', { type: 'BREAK_START' });
  expect(tooSoon.status === 400 && tooSoon.data.code === 'CLOCK_TOO_SOON', 'actions are spaced out (no double clicks)', tooSoon);
  const zDash = (await Z.get('/dashboard')).data.employee.signIn;
  expect(zDash.source === 'HOME' && zDash.checkIn && !zDash.checkOut, 'dashboard shows signed in from home, still at work', zDash);
  expect((await E.get('/attendance/me/clock')).data.state !== undefined && (await OPS.post('/attendance/me/clock', { type: 'FLY' })).status === 400, 'only the four actions are accepted');

  // Dashboard "my day": how I signed in today and my shift (for time passed / remaining)
  const myDay = (await E.get('/dashboard')).data.employee?.signIn;
  expect(myDay && typeof myDay.workingDay === 'boolean' && /^\d\d:\d\d$/.test(myDay.shift.startTime) && myDay.shift.netMinutes >= 0, 'dashboard returns my sign-in source and shift', myDay);
  // Compliance overview: own numbers for everyone, management counts only with the permission
  const eComp = (await E.get('/compliance/overview')).data;
  expect(typeof eComp.publishedPolicies === 'number' && typeof eComp.myOpenQueries === 'number' && !('openComplaints' in eComp) && !('openQueriesAll' in eComp), 'compliance overview shows an employee only their own numbers', eComp);
  const hrComp = (await HR.get('/compliance/overview')).data;
  expect(typeof hrComp.openComplaints === 'number' && typeof hrComp.openQueriesAll === 'number' && typeof hrComp.draftPolicies === 'number', 'compliance overview adds management counts for HR', hrComp);

  // Access & roles overview
  const ao = (await admin.get('/access/overview')).data;
  expect(ao.accounts?.total >= 8 && ao.roles?.some((r) => r.role === 'HR' && r.users >= 1) && ao.activity?.recent.length > 0, 'access overview: accounts, roles and recent activity', ao.accounts);
  expect((await E.get('/access/overview')).status === 403, 'employees cannot open the access overview');

  // Leave overview for module overviews
  const lo = await HR.get('/leave/overview');
  expect(lo.status === 200 && lo.data.scope === 'company' && typeof lo.data.pending === 'number', 'leave overview KPIs for HR');
  const eo = (await E.get('/leave/overview')).data;
  expect(eo.scope === 'self', 'leave overview scoped to the employee');
  expect(eo.me && typeof eo.me.leaveAvailable === 'number' && eo.me.requests.some((r) => r.kind === 'WORK_FROM_HOME') && eo.me.requests.some((r) => r.kind === 'LEAVE'), 'leave overview lists my own leave and work-from-home requests', eo.me);
  expect(Array.isArray((await HR.get('/leave/overview')).data.me?.requests), 'HR also gets their own stats on the overview');

  // ---- Dashboards (A2)
  for (const [name, c] of [['employee', E], ['team lead', TL], ['HR', HR], ['operations', OPS], ['super admin', admin]]) {
    const d = await c.get('/dashboard');
    expect(d.status === 200, `${name} dashboard loads`, d);
  }

  // ---- Sign in with email + password only (company found from the email)
  const emailOnly = new Client();
  await emailOnly.get('/auth/csrf');
  expect((await emailOnly.post('/auth/login', { email: `esha@${ws}.test`, password: pw })).status === 200, 'sign in with email and password only');
  expect((await emailOnly.post('/auth/login', { email: `nobody-${ws}@example.test`, password: pw })).status === 401, 'unknown email is rejected');

  // ---- Emails are unique across all companies
  const dupCompany = await platform.post('/platform/companies', { companyName: 'Dup Co', workspace: `${ws}-dup`, adminName: 'Dup', email: `ESHA@${ws}.test`, password: pw, mustChangePassword: false });
  expect(dupCompany.status === 409 && dupCompany.data.code === 'EMAIL_TAKEN', 'an email already used in one company cannot be used for another', dupCompany);

  // ---- Deleting records needs the "Delete records" permission (Super Admin by default)
  const pol = await HR.post('/policies', { category: 'COMPANY', title: 'Temporary policy', content: 'Draft text to be removed.' });
  expect(pol.status === 201, 'HR creates a policy', pol);
  expect((await HR.req('DELETE', `/policies/${pol.data.id}`)).status === 403, 'HR cannot delete without the "Delete records" permission');
  expect((await admin.req('DELETE', `/policies/${pol.data.id}`)).status === 200, 'Super Admin deletes the policy');
  const usedDept = await admin.req('DELETE', `/departments/${sales.id}`);
  expect(usedDept.status === 409 && /employee/.test(usedDept.data.message), 'department in use cannot be deleted, with the reason', usedDept);

  // ---- Plans: a company only gets the modules its plan includes
  const plans = (await platform.get('/platform/plans')).data;
  const starter = plans.find((p) => p.name === 'Starter');
  expect(starter && !starter.modules.includes('PAYROLL'), 'Starter plan has no payroll', plans);
  const companyId = (await platform.get('/platform/companies')).data.find((c) => c.slug === ws).id;
  expect((await platform.patch(`/platform/companies/${companyId}`, { planId: starter.id })).data.modules.includes('PAYROLL') === false, 'platform owner moves the company to Starter');
  const blocked = await admin.get('/payroll/runs');
  expect(blocked.status === 403 && blocked.data.code === 'MODULE_DISABLED', 'payroll blocked even for Super Admin when not in the plan', { status: blocked.status, data: blocked.data });
  const sess = (await admin.get('/auth/session')).data;
  expect(!sess.tenant.modules.includes('PAYROLL') && !sess.user.permissions.includes('payroll.process'), 'session shows the plan modules and drops payroll permissions', sess.tenant.modules);
  expect((await admin.get('/leave/types')).status === 200 && (await admin.get('/calendar?from=2026-01-01&to=2026-01-31')).status !== 403, 'included modules and core features still work');
  const detail = (await platform.get(`/platform/companies/${companyId}`)).data;
  expect(detail.superAdmins.some((a) => a.email === `sam@${ws}.test`), 'company page lists its Super Admins', detail);
  expect((await platform.post(`/platform/companies/${companyId}/welcome`)).data.sent.length >= 1, 'welcome email can be re-sent');
  expect((await platform.patch(`/platform/companies/${companyId}`, { planId: null, modules: ['ATTENDANCE', 'LEAVE', 'PAYROLL', 'PERFORMANCE', 'COMPLIANCE', 'COMMUNITY', 'BIOMETRIC'], maxEmployees: null })).status === 200, 'custom module set restored');
  expect((await admin.get('/payroll/runs')).status === 200, 'payroll available again');

  // ---- Tenant isolation (RLS)
  const other = await createCompany(platform, { companyName: 'Other Co', workspace: `${ws}-b`, adminName: 'Bob', email: `bob@${ws}-b.test`, password: pw });
  expect((await other.get(`/employees/${emp.id}`)).status === 404, 'other tenant cannot read employee (RLS)');
  expect((await other.get(`/payroll/payslips/${slips[0].id}`)).status === 403, 'other tenant cannot read payslip');
  const otherList = (await other.get('/employees')).data;
  expect(otherList.total === 1, 'other tenant sees only its own employees');
  expect(!(otherList.items ?? []).some((x) => x.id === emp.id), 'other tenant list never contains our employee');
  expect([403, 404].includes((await other.patch(`/employees/${emp.id}`, { designation: 'Hacked' })).status), 'other tenant cannot edit our employee');
  const crossFix = await other.post('/attendance/days/correct', { employeeId: emp.id, date: prevWeekday(today, 3), checkIn: '09:00', note: 'cross tenant' });
  expect([400, 403, 404].includes(crossFix.status), 'other tenant cannot correct our attendance', crossFix);
  expect((await admin.get(`/employees/${emp.id}`)).data.designation !== 'Hacked', 'our employee is unchanged');
  const suspended = await platform.patch(`/platform/companies/${(await platform.get('/platform/companies')).data.find((c) => c.slug === `${ws}-b`).id}`, { status: 'SUSPENDED' });
  expect(suspended.data.status === 'SUSPENDED', 'platform owner suspends a company');
  expect((await other.get('/employees')).status === 401, 'suspended company is locked out immediately');

  // ---- Company email domain and direct corrections by HR
  const wrongDomain = await admin.post('/employees', { fullName: 'Wrong Domain', email: 'wrong@elsewhere.test', departmentId: sales.id, levelId: lvl('L1').id, designation: 'Associate', joiningDate: today, sendInvite: false });
  expect(wrongDomain.status === 400 && wrongDomain.data.code === 'EMAIL_DOMAIN', 'employee emails must use the company email domain', wrongDomain);
  const fixDay = prevWeekday(today, 5);
  const fixed = await HR.post('/attendance/days/correct', { employeeId: emp.id, date: fixDay, checkIn: '09:00', checkOut: '18:00', note: 'Device was offline' });
  expect(fixed.status === 201 && fixed.data.day?.status === 'PRESENT', 'HR corrects a day directly, no approval needed', fixed);
  expect((await E.post('/attendance/days/correct', { employeeId: emp.id, date: fixDay, checkIn: '08:00', note: 'Trying myself' })).status === 403, 'employees cannot correct attendance directly');

  // ---- Medical claims only for employees the company offers them to
  const notEligible = await E.post('/payroll/medical', { amount: 1000, claimDate: today, description: 'Doctor visit' });
  expect(notEligible.status === 403, 'employees without medical benefit cannot claim', notEligible);
  expect((await admin.patch(`/employees/${emp.id}`, { medicalEligible: true })).status === 200, 'HR makes an employee eligible for medical claims');
  const eligibleNoDocs = await E.post('/payroll/medical', { amount: 1000, claimDate: today, description: 'Doctor visit' });
  expect(eligibleNoDocs.status === 400 && eligibleNoDocs.data.code === 'DOCUMENTS_REQUIRED', 'eligible employee passes the check (still needs receipts)', eligibleNoDocs);
  const badPhone = await E.req('PATCH', '/me/profile', { contactNo: '1111111' });
  expect(badPhone.status === 400, 'phone numbers must look like real numbers', badPhone);

  // ---- Former employees: kept until deleted, can be reactivated, deleted only on purpose
  const leaver = await mk('Lena Leaver', `lena@${ws}.test`, sales.id, lvl('L1').id, ['EMPLOYEE']);
  await HR.post('/attendance/days/correct', { employeeId: leaver.id, date: prevWeekday(today, 2), checkIn: '09:00', checkOut: '17:00', note: 'History to keep' });
  expect((await admin.del(`/employees/${leaver.id}`)).status === 400, 'active employees cannot be deleted');
  expect((await admin.post(`/employees/${leaver.id}/terminate`, { exitDate: today, reason: 'Contract ended' })).status === 201, 'employee terminated');
  const listed = (await admin.get('/employees?pageSize=100')).data.items.find((x) => x.id === leaver.id);
  expect(listed?.employmentStatus === 'TERMINATED', 'terminated employee still listed by default');
  expect((await admin.get(`/employees/${leaver.id}`)).data.accountStatus === 'DISABLED', 'terminated employee login disabled');
  const back = await admin.post(`/employees/${leaver.id}/reactivate`, { restoreLogin: true });
  expect(back.status === 201 && back.data.login === 'restored', 'Company Admin reactivates and restores login', back);
  const again = (await admin.get(`/employees/${leaver.id}`)).data;
  expect(again.employmentStatus === 'ACTIVE' && again.accountStatus === 'ACTIVE' && !again.exitDate, 'reactivated employee is active with login');
  await admin.post(`/employees/${leaver.id}/terminate`, { exitDate: today, reason: 'Left again' });
  expect((await HR.del(`/employees/${leaver.id}`)).status === 403, 'HR without "Delete records" cannot delete');
  const gone = await admin.del(`/employees/${leaver.id}`);
  expect(gone.status === 200 && gone.data.deleted, 'Company Admin permanently deletes a former employee with history', gone);
  expect((await admin.get(`/employees/${leaver.id}`)).status === 404, 'deleted employee is gone');
  expect((await admin.post('/employees', { fullName: 'Lena Again', email: `lena@${ws}.test`, departmentId: sales.id, levelId: lvl('L1').id, designation: 'Associate', joiningDate: today, sendInvite: false })).status === 201, 'deleted email can be used again');

  // ---- Platform settings: default currency and sign-in footer
  const before = (await platform.get('/platform/settings')).data;
  const altCurrency = before.defaultCurrency === 'USD' ? 'EUR' : 'USD';
  expect((await platform.put('/platform/settings', { defaultCurrency: altCurrency })).status === 200, 'Super Admin changes the platform currency');
  const pub = (await new Client().get('/public/plans')).data;
  expect(pub.length > 0 && pub.every((p) => p.currency === altCurrency), 'every plan (and the homepage) follows the platform currency', pub);
  const named = await platform.put('/platform/settings', { defaultCurrency: before.defaultCurrency, siteName: 'Acme People' });
  expect(named.status === 200 && (await new Client().get('/public/branding')).data.siteName === 'Acme People', 'Super Admin sets the platform name');
  const saved = await platform.put('/platform/settings', { defaultCurrency: before.defaultCurrency, copyright: '© {year} Test Footer' });
  expect(saved.status === 200 && saved.data.copyright === '© {year} Test Footer', 'Super Admin saves platform settings', saved);
  const brand = (await new Client().get('/public/branding')).data;
  expect(brand.copyright === `© ${new Date().getFullYear()} Test Footer`, 'sign-in footer shows the saved text with the year', brand);
  expect((await admin.get('/platform/settings')).status === 401, 'company users cannot read platform settings');
  await platform.put('/platform/settings', { defaultCurrency: before.defaultCurrency, siteName: before.siteName ?? undefined, copyright: before.copyright ?? undefined });

  // ---- Platform logo / favicon (only real images; SVG refused because it can carry scripts)
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const hadFavicon = before.faviconVersion !== null;
  const up = await platform.put('/platform/settings/favicon', { data: png });
  expect(up.status === 200 && up.data.faviconVersion, 'Super Admin uploads a favicon', up);
  const svg = await platform.put('/platform/settings/logo', { data: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64') });
  expect(svg.status === 400 && svg.data.code === 'BAD_IMAGE', 'SVG logos are refused', svg);
  const plansPublic = await new Client().get('/public/plans');
  expect(plansPublic.status === 200 && Array.isArray(plansPublic.data), 'homepage can list plans without signing in');
  if (!hadFavicon) await platform.put('/platform/settings/favicon', { data: null });

  // ---- Billing: yearly price, unpaid lock, company pays, Super Admin confirms
  const pm = await platform.post('/platform/payment-methods', { name: 'Test Bank', kind: 'BANK_TRANSFER', instructions: 'IBAN PK00 TEST 0000 0000 0000' });
  expect(pm.status === 201, 'Super Admin adds a payment method', pm);
  await platform.patch(`/platform/companies/${companyId}`, { planId: starter.id, billingCycle: 'ANNUAL' });
  const inv = await platform.post(`/platform/companies/${companyId}/invoices`);
  // Pricing is per active employee: the yearly plan price times the company's active staff (at least one).
  const perEmployee = starter.priceAnnual ?? starter.priceMonthly * 12;
  // The invoice is in the company's currency, so the plan price is converted when the plan uses another one.
  const line = inv.data.items?.[0];
  expect(
    inv.status === 201 && inv.data.cycle === 'ANNUAL' && line.quantity >= 1 && inv.data.amount === line.unitPrice * line.quantity &&
      (inv.data.currency !== starter.currency || line.unitPrice === perEmployee),
    'yearly invoice at the annual price per active employee',
    inv,
  );
  expect((await platform.post(`/platform/companies/${companyId}/unpaid`, {})).status === 200, 'Super Admin marks the company unpaid');
  const lockedOut = await E.get('/dashboard');
  expect((await E.get('/me/profile')).status === 200, 'own profile (and password change) still open while unpaid');
  expect(lockedOut.status === 402 && lockedOut.data.code === 'PAYMENT_REQUIRED', 'unpaid workspace is locked', lockedOut);
  const billingView = (await admin.get('/billing')).data;
  expect(billingView.billingStatus === 'UNPAID' && billingView.paymentMethods.some((m) => m.id === pm.data.id), 'Company Admin still sees Billing with payment methods');
  expect((await admin.post(`/billing/invoices/${inv.data.id}/submit`, { paymentMethodId: pm.data.id, reference: 'TXN-12345' })).status === 200, 'company submits its payment reference');
  const paidRes = await platform.post(`/platform/invoices/${inv.data.id}/paid`, {});
  expect(paidRes.data.status === 'PAID' && paidRes.data.paidUntil === inv.data.periodEnd, 'Super Admin marks it paid', paidRes);
  expect((await E.get('/dashboard')).status === 200, 'workspace unlocked after payment');
  // ---- Invoices: template, custom invoice, details and PDF for both sides
  const tplBefore = (await platform.get('/platform/settings/invoice-template')).data;
  const invTpl = await platform.put('/platform/settings/invoice-template', { ...tplBefore, businessName: 'E2E Billing Co', phone: '0300 1234567', accentColor: '#0f766e' });
  expect(invTpl.status === 200 && invTpl.data.businessName === 'E2E Billing Co', 'Super Admin sets the invoice template', invTpl);
  expect(inv.data.number?.startsWith('INV-') && inv.data.title, 'subscription invoice has a number and a title', inv.data);
  const custom = await platform.post(`/platform/companies/${companyId}/invoices/custom`, { title: 'Onboarding and data import', items: [{ description: 'Data import', quantity: 2, unitPrice: 5000 }, { description: 'Training session', quantity: 1, unitPrice: 7500 }], notes: 'Thanks!' });
  expect(custom.status === 201 && custom.data.amount === 17500 && custom.data.kind === 'CUSTOM', 'Super Admin creates a custom invoice with lines', custom);
  const pdfOf = async (c, path) => { const cookie = [...c.jar].map(([k, v]) => `${k}=${v}`).join('; '); const r = await fetch(ORIGIN + '/api/v1' + path, { headers: { cookie } }); return { status: r.status, type: r.headers.get('content-type'), head: (await r.text()).slice(0, 5) }; };
  const adminPdf = await pdfOf(platform, `/platform/invoices/${custom.data.id}/pdf`);
  expect(adminPdf.status === 200 && adminPdf.type === 'application/pdf' && adminPdf.head === '%PDF-', 'Super Admin downloads the invoice PDF', adminPdf);
  const seen = (await admin.get(`/billing/invoices/${custom.data.id}`)).data;
  expect(seen.title === 'Onboarding and data import' && seen.items.length === 2, 'company opens its invoice and sees what it is for');
  const companyPdf = await pdfOf(admin, `/billing/invoices/${custom.data.id}/pdf`);
  expect(companyPdf.status === 200 && companyPdf.head === '%PDF-', 'company downloads its invoice PDF', companyPdf);
  expect((await platform.post(`/platform/invoices/${custom.data.id}/paid`, {})).data.status === 'PAID', 'custom invoice marked paid');
  await platform.put('/platform/settings/invoice-template', tplBefore);
  await platform.del(`/platform/payment-methods/${pm.data.id}`);

  // ---- Read-only demo with lead capture
  await platform.patch(`/platform/companies/${companyId}`, { isDemo: true });
  const visitor = new Client();
  await visitor.get('/auth/csrf');
  const opened = await visitor.post('/public/demo', { name: 'Demo Visitor', email: `visitor@${ws}.test`, company: 'Visitor Co' });
  expect(opened.status === 200, 'visitor opens the demo after leaving their details', opened);
  expect((await visitor.get('/employees')).status === 200, 'demo visitor can look around');
  const readOnly = await visitor.post('/departments', { name: 'Hackers', code: 'HCK' });
  expect(readOnly.status === 403 && readOnly.data.code === 'DEMO_READ_ONLY', 'the demo cannot be changed', readOnly);
  await platform.patch(`/platform/companies/${companyId}`, { isDemo: false });
  expect((await platform.get('/platform/leads')).data.some((l) => l.email === `visitor@${ws}.test` && l.source === 'DEMO'), 'Super Admin sees the demo lead');

  // ---- Website sign-up: plan + cycle, then Billing until paid
  const webWs = `e2e-${randomBytes(3).toString('hex')}`;
  const web = new Client();
  await web.get('/auth/csrf');
  const su = await web.post('/public/signup', { companyName: webWs, adminName: 'Web Owner', email: `owner@${webWs}.test`, password: pw, planId: starter.id, cycle: 'MONTHLY' });
  expect(su.status === 200 && su.data.workspace === webWs, 'company signs up from the website', su);
  const webBilling = (await web.get('/billing')).data;
  expect(webBilling.billingStatus === 'UNPAID' && webBilling.invoices.length === 1 && webBilling.invoices[0].amount === starter.priceMonthly, 'new company gets its first invoice and waits for payment', webBilling);
  expect((await web.get('/employees')).status === 402, 'signed-up company is on Billing until paid');

  // ---- Free plan (price 0): no payment, workspace open straight away
  const freePlan = await platform.post('/platform/plans', { name: `E2E Free ${webWs}`, priceMonthly: 0, priceAnnual: 0, modules: ['ATTENDANCE', 'LEAVE'], isActive: true });
  expect(freePlan.status === 201, 'Super Admin creates a free plan', freePlan);
  const freeWs = `e2e-${randomBytes(3).toString('hex')}`;
  const free = new Client();
  await free.get('/auth/csrf');
  expect((await free.post('/public/signup', { companyName: freeWs, adminName: 'Free Owner', email: `owner@${freeWs}.test`, password: pw, planId: freePlan.data.id, cycle: 'MONTHLY' })).status === 200, 'company signs up on the free plan');
  const freeBilling = (await free.get('/billing')).data;
  expect(freeBilling.billingStatus === 'PAID' && freeBilling.invoices.every((i) => i.status === 'PAID'), 'free plan needs no payment', freeBilling);
  expect((await free.get('/employees')).status === 200, 'free-plan workspace is open straight away');

  console.log(`\nAll flows passed for workspace "${ws}".`);
  // Test companies are removed afterwards so they don't pile up.
  const { deleteTestCompanies } = await import('./cleanup-test-companies.mjs');
  await deleteTestCompanies([ws, `${ws}-b`, webWs, freeWs]);
  await platform.del(`/platform/plans/${freePlan.data.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
