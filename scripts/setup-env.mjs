// Creates .env with strong random secrets (never overwrites an existing .env).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env already exists – leaving it untouched.');
  process.exit(0);
}
const secret = (n = 32) => randomBytes(n).toString('base64url');
const superPw = secret(18);
const appPw = secret(18);
const template = readFileSync('.env.example', 'utf8');
const out = template
  .replace('PG_SUPERUSER_PASSWORD=change-me', `PG_SUPERUSER_PASSWORD=${superPw}`)
  .replace('PG_APP_PASSWORD=change-me', `PG_APP_PASSWORD=${appPw}`)
  .replace('postgres://postgres:change-me@', `postgres://postgres:${superPw}@`)
  .replace('postgres://hrms_app:change-me@', `postgres://hrms_app:${appPw}@`)
  .replace('JWT_SECRET=change-me', `JWT_SECRET=${secret(48)}`)
  .replace('DATA_HMAC_SECRET=change-me', `DATA_HMAC_SECRET=${secret(48)}`)
  .replace(/^DATA_ENCRYPTION_KEY=$/m, `DATA_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`)
  .replace('PLATFORM_ADMIN_PASSWORD=change-me', `PLATFORM_ADMIN_PASSWORD=${secret(18)}Aa1`);
writeFileSync('.env', out, { mode: 0o600 });
console.log('Created .env with fresh secrets.');
