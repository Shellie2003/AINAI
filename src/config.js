import fs from 'node:fs';
import path from 'node:path';

// Lecture minimale d'un fichier .env (sans dépendance externe)
function loadDotEnv(file = path.resolve('.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv();

export const config = {
  port: Number(process.env.PORT) || 3000,
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  secretKey: process.env.SECRET_KEY || '',
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  graphVersion: process.env.GRAPH_VERSION || 'v23.0',
  keepAlive: !['0', 'false', 'non'].includes(String(process.env.KEEP_ALIVE ?? 'true').toLowerCase()),
};

// Base de données distante configurée (Postgres, MongoDB, Upstash ou Supabase) ?
export const usesRemoteDb = Boolean(
  process.env.DATABASE_URL ||
    process.env.MONGODB_URI ||
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)),
);

// Sans disque permanent, une clé générée automatiquement serait perdue à chaque redémarrage
// et les clés API chiffrées deviendraient illisibles.
if (usesRemoteDb && !config.secretKey) {
  throw new Error('SECRET_KEY est obligatoire quand les données sont stockées dans une base distante.');
}
