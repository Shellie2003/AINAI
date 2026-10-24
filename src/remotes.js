// Bases de données distantes gratuites. Chacune garde toute la base AINAI dans un seul enregistrement.
import { gzipSync, gunzipSync } from 'node:zlib';
import { supabaseRemote } from './supabase.js';

const KEY = 'main';

/** Postgres : Neon, Aiven, Supabase (projet existant), Prisma Postgres, tout Postgres. La table est créée toute seule. */
export function postgresRemote(url) {
  let pool;
  async function db() {
    if (pool) return pool;
    const { default: pg } = await import('pg');
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    pool = new pg.Pool({
      connectionString: url,
      max: 2,
      // Connexions fermées vite : Neon gratuit peut alors s'endormir et ne pas épuiser ses heures de calcul
      idleTimeoutMillis: 10_000,
      ...(local || /sslmode=/.test(url) ? {} : { ssl: { rejectUnauthorized: false } }),
    });
    // Neon coupe les connexions quand il s'endort : ce n'est pas une panne, le pool se reconnecte au besoin
    pool.on('error', (err) => console.error(`[store] connexion Postgres fermée : ${err.message}`));
    await pool.query(`create table if not exists ainai_store (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )`);
    return pool;
  }
  return {
    name: 'Postgres',
    async load() {
      const { rows } = await (await db()).query('select data from ainai_store where id = $1', [KEY]);
      return rows[0]?.data ?? null;
    },
    async save(data) {
      await (await db()).query(
        `insert into ainai_store (id, data, updated_at) values ($1, $2, now())
         on conflict (id) do update set data = excluded.data, updated_at = now()`,
        [KEY, JSON.stringify(data)],
      );
    },
  };
}

/** MongoDB Atlas (cluster M0 gratuit). Stocké en texte JSON : aucun souci de noms de champs. */
export function mongoRemote(url) {
  let collection;
  async function col() {
    if (collection) return collection;
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    collection = client.db(process.env.MONGODB_DB || 'ainai').collection('ainai_store');
    return collection;
  }
  return {
    name: 'MongoDB',
    async load() {
      const doc = await (await col()).findOne({ _id: KEY });
      return doc?.json ? JSON.parse(doc.json) : null;
    },
    async save(data) {
      await (await col()).replaceOne({ _id: KEY }, { json: JSON.stringify(data), updatedAt: new Date() }, { upsert: true });
    },
  };
}

/** Upstash Redis via son API REST (aucune dépendance). Données compressées : la bande passante gratuite est limitée. */
export function upstashRemote(url, token) {
  async function command(args) {
    const res = await fetch(url.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      const hint =
        res.status === 401
          ? ' → Jeton refusé : recopiez UPSTASH_REDIS_REST_TOKEN depuis la section « REST API » de VOTRE base (pas le jeton « Read-Only », ni le mot de passe redis://).'
          : '';
      throw new Error(`Upstash ${res.status}: ${body.error || 'erreur'}${hint}`);
    }
    return body.result;
  }
  return {
    name: 'Upstash Redis',
    async load() {
      const raw = await command(['GET', `ainai:${KEY}`]);
      if (!raw) return null;
      return JSON.parse(raw.startsWith('gz:') ? gunzipSync(Buffer.from(raw.slice(3), 'base64')).toString('utf8') : raw);
    },
    async save(data) {
      await command(['SET', `ainai:${KEY}`, `gz:${gzipSync(JSON.stringify(data)).toString('base64')}`]);
    },
  };
}

// « - » ou « aucun » = variable laissée vide (Render peut exiger une valeur pour chaque variable).
const PLACEHOLDERS = new Set(['', '-', 'aucun', 'none', 'vide']);
export const cleanEnv = (env) =>
  Object.fromEntries(
    Object.entries(env)
      // Erreurs de copier-coller courantes : espaces, guillemets, ou ligne « NOM=valeur » copiée en entier
      .map(([k, v]) => [k, String(v ?? '').trim().replace(new RegExp(`^${k}\\s*=\\s*`), '').replace(/^(["'])(.*)\1$/, '$2').trim()])
      .filter(([, v]) => !PLACEHOLDERS.has(v.toLowerCase())),
  );

/** Choisit la base selon les variables d'environnement présentes (null = fichier local). */
export function createRemote(rawEnv = process.env) {
  const env = cleanEnv(rawEnv);
  const dbUrl = env.DATABASE_URL || env.MONGODB_URI || '';
  if (/^mongodb(\+srv)?:\/\//.test(dbUrl)) return mongoRemote(dbUrl);
  if (/^postgres(ql)?:\/\//.test(dbUrl)) return postgresRemote(dbUrl);
  if (dbUrl) throw new Error('DATABASE_URL doit commencer par postgres://, postgresql://, mongodb:// ou mongodb+srv://');
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return upstashRemote(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  const supaKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (env.SUPABASE_URL && supaKey) return supabaseRemote(env.SUPABASE_URL, supaKey);
  return null;
}
