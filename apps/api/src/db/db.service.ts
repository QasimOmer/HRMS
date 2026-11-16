import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import { als } from '../common/context';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger('Database');
  readonly pool: Pool;
  /** Raw handle – only for platform tables (tenants, jobs). Tenant data must go through `tx`. */
  readonly root: Database;

  constructor() {
    this.pool = new Pool({
      connectionString: config().DATABASE_URL,
      max: config().DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      statement_timeout: 30_000,
    });
    // Hosted Postgres (Neon, Supabase, …) closes idle connections. Without a listener, that 'error'
    // event is unhandled and crashes the whole process; the pool replaces the client on its own.
    this.pool.on('error', (err) => this.logger.warn(`Idle database connection dropped: ${err.message}`));
    this.root = drizzle(this.pool, { schema, casing: 'snake_case' });
  }

  /** The transaction bound to the current request (tenant context already set). */
  get tx(): Tx {
    const tx = als.getStore()?.tx;
    if (!tx) throw new Error('No tenant transaction in context – is the route authenticated?');
    return tx;
  }

  /**
   * Run `fn` inside a transaction with the Postgres RLS tenant set.
   * Nested calls reuse the outer transaction.
   */
  async inTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const store = als.getStore();
    if (store?.tx && store.tenantId === tenantId) return fn(store.tx);
    const role = await this.restrictedRole();
    return this.root.transaction(async (tx) => {
      if (role) await tx.execute(sql.raw(`set local role "${role}"`));
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      if (store) {
        const prev = { tx: store.tx, tenantId: store.tenantId };
        store.tx = tx;
        store.tenantId = tenantId;
        try {
          return await fn(tx);
        } finally {
          store.tx = prev.tx;
          store.tenantId = prev.tenantId;
        }
      }
      return als.run({ tenantId, tx }, () => fn(tx));
    });
  }

  private rlsRole?: Promise<string | null>;

  /**
   * When the app's login can skip row-level security (superuser or BYPASSRLS, typical for one-login hosted
   * databases), company requests switch to the restricted "hrms_rls" role made by the migrations, so each
   * company only ever sees its own rows. A normal app login (like the local hrms_app) needs no switch.
   */
  private restrictedRole(): Promise<string | null> {
    this.rlsRole ??= this.pool
      .query<{ rolname: string }>(
        `select r.rolname from pg_roles r join pg_roles me on me.rolname = current_user
         where r.rolname = 'hrms_rls' and (me.rolsuper or me.rolbypassrls) and pg_has_role(current_user, r.oid, 'MEMBER')`,
      )
      .then((r) => {
        const role = r.rows[0]?.rolname ?? null;
        if (role) this.logger.log(`Company requests run as the restricted role "${role}"`);
        return role;
      })
      .catch((e) => {
        this.rlsRole = undefined; // try again on the next request
        this.logger.warn(`Could not check the database role: ${(e as Error).message}`);
        return null;
      });
    return this.rlsRole;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
