import { config } from '../config.js';

const graphUrl = (p) => `https://graph.facebook.com/${config.graphVersion}/${p.replace(/^\//, '')}`;

export const FB_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_engagement',
];

export async function graph(path, { method = 'GET', token, params = {}, body } = {}) {
  const url = new URL(graphUrl(path));
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  if (token) url.searchParams.set('access_token', token);
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new Error(`Facebook: ${data.error?.message || res.statusText}`);
    err.code = data.error?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export function oauthDialogUrl(appId, redirectUri, state) {
  const u = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
  u.searchParams.set('client_id', appId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', FB_SCOPES.join(','));
  return u.toString();
}

export const exchangeCode = (appId, appSecret, redirectUri, code) =>
  graph('oauth/access_token', { params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code } });

// Jeton utilisateur longue durée → les jetons de page qui en découlent n'expirent pas.
export const longLivedToken = (appId, appSecret, shortToken) =>
  graph('oauth/access_token', {
    params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken },
  });

export async function listPages(userToken) {
  const data = await graph('me/accounts', { token: userToken, params: { fields: 'id,name,access_token,picture{url},category', limit: 100 } });
  return data.data || [];
}

export const subscribePage = (pageId, pageToken) =>
  graph(`${pageId}/subscribed_apps`, {
    method: 'POST',
    token: pageToken,
    params: { subscribed_fields: 'feed,messages,messaging_postbacks,message_echoes' },
  });

export const unsubscribePage = (pageId, pageToken) => graph(`${pageId}/subscribed_apps`, { method: 'DELETE', token: pageToken });

// Configure le webhook de l'application en un clic (au lieu de le faire à la main dans le tableau de bord Meta).
export const configureAppWebhook = (appId, appSecret, callbackUrl, verifyToken) =>
  graph(`${appId}/subscriptions`, {
    method: 'POST',
    token: `${appId}|${appSecret}`,
    params: {
      object: 'page',
      callback_url: callbackUrl,
      verify_token: verifyToken,
      fields: 'feed,messages,messaging_postbacks,message_echoes',
      include_values: 'true',
    },
  });

export const sendMessage = (pageToken, recipientId, text) =>
  graph('me/messages', {
    method: 'POST',
    token: pageToken,
    body: { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text } },
  });

export const senderAction = (pageToken, recipientId, action) =>
  graph('me/messages', { method: 'POST', token: pageToken, body: { recipient: { id: recipientId }, sender_action: action } }).catch(() => {});

// « Réponse privée » : envoie un MP à l'auteur d'un commentaire (une seule fois par commentaire).
export const privateReply = (pageToken, pageId, commentId, text) =>
  graph(`${pageId}/messages`, { method: 'POST', token: pageToken, body: { recipient: { comment_id: commentId }, message: { text } } });

export const replyToComment = (pageToken, commentId, text) =>
  graph(`${commentId}/comments`, { method: 'POST', token: pageToken, body: { message: text } });

export const likeComment = (pageToken, commentId) => graph(`${commentId}/likes`, { method: 'POST', token: pageToken });

export const hideComment = (pageToken, commentId) =>
  graph(commentId, { method: 'POST', token: pageToken, body: { is_hidden: true } });

export async function getPostText(pageToken, postId) {
  try {
    const d = await graph(postId, { token: pageToken, params: { fields: 'message' } });
    return d.message || '';
  } catch {
    return '';
  }
}

export async function getUserName(pageToken, psid) {
  try {
    const d = await graph(psid, { token: pageToken, params: { fields: 'first_name,last_name' } });
    return [d.first_name, d.last_name].filter(Boolean).join(' ');
  } catch {
    return '';
  }
}

// Télécharge une pièce jointe Messenger (image, vocal…) pour l'envoyer à l'IA.
export async function downloadMedia(url, maxBytes = 8 * 1024 * 1024) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return null;
    const mime = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0];
    return { mime, base64: buf.toString('base64') };
  } catch {
    return null;
  }
}
