import { and, eq, ne, or, sql } from 'drizzle-orm';
import type { DbService } from '../db/db.service';
import { tenants } from '../db/schema';

/** Is `domain` already used by another company, as its main or one of its extra email domains? */
export async function domainUsedByOther(db: DbService, domain: string, exceptTenantId?: string): Promise<boolean> {
  const used = or(eq(tenants.emailDomain, domain), sql`${domain} = any(${tenants.extraEmailDomains})`);
  const rows = await db.root
    .select({ id: tenants.id })
    .from(tenants)
    .where(exceptTenantId ? and(used, ne(tenants.id, exceptTenantId)) : used)
    .limit(1);
  return rows.length > 0;
}
