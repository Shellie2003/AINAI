// Tableau de bord AINAI – JavaScript sans framework.
const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#main');
let state = null;

/* ------------------------------- Utilitaires ------------------------------ */

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (res.status === 401 && path !== '/api/login') showAuth();
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data;
}

function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(t.timer);
  t.timer = setTimeout(() => (t.className = 'toast'), 3500);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
// Un seul élément racine → on renvoie l'élément lui-même (il reste utilisable après insertion dans la page,
// contrairement à un DocumentFragment qui se vide) ; plusieurs racines → fragment.
const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.children.length === 1 && t.content.childNodes.length === 1 ? t.content.firstElementChild : t.content;
};

// Exécute une action de bouton avec état « chargement » et message d'erreur.
async function act(btn, fn, okMsg) {
  btn.disabled = true;
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

function copyField(value) {
  return `<div class="copy"><input readonly value="${esc(value)}" /><button class="btn small" data-copy="${esc(value)}">Copier</button></div>`;
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]');
  if (c) navigator.clipboard.writeText(c.dataset.copy).then(() => toast('Copié ✔'));
});

async function refresh() {
  state = await api('/api/state');
  $('#queueBadge').textContent = state.pendingCount || '';
}

/* ------------------------------ Authentification -------------------------- */

async function showAuth() {
  const s = await fetch('/api/session').then((r) => r.json());
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  $('#authHint').textContent = s.needsSetup ? 'Bienvenue ! Choisissez un mot de passe pour protéger votre tableau de bord (8 caractères min.).' : 'Connectez-vous à votre assistante.';
  $('#authBtn').textContent = s.needsSetup ? 'Créer mon mot de passe' : 'Se connecter';
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(s.needsSetup ? '/api/setup' : '/api/login', { method: 'POST', body: { password: $('#authPassword').value } });
      start();
    } catch (err) {
      $('#authError').textContent = err.message;
    }
  };
}

$('#logoutBtn').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  showAuth();
};

/* --------------------------------- Routeur -------------------------------- */

const tabs = { home, facebook, ai, persona, knowledge, automation, queue, conversations, leads, playground, logs };

async function route() {
  const [tab, query] = (location.hash.slice(1) || 'home').split('?');
  const fn = tabs[tab] || home;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  try {
    await refresh();
    main.innerHTML = '';
    await fn(new URLSearchParams(query || ''));
  } catch (err) {
    main.innerHTML = `<div class="card error">${esc(err.message)}</div>`;
  }
}

document.querySelectorAll('#nav a').forEach((a) => (a.onclick = () => (location.hash = a.dataset.tab)));
window.addEventListener('hashchange', route);

async function start() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  route();
}

(async () => {
  const s = await fetch('/api/session').then((r) => r.json());
  if (s.authenticated) start();
  else showAuth();
})();

async function saveSection(section, value, btn) {
  return act(btn, () => api(`/api/settings/${section}`, { method: 'PUT', body: { value } }), 'Enregistré ✔');
}

/* --------------------------------- Accueil -------------------------------- */

