/**
 * Applies schema migrations (as the DB owner), then the security hardening:
 *  - Row-Level Security on every tenant table (FORCE so even the owner is filtered)
 *  - least-privilege grants for the application role
 *  - append-only audit log
 * Safe to run repeatedly.
 */
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import { Client } from 'pg';
import * as schema from './schema';
import { encryptField, isEncrypted } from '../common/crypto';

/** Role used by the local dev database (scripts/dev-db.mjs) when DATABASE_URL names no user. */
const DEFAULT_APP_ROLE = 'hrms_app';

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * The application connects as the user in DATABASE_URL. Grants and RLS must target that role, not a
 * hard-coded name: on hosted Postgres (Neon, Supabase, …) there is no "hrms_app" unless we create it.
 * Returns null when the app uses the same login as migrations (one-user databases): grants are then moot,
 * and FORCE ROW LEVEL SECURITY still filters the owner.
 */
export function appRoleFrom(appUrl: string | undefined, adminUrl: string): { name: string; password?: string } | null {
  if (!appUrl) return { name: DEFAULT_APP_ROLE };
  let app: URL;
  let admin: URL;
  try {
    app = new URL(appUrl);
    admin = new URL(adminUrl);
  } catch {
    return { name: DEFAULT_APP_ROLE };
  }
  const name = decodeURIComponent(app.username);
  if (!name) return { name: DEFAULT_APP_ROLE };
  if (name === decodeURIComponent(admin.username)) return null;
  return { name, password: app.password ? decodeURIComponent(app.password) : undefined };
}

/** Create the non-owner application role if it does not exist yet (never a superuser, never BYPASSRLS). */
async function ensureAppRole(client: Client, role: { name: string; password?: string }) {
  const { rowCount } = await client.query('select 1 from pg_roles where rolname = $1', [role.name]);
  if (rowCount) return;
  if (!role.password) throw new Error(`Database role "${role.name}" (from DATABASE_URL) does not exist and DATABASE_URL has no password to create it with.`);
  await client.query(
    `CREATE ROLE ${quoteIdent(role.name)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${quoteLiteral(role.password)}`,
  );
  console.log(`Created database role "${role.name}" for the application.`);
}

/**
 * One-login databases (Prisma Postgres, Neon…): the app signs in as the owner, which often has BYPASSRLS, so
 * company filtering would be skipped. We create a restricted, no-login role the app switches to for every
 * company request (DbService.inTenant → SET LOCAL ROLE). Returns null if the role can't be created.
 */
export const RLS_ROLE = 'hrms_rls';
async function ensureRlsRole(client: Client): Promise<string | null> {
  try {
    const { rowCount } = await client.query('select 1 from pg_roles where rolname = $1', [RLS_ROLE]);
    if (!rowCount) await client.query(`CREATE ROLE ${quoteIdent(RLS_ROLE)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    await client.query(`GRANT ${quoteIdent(RLS_ROLE)} TO CURRENT_USER`).catch(() => undefined); // already a member, or superuser
    console.log(`Company requests run as the restricted role "${RLS_ROLE}".`);
    return RLS_ROLE;
  } catch (e) {
    console.warn(
      `Could not create the restricted role "${RLS_ROLE}" (${(e as Error).message}). Company isolation (RLS) is only guaranteed if the ` +
        'database login lacks BYPASSRLS; use a separate user in DATABASE_URL to fix this.',
    );
    return null;
  }
}

function tenantTables(): string[] {
  return (Object.values(schema) as unknown[])
    .filter((v): v is PgTable => is(v, PgTable))
    .map((t) => getTableConfig(t))
    .filter((c) => !schema.NON_TENANT_TABLES.includes(c.name) && c.columns.some((col) => col.name === 'tenant_id'))
    .map((c) => c.name);
}

/**
 * Cross-company references are impossible at the database level: every foreign key between two tenant
 * tables gets a companion key on (tenant_id, column) → (tenant_id, id). Foreign-key checks bypass RLS, so
 * without this a request could link a row in its own company to another company's employee, department, etc.
 * Plain foreign keys stay in place for their ON DELETE behaviour.
 */
export function sameTenantFkSql(): string {
  const tenantSet = new Set(tenantTables());
  const lines: string[] = [];
  const refs = new Set<string>();
  for (const t of Object.values(schema) as unknown[]) {
    if (!is(t, PgTable)) continue;
    const cfg = getTableConfig(t);
    if (!tenantSet.has(cfg.name)) continue;
    for (const fk of cfg.foreignKeys) {
      const r = fk.reference();
      const col = r.columns[0]?.name;
      const target = getTableConfig(r.foreignTable).name;
      if (r.columns.length !== 1 || r.foreignColumns[0]?.name !== 'id' || col === 'tenant_id' || !tenantSet.has(target)) continue;
      refs.add(target);
      const name = `${cfg.name}_${col}`.slice(0, 50) + '_same_tenant';
      lines.push(
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN ` +
          `ALTER TABLE "${cfg.name}" ADD CONSTRAINT "${name}" FOREIGN KEY ("tenant_id", "${col}") REFERENCES "${target}" ("tenant_id", "id"); END IF; END $$;`,
      );
    }
  }
  const uniques = [...refs].map((t) => `CREATE UNIQUE INDEX IF NOT EXISTS "${t.slice(0, 45)}_tenant_id_id_uq" ON "${t}" ("tenant_id", "id");`);
  return [...uniques, ...lines].join('\n');
}

