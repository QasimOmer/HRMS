'use strict';
// Production entry for single-process Node hosts (e.g. Hostinger "Node.js web app").
//
// One HTTP server on $PORT:
//   /api/*, /iclock/*, /health -> NestJS API, mounted in-process (no second port)
//   everything else  -> Next.js web app
// It starts listening immediately (the host expects listen() within seconds) and answers
// 503 "Starting up" until both apps are ready.
//
// On every start it also, under a Postgres advisory lock (so several instances starting
// at once don't collide):
//   1. creates/updates the hrms_app role   (needs DATABASE_ADMIN_URL + PG_APP_PASSWORD)
//   2. runs migrations + RLS hardening       (safe to repeat)
//
// Uploads: a relative STORAGE_DIR is placed in the home directory (~/hrms-storage by default)
// so files survive redeploys.
//
// Build first with: npm run build
// Keep thread counts low: shared hosting caps processes+threads per account (Hostinger: 120).
// Must be set before anything touches the libuv thread pool or native thread pools.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '2';
process.env.RAYON_NUM_THREADS = process.env.RAYON_NUM_THREADS || '1';

const { spawn } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = __dirname;
const apiDir = path.join(root, 'apps', 'api');
const webDir = path.join(root, 'apps', 'web');
const log = (...a) => console.log('[server]', ...a);
const MIGRATION_LOCK_ID = 72451901;
const DEMO_LOCK_ID = 72451902;

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.COOKIE_SECURE = process.env.COOKIE_SECURE || 'true';
process.env.HRMS_EMBEDDED = '1'; // apps/api/dist/main.js: don't listen on API_PORT
const storage = process.env.STORAGE_DIR;
if (!storage || !path.isAbsolute(storage)) {
  process.env.STORAGE_DIR = path.join(os.homedir(), 'hrms-storage');
}

let apiHandler = null;
let webHandler = null;
let startupFailed = false;

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  // /iclock/* are fixed paths used by ZKTeco biometric devices (BIO-01).
  const isApi = url.startsWith('/api/') || url.startsWith('/iclock/') || url === '/health' || url.startsWith('/health?');
  // Cold start: hold the request until both apps are ready (up to 60s) instead of failing it.
  const started = Date.now();
  const serve = () => {
    const handler = isApi ? apiHandler : webHandler;
    if (handler) return handler(req, res);
    if (startupFailed || Date.now() - started > 60_000) {
      res.statusCode = 503;
      res.setHeader('Retry-After', '5');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end(startupFailed ? 'Service failed to start - check the server logs.' : 'Still starting up, please retry in a few seconds.');
    }
    setTimeout(serve, 150);
  };
  serve();
});
const port = process.env.PORT || 3000;
server.listen(port, () => log('listening on ' + port));

function runNode(script, cwd, extraEnv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { cwd, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
    child.on('exit', (code) => resolve(code));
    child.on('error', (err) => {
      log('could not run ' + script + ': ' + err.message);
      resolve(1);
    });
  });
}

/** True when every migration in apps/api/drizzle has already been applied (skips a slow child process). */
async function migrationsUpToDate(client) {
  try {
    const journal = require(path.join(apiDir, 'drizzle', 'meta', '_journal.json'));
    const r = await client.query('SELECT count(*)::int AS n FROM public.__drizzle_migrations');
    return r.rows[0].n >= journal.entries.length;
  } catch {
    return false;
  }
}

async function prepareDatabase() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) {
    log('DATABASE_ADMIN_URL not set - skipping role setup and migrations');
    return;
  }
  const { Client } = require(require.resolve('pg', { paths: [apiDir] }));
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    const pw = process.env.PG_APP_PASSWORD;
    if (pw) {
      const lit = "'" + pw.replace(/'/g, "''") + "'";
      const r = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app'");
      if (r.rowCount === 0) {
        await client.query('CREATE ROLE hrms_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ' + lit);
        log('created database role hrms_app');
      } else {
        await client.query('ALTER ROLE hrms_app PASSWORD ' + lit);
      }
    }
    if (await migrationsUpToDate(client)) {
      log('database schema up to date');
    } else {
      const code = await runNode('dist/db/migrate.js', apiDir);
      if (code !== 0) log('migrations failed (exit ' + code + ')');
    }
    // Platform owner (Super Admin of the SaaS): created or its password reset from the env, when both are set.
    // Done in-process: shared hosting may refuse to start extra processes (spawn EAGAIN).
    try {
      await ensurePlatformAdmin(client);
    } catch (err) {
      log('platform owner setup failed: ' + err.message);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    await client.end().catch(() => {});
  }
}

/** Same Argon2id settings as apps/api/src/common/crypto.ts. */
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

