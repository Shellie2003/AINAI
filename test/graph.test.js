import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { subscribePage } = await import('../src/facebook/graph.js');

test('abonnement : sans permission « feed », on active au moins les messages privés', async (t) => {
  const fields = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const f = new URL(url).searchParams.get('subscribed_fields');
    fields.push(f);
    if (f.includes('feed')) {
      return Response.json({ error: { message: '(#200) To subscribe to the feed field, one of these permissions is needed: pages_manage_metadata', code: 200 } }, { status: 403 });
    }
    return Response.json({ success: true });
  });
  const r = await subscribePage('123', 'tok');
  assert.equal(r.comments, false);
  assert.deepEqual(fields, ['feed,messages,messaging_postbacks,message_echoes', 'messages,messaging_postbacks,message_echoes']);
});

test('abonnement complet quand la permission est là', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true }));
  assert.equal((await subscribePage('123', 'tok')).comments, true);
});
