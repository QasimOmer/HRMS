'use strict';
/**
 * One-off: copy ONE company (tenant) with all of its data from another HRMS database (e.g. the old Vercel one)
 * into this one. server.js runs it on start-up when these env vars are set (remove them afterwards):
 *   MIGRATE_SOURCE_URL   connection string of the source database (only ever read, in a READ ONLY transaction)
 *   MIGRATE_TENANT       workspace to copy, e.g. "ecomalign"
 *   MIGRATE_SOURCE_DATA_HMAC_SECRET (or MIGRATE_SOURCE_DATA_ENCRYPTION_KEY)  the source's secret, so encrypted
 *                        fields (enc:v1:...) can be decrypted and re-encrypted with this server's key
 * Everything is written in one transaction: all or nothing. Skipped when the company already exists here.
 * Not copied: sign-in sessions (people sign in again) and user_directory (filled by a trigger on users).
 */
const crypto = require('node:crypto');

const SKIP = new Set(['user_directory', 'refresh_tokens', '__drizzle_migrations']);
const ENC = 'enc:v1:';
const BATCH = 200;

function keyFrom(explicit, secret) {
  if (explicit) {
    const k = Buffer.from(explicit, 'base64');
    if (k.length !== 32) throw new Error('encryption key must be 32 bytes, base64');
    return k;
  }
  return secret ? Buffer.from(crypto.hkdfSync('sha256', secret, 'hrms', 'hrms data encryption v1', 32)) : null;
}
function decrypt(key, s) {
  const raw = Buffer.from(s.slice(ENC.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
function encrypt(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ENC + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
const q = (name) => '"' + String(name).replace(/"/g, '""') + '"';

async function migrateTenant({ log, apiDir }) {
  const srcUrl = process.env.MIGRATE_SOURCE_URL;
  const slug = (process.env.MIGRATE_TENANT || '').trim().toLowerCase();
  const dstUrl = process.env.DATABASE_ADMIN_URL;
  if (!srcUrl || !slug || !dstUrl) return log('migration: needs MIGRATE_SOURCE_URL, MIGRATE_TENANT and DATABASE_ADMIN_URL - skipping');
  const srcKey = keyFrom(process.env.MIGRATE_SOURCE_DATA_ENCRYPTION_KEY, process.env.MIGRATE_SOURCE_DATA_HMAC_SECRET);
  const dstKey = keyFrom(process.env.DATA_ENCRYPTION_KEY, process.env.DATA_HMAC_SECRET);

  const pg = require(require.resolve('pg', { paths: [apiDir] }));
  // Keep every value as Postgres text (exact dates, numbers, arrays, json); only bytea comes back as a Buffer.
  const types = { getTypeParser: (oid, format) => (oid === 17 ? pg.types.getTypeParser(oid, format) : (v) => v) };
  const S = new pg.Client({ connectionString: srcUrl, types });
  const D = new pg.Client({ connectionString: dstUrl, types });
  await S.connect();
  await D.connect();

  let reencrypted = 0;
  let unreadable = 0;
  const fix = (v) => {
    if (typeof v !== 'string' || !v.includes(ENC) || !srcKey || !dstKey) return v;
    return v.replace(/enc:v1:[A-Za-z0-9+/=]+/g, (m) => {
      try {
        const out = encrypt(dstKey, decrypt(srcKey, m));
        reencrypted++;
        return out;
      } catch {
        unreadable++;
        return m;
      }
    });
  };

  let locked = false;
  try {
    locked = (await D.query('SELECT pg_try_advisory_lock(72451903) AS ok')).rows[0].ok === true;
    if (!locked) return log('migration: another instance is copying - skipping');

    await S.query('BEGIN TRANSACTION READ ONLY');
    const [tenant] = (await S.query('SELECT id, name FROM tenants WHERE slug = $1', [slug])).rows;
    if (!tenant) throw new Error('company "' + slug + '" not found in the source database');
    const exists = (await D.query('SELECT 1 FROM tenants WHERE id = $1 OR slug = $2', [tenant.id, slug])).rows.length > 0;
    if (exists) return log('migration: company "' + slug + '" is already here - nothing to do (you can remove the MIGRATE_* settings)');
    log('migration: copying "' + tenant.name + '" (' + slug + ')' + (srcKey ? '' : ' - WARNING: no source key set, encrypted fields will be unreadable'));
    await S.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);

    // Tables, columns, keys and foreign keys of THIS database (the source may be older; we copy the columns both have).
    const colsOf = async (c) => {
      const { rows } = await c.query(
        "SELECT c.table_name t, c.column_name col, c.is_nullable nul, c.is_generated gen, c.identity_generation ident, c.column_default def " +
          "FROM information_schema.columns c JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name " +
          "WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE' ORDER BY c.ordinal_position",
      );
      const m = new Map();
      for (const r of rows) (m.get(r.t) || m.set(r.t, []).get(r.t)).push(r);
      return m;
    };
    const dCols = await colsOf(D);
    const sCols = await colsOf(S);
    const tables = [...dCols.keys()].filter((t) => !SKIP.has(t) && (t === 'tenants' || dCols.get(t).some((c) => c.col === 'tenant_id')));
    const missingInSource = tables.filter((t) => !sCols.has(t));
    const fks = (
      await D.query(
        "SELECT c.conrelid::regclass::text child, a.attname col, c.confrelid::regclass::text parent, af.attname pcol FROM pg_constraint c " +
          'JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1] ' +
          "WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND array_length(c.conkey, 1) = 1",
      )
    ).rows.map((r) => ({ ...r, child: r.child.replace(/"/g, ''), parent: r.parent.replace(/"/g, '') }));
    const pkOf = async (t) =>
      (await D.query("SELECT a.attname col FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = $1::regclass AND i.indisprimary", [q(t)])).rows.map((r) => r.col);

    // Insert order: parents before children; columns pointing at a table not copied yet are filled in afterwards.
    const set = new Set(tables.filter((t) => sCols.has(t)));
    const inner = fks.filter((f) => set.has(f.child) && set.has(f.parent));
    const order = [];
    const deferred = new Map();
    const placed = new Set();
    const remaining = new Set(set);
    while (remaining.size) {
      let next = [...remaining].find((t) => inner.every((e) => e.child !== t || e.parent === t || placed.has(e.parent)));
      if (!next) next = remaining.has('tenants') ? 'tenants' : [...remaining][0];
      deferred.set(next, new Set(inner.filter((e) => e.child === next && (e.parent === next || !placed.has(e.parent))).map((e) => e.col)));
      order.push(next);
      placed.add(next);
      remaining.delete(next);
    }

    await D.query('BEGIN');
    await D.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);
    const later = [];
    const outsideCache = new Map();
    const counts = [];
    for (const t of order) {
      const sHas = new Set(sCols.get(t).map((c) => c.col));
      const cols = dCols.get(t).filter((c) => sHas.has(c.col) && c.gen !== 'ALWAYS' && c.ident !== 'ALWAYS');
      const where = t === 'tenants' ? 'id' : 'tenant_id';
      const { rows } = await S.query('SELECT ' + cols.map((c) => q(c.col)).join(', ') + ' FROM ' + q(t) + ' WHERE ' + q(where) + ' = $1', [tenant.id]);
      if (!rows.length) continue;
      const def = deferred.get(t);
      for (const c of cols) if (def.has(c.col) && c.nul === 'NO') throw new Error(t + '.' + c.col + ' cannot be filled in later (NOT NULL)');
      const outside = fks.filter((f) => f.child === t && !set.has(f.parent) && cols.some((c) => c.col === f.col));
      const pk = def.size ? await pkOf(t) : [];
      for (const r of rows) {
        for (const k of Object.keys(r)) r[k] = fix(r[k]);
        // References to shared tables (plans, platform owners...) that don't exist here.
        for (const f of outside) {
          const v = r[f.col];
          if (v == null) continue;
          const key = f.parent + '|' + f.pcol + '|' + v;
          if (!outsideCache.has(key)) {
            let ok = (await D.query('SELECT 1 FROM ' + q(f.parent) + ' WHERE ' + q(f.pcol) + ' = $1', [v])).rows.length > 0;
            let mapped = ok ? v : null;
            if (!ok && f.parent === 'platform_plans') {
              const [p] = (await S.query('SELECT name FROM platform_plans WHERE id = $1', [v])).rows;
              const [m] = p ? (await D.query('SELECT id FROM platform_plans WHERE lower(name) = lower($1) LIMIT 1', [p.name])).rows : [];
              mapped = m ? m.id : null;
            }
            outsideCache.set(key, mapped);
          }
          const mapped = outsideCache.get(key);
          if (mapped == null && cols.find((c) => c.col === f.col).nul === 'NO') throw new Error(t + '.' + f.col + ' points to ' + f.parent + ' ' + v + ', which does not exist here');
          r[f.col] = mapped;
        }
        if (def.size) {
          for (const c of def) {
            if (r[c] != null) later.push({ t, pk, pkv: pk.map((k) => r[k]), col: c, v: r[c] });
            r[c] = null;
          }
        }
      }
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const params = [];
        const values = chunk.map((r) => '(' + cols.map((c) => (params.push(r[c.col]), '$' + params.length)).join(', ') + ')');
        await D.query('INSERT INTO ' + q(t) + ' (' + cols.map((c) => q(c.col)).join(', ') + ') VALUES ' + values.join(', '), params);
      }
      // Keep serial counters ahead of the copied ids.
      for (const c of cols) {
        const m = /nextval\('([^']+)'/.exec(c.def || '');
        if (m) await D.query('SELECT setval($1, GREATEST((SELECT COALESCE(MAX(' + q(c.col) + '), 1) FROM ' + q(t) + '), 1))', [m[1]]);
      }
      counts.push(t + ' ' + rows.length);
    }
    for (const u of later) {
      await D.query('UPDATE ' + q(u.t) + ' SET ' + q(u.col) + ' = $1 WHERE ' + u.pk.map((k, i) => q(k) + ' = $' + (i + 2)).join(' AND '), [u.v, ...u.pkv]);
    }
    await D.query('COMMIT');
    log('migration: done - ' + counts.join(', '));
    log('migration: ' + reencrypted + ' encrypted values re-encrypted' + (unreadable ? ', ' + unreadable + ' could NOT be decrypted (wrong source key?)' : ''));
    if (missingInSource.length) log('migration: tables new here (nothing to copy): ' + missingInSource.join(', '));
    log('migration: finished - remove the MIGRATE_* settings now');
  } catch (e) {
    await D.query('ROLLBACK').catch(() => {});
    log('migration FAILED, nothing was changed: ' + (e.detail ? e.message + ' (' + e.detail + ')' : e.message));
  } finally {
    await S.query('ROLLBACK').catch(() => {});
    if (locked) await D.query('SELECT pg_advisory_unlock(72451903)').catch(() => {});
    await S.end().catch(() => {});
    await D.end().catch(() => {});
  }
}

module.exports = { migrateTenant };
