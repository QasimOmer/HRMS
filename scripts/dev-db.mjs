// Local PostgreSQL for development (no Docker / system service needed).
// Production uses a managed Postgres or infra/docker-compose.yml instead.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import pg from 'pg';

const env = process.env;
const required = ['PG_SUPERUSER_PASSWORD', 'PG_APP_PASSWORD'];
for (const k of required) {
  if (!env[k]) {
    console.error(`Missing ${k}. Run "node scripts/setup-env.mjs" first, then "npm run db:start".`);
    process.exit(1);
  }
}

const port = Number(env.PG_PORT ?? 5433);
const dataDir = resolve(process.cwd(), '.pgdata');
const db = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: env.PG_SUPERUSER_PASSWORD,
  port,
  persistent: true,
  // Always UTF-8 (Windows would otherwise default to WIN1252 and reject Urdu names, emoji, "→").
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-collate=C', '--lc-ctype=C'],
  onLog: () => {},
});

/** Is something already listening on the port? (e.g. the database was started from another window) */
const portInUse = () =>
  new Promise((ok) => {
    const sock = createConnection({ host: '127.0.0.1', port }, () => { sock.end(); ok(true); });
    sock.on('error', () => ok(false));
    sock.setTimeout(1500, () => { sock.destroy(); ok(false); });
  });

if (await portInUse()) {
  console.log(`PostgreSQL is already running on localhost:${port}. Nothing to do; you can start the API and web app.`);
  process.exit(0);
}

if (!existsSync(resolve(dataDir, 'PG_VERSION'))) {
  console.log('Initialising database cluster in .pgdata …');
  await db.initialise();
}
try {
  await db.start();
} catch (e) {
  // After a crash or restart Postgres can leave a stale lock file behind; nothing is running, so remove it and retry once.
  const lock = resolve(dataDir, 'postmaster.pid');
  if (existsSync(lock)) {
    console.log('Removing a stale lock file left by an earlier run, then retrying…');
    rmSync(lock, { force: true });
    await db.start();
  } else {
    console.error(`Could not start PostgreSQL on port ${port}: ${e?.message ?? e ?? 'unknown error'}`);
    process.exit(1);
  }
}

const admin = new pg.Client({
  host: 'localhost',
  port,
  user: 'postgres',
  password: env.PG_SUPERUSER_PASSWORD,
  database: 'postgres',
});
await admin.connect();
const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'hrms'");
if (exists.rowCount === 0) await admin.query("CREATE DATABASE hrms ENCODING 'UTF8' TEMPLATE template0");
const enc = await admin.query("SELECT pg_encoding_to_char(encoding) AS e FROM pg_database WHERE datname = 'hrms'");
if (enc.rows[0]?.e !== 'UTF8') {
  console.error(`Database "hrms" uses ${enc.rows[0]?.e}, not UTF8. Stop this script, delete the .pgdata folder and run it again.`);
  await admin.end();
  await db.stop();
  process.exit(1);
}
// Application role: no superuser, no BYPASSRLS → Row-Level Security always applies.
const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app'");
const pwLiteral = `'${env.PG_APP_PASSWORD.replace(/'/g, "''")}'`;
if (role.rowCount === 0) {
  await admin.query(`CREATE ROLE hrms_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${pwLiteral}`);
} else {
  await admin.query(`ALTER ROLE hrms_app PASSWORD ${pwLiteral}`);
}
await admin.end();

console.log(`PostgreSQL ready on localhost:${port} (database "hrms"). Press Ctrl+C to stop.`);

const shutdown = async () => {
  await db.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
