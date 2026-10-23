import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Clé maîtresse : SECRET_KEY si fournie, sinon une clé générée et conservée dans DATA_DIR.
function masterKey() {
  if (config.secretKey) return crypto.createHash('sha256').update(config.secretKey).digest();
  const file = path.join(config.dataDir, '.secret');
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').trim()).digest();
}

const KEY = masterKey();
const PREFIX = 'enc:v1:';

export function encrypt(plain) {
  if (!plain) return '';
  if (String(plain).startsWith(PREFIX)) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decrypt(value) {
  if (!value || !String(value).startsWith(PREFIX)) return value || '';
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function mask(secret) {
  const s = decrypt(secret);
  if (!s) return '';
  return s.length <= 8 ? '••••' : `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

export function hmac(data) {
  return crypto.createHmac('sha256', KEY).update(data).digest('base64url');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export const randomId = (n = 9) => crypto.randomBytes(n).toString('base64url');
