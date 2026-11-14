/**
 * Creates (or resets the password of) a platform owner – the SaaS operator account that creates client
 * companies and their Super Admins. Run once after deploying:
 *
 *   npm run platform:admin -- --email you@example.com --name "Your Name"
 *
 * The password comes from PLATFORM_ADMIN_PASSWORD if set; otherwise a strong one is generated and
 * printed once. Further platform owners are added from the platform console by an existing owner.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { parseArgs } from 'node:util';
import { platformAdminSchema } from '@hrms/shared';
import { hashPassword, randomToken } from '../common/crypto';
import { platformAdmins } from './schema';

async function main() {
  const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
  const email = values.email ?? process.env.PLATFORM_ADMIN_EMAIL;
  const name = values.name ?? process.env.PLATFORM_ADMIN_NAME ?? 'Super Admin';
  const generated = !process.env.PLATFORM_ADMIN_PASSWORD;
  const password = process.env.PLATFORM_ADMIN_PASSWORD || `${randomToken(12)}Aa1!`;
  const input = platformAdminSchema.parse({ email, name, password });

  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is required');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const db = drizzle(client);
    const hash = await hashPassword(input.password);
    const [existing] = await db.select({ id: platformAdmins.id, ver: platformAdmins.tokenVersion }).from(platformAdmins).where(eq(platformAdmins.email, input.email));
    if (existing) {
      await db.update(platformAdmins).set({ passwordHash: hash, name: input.name, failedLoginCount: 0, lockedUntil: null, tokenVersion: existing.ver + 1 }).where(eq(platformAdmins.id, existing.id));
      console.log(`Super Admin ${input.email} already existed – password reset.`);
    } else {
      await db.insert(platformAdmins).values({ email: input.email, name: input.name, passwordHash: hash });
      console.log(`Super Admin ${input.email} created.`);
    }
    if (generated) console.log(`Password (shown once – store it safely): ${input.password}`);
    console.log('Sign in at <APP_URL>/platform/login');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
