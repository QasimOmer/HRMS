// End-to-end smoke test against a running local API (http://localhost:4000).
// Usage: node scripts/smoke.mjs
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Load PLATFORM_ADMIN_* from .env when not already in the environment.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

const BASE = process.env.API_URL ?? 'http://localhost:4000/api/v1';

export class Client {
  jar = new Map();
  async req(method, path, body, { csrf = true, raw = false } = {}) {
    const headers = { 'content-type': 'application/json' };
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.cookie = cookie;
    if (csrf && this.jar.has('hrms_csrf')) headers['x-csrf-token'] = this.jar.get('hrms_csrf');
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      const val = v.join('=');
      if (!val || /Expires=Thu, 01 Jan 1970/i.test(c)) this.jar.delete(k);
      else this.jar.set(k, val);
    }
    if (raw) return res;
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  get = (p) => this.req('GET', p);
  post = (p, b, o) => this.req('POST', p, b, o);
  patch = (p, b) => this.req('PATCH', p, b);
  put = (p, b) => this.req('PUT', p, b);
  del = (p) => this.req('DELETE', p);
}

export function expect(cond, msg, extra) {
  if (!cond) {
    console.error('✗', msg, extra !== undefined ? JSON.stringify(extra, null, 1).slice(0, 800) : '');
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('✓', msg);
}

export const testPassword = () => `Tt1${randomBytes(12).toString('base64url')}`;

/** Signs in to the platform console (no public sign-up: companies are created by a platform owner). */
export async function platformClient() {
  const p = new Client();
  await p.get('/auth/csrf');
  const r = await p.post('/platform/login', { email: process.env.PLATFORM_ADMIN_EMAIL, password: process.env.PLATFORM_ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error(`Platform login failed (${r.status}). Run: npm run platform:admin  (uses PLATFORM_ADMIN_* from .env)`);
  return p;
}

/** Creates a company with a Super Admin and returns a Client signed in as that admin. */
export async function createCompany(platform, { companyName, workspace, adminName, email, password }) {
  // Test companies use their admin's email domain (e.g. acme-1a2b3c.test).
  const r = await platform.post('/platform/companies', { companyName, workspace, adminName, email, password, mustChangePassword: false, emailDomain: email.split('@')[1] });
  expect(r.status === 201, `company ${workspace} created`, r);
  const c = new Client();
  await c.get('/auth/csrf');
  const l = await c.post('/auth/login', { workspace, email, password });
  expect(l.status === 200, `company admin of ${workspace} signs in`, l);
  return c;
}

async function main() {
  const workspace = `acme-${randomBytes(3).toString('hex')}`;
  const password = testPassword();
  const email = `admin@${workspace}.test`;

  const anonSignup = new Client();
  await anonSignup.get('/auth/csrf');
  const pub = await anonSignup.post('/auth/signup', { companyName: 'Acme', workspace, adminName: 'Ada Admin', email, password });
  expect(pub.status === 404, 'public sign-up does not exist', pub);
  expect((await anonSignup.post('/platform/companies', { companyName: 'Acme', workspace, adminName: 'Ada', email, password })).status === 401, 'creating a company needs a Super Admin');

  const platform = await platformClient();
  const noCsrf = await platform.post('/platform/companies', { companyName: 'Acme', workspace, adminName: 'Ada Admin', email, password }, { csrf: false });
  expect(noCsrf.status === 403, 'company creation without CSRF header is rejected', noCsrf);
  const c = await createCompany(platform, { companyName: 'Acme Corp', workspace, adminName: 'Ada Admin', email, password });

  const me = await c.get('/auth/me');
  expect(me.status === 200 && me.data.user.roles.includes('SUPER_ADMIN'), 'me returns company admin', me);

  const anon = new Client();
  const unauth = await anon.get('/auth/me');
  expect(unauth.status === 401, 'unauthenticated /me is 401', unauth);

  await anon.get('/auth/csrf');
  const bad = await anon.post('/auth/login', { workspace, email, password: 'WrongPassword123' });
  expect(bad.status === 401, 'wrong password rejected', bad);
  const good = await anon.post('/auth/login', { workspace, email, password });
  expect(good.status === 200, 'login works', good);
  const refreshed = await anon.post('/auth/refresh');
  expect(refreshed.status === 200, 'refresh rotates session', refreshed);
  console.log(JSON.stringify({ workspace, email }));
  const { deleteTestCompanies } = await import('./cleanup-test-companies.mjs');
  await deleteTestCompanies([workspace]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
