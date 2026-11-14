// Seeds a realistic demo company through the public API (all business rules apply).
// Usage (API running): node scripts/seed-demo.mjs
// Login details are written to demo-credentials.local.md (git-ignored).
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Client, createCompany, platformClient } from './smoke.mjs';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const TZ = 'Asia/Karachi';
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const today = ymd(new Date());
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const dow = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
const pk = (date, hhmm) => `${date}T${hhmm}:00+05:00`;
const pad = (n) => String(n).padStart(2, '0');
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function must(r, what) {
  if (r.status >= 300) throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function login(ws, email, password) {
  const c = new Client();
  await c.get('/auth/csrf');
  must(await c.post('/auth/login', { workspace: ws, email, password }), `login ${email}`);
  return c;
}

const PEOPLE = [
  { name: 'Hina Raza', email: 'hina', dept: 'HR', level: 'L5', roles: ['HR'], designation: 'HR Manager', tier: 'MANAGEMENT' },
  { name: 'Omar Farooq', email: 'omar', dept: 'OPS', level: 'L5', roles: ['OPERATIONS'], designation: 'Operations Manager', tier: 'MANAGEMENT' },
  { name: 'Tariq Mehmood', email: 'tariq', dept: 'SALES', level: 'L4', roles: [], designation: 'Sales Team Lead', tier: 'TEAM_LEAD' },
  { name: 'Ayesha Khan', email: 'ayesha', dept: 'SALES', level: 'L2', roles: [], designation: 'Sales Executive', tier: 'MEMBER' },
  { name: 'Bilal Ahmed', email: 'bilal', dept: 'SALES', level: 'L1', roles: [], designation: 'Sales Associate', tier: 'MEMBER' },
  { name: 'Sana Iqbal', email: 'sana', dept: 'SALES', level: 'L3', roles: [], designation: 'Senior Sales Executive', tier: 'MEMBER' },
  { name: 'Usman Ali', email: 'usman', dept: 'DEV', level: 'L4', roles: [], designation: 'Lead Developer', tier: 'TEAM_LEAD' },
  { name: 'Fatima Noor', email: 'fatima', dept: 'DEV', level: 'L2', roles: [], designation: 'Developer', tier: 'MEMBER' },
  { name: 'Hamza Sheikh', email: 'hamza', dept: 'DEV', level: 'L0', roles: [], designation: 'Intern Developer', tier: 'MEMBER' },
  { name: 'Zainab Malik', email: 'zainab', dept: 'DEV', level: 'L3', roles: [], designation: 'Senior Developer', tier: 'MEMBER' },
];

async function main() {
  const ws = process.env.DEMO_WORKSPACE ?? `demo-${randomBytes(2).toString('hex')}`;
  const domain = `${ws}.example.com`;
  const password = `Demo${randomBytes(9).toString('base64url')}1a`;
  console.log(`Seeding workspace "${ws}"…`);

  const admin = await createCompany(await platformClient(), { companyName: 'Nimbus Technologies', workspace: ws, adminName: 'Sara Admin', email: `admin@${domain}`, password });

  const depts = must(await admin.get('/departments'), 'departments');
  const byCode = Object.fromEntries(depts.map((d) => [d.code, d]));
  const levels = {};
  for (const d of depts) levels[d.code] = must(await admin.get(`/levels?departmentId=${d.id}`), 'levels');

  const people = {};
  const joined = addDays(today, -400);
  for (const [i, p] of PEOPLE.entries()) {
    const lvl = levels[p.dept].find((l) => l.code === p.level);
    const dobMonth = pad(((new Date().getMonth() + i) % 12) + 1);
    const dobDay = i === 3 ? today.slice(8) : pad(rnd(1, 28));
    const dob = i === 3 ? `1996-${today.slice(5)}` : `${1988 + i}-${dobMonth}-${dobDay}`;
    const e = must(await admin.post('/employees', {
      fullName: p.name, email: `${p.email}@${domain}`, departmentId: byCode[p.dept].id, levelId: lvl.id, designation: p.designation,
      joiningDate: addDays(joined, i * 20), dateOfBirth: dob, roles: ['EMPLOYEE', ...p.roles], sendInvite: false, hierarchyTier: p.tier,
      cnic: `35202-${String(1000000 + i * 1111).slice(0, 7)}-${i % 10}`, contactNo: `+92 300 ${rnd(1000000, 9999999)}`, emergencyContact: `+92 321 ${rnd(1000000, 9999999)}`, bloodGroup: ['A+', 'B+', 'O+', 'AB+'][i % 4],
    }), `employee ${p.name}`);
    must(await admin.post(`/access/users/${e.userId}/password`, { password, mustChange: false }), 'password');
    people[p.email] = e;
  }
  // Reporting lines
  for (const k of ['ayesha', 'bilal', 'sana']) await admin.patch(`/employees/${people[k].id}`, { reportingManagerId: people.tariq.id });
  for (const k of ['fatima', 'hamza', 'zainab']) await admin.patch(`/employees/${people[k].id}`, { reportingManagerId: people.usman.id });

  const sales = must(await admin.post('/teams', { name: 'Sales Falcons', departmentId: byCode.SALES.id, leadEmployeeId: people.tariq.id }), 'team');
  const dev = must(await admin.post('/teams', { name: 'Platform Squad', departmentId: byCode.DEV.id, leadEmployeeId: people.usman.id }), 'team');
  for (const k of ['ayesha', 'bilal', 'sana']) await admin.post(`/teams/${sales.id}/members`, { employeeId: people[k].id });
  for (const k of ['fatima', 'hamza', 'zainab']) await admin.post(`/teams/${dev.id}/members`, { employeeId: people[k].id });

  // Holidays & events
  const year = today.slice(0, 4);
  for (const [name, d] of [['Kashmir Day', `${year}-02-05`], ['Pakistan Day', `${year}-03-23`], ['Labour Day', `${year}-05-01`], ['Independence Day', `${year}-08-14`], ['Iqbal Day', `${year}-11-09`], ['Quaid-e-Azam Day', `${year}-12-25`]]) {
    await admin.post('/holidays', { name, date: d, type: 'PUBLIC' });
  }
  await admin.post('/calendar/events', { title: 'Quarterly town hall', startDate: addDays(today, 5), endDate: addDays(today, 5), visibility: 'COMPANY' });
  await admin.post('/calendar/events', { title: 'Sales kickoff', startDate: addDays(today, 9), endDate: addDays(today, 9), visibility: 'DEPARTMENT', departmentId: byCode.SALES.id });

  // Salary components
  await admin.post('/payroll/components', { kind: 'ALLOWANCE', code: 'HOUSE_RENT', label: 'House rent allowance', amount: 10, isPercentOfBasic: true });
  await admin.post('/payroll/components', { kind: 'ALLOWANCE', code: 'CONVEYANCE', label: 'Conveyance allowance', amount: 5000, isPercentOfBasic: false });
  await admin.post('/payroll/components', { kind: 'DEDUCTION', code: 'EOBI', label: 'EOBI contribution', amount: 370, isPercentOfBasic: false });

  // ~6 weeks of biometric attendance via a device
  const device = must(await admin.post('/attendance/devices', { name: 'Main entrance' }), 'device');
  const punches = [];
  const staff = Object.entries(people);
  for (let d = addDays(today, -42); d < today; d = addDays(d, 1)) {
    if (dow(d) === 0 || dow(d) === 6) continue;
    for (const [key, e] of staff) {
      const r = Math.random();
      if (r < 0.04) continue; // absent
      const late = r < 0.15 ? rnd(20, 50) : rnd(-10, 12);
      const inM = 9 * 60 + late;
      const ot = key === 'sana' || key === 'zainab' ? (Math.random() < 0.35 ? rnd(60, 150) : 0) : Math.random() < 0.08 ? rnd(45, 120) : 0;
      const skipBreak = Math.random() < 0.12;
      const outM = inM + (skipBreak ? 480 : 540) + ot + rnd(-5, 10);
      const t = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
      punches.push({ employeeCode: e.employeeCode, at: pk(d, t(inM)) });
      if (!skipBreak) {
        punches.push({ employeeCode: e.employeeCode, at: pk(d, t(13 * 60 + rnd(0, 10))) });
        punches.push({ employeeCode: e.employeeCode, at: pk(d, t(14 * 60 + rnd(0, 10))) });
      }
      punches.push({ employeeCode: e.employeeCode, at: pk(d, t(outM)) });
    }
  }
  // Today: people who already checked in
  for (const [, e] of staff.slice(0, 7)) punches.push({ employeeCode: e.employeeCode, at: pk(today, `08:${pad(rnd(45, 59))}`) });
  for (let i = 0; i < punches.length; i += 900) {
    const res = await fetch(`${API}/attendance/device/punches`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-key': device.apiKey }, body: JSON.stringify({ punches: punches.slice(i, i + 900) }) });
    if (!res.ok) throw new Error(`device push failed ${res.status} ${await res.text()}`);
  }
  console.log(`  ${punches.length} biometric punches imported`);

  // Logins for workflow actors
  const HR = await login(ws, `hina@${domain}`, password);
  const OPS = await login(ws, `omar@${domain}`, password);
  const TL = await login(ws, `tariq@${domain}`, password);
  const TL2 = await login(ws, `usman@${domain}`, password);
  const ayesha = await login(ws, `ayesha@${domain}`, password);
  const fatima = await login(ws, `fatima@${domain}`, password);
  const bilal = await login(ws, `bilal@${domain}`, password);

  // Leave: one approved, one waiting for TL, one waiting for HR
  const types = must(await ayesha.get('/leave/types'), 'types');
  const casual = types.find((t) => t.code === 'CASUAL');
  const sick = types.find((t) => t.code === 'SICK');
  let nextMon = addDays(today, 1);
  while (dow(nextMon) !== 1) nextMon = addDays(nextMon, 1);
  const l1 = must(await ayesha.post('/leave/requests', { leaveTypeId: casual.id, startDate: nextMon, endDate: addDays(nextMon, 1), reason: "Sister's wedding" }), 'leave');
  await TL.post(`/leave/requests/${l1.id}/decision`, { approve: true, comment: 'Enjoy!' });
  await HR.post(`/leave/requests/${l1.id}/decision`, { approve: true });
  must(await bilal.post('/leave/requests', { leaveTypeId: sick.id, startDate: addDays(nextMon, 2), endDate: addDays(nextMon, 2), reason: 'Doctor appointment' }), 'leave2');
  const l3 = must(await fatima.post('/leave/requests', { leaveTypeId: casual.id, startDate: addDays(nextMon, 7), endDate: addDays(nextMon, 9), reason: 'Family trip to Hunza' }), 'leave3');
  await TL2.post(`/leave/requests/${l3.id}/decision`, { approve: true });

  // Overtime approvals (some approved, rest pending)
  const ots = must(await TL.get('/attendance/overtime?status=PENDING'), 'ot');
  for (const o of ots.slice(0, Math.ceil(ots.length / 2))) await TL.post(`/attendance/overtime/${o.id}/decision`, { approve: true, workDescription: 'Client follow-ups and month-end reporting' });

  // KPIs
  const month = today.slice(0, 7);
  const tgt = {};
  for (const [k, target] of [['ayesha', 1500000], ['bilal', 800000], ['sana', 2000000]]) {
    tgt[k] = must(await TL.post('/kpi/targets', { employeeId: people[k].id, period: month, metric: 'Sales revenue', unit: 'PKR', targetValue: target, incentiveType: 'PERCENT_OF_EXCESS', incentiveValue: 5 }), 'target');
  }
  const sana = await login(ws, `sana@${domain}`, password);
  const s1 = must(await sana.post('/kpi/submissions', { targetId: tgt.sana.id, period: month, metric: 'Sales revenue', achievedValue: 2350000, notes: 'Closed two enterprise deals' }), 'kpi');
  await TL.post(`/kpi/submissions/${s1.id}/decision`, { approve: true, remarks: 'Outstanding month!' });
  await HR.post(`/kpi/submissions/${s1.id}/decision`, { approve: true, remarks: 'Well done' });
  must(await ayesha.post('/kpi/submissions', { targetId: tgt.ayesha.id, period: month, metric: 'Sales revenue', achievedValue: 1320000 }), 'kpi2');

  // Loans & medical
  await HR.post('/payroll/loans', { employeeId: people.bilal.id, principal: 60000, installment: 10000, startPeriod: month, reason: 'Motorbike repair' });

  // Payroll for last month: processed by HR, approved by Super Admin (HR step) and Operations
  const lastMonth = addDays(`${month}-01`, -1).slice(0, 7);
  const run = must(await HR.post('/payroll/runs', { period: lastMonth }), 'payroll');
  await HR.post(`/payroll/runs/${run.id}/submit`);
  await admin.post(`/payroll/runs/${run.id}/decision`, { approve: true, comment: 'Checked against attendance' });
  await OPS.post(`/payroll/runs/${run.id}/decision`, { approve: true });
  await HR.post(`/payroll/runs/${run.id}/mark-paid`);
  console.log(`  payroll ${lastMonth} approved and paid`);

  // Policies
  const policies = [
    ['LEAVE', 'Leave Policy', 'Entitlements, applying and cancelling leave.', 'Every employee is entitled to 14 days of casual leave and 7 days of sick leave per calendar year. Compensation leave is earned from approved overtime.\n\nApply through the HR portal. Your Team Lead reviews the request first and HR gives final approval. Approved leave can be cancelled through the portal; HR reviews every cancellation.'],
    ['ATTENDANCE', 'Attendance Policy', 'Working hours, biometric attendance and corrections.', 'Working hours are 09:00–18:00, Monday to Friday, with a one-hour break. Attendance is recorded with the biometric device at the main entrance.\n\nIf you work without taking your break, you may leave early by the length of the break. Missed or incorrect punches can be corrected by submitting a correction request (Team Lead → HR).'],
    ['LATE_ARRIVAL', 'Late Arrival Policy', 'Grace period and consequences of repeated late arrival.', 'There is no grace period. Any check-in after the shift start is recorded as late, with the minutes counted. Three late arrivals in a month will be discussed with your Team Lead.'],
    ['HR', 'Code of Conduct', 'Expected behaviour at work.', 'Treat colleagues with respect. Harassment, discrimination and bullying are not tolerated. Report concerns confidentially through the Complaints section.'],
  ];
  for (const [category, title, summary, content] of policies) {
    const fd = new FormData();
    Object.entries({ category, title, summary, content }).forEach(([k, v]) => fd.set(k, v));
    const res = await fetch(`${API}/policies`, { method: 'POST', headers: { cookie: [...HR.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-csrf-token': HR.jar.get('hrms_csrf') }, body: fd });
    const p = await res.json();
    await HR.post(`/policies/${p.id}/publish`);
  }

  // Community
  await HR.post('/announcements', { title: 'Welcome to our new HR portal 🎉', body: 'You can now check attendance, apply for leave, download salary slips and much more, all in one place. Please complete your profile and accept the community guidelines.', pinned: true });
  await HR.post('/announcements', { title: 'Office closed on public holidays', body: 'Please check the calendar for upcoming public holidays.' });
  for (const c of [HR, ayesha, sana, TL]) await c.post('/community/guidelines/accept');
  await HR.req('PUT', `/community/posting/${people.sana.userId}`, { canPost: true });
  const sana2 = await login(ws, `sana@${domain}`, password);
  await sana2.post('/community/posts', { body: 'Just closed our biggest deal of the quarter with the Sales Falcons! 🚀 Thank you team!' });

  // Queries & survey
  const q = must(await bilal.post('/queries', { subject: 'Loan deduction schedule', category: 'PAYROLL', body: 'When will the first loan instalment be deducted from my salary?' }), 'query');
  await TL.post(`/queries/${q.id}/messages`, { body: 'It starts with this month’s payroll. Let me confirm the amount with HR.' });
  const sv = must(await HR.post('/surveys', { title: 'Quarterly pulse check', kind: 'GENERAL', audience: 'ALL', anonymous: true, questions: [
    { id: 'q1', type: 'RATING', label: 'How satisfied are you with your work environment?', required: true },
    { id: 'q2', type: 'SINGLE_CHOICE', label: 'How manageable is your workload?', options: ['Too light', 'Just right', 'Too heavy'], required: true },
    { id: 'q3', type: 'TEXT', label: 'What one thing should we improve?', required: false },
  ] }), 'survey');
  await HR.post(`/surveys/${sv.id}/open`);
  await ayesha.post(`/surveys/${sv.id}/responses`, { answers: { q1: 4, q2: 'Just right', q3: 'More team lunches!' } });
  await fatima.post(`/surveys/${sv.id}/responses`, { answers: { q1: 5, q2: 'Too heavy' } });

  const rows = [['Super Admin', 'admin'], ['HR', 'hina'], ['Operations', 'omar'], ['Team Lead (Sales)', 'tariq'], ['Team Lead (Development)', 'usman'], ['Employee', 'ayesha'], ['Employee', 'sana']];
  const md = `# Demo login details (local only – do not commit)\n\nWorkspace: **${ws}**\nPassword for every account: \`${password}\`\n\n| Role | Email |\n|---|---|\n${rows.map(([r, e]) => `| ${r} | ${e}@${domain} |`).join('\n')}\n`;
  writeFileSync('demo-credentials.local.md', md);
  console.log(`\nDone. Login details saved to demo-credentials.local.md (workspace "${ws}").`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
