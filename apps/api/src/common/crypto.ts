import { hash, verify } from '@node-rs/argon2';
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

// OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1).
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => hash(plain, ARGON);

export async function verifyPassword(hashStr: string | null | undefined, plain: string): Promise<boolean> {
  if (!hashStr) {
    // Burn comparable time so missing accounts aren't distinguishable by timing.
    await hash(plain, ARGON);
    return false;
  }
  try {
    return await verify(hashStr, plain);
  } catch {
    return false;
  }
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const hmac = (v: string) => createHmac('sha256', config().DATA_HMAC_SECRET).update(v).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/* ---------------- SEC-05: field-level encryption at rest (AES-256-GCM) ---------------- */

const ENC_PREFIX = 'enc:v1:';
let encKey: Buffer | undefined;

/**
 * DATA_ENCRYPTION_KEY (32 bytes, base64) if set; otherwise derived from DATA_HMAC_SECRET with HKDF.
 * Either way the key must never change once data has been written.
 */
function dataKey(): Buffer {
  if (encKey) return encKey;
  const explicit = config().DATA_ENCRYPTION_KEY;
  if (explicit) {
    const k = Buffer.from(explicit, 'base64');
    if (k.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    encKey = k;
  } else {
    encKey = Buffer.from(hkdfSync('sha256', config().DATA_HMAC_SECRET, 'hrms', 'hrms data encryption v1', 32));
  }
  return encKey;
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dataKey(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ENC_PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

/** Values written before encryption was enabled are returned as-is (re-encrypted on next write or by db:migrate). */
export function decryptField(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
  const d = createDecipheriv('aes-256-gcm', dataKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

export const isEncrypted = (v: string | null | undefined) => !!v && v.startsWith(ENC_PREFIX);
