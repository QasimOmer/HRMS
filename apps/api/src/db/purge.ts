import { inArray, is } from 'drizzle-orm';
import { getTableConfig, PgTable, type PgColumn } from 'drizzle-orm/pg-core';
import type { Tx } from './db.service';
import * as schema from './schema';

interface Ref {
  table: PgTable;
  name: string;
  column: PgColumn;
  /** NOT NULL reference: the row belongs to the parent and goes with it. Nullable: the link is cleared. */
  owned: boolean;
  idColumn: PgColumn | undefined;
}

/**
 * Permanently removes a record and everything that belongs to it, following the foreign keys in the schema:
 *  - rows that must point at it (NOT NULL key) are removed, recursively;
 *  - rows that may point at it (nullable key, e.g. "approved by", "reporting manager") just lose the link.
 * Runs inside the caller's tenant transaction, so RLS keeps it within one company.
 */
export class RecordPurger {
  private readonly refs = new Map<string, Ref[]>();
  private readonly tables = new Map<string, PgTable>();

  constructor() {
    for (const t of Object.values(schema) as unknown[]) {
      if (!is(t, PgTable)) continue;
      const cfg = getTableConfig(t);
      this.tables.set(cfg.name, t);
      for (const fk of cfg.foreignKeys) {
        const r = fk.reference();
        const target = getTableConfig(r.foreignTable).name;
        const column = r.columns[0]!;
        if (r.columns.length !== 1 || r.foreignColumns[0]?.name !== 'id' || column.name === 'tenant_id') continue;
        const list = this.refs.get(target) ?? [];
        list.push({ table: t, name: cfg.name, column, owned: column.notNull, idColumn: cfg.columns.find((c) => c.name === 'id') });
        this.refs.set(target, list);
      }
    }
  }

  /** Deletes rows of `tableName` with the given ids, after handling everything that references them. */
  async purge(tx: Tx, tableName: string, ids: string[], depth = 0): Promise<number> {
    if (!ids.length) return 0;
    if (depth > 6) throw new Error(`Purge of ${tableName} nested too deeply`);
    const table = this.tables.get(tableName);
    if (!table) throw new Error(`Unknown table ${tableName}`);
    for (const ref of this.refs.get(tableName) ?? []) {
      if (ref.owned) {
        if (ref.idColumn && ref.name !== tableName) {
          const rows = (await tx.select({ id: ref.idColumn }).from(ref.table).where(inArray(ref.column, ids))) as { id: string }[];
          await this.purge(tx, ref.name, rows.map((r) => r.id), depth + 1);
        } else {
          await tx.delete(ref.table).where(inArray(ref.column, ids));
        }
      } else {
        await tx.update(ref.table).set({ [this.key(ref)]: null } as never).where(inArray(ref.column, ids));
      }
    }
    const idCol = getTableConfig(table).columns.find((c) => c.name === 'id')!;
    const res = await tx.delete(table).where(inArray(idCol, ids));
    return res.rowCount ?? 0;
  }

  /** Drizzle's property name for a column (the update API takes property names, not SQL names). */
  private key(ref: Ref): string {
    const entry = Object.entries(ref.table).find(([, v]) => v === ref.column);
    if (!entry) throw new Error(`Column ${ref.name}.${ref.column.name} not found`);
    return entry[0];
  }
}

export const recordPurger = new RecordPurger();