export function hardeningSql(appRole: string | null = DEFAULT_APP_ROLE): string {
  const tables = tenantTables();
  const role = appRole ? quoteIdent(appRole) : null;
  const lines: string[] = role
    ? [
        `GRANT USAGE ON SCHEMA public TO ${role};`,
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role};`,
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role};`,
        // Tenants are never deleted through the app.
        `REVOKE DELETE ON tenants FROM ${role};`,
        // F5: audit trail is append-only for the application.
        `REVOKE UPDATE, DELETE ON audit_logs FROM ${role};`,
        `REVOKE ALL ON __drizzle_migrations FROM ${role};`,
      ]
    : [];
  for (const t of tables) {
    lines.push(
      `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;`,
      `DROP POLICY IF EXISTS tenant_isolation ON "${t}";`,
      `CREATE POLICY tenant_isolation ON "${t}" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);`,
    );
  }
  // Tenants: readable for workspace lookup at login, but only the current tenant can be modified.
  const cur = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;
  lines.push(
    `ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE tenants FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS tenants_read ON tenants;`,
    `DROP POLICY IF EXISTS tenants_insert ON tenants;`,
    `DROP POLICY IF EXISTS tenants_update ON tenants;`,
    `CREATE POLICY tenants_read ON tenants FOR SELECT USING (true);`,
    `CREATE POLICY tenants_insert ON tenants FOR INSERT WITH CHECK (true);`,
    `CREATE POLICY tenants_update ON tenants FOR UPDATE USING (id = ${cur}) WITH CHECK (id = ${cur});`,
    // Deleting a company is only possible for the database owner (maintenance scripts), one company at a time;
    // the app role has no DELETE on tenants at all.
    `DROP POLICY IF EXISTS tenants_delete ON tenants;`,
    `CREATE POLICY tenants_delete ON tenants FOR DELETE USING (id = ${cur});`,
  );
  return lines.join('\n');
}

/** SEC-05: encrypt confidential values written before field encryption existed. Idempotent. */
const ENCRYPTED_COLUMNS: [table: string, columns: string[]][] = [
  ['employees', ['cnic', 'father_cnic', 'basic_salary']],
  ['employee_positions', ['salary']],
  ['complaints', ['description', 'resolution_note']],
];

async function encryptLegacyValues(client: Client) {
  const { rows: tenantRows } = await client.query<{ id: string }>('select id from tenants');
  let updated = 0;
  for (const { id: tenantId } of tenantRows) {
    await client.query('BEGIN');
    try {
      // RLS is forced even for the owner, so act inside each tenant.
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      for (const [table, cols] of ENCRYPTED_COLUMNS) {
        const { rows } = await client.query<Record<string, string | null>>(`select id, ${cols.join(', ')} from ${table}`);
        for (const row of rows) {
          const pending = cols.filter((c) => row[c] != null && !isEncrypted(row[c]));
          if (!pending.length) continue;
          const sets = pending.map((c, i) => `${c} = $${i + 2}`).join(', ');
          await client.query(`update ${table} set ${sets} where id = $1`, [row.id, ...pending.map((c) => encryptField(String(row[c])))]);
          updated++;
        }
      }
      // Older payslips copied the CNIC into their snapshot; strip it.
      await client.query(`update payslips set snapshot = snapshot - 'cnic' where snapshot ? 'cnic'`);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }
  return updated;
}

/**
 * `--deploy` is used by the Vercel build: it migrates production deployments only (previews usually share
 * the production database and must not apply unreleased migrations), and skips with a warning instead of
 * failing the build when DATABASE_ADMIN_URL is not configured.
 */
function deploySkipReason(): string | null {
  if (!process.argv.includes('--deploy')) return null;
  if (!process.env.DATABASE_ADMIN_URL) return 'DATABASE_ADMIN_URL is not set';
  const env = process.env.VERCEL_ENV;
  if (env && env !== 'production' && process.env.MIGRATE_ON_PREVIEW !== 'true') return `this is a ${env} deployment (set MIGRATE_ON_PREVIEW=true to allow)`;
  return null;
}

async function main() {
  const skip = deploySkipReason();
  if (skip) {
    console.warn(`Skipping database migrations: ${skip}.`);
    return;
  }
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is required for migrations');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: resolve(__dirname, '../../drizzle'), migrationsSchema: 'public' });
    const appRole = appRoleFrom(process.env.DATABASE_URL, url);
    if (appRole) await ensureAppRole(client, appRole);
    const rlsRole = appRole ? null : await ensureRlsRole(client);
    await client.query(hardeningSql(appRole?.name ?? rlsRole));
    await client.query(sameTenantFkSql());
    const encrypted = await encryptLegacyValues(client);
    console.log(`Migrations applied; RLS enforced on ${tenantTables().length} tenant tables; ${encrypted} rows encrypted.`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