async function home() {
  const [stats, logList] = await Promise.all([api('/api/stats'), api('/api/logs')]);
  const days = Object.keys(stats.days).sort().slice(-14);
  const sum = (k, list = days) => list.reduce((n, d) => n + (stats.days[d]?.[k] || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const all = Object.keys(stats.days);
  const s = state.settings;
  const checklist = [
    [s.providers.length > 0, 'Ajouter une IA (Gemini gratuit)', 'ai'],
    [Boolean(s.facebook.appId && s.facebook.appSecret), 'Renseigner votre app Facebook', 'facebook'],
    [state.pages.some((p) => p.active), 'Activer l’assistante sur une page', 'facebook'],
    [Boolean(s.persona.businessName), 'Décrire votre entreprise', 'persona'],
    [s.knowledge.length > 0, 'Ajouter vos infos (prix, horaires, FAQ…)', 'knowledge'],
  ];
  const intents = {};
  const providers = {};
  for (const d of all)
    for (const [k, v] of Object.entries(stats.days[d])) {
      if (k.startsWith('intent_')) intents[k.slice(7)] = (intents[k.slice(7)] || 0) + v;
      if (k.startsWith('provider_')) providers[k.slice(9)] = (providers[k.slice(9)] || 0) + v;
    }
  const max = Math.max(1, ...days.map((d) => (stats.days[d].comments_out || 0) + (stats.days[d].messages_out || 0)));
  const bars = (obj) => {
    const total = Math.max(1, ...Object.values(obj));
    return Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(v / total) * 100}%"></div></div><b>${v}</b></div>`).join('') || '<p class="muted">Pas encore de données.</p>';
  };
  const done = checklist.filter((c) => c[0]).length;

  main.append(h(`
    <h1>Bonjour 👋</h1>
    <p class="subtitle">Votre assistante répond à vos commentaires et messages Facebook, 24 h/24.</p>
    ${state.ephemeralStorage ? '<div class="card"><span class="pill danger">Attention</span> Cet hébergement n’a pas de disque permanent : vos réglages seront effacés au prochain redémarrage. Reliez une base de données gratuite (Upstash Redis conseillé, ou <code>DATABASE_URL</code> Neon / MongoDB Atlas) : voir GUIDE.md.</div>' : ''}
    ${done < checklist.length ? `<div class="card"><h2>🚀 Démarrage rapide (${done}/${checklist.length})</h2><ol class="steps">${checklist.map(([ok, label, tab]) => `<li class="${ok ? 'done' : ''}"><a href="#${tab}">${label}</a></li>`).join('')}</ol></div>` : ''}
    <div class="stats">
      <div class="stat"><div class="v">${sum('comments_out', [today])}</div><div class="l">Commentaires répondus aujourd’hui</div></div>
      <div class="stat"><div class="v">${sum('messages_out', [today])}</div><div class="l">MP répondus aujourd’hui</div></div>
      <div class="stat"><div class="v">${sum('comments_out') + sum('messages_out')}</div><div class="l">Réponses (14 j)</div></div>
      <div class="stat"><div class="v">${sum('leads', all)}</div><div class="l">Prospects détectés</div></div>
      <div class="stat"><div class="v">${sum('hidden', all)}</div><div class="l">Spams / insultes masqués</div></div>
      <div class="stat"><div class="v">${state.pendingCount}</div><div class="l">Brouillons à valider</div></div>
    </div>
    <div class="grid two">
      <div class="card"><h2>Réponses par jour</h2><div class="spark">${days.map((d) => `<div title="${d}" style="height:${(((stats.days[d].comments_out || 0) + (stats.days[d].messages_out || 0)) / max) * 100}%"></div>`).join('') || '<p class="muted">Pas encore de données.</p>'}</div></div>
      <div class="card"><h2>Intentions des clients</h2><div class="bars">${bars(intents)}</div></div>
      <div class="card"><h2>IA utilisées</h2><div class="bars">${bars(providers)}</div></div>
      <div class="card"><h2>Activité récente</h2>${logList.slice(0, 8).map(logRow).join('') || '<p class="muted">Rien pour l’instant.</p>'}</div>
    </div>`));
}

const logRow = (l) => `<div class="log ${l.level}"><time>${fmtDate(l.ts)}</time><span>${esc(l.message)}</span></div>`;

/* -------------------------------- Facebook -------------------------------- */

async function facebook(params) {
  const f = state.settings.facebook;
  const oauth = params.get('oauth');
  if (oauth === 'ok') toast(`✅ ${params.get('pages')} page(s) importée(s). Activez celles que l’assistante doit gérer.`);
  if (oauth === 'error') toast(`Connexion Facebook échouée : ${params.get('msg')}`, true);
  if (oauth === 'expired') toast('Session de connexion expirée, réessayez.', true);
  if (oauth) history.replaceState(null, '', '#facebook');

  main.append(h(`
    <h1>📘 Connexion Facebook</h1>
    <p class="subtitle">Reliez votre page en 4 étapes. Tout est expliqué, aucune ligne de code à écrire.</p>
    ${state.publicUrlConfigured || state.webhookUrl.startsWith('https://') ? '' : `<div class="card"><span class="pill warn">Attention</span> Ce serveur n’a pas d’adresse HTTPS publique (<code>${esc(state.webhookUrl)}</code>). Facebook ne pourra pas envoyer les messages. Hébergez AINAI (Render, Railway…) ou utilisez un tunnel (ngrok, cloudflared) et définissez <code>PUBLIC_URL</code>.</div>`}
    <div class="card"><ol class="steps">
      <li class="${f.appId ? 'done' : ''}">
        <h2>Créer une app sur Meta for Developers</h2>
        <p class="small muted">Allez sur <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener">developers.facebook.com/apps</a> → <b>Créer une app</b> → cas d’usage <b>« Autre »</b> → type <b>« Entreprise »</b>. Ajoutez les produits <b>Messenger</b> et <b>Facebook Login</b>.
        Dans <b>Paramètres → Général</b>, collez l’URL de confidentialité : <code>${esc(state.webhookUrl.replace(/\/webhook$/, '/privacy'))}</code></p>
        <p class="small muted">Dans <b>Facebook Login → Paramètres</b>, ajoutez cette URL de redirection OAuth valide :</p>
        ${copyField(state.callbackUrl)}
      </li>
      <li class="${f.appId && f.appSecret ? 'done' : ''}">
        <h2>Identifiants de l’app</h2>
        <p class="small muted">Dans <b>Paramètres de l’app → Général</b> : copiez l’ID et la clé secrète.</p>
        <div class="grid two">
          <div><label>ID de l’app</label><input id="fbAppId" value="${esc(f.appId)}" placeholder="123456789012345" /></div>
          <div><label>Clé secrète <span class="muted">${f.appSecret ? `(enregistrée : ${esc(f.appSecret)})` : ''}</span></label><input id="fbSecret" type="password" placeholder="${f.appSecret ? 'Laisser vide pour conserver' : 'abcdef0123…'}" /></div>
        </div>
        <p><button class="btn primary" id="fbSave">Enregistrer</button></p>
      </li>
      <li>
        <h2>Webhook (réception des messages)</h2>
        <p class="small muted">Cliquez sur « Configurer automatiquement ». Ou manuellement : <b>Messenger → Paramètres de l’API</b> (ou <b>Webhooks → Page</b>), collez l’URL et le jeton ci-dessous et cochez <code>messages</code>, <code>messaging_postbacks</code>, <code>message_echoes</code>, <code>feed</code>.</p>
        <label>URL de rappel</label>${copyField(state.webhookUrl)}
        <label>Jeton de vérification</label>${copyField(f.verifyToken)}
        <p><button class="btn" id="fbHook">⚡ Configurer automatiquement</button></p>
      </li>
      <li class="${state.pages.some((p) => p.active) ? 'done' : ''}">
        <h2>Connecter vos pages</h2>
        <p><button class="btn fb" id="fbLogin">Se connecter avec Facebook</button></p>
        <details><summary class="small">Autre méthode : coller un jeton d’accès</summary>
          <p class="small muted">Dans l’<a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener">Explorateur de l’API Graph</a>, choisissez votre app, ajoutez les permissions <code>pages_show_list, pages_messaging, pages_manage_metadata, pages_read_engagement, pages_read_user_content, pages_manage_engagement</code>, générez un jeton utilisateur et collez-le ici.</p>
          <div class="row"><input class="grow" id="fbToken" placeholder="EAAG…" /><button class="btn" id="fbTokenBtn">Importer</button></div>
        </details>
        <div id="pages" style="margin-top:14px"></div>
      </li>
    </ol></div>`));

  $('#fbSave').onclick = (e) =>
    act(e.target, async () => {
      await api('/api/settings/facebook', { method: 'PUT', body: { appId: $('#fbAppId').value, appSecret: $('#fbSecret').value } });
      route();
    }, 'Identifiants enregistrés ✔');
  $('#fbHook').onclick = (e) => act(e.target, () => api('/api/facebook/configure-webhook', { method: 'POST' }), 'Webhook configuré ✔');
  $('#fbLogin').onclick = (e) => act(e.target, async () => (location.href = (await api('/api/facebook/login-url')).url));
  $('#fbTokenBtn').onclick = (e) =>
    act(e.target, async () => {
      const r = await api('/api/facebook/manual-token', { method: 'POST', body: { token: $('#fbToken').value } });
      toast(`${r.pages} page(s) importée(s)`);
      route();
    });

  const box = $('#pages');
  if (!state.pages.length) box.innerHTML = '<p class="muted small">Aucune page importée pour l’instant.</p>';
  for (const p of state.pages) {
    const el = h(`<div class="list-item spread">
      <div class="row">${p.picture ? `<img src="${esc(p.picture)}" width="40" height="40" style="border-radius:50%" alt="" />` : '📄'}
        <div><b>${esc(p.name)}</b><div class="small muted">${esc(p.category || '')} · ID ${esc(p.id)}</div></div></div>
      <div class="row">${p.active ? '<span class="pill ok">● Active</span>' : '<span class="pill">Inactive</span>'}
        <button class="btn small ${p.active ? '' : 'primary'}" data-act>${p.active ? 'Désactiver' : 'Activer l’assistante'}</button>
        <button class="btn small danger" data-del>Retirer</button></div></div>`);
    el.querySelector('[data-act]').onclick = (e) => act(e.target, async () => { await api(`/api/pages/${p.id}/${p.active ? 'deactivate' : 'activate'}`, { method: 'POST' }); route(); });
    el.querySelector('[data-del]').onclick = (e) => confirm(`Retirer « ${p.name} » ?`) && act(e.target, async () => { await api(`/api/pages/${p.id}`, { method: 'DELETE' }); route(); });
    box.append(el);
  }
}

/* --------------------------------- Moteurs IA ------------------------------- */

async function ai() {
  const cat = Object.fromEntries(state.catalog.map((c) => [c.type, c]));
  main.append(h(`
    <h1>🧠 Moteurs IA</h1>
    <p class="subtitle">Ajoutez une ou plusieurs IA. Elles sont utilisées <b>dans l’ordre</b> : si la première échoue (quota gratuit épuisé, panne…), la suivante prend le relais automatiquement. Glissez-déposez pour changer l’ordre.</p>
    <div id="provList"></div>
    <div class="card"><h2>➕ Ajouter une IA</h2>
      <div class="grid two">
        <div><label>Fournisseur</label><select id="pType">${state.catalog.map((c) => `<option value="${c.type}">${esc(c.label)}</option>`).join('')}</select></div>
        <div><label>Clé API <a id="pKeyUrl" class="small" target="_blank" rel="noopener">obtenir une clé ↗</a></label><input id="pKey" type="password" placeholder="Collez votre clé" /></div>
        <div><label>Modèle</label><input id="pModel" /></div>
        <div id="pBaseWrap"><label>URL de l’API <span class="muted">(compatibles OpenAI)</span></label><input id="pBase" /></div>
      </div>
      <p><button class="btn primary" id="pAdd">Ajouter</button></p>
      <p class="small muted">💡 <b>Gemini</b> : clé gratuite sur <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Google AI Studio</a>, lit aussi les photos et messages vocaux. Secours gratuits conseillés : <b>Groq</b>, <b>Cerebras</b>, <b>OpenRouter</b> (modèle <code>openrouter/free</code>) et <b>Mistral</b>. Si un modèle est retiré par le fournisseur, l’assistante en choisit un autre toute seule. <b>Claude</b> (Anthropic) est payant mais excellent en rédaction.</p>
    </div>`));

  const sync = () => {
    const c = cat[$('#pType').value];
    $('#pModel').value = c.defaultModel;
    $('#pBase').value = c.defaultBaseUrl;
    $('#pBaseWrap').classList.toggle('hidden', !c.defaultBaseUrl && c.type !== 'custom');
    $('#pKeyUrl').href = c.keyUrl || '#';
    $('#pKeyUrl').classList.toggle('hidden', !c.keyUrl);
  };
  $('#pType').onchange = sync;
  sync();
  $('#pAdd').onclick = (e) =>
    act(e.target, async () => {
      await api('/api/providers', { method: 'POST', body: { type: $('#pType').value, apiKey: $('#pKey').value, model: $('#pModel').value, baseUrl: $('#pBase').value } });
      route();
    }, 'IA ajoutée ✔');

  const list = $('#provList');
  if (!state.settings.providers.length) list.append(h('<div class="card muted">Aucune IA. Commencez par Gemini (gratuit) 👇</div>'));
  state.settings.providers.forEach((p, i) => {
    const el = h(`<div class="list-item" draggable="true" data-id="${p.id}">
      <div class="spread"><div class="row"><span class="handle">☰</span><b>${i + 1}. ${esc(p.name)}</b><span class="pill">${esc(cat[p.type]?.label || p.type)}</span>${p.enabled ? '<span class="pill ok">activée</span>' : '<span class="pill">désactivée</span>'}</div>
      <div class="row"><button class="btn small" data-test>Tester</button><button class="btn small" data-toggle>${p.enabled ? 'Désactiver' : 'Activer'}</button><button class="btn small danger" data-del>Supprimer</button></div></div>
      <div class="grid two">
        <div><label>Modèle</label><div class="row"><input class="grow" data-model value="${esc(p.model)}" list="models-${p.id}" /><button class="btn small" data-models title="Charger la liste des modèles">↻</button></div><datalist id="models-${p.id}"></datalist></div>
        <div><label>Clé API <span class="muted">${esc(p.apiKey || 'aucune')}</span></label><input data-key type="password" placeholder="Nouvelle clé (optionnel)" /></div>
      </div>
      <p class="row"><button class="btn small primary" data-save>Enregistrer</button><span class="small muted" data-out></span></p></div>`);
    const q = (s) => el.querySelector(s);
    q('[data-save]').onclick = (e) => act(e.target, async () => { await api(`/api/providers/${p.id}`, { method: 'PUT', body: { model: q('[data-model]').value, apiKey: q('[data-key]').value } }); route(); }, 'Enregistré ✔');
    q('[data-toggle]').onclick = (e) => act(e.target, async () => { await api(`/api/providers/${p.id}`, { method: 'PUT', body: { enabled: !p.enabled } }); route(); });
    q('[data-del]').onclick = (e) => confirm('Supprimer cette IA ?') && act(e.target, async () => { await api(`/api/providers/${p.id}`, { method: 'DELETE' }); route(); });
    q('[data-test]').onclick = (e) => act(e.target, async () => {
      q('[data-out]').textContent = '⏳ Test en cours…';
      const r = await api(`/api/providers/${p.id}/test`, { method: 'POST' }).catch((err) => { q('[data-out]').textContent = `❌ ${err.message}`; throw err; });
      q('[data-out]').textContent = `✅ ${r.ms} ms – « ${r.text} »`;
      if (r.modelChanged) { toast(`Modèle ${r.modelChanged.from} retiré : remplacé par ${r.modelChanged.to}`); q('[data-model]').value = r.model; }
    });
    q('[data-models]').onclick = (e) => act(e.target, async () => {
      const r = await api(`/api/providers/${p.id}/models`);
      q('datalist').innerHTML = r.models.map((m) => `<option value="${esc(m)}">`).join('');
      toast(`${r.models.length} modèles disponibles – cliquez dans le champ pour choisir`);
    });
    list.append(el);
  });

  // Glisser-déposer pour l'ordre de priorité
  let dragged;
  list.addEventListener('dragstart', (e) => { dragged = e.target.closest('[data-id]'); dragged?.classList.add('dragging'); });
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const over = e.target.closest('[data-id]');
    if (over && dragged && over !== dragged) list.insertBefore(dragged, over.getBoundingClientRect().top + over.offsetHeight / 2 > e.clientY ? over : over.nextSibling);
  });
  list.addEventListener('dragend', async () => {
    dragged?.classList.remove('dragging');
    const ids = [...list.querySelectorAll('[data-id]')].map((x) => x.dataset.id);
    await api('/api/providers/order', { method: 'PUT', body: { ids } });
    toast('Ordre de priorité enregistré ✔');
    route();
  });
}