/** Creates the platform owner, or updates its password when PLATFORM_ADMIN_PASSWORD changed. */
async function ensurePlatformAdmin(client) {
  const email = (process.env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD || '';
  if (!email || !password) return;
  const name = (process.env.PLATFORM_ADMIN_NAME || 'Super Admin').trim();
  const argon2 = require(require.resolve('@node-rs/argon2', { paths: [apiDir] }));
  const found = await client.query('SELECT id, password_hash FROM platform_admins WHERE email = $1', [email]);
  if (found.rowCount) {
    let same = false;
    try {
      same = await argon2.verify(found.rows[0].password_hash, password);
    } catch {}
    if (same) return log('platform owner ready: ' + email);
    const hash = await argon2.hash(password, ARGON);
    await client.query(
      'UPDATE platform_admins SET password_hash = $1, name = $2, failed_login_count = 0, locked_until = NULL, token_version = token_version + 1 WHERE id = $3',
      [hash, name, found.rows[0].id],
    );
    log('platform owner password updated: ' + email);
  } else {
    const hash = await argon2.hash(password, ARGON);
    await client.query('INSERT INTO platform_admins (email, name, password_hash) VALUES ($1, $2, $3)', [email, name, hash]);
    log('platform owner created: ' + email);
  }
}

/**
 * Runs scripts/seed-demo.mjs inside this process (no child process). The script ends with
 * main().catch(... process.exit(1)), so a copy is loaded that exports main() instead.
 */
async function runSeedDemo(workspace) {
  const fs = require('node:fs');
  const { pathToFileURL } = require('node:url');
  const scripts = path.join(root, 'scripts');
  const src = fs
    .readFileSync(path.join(scripts, 'seed-demo.mjs'), 'utf8')
    .replace("from './smoke.mjs'", 'from ' + JSON.stringify(pathToFileURL(path.join(scripts, 'smoke.mjs')).href))
    .replace(/main\(\)\.catch\([\s\S]*$/, 'export { main };\n');
  const tmp = path.join(os.tmpdir(), 'hrms-seed-demo-' + process.pid + '.mjs');
  fs.writeFileSync(tmp, src);
  // Prefer our own port; some hosts (Hostinger/LiteSpeed) don't expose it, so fall back to the public URL.
  let base = 'http://127.0.0.1:' + port;
  try { await fetch(base + '/health', { signal: AbortSignal.timeout(3000) }); }
  catch { base = (process.env.APP_URL || '').replace(/\/+$/, ''); }
  process.env.API_URL = base + '/api/v1';
  log('seeding through ' + base);
  process.env.DEMO_WORKSPACE = workspace;
  const realExit = process.exit;
  process.exit = (code) => {
    throw new Error('seed script tried to exit (' + code + ')');
  };
  try {
    const mod = await import(pathToFileURL(tmp).href);
    await mod.main();
    return 0;
  } catch (err) {
    log('demo seeding error: ' + (err && err.message ? err.message : err));
    return 1;
  } finally {
    process.exit = realExit;
    fs.unlink(tmp, () => {});
  }
}

/**
 * SEED_DEMO=1: once, fills a read-only demo company (scripts/seed-demo.mjs, through our own API) and marks
 * it as the website's live demo. Skipped when the demo workspace already exists. Needs PLATFORM_ADMIN_*.
 */
async function seedDemoIfRequested() {
  if (process.env.SEED_DEMO !== '1' || !process.env.DATABASE_ADMIN_URL) return;
  if (!process.env.PLATFORM_ADMIN_EMAIL || !process.env.PLATFORM_ADMIN_PASSWORD) {
    log('SEED_DEMO needs PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD - skipping');
    return;
  }
  const workspace = process.env.DEMO_WORKSPACE || 'demo';
  const { Client } = require(require.resolve('pg', { paths: [apiDir] }));
  const client = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await client.connect();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [DEMO_LOCK_ID]);
    if (!lock.rows[0].ok) return; // another instance is seeding
    const findTenant = async () => (await client.query('SELECT id, is_demo FROM tenants WHERE slug = $1', [workspace])).rows[0];
    let tenant = await findTenant();
    if (!tenant) {
      log('seeding demo company "' + workspace + '"');
      const code = await runSeedDemo(workspace);
      if (code !== 0) log('demo seeding failed (exit ' + code + ')');
      tenant = await findTenant();
    }
    if (tenant && !tenant.is_demo) {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);
      await client.query('UPDATE tenants SET is_demo = true WHERE id = $1', [tenant.id]);
      await client.query('COMMIT');
      log('demo company "' + workspace + '" is now the live demo');
    }
    await client.query('SELECT pg_advisory_unlock($1)', [DEMO_LOCK_ID]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    log('demo setup failed: ' + err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

async function startApi() {
  const { createApiApp } = require(path.join(apiDir, 'dist', 'main.js'));
  const app = await createApiApp();
  await app.init();
  const expressApp = app.getHttpAdapter().getInstance();
  apiHandler = (req, res) => expressApp(req, res);
  log('API ready');
}

async function startWeb() {
  const nextMod = require(require.resolve('next', { paths: [webDir] }));
  const next = nextMod.default || nextMod;
  const app = next({ dev: false, dir: webDir });
  await app.prepare();
  webHandler = app.getRequestHandler();
  log('web ready');
}

(async () => {
  const web = startWeb().catch((err) => {
    startupFailed = true;
    console.error('[server] web failed to start', err);
  });
  try {
    await prepareDatabase();
  } catch (err) {
    log('database preparation failed: ' + err.message);
  }
  try {
    await startApi();
  } catch (err) {
    startupFailed = true;
    console.error('[server] API failed to start', err);
  }
  await web;
  if (apiHandler) await seedDemoIfRequested();
  // One-off company copy from another database (MIGRATE_SOURCE_URL + MIGRATE_TENANT); see scripts/migrate-tenant.cjs.
  if (apiHandler && process.env.MIGRATE_SOURCE_URL) {
    await require(path.join(__dirname, 'scripts', 'migrate-tenant.cjs')).migrateTenant({ log, apiDir }).catch((e) => log('migration error: ' + e.message));
  }
})();

function shutdown() {
  server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
