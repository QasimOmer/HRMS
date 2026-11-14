import { PERMISSIONS, type Paginated } from '@hrms/shared';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { DbService, Tx } from '../db/db.service';
import { tenants, userDirectory, type TenantSettings } from '../db/schema';
import { currentUser } from './context';
import { conflict, forbidden, notFound } from './errors';

export function page<T>(items: T[], total: number, p: { page: number; pageSize: number }): Paginated<T> {
  return { items, total, page: p.page, pageSize: p.pageSize };
}

export const offset = (p: { page: number; pageSize: number }) => (p.page - 1) * p.pageSize;

/** `count(*)` helper: `await tx.select(countCol).from(t).where(w)` → rows[0].n */
export const countCol = { n: sql<number>`count(*)::int` };
export const firstN = (rows: { n: number }[]) => rows[0]?.n ?? 0;

/** Escape LIKE wildcards in user search input. */
export const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function tenantInfo(tx: Tx): Promise<{ id: string; name: string; timezone: string; currency: string; settings: TenantSettings }> {
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, currentUser().tenantId));
  if (!t) throw notFound('Tenant');
  return t;
}

export function one<T>(rows: T[], what = 'Record'): T {
  const r = rows[0];
  if (!r) throw notFound(what);
  return r;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** `col IN (ids)` that is simply false for an empty list. */
export function inIds(col: AnyPgColumn, ids: string[]): SQL {
  return ids.length ? inArray(col, ids) : sql`false`;
}

/** Optional scope filter: `null` means unrestricted. */
export function scoped(col: AnyPgColumn, ids: string[] | null): SQL | undefined {
  return ids === null ? undefined : inIds(col, ids);
}

/** Permanent deletes need the "Delete records" permission on top of the module's manage permission. */
export function requireDelete() {
  if (!currentUser().permissions.has(PERMISSIONS.DATA_DELETE)) {
    throw forbidden('Deleting needs the "Delete records" permission. Ask your Company Admin to grant it.');
  }
}

/** Refuses to delete something that other records still use, saying what uses it. */
export function assertUnused(what: string, uses: [count: number, label: string][]) {
  const parts = uses.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  if (parts.length) throw conflict(`${what} can't be deleted because it is still used by ${parts.join(', ')}. Deactivate it instead.`, 'IN_USE');
}

export async function countWhere(tx: Tx, table: PgTable, where: SQL | undefined): Promise<number> {
  return firstN(await tx.select(countCol).from(table).where(where));
}

/** Runs a delete in a savepoint and turns a foreign-key violation into a clear "still in use" answer. */
export async function deleteSafely(tx: Tx, what: string, fn: () => Promise<unknown>) {
  try {
    await tx.transaction(async () => {
      await fn();
    });
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (code === '23503') throw conflict(`${what} is still linked to other records and can't be deleted. Deactivate it instead.`, 'IN_USE');
    throw e;
  }
}

/** Emails are unique across all companies; one primary-key lookup in the platform-wide directory. */
export async function emailInUse(db: DbService, email: string, exceptUserId?: string): Promise<boolean> {
  const [row] = await db.root.select({ userId: userDirectory.userId }).from(userDirectory).where(eq(userDirectory.email, email.toLowerCase())).limit(1);
  return !!row && row.userId !== exceptUserId;
}