/* ------------------------------- Personnalité ------------------------------- */

function persona() {
  const p = state.settings.persona;
  main.append(h(`
    <h1>🎭 Personnalité</h1>
    <p class="subtitle">Comment votre assistante se présente et s’exprime.</p>
    <div class="card"><div class="grid two">
      <div><label>Nom de l’entreprise / page</label><input id="businessName" value="${esc(p.businessName)}" /></div>
      <div><label>Ton</label><input id="tone" value="${esc(p.tone)}" placeholder="chaleureux, professionnel…" /></div>
      <div><label>Langue par défaut <span class="muted">(sinon, elle répond dans la langue du client)</span></label><input id="defaultLanguage" value="${esc(p.defaultLanguage)}" /></div>
      <div><label>Longueur max. d’une réponse (caractères)</label><input id="maxLength" type="number" min="100" max="2000" value="${p.maxLength}" /></div>
      <div><label>Signature des MP <span class="muted">(optionnel)</span></label><input id="signature" value="${esc(p.signature)}" placeholder="— L’équipe Boutique Soa" /></div>
      <div><label>Contact humain <span class="muted">(téléphone, WhatsApp…)</span></label><input id="humanContact" value="${esc(p.humanContact)}" /></div>
    </div>
    <label>Description de l’activité</label><textarea id="description" placeholder="Ex. : Boutique de vêtements à Antananarivo, livraison partout à Madagascar…">${esc(p.description)}</textarea>
    <label>Consignes spécifiques</label><textarea id="customInstructions" placeholder="Ex. : Toujours proposer la livraison. Ne jamais faire de remise sans validation. Tutoyer les clients.">${esc(p.customInstructions)}</textarea>
    <label class="check"><input type="checkbox" id="useEmojis" ${p.useEmojis ? 'checked' : ''}/> Utiliser des emojis</label>
    <button class="btn primary" id="save">Enregistrer</button></div>`));
  $('#save').onclick = (e) =>
    saveSection('persona', {
      ...Object.fromEntries(['businessName', 'tone', 'defaultLanguage', 'signature', 'humanContact', 'description', 'customInstructions'].map((k) => [k, $(`#${k}`).value])),
      maxLength: Number($('#maxLength').value) || 600,
      useEmojis: $('#useEmojis').checked,
    }, e.target);
}

