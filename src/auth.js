import crypto from 'node:crypto';
import { config } from './config.js';
import { hmac, safeEqual } from './crypto.js';
import { store } from './store.js';

const COOKIE = 'ainai_session';
const TTL = 30 * 24 * 3600 * 1000;
const attempts = new Map();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}

function checkPassword(password) {
  if (config.adminPassword) return safeEqual(password, config.adminPassword);
  const stored = store.data.adminHash;
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  return safeEqual(crypto.scryptSync(password, salt, 32).toString('hex'), hash);
}

export const needsSetup = () => !config.adminPassword && !store.data.adminHash;

function readCookie(req) {
  const raw = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  return raw ? decodeURIComponent(raw.slice(COOKIE.length + 1)) : '';
}

export function isAuthenticated(req) {
  const [exp, sig] = readCookie(req).split('.');
  return Boolean(exp && sig && Number(exp) > Date.now() && safeEqual(sig, hmac(`session:${exp}:${store.data.adminHash || ''}`)));
}

function setSession(req, res) {
  const exp = Date.now() + TTL;
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${exp}.${hmac(`session:${exp}:${store.data.adminHash || ''}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL / 1000}${secure ? '; Secure' : ''}`,
  );
}

export function login(req, res) {
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans quelques minutes.' });
  if (!checkPassword(String(req.body?.password || ''))) {
    a.n += 1;
    if (a.n >= 5) Object.assign(a, { n: 0, until: Date.now() + 5 * 60_000 });
    attempts.set(ip, a);
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  attempts.delete(ip);
  setSession(req, res);
  res.json({ ok: true });
}

export function setup(req, res) {
  if (!needsSetup()) return res.status(400).json({ error: 'Mot de passe déjà défini' });
  const password = String(req.body?.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'Au moins 8 caractères' });
  store.data.adminHash = hashPassword(password);
  store.save();
  setSession(req, res);
  res.json({ ok: true });
}

export function logout(_req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ ok: true });
}

export function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'Non connecté' });
}
