// Deletes companies created by the automated tests (workspaces like e2e-1a2b3c, e2e-1a2b3c-b, acme-1a2b3c)
// together with all their data and uploaded files. Real companies never match the pattern.
// Usage: node scripts/cleanup-test-companies.mjs            (all test companies)
//        import { deleteTestCompanies } from './cleanup-test-companies.mjs'; await deleteTestCompanies(['e2e-1a2b3c'])
import { createRequire } from 'node:module';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = require('pg');
const TEST_SLUG = /^(e2e|acme)-[0-9a-f]{6}(-b|-dup)?$/;

function env() {
  if (existsSync('.env')) {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
}

/** Deletes the given test workspaces (or every test workspace when none are given). Returns the slugs deleted. */
export async function deleteTestCompanies(slugs) {
  env();
  const db = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await db.connect();
  const storage = resolve('apps/api', process.env.STORAGE_DIR ?? './storage');
  const deleted = [];
  try {
    const { rows } = await db.query('select id, slug from tenants');
    const targets = rows.filter((t) => TEST_SLUG.test(t.slug) && (!slugs || slugs.includes(t.slug)));
    for (const t of targets) {
      await db.query('begin');
      try {
        await db.query("select set_config('app.tenant_id', $1, true)", [t.id]);
        // Filter by company explicitly: the admin connection may bypass row-level security, and an unfiltered
        // query would return (and delete) every company's files.
        const files = (await db.query('select storage_key from files where tenant_id = $1', [t.id])).rows.map((r) => r.storage_key);
        await db.query('delete from tenants where id = $1', [t.id]); // everything else cascades
        await db.query('commit');
        // Only ever delete inside this company's own folder.
        for (const key of files) if (key.startsWith(`${t.id}/`)) rmSync(resolve(storage, key), { force: true });
        deleted.push(t.slug);
        // Marketing leads left by test runs (demo visitors / sign-ups on the test domain).
        await db.query('delete from marketing_leads where email like $1', [`%@${t.slug}.test`]);
      } catch (e) {
        await db.query('rollback');
        throw e;
      }
    }
  } finally {
    await db.end();
  }
  return deleted;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const done = await deleteTestCompanies();
  console.log(`Deleted ${done.length} test compan${done.length === 1 ? 'y' : 'ies'}${done.length ? `: ${done.join(', ')}` : ''}`);
}
