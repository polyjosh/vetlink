import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;

/**
 * Field-level encryption for highly sensitive columns (national IDs, TOTP secrets; §17).
 * Separate keys for encryption and lookup hashing are derived from one master key with HKDF,
 * so a leaked hash key never decrypts data.
 */
export interface FieldCrypto {
  /**
   * AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url). A fresh IV every call.
   * `context` (e.g. `fieldContext('vets.national_id', userId)`) is bound in as associated data,
   * so a value copied to another column or row fails to decrypt.
   */
  encrypt(plaintext: string, context: string): string;
  /** Throws if the value was tampered with, moved, or encrypted under another key. */
  decrypt(token: string, context: string): string;
  /**
   * Keyed HMAC-SHA256 for duplicate detection (e.g. national ID). Deterministic, unlike
   * `encrypt`. Keyed because a plain hash of a short ID is trivially brute-forced.
   */
  lookupHash(value: string): string;
}

/** Decode and validate a base64 master key. Throws unless it is exactly 32 bytes. */
export function parseMasterKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32 || key.toString('base64') !== base64.trim()) {
    throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  }
  return key;
}

function deriveKey(master: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
}

/** Associated-data context for an encrypted column value: `table.column:rowId`. */
export function fieldContext(column: string, rowId: string): string {
  return `${column}:${rowId}`;
}

export function fieldCrypto(masterKeyBase64: string): FieldCrypto {
  const master = parseMasterKey(masterKeyBase64);
  const encKey = deriveKey(master, 'vetlink:field-encryption:v1');
  const hashKey = deriveKey(master, 'vetlink:lookup-hash:v1');

  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', encKey, iv);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, iv, tag, ciphertext]
        .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
        .join('.');
    },
    decrypt(token, context) {
      const [version, iv, tag, ciphertext] = token.split('.');
      if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
        throw new Error('Unrecognized encrypted value');
      }
      const decipher = createDecipheriv('aes-256-gcm', encKey, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
    lookupHash(value) {
      return createHmac('sha256', hashKey).update(value, 'utf8').digest('hex');
    },
  };
}
