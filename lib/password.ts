import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing, on its own so both the auth layer and the database seed can
 * use it.
 *
 * It lives here rather than in `lib/auth.ts` because `lib/auth.ts` imports the
 * database, and the database has to be able to create the built-in admin
 * account as it opens — importing auth from db would close that loop.
 *
 * Passwords are stored as `scrypt$<salt>$<key>`. scrypt is deliberately slow and
 * memory-hard, which is what makes an offline guess against a stolen database
 * expensive. Each password gets its own 16-byte salt so identical passwords
 * never produce identical hashes.
 */

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  let candidate: Buffer;
  try {
    candidate = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  } catch {
    return false;
  }
  // Constant-time compare — a length or timing difference leaks information.
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}
