// Stockage distant gratuit : toute la base AINAI dans une ligne JSONB d'une table Supabase.
// Utilisé quand l'hébergeur n'a pas de disque permanent (Render gratuit, Koyeb…).
const TABLE = 'ainai_store';
const ROW = 'main';

export function supabaseRemote(url, key) {
  const base = `${url.replace(/\/+$/, '')}/rest/v1/${TABLE}`;
  const headers = {
    apikey: key,
    // Les anciennes clés « service_role » sont des JWT ; les nouvelles clés « sb_secret_… » passent seulement par apikey
    ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}),
    'content-type': 'application/json',
  };

  async function request(path, init) {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init?.headers }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const hint = res.status === 404 || /relation|does not exist/i.test(body) ? ' – avez-vous exécuté supabase.sql ?' : '';
      throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}${hint}`);
    }
    return res;
  }

  return {
    name: 'Supabase',
    async load() {
      const rows = await (await request(`?id=eq.${ROW}&select=data`)).json();
      return rows[0]?.data ?? null;
    },
    async save(data) {
      await request('', {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id: ROW, data, updated_at: new Date().toISOString() }),
      });
    },
  };
}