/* ------------------------------- Connaissances ------------------------------ */

function knowledge() {
  let items = structuredClone(state.settings.knowledge);
  let examples = structuredClone(state.settings.examples);
  main.append(h(`
    <h1>📚 Base de connaissances</h1>
    <p class="subtitle">Tout ce que l’assistante doit savoir : produits, prix, horaires, livraison, FAQ… Elle n’invente jamais ce qui n’est pas écrit ici.</p>
    <div id="kList"></div>
    <div class="row"><button class="btn" id="kAdd">➕ Ajouter une fiche</button><button class="btn primary" id="kSave">Enregistrer les fiches</button>
      <label class="btn">📥 Importer un fichier .txt / .md<input type="file" id="kFile" accept=".txt,.md,.csv" hidden multiple /></label></div>
    <div class="card" style="margin-top:24px"><h2>🧠 Exemples appris</h2>
      <p class="small muted">Quand vous corrigez un brouillon avant de l’envoyer, la correction est mémorisée ici et l’assistante imite ce style.</p>
      <div id="exList"></div><button class="btn small" id="exAdd">➕ Ajouter un exemple</button> <button class="btn small primary" id="exSave">Enregistrer les exemples</button></div>`));

  const renderK = () => {
    const box = $('#kList');
    box.innerHTML = items.length ? '' : '<div class="card muted">Aucune fiche. Ajoutez par exemple « Tarifs », « Livraison », « Horaires ».</div>';
    items.forEach((k, i) => {
      const el = h(`<div class="list-item"><div class="row"><input class="grow" value="${esc(k.title)}" placeholder="Titre (ex. Tarifs)" data-f="title" />
        <label class="check" title="Toujours inclure"><input type="checkbox" data-f="pinned" ${k.pinned ? 'checked' : ''}/> épinglée</label>
        <label class="check"><input type="checkbox" data-f="enabled" ${k.enabled !== false ? 'checked' : ''}/> active</label>
        <button class="btn small danger" data-del>✕</button></div>
        <textarea data-f="content" placeholder="Contenu…">${esc(k.content)}</textarea></div>`);
      el.querySelectorAll('[data-f]').forEach((inp) => (inp.oninput = inp.onchange = () => (items[i][inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value)));
      el.querySelector('[data-del]').onclick = () => { items.splice(i, 1); renderK(); };
      box.append(el);
    });
  };
  const renderEx = () => {
    const box = $('#exList');
    box.innerHTML = examples.length ? '' : '<p class="muted small">Aucun exemple pour l’instant.</p>';
    examples.forEach((ex, i) => {
      const el = h(`<div class="list-item"><div class="grid two"><div><label>Message du client</label><textarea data-f="input">${esc(ex.input)}</textarea></div>
        <div><label>Réponse idéale</label><textarea data-f="output">${esc(ex.output)}</textarea></div></div><button class="btn small danger" data-del>Supprimer</button></div>`);
      el.querySelectorAll('[data-f]').forEach((inp) => (inp.oninput = () => (examples[i][inp.dataset.f] = inp.value)));
      el.querySelector('[data-del]').onclick = () => { examples.splice(i, 1); renderEx(); };
      box.append(el);
    });
  };
  renderK();
  renderEx();
  $('#kAdd').onclick = () => { items.push({ title: '', content: '', enabled: true }); renderK(); };
  $('#kSave').onclick = (e) => saveSection('knowledge', items, e.target);
  $('#exAdd').onclick = () => { examples.push({ input: '', output: '' }); renderEx(); };
  $('#exSave').onclick = (e) => saveSection('examples', examples, e.target);
  $('#kFile').onchange = async (e) => {
    for (const file of e.target.files) items.push({ title: file.name.replace(/\.\w+$/, ''), content: await file.text(), enabled: true });
    renderK();
    toast('Fichier(s) ajouté(s) – pensez à enregistrer');
  };
}

/* ------------------------------- Automatisation ----------------------------- */

function automation() {
  const a = structuredClone(state.settings.automation);
  let rules = structuredClone(state.settings.rules);
  const modeSel = (id, v) => `<select id="${id}"><option value="auto" ${v === 'auto' ? 'selected' : ''}>🤖 Automatique</option><option value="approval" ${v === 'approval' ? 'selected' : ''}>📝 Brouillon à valider (copilote)</option><option value="off" ${v === 'off' ? 'selected' : ''}>⛔ Désactivé</option></select>`;
  main.append(h(`
    <h1>⚙️ Automatisation</h1>
    <p class="subtitle">Choisissez ce que l’assistante fait toute seule, et ce qu’elle vous soumet.</p>
    <div class="grid two">
      <div class="card"><h2>💬 Commentaires</h2>
        <label>Mode</label>${modeSel('cMode', a.comments.enabled ? a.comments.mode : 'off')}
        <label class="check"><input type="checkbox" id="cLike" ${a.comments.likeComments ? 'checked' : ''}/> Liker les commentaires (sauf négatifs)</label>
        <label class="check"><input type="checkbox" id="cHide" ${a.comments.hideNegative ? 'checked' : ''}/> Masquer automatiquement spam, arnaques et insultes</label>
        <label class="check"><input type="checkbox" id="cPrivate" ${a.comments.privateReplyOnLead ? 'checked' : ''}/> Envoyer un MP automatique aux personnes intéressées (« prix ? », « dispo ? »…)</label>
        <label class="check"><input type="checkbox" id="cReplies" ${a.comments.ignoreReplies ? 'checked' : ''}/> Ignorer les réponses à d’autres commentaires</label>
      </div>
      <div class="card"><h2>✉️ Messages privés</h2>
        <label>Mode</label>${modeSel('mMode', a.messages.enabled ? a.messages.mode : 'off')}
        <label>Regrouper les messages envoyés en rafale pendant (secondes)</label><input id="mAgg" type="number" min="0" max="60" value="${a.messages.aggregateSeconds}" />
        <label>Mémoire : nombre de messages précédents pris en compte</label><input id="mMem" type="number" min="1" max="40" value="${a.messages.memorySize}" />
        <label>Pause du bot quand un humain répond depuis Messenger (heures, 0 = jamais)</label><input id="takeover" type="number" min="0" max="168" value="${a.humanTakeoverHours}" />
      </div>
      <div class="card"><h2>⏱️ Comportement humain</h2>
        <label>Délai aléatoire avant réponse (secondes)</label>
        <div class="row"><input id="dMin" type="number" min="0" value="${a.replyDelay.min}" /> à <input id="dMax" type="number" min="0" value="${a.replyDelay.max}" /></div>
        <label>Message quand l’IA a besoin d’un humain</label><textarea id="escal">${esc(a.escalationMessage)}</textarea>
      </div>
      <div class="card"><h2>🕘 Heures d’ouverture</h2>
        <label class="check"><input type="checkbox" id="bhOn" ${a.businessHours.enabled ? 'checked' : ''}/> Tenir compte des heures d’ouverture</label>
        <div class="row"><input id="bhStart" type="time" value="${a.businessHours.start}" /> → <input id="bhEnd" type="time" value="${a.businessHours.end}" /></div>
        <label>Fuseau horaire</label><input id="bhTz" value="${esc(a.businessHours.timezone)}" />
        <label>Consigne hors horaires</label><input id="bhNote" value="${esc(a.businessHours.offHoursNote)}" placeholder="Ex. : préciser qu’on rappelle dès 8 h" />
      </div>
    </div>
    <button class="btn primary" id="aSave">Enregistrer l’automatisation</button>
    <div class="card" style="margin-top:24px"><h2>⚡ Règles par mots-clés</h2>
      <p class="small muted">Réponse instantanée quand un message contient un mot-clé. Sans IA (réponse fixe, zéro quota) ou avec IA (la règle devient une consigne).</p>
      <div id="rList"></div><button class="btn small" id="rAdd">➕ Nouvelle règle</button> <button class="btn small primary" id="rSave">Enregistrer les règles</button></div>`));

  const renderRules = () => {
    const box = $('#rList');
    box.innerHTML = rules.length ? '' : '<p class="muted small">Ex. : mots-clés « prix, tarif, combien » → « Je vous envoie les tarifs en MP 📩 » + MP automatique.</p>';
    rules.forEach((r, i) => {
      const el = h(`<div class="list-item"><div class="grid two">
        <div><label>Nom</label><input data-f="name" value="${esc(r.name || '')}" /></div>
        <div><label>Mots-clés <span class="muted">(séparés par des virgules)</span></label><input data-f="keywords" value="${esc((r.keywords || []).join(', '))}" /></div>
        <div><label>Canal</label><select data-f="channel"><option value="all">Tous</option><option value="comment">Commentaires</option><option value="message">Messages privés</option></select></div>
        <div><label>Type</label><select data-f="useAi"><option value="">Réponse fixe</option><option value="1">Consigne pour l’IA</option></select></div></div>
        <label>Réponse / consigne</label><textarea data-f="response">${esc(r.response || '')}</textarea>
        <label>MP à envoyer en plus <span class="muted">(commentaires, réponse fixe uniquement)</span></label><input data-f="privateMessage" value="${esc(r.privateMessage || '')}" />
        <p class="row"><label class="check"><input type="checkbox" data-f="enabled" ${r.enabled !== false ? 'checked' : ''}/> active</label><button class="btn small danger" data-del>Supprimer</button></p></div>`);
      el.querySelector('[data-f=channel]').value = r.channel || 'all';
      el.querySelector('[data-f=useAi]').value = r.useAi ? '1' : '';
      el.querySelectorAll('[data-f]').forEach((inp) => (inp.oninput = inp.onchange = () => {
        const f = inp.dataset.f;
        rules[i][f] = f === 'keywords' ? inp.value.split(',').map((s) => s.trim()).filter(Boolean) : f === 'useAi' ? Boolean(inp.value) : inp.type === 'checkbox' ? inp.checked : inp.value;
      }));
      el.querySelector('[data-del]').onclick = () => { rules.splice(i, 1); renderRules(); };
      box.append(el);
    });
  };
  renderRules();
  $('#rAdd').onclick = () => { rules.push({ name: '', keywords: [], channel: 'all', response: '', enabled: true }); renderRules(); };
  $('#rSave').onclick = (e) => saveSection('rules', rules, e.target);
  $('#aSave').onclick = (e) => {
    const mode = (id) => ({ enabled: $(id).value !== 'off', mode: $(id).value === 'off' ? 'auto' : $(id).value });
    saveSection('automation', {
      comments: { ...mode('#cMode'), likeComments: $('#cLike').checked, hideNegative: $('#cHide').checked, privateReplyOnLead: $('#cPrivate').checked, ignoreReplies: $('#cReplies').checked },
      messages: { ...mode('#mMode'), aggregateSeconds: Number($('#mAgg').value), memorySize: Number($('#mMem').value) },
      humanTakeoverHours: Number($('#takeover').value),
      replyDelay: { min: Number($('#dMin').value), max: Number($('#dMax').value) },
      escalationMessage: $('#escal').value,
      businessHours: { enabled: $('#bhOn').checked, start: $('#bhStart').value, end: $('#bhEnd').value, timezone: $('#bhTz').value, offHoursNote: $('#bhNote').value },
    }, e.target);
  };
}

/* ------------------------------- À valider ---------------------------------- */

async function queue() {
  const items = await api('/api/queue');
  main.append(h(`<h1>📝 Brouillons à valider</h1><p class="subtitle">En mode « copilote », l’assistante prépare les réponses et vous les validez. Vos corrections lui apprennent votre style.</p><div id="qList"></div>`));
  const box = $('#qList');
  if (!items.length) box.innerHTML = '<div class="card muted">Rien à valider 🎉</div>';
  for (const q of items) {
    const r = q.result || {};
    const el = h(`<div class="card">
      <div class="spread"><div><b>${q.channel === 'comment' ? '💬 Commentaire' : '✉️ Message'} de ${esc(q.userName || q.userId)}</b> <span class="small muted">· ${esc(q.pageName || '')} · ${fmtDate(q.createdAt)}</span></div>
      <div class="row">${pills(r)}</div></div>
      <div class="bubble user" style="margin:10px 0">${esc(q.incoming)}</div>
      <label>Réponse</label><textarea data-reply>${esc(q.draft)}</textarea>
      ${q.channel === 'comment' ? `<label>MP privé <span class="muted">(optionnel)</span></label><textarea data-private>${esc(q.draftPrivate)}</textarea>` : ''}
      <p class="row"><button class="btn primary" data-ok>Envoyer</button><button class="btn" data-no>Ignorer</button><span class="small muted">via ${esc(r.provider || '')}</span></p></div>`);
    el.querySelector('[data-ok]').onclick = (e) => act(e.target, async () => {
      await api(`/api/queue/${q.id}/approve`, { method: 'POST', body: { reply: el.querySelector('[data-reply]').value, privateMessage: el.querySelector('[data-private]')?.value } });
      route();
    }, 'Envoyé ✔');
    el.querySelector('[data-no]').onclick = (e) => act(e.target, async () => { await api(`/api/queue/${q.id}/reject`, { method: 'POST' }); route(); });
    box.append(el);
  }
}

function pills(r) {
  const s = { positif: 'ok', negatif: 'danger' }[r.sentiment] || '';
  return `<span class="pill">${esc(r.intent || '?')}</span><span class="pill ${s}">${esc(r.sentiment || '')}</span>${r.needsHuman ? '<span class="pill warn">humain requis</span>' : ''}${r.hide ? '<span class="pill danger">à masquer</span>' : ''}`;
}

/* ------------------------------- Conversations ------------------------------ */

async function conversations(params) {
  const list = await api('/api/conversations');
  main.append(h(`<h1>💬 Conversations</h1><p class="subtitle">Historique Messenger. Mettez le bot en pause pour reprendre la main, ou répondez directement d’ici.</p>
    <div class="conv-layout"><div class="conv-list" id="cList"></div><div class="card" id="cView"><p class="muted">Sélectionnez une conversation.</p></div></div>`));
  const box = $('#cList');
  if (!list.length) box.innerHTML = '<div class="card muted">Aucune conversation.</div>';
  for (const c of list) {
    const paused = c.pausedUntil > Date.now();
    const el = h(`<div class="list-item" data-key="${esc(c.key)}"><div class="spread"><b>${esc(c.name || c.userId)}</b><span class="small muted">${fmtDate(c.updatedAt)}</span></div>
      <div class="small muted">${esc((c.last?.text || '').slice(0, 80))}</div>
      <div class="row small">${paused ? '<span class="pill warn">⏸ pause</span>' : ''}${c.needsHuman ? '<span class="pill danger">humain requis</span>' : ''}</div></div>`);
    el.onclick = () => openConversation(c.key);
    box.append(el);
  }
  const key = params.get('key') || list[0]?.key;
  if (key) openConversation(key);
}

async function openConversation(key) {
  document.querySelectorAll('#cList .list-item').forEach((x) => x.classList.toggle('active', x.dataset.key === key));
  const c = await api(`/api/conversations/${encodeURIComponent(key)}`);
  const paused = c.pausedUntil > Date.now();
  const view = $('#cView');
  view.innerHTML = '';
  view.append(h(`<div class="spread"><h2>${esc(c.name || c.userId)}</h2>
    <div class="row">${paused ? `<span class="small muted">Bot en pause jusqu’au ${fmtDate(c.pausedUntil)}</span><button class="btn small" data-resume>▶ Réactiver le bot</button>` : '<button class="btn small" data-pause>⏸ Pause 24 h</button>'}</div></div>
    <div class="chat" id="chat">${c.messages.map((m) => `<div class="bubble ${m.role}">${esc(m.text)}</div><div class="meta" style="align-self:${m.role === 'user' ? 'flex-start' : 'flex-end'}">${fmtDate(m.ts)}</div>`).join('')}</div>
    <div class="row" style="margin-top:12px"><input class="grow" id="cMsg" placeholder="Répondre en tant que page…" /><button class="btn primary" id="cSend">Envoyer</button></div>`));
  $('#chat').scrollTop = 1e9;
  const pause = (hours) => (e) => act(e.target, async () => { await api(`/api/conversations/${encodeURIComponent(key)}/pause`, { method: 'POST', body: { hours } }); conversationsReload(key); });
  view.querySelector('[data-pause]')?.addEventListener('click', pause(24));
  view.querySelector('[data-resume]')?.addEventListener('click', pause(0));
  $('#cSend').onclick = (e) => act(e.target, async () => {
    await api(`/api/conversations/${encodeURIComponent(key)}/send`, { method: 'POST', body: { text: $('#cMsg').value } });
    openConversation(key);
  }, 'Message envoyé ✔');
}

const conversationsReload = (key) => {
  if (location.hash.includes(`key=${encodeURIComponent(key)}`)) route();
  else location.hash = `conversations?key=${encodeURIComponent(key)}`;
};

/* -------------------------------- Prospects --------------------------------- */

async function leads() {
  const list = await api('/api/leads');
  const statuses = ['nouveau', 'contacté', 'client', 'perdu'];
  main.append(h(`<div class="spread"><div><h1>🎯 Prospects</h1><p class="subtitle">Détectés automatiquement : intention d’achat, numéro de téléphone ou e-mail laissé en commentaire ou en MP.</p></div>
    <a class="btn" href="/api/leads.csv">⬇ Exporter CSV</a></div>
    <div class="card table-wrap"><table><thead><tr><th>Nom</th><th>Contact</th><th>Intérêt</th><th>Statut</th><th>Note</th><th>Date</th><th></th></tr></thead><tbody id="lBody"></tbody></table></div>`));
  const body = $('#lBody');
  if (!list.length) body.innerHTML = '<tr><td colspan="7" class="muted">Aucun prospect pour l’instant.</td></tr>';
  for (const l of list) {
    const tr = h(`<tr><td><b>${esc(l.name)}</b><div class="small muted">${l.channel === 'comment' ? '💬' : '✉️'}</div></td>
      <td>${esc(l.phone)}<br>${esc(l.email)}</td><td class="small">${esc(l.interest)}</td>
      <td><select data-f="status">${statuses.map((s) => `<option ${s === l.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td><input data-f="note" value="${esc(l.note || '')}" /></td><td class="small">${fmtDate(l.createdAt)}</td>
      <td><button class="btn small danger" data-del>✕</button></td></tr>`);
    tr.querySelectorAll('[data-f]').forEach((inp) => (inp.onchange = () => api(`/api/leads/${l.id}`, { method: 'PUT', body: { [inp.dataset.f]: inp.value } }).then(() => toast('Enregistré ✔'))));
    tr.querySelector('[data-del]').onclick = (e) => act(e.target, async () => { await api(`/api/leads/${l.id}`, { method: 'DELETE' }); route(); });
    body.append(tr);
  }
}

/* -------------------------------- Simulateur -------------------------------- */

function playground() {
  const history = [];
  main.append(h(`<h1>🧪 Simulateur</h1><p class="subtitle">Testez votre assistante comme un client, sans rien publier sur Facebook.</p>
    <div class="card"><div class="grid two">
      <div><label>Canal</label><select id="pgChannel"><option value="message">✉️ Message privé</option><option value="comment">💬 Commentaire public</option></select></div>
      <div><label>Nom du client</label><input id="pgName" value="Rakoto" /></div></div>
      <div id="pgPostWrap" class="hidden"><label>Texte de la publication commentée</label><textarea id="pgPost" placeholder="Ex. : Nouvelle collection disponible ! Robes en coton…"></textarea></div>
      <div class="chat" id="pgChat" style="margin-top:14px"></div>
      <div class="row" style="margin-top:12px"><input class="grow" id="pgMsg" placeholder="Écrivez comme un client… (ex. Combien coûte la livraison ?)" /><button class="btn primary" id="pgSend">Envoyer</button><button class="btn" id="pgReset">Recommencer</button></div></div>`));
  const chat = $('#pgChat');
  $('#pgChannel').onchange = () => $('#pgPostWrap').classList.toggle('hidden', $('#pgChannel').value !== 'comment');
  const send = (e) => act($('#pgSend'), async () => {
    const text = $('#pgMsg').value.trim();
    if (!text) return;
    $('#pgMsg').value = '';
    if ($('#pgChannel').value === 'comment') history.length = 0;
    history.push({ role: 'user', text });
    chat.append(h(`<div class="bubble user">${esc(text)}</div>`));
    const r = await api('/api/playground', { method: 'POST', body: { channel: $('#pgChannel').value, history, userName: $('#pgName').value, postContext: $('#pgPost').value } });
    history.push({ role: 'assistant', text: r.reply });
    chat.append(h(`<div class="bubble assistant">${esc(r.reply || '(aucune réponse)')}</div>
      ${r.privateMessage ? `<div class="bubble assistant" style="opacity:.8">📩 MP : ${esc(r.privateMessage)}</div>` : ''}
      <div class="meta">${pills(r)} · ${esc(r.provider)} ${r.ms ? `· ${r.ms} ms` : ''}${r.lead?.phone || r.lead?.email ? ` · 🎯 prospect ${esc(r.lead.phone || r.lead.email)}` : ''}</div>`));
    chat.scrollTop = 1e9;
  });
  $('#pgSend').onclick = send;
  $('#pgMsg').onkeydown = (e) => e.key === 'Enter' && send();
  $('#pgReset').onclick = () => { history.length = 0; chat.innerHTML = ''; };
}

/* --------------------------------- Journal ---------------------------------- */

async function logs() {
  const list = await api('/api/logs');
  main.append(h(`<div class="spread"><div><h1>📜 Journal</h1><p class="subtitle">Tout ce que fait l’assistante.</p></div>
    <div class="row"><a class="btn small" href="/api/export">⬇ Sauvegarder les réglages</a><label class="btn small">⬆ Restaurer<input type="file" id="imp" accept=".json" hidden /></label><button class="btn small" id="lRefresh">↻ Actualiser</button></div></div>
    <div class="card">${list.map(logRow).join('') || '<p class="muted">Vide.</p>'}</div>`));
  $('#lRefresh').onclick = route;
  $('#imp').onchange = async (e) => {
    try {
      await api('/api/import', { method: 'POST', body: JSON.parse(await e.target.files[0].text()) });
      toast('Réglages restaurés ✔');
    } catch (err) {
      toast(err.message, true);
    }
  };
}
