import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createServer } from '../server.js';
import { CommunityStore } from '../community/CommunityStore.js';
import { EVENTS } from '@runrun/shared/protocol';
import { COMMUNITY_EVENTS as C, normalizeFriendCode } from '@runrun/shared/community';

const once = (s, ev) => new Promise((r) => s.once(ev, (...a) => r(a.length > 1 ? a : a[0])));
const call = (s, ev, payload) => new Promise((r) => s.emit(ev, payload, r));

test('store: solicitudes, aceptación cruzada, borrado y dispositivos enlazados', () => {
  const store = new CommunityStore(':memory:');
  const { user: ana, token } = store.createUser('Ana');
  const { user: beto } = store.createUser('Beto');
  assert.equal(normalizeFriendCode(ana.friendCode.toLowerCase()), ana.friendCode);
  assert.ok(store.authenticate(ana.id, token));
  assert.equal(store.authenticate(ana.id, 'otro'), null);
  assert.equal(store.authenticate(beto.id, token), null, 'el token de Ana no abre la cuenta de Beto');

  assert.match(store.sendRequest(ana.id, ana.id).error, /propio/);
  assert.equal(store.sendRequest(ana.id, beto.id).status, 'sent');
  assert.match(store.sendRequest(ana.id, beto.id).error, /Ya enviaste/);
  // Beto envía a Ana a la vez: se convierte en amistad.
  assert.equal(store.sendRequest(beto.id, ana.id).status, 'accepted');
  assert.ok(store.areFriends(ana.id, beto.id));
  assert.equal(store.listFor(ana.id).friends[0].name, 'Beto');
  assert.equal(store.listFor(ana.id).outgoing.length, 0);

  assert.ok(store.removeFriend(beto.id, ana.id));
  assert.equal(store.friendCount(ana.id), 0);

  store.sendRequest(ana.id, beto.id);
  store.respond(beto.id, ana.id, false);
  assert.equal(store.listFor(beto.id).incoming.length, 0);
  assert.ok(!store.areFriends(ana.id, beto.id));

  const { code } = store.createLinkCode(ana.id);
  const linked = store.redeemLinkCode(code);
  assert.equal(linked.user.id, ana.id);
  assert.ok(store.authenticate(ana.id, linked.token));
  assert.equal(store.redeemLinkCode(code), null, 'un solo uso');

  assert.ok(!store.savePushSubscription(ana.id, { endpoint: 'http://inseguro', keys: { p256dh: 'a', auth: 'b' } }));
  assert.ok(store.savePushSubscription(ana.id, { endpoint: 'https://push.example/1', keys: { p256dh: 'a', auth: 'b' } }));
  assert.equal(store.pushSubscriptionsOf(ana.id).length, 1);
  store.close();
});

test('sockets: cuenta anónima, amistad, presencia, invitación a sala y push', async () => {
  const { server, push } = createServer({ dbPath: ':memory:' });
  const sent = [];
  push.sender = { sendNotification: async (sub, body) => sent.push({ endpoint: sub.endpoint, ...JSON.parse(body) }) };
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const a = connect(url, { transports: ['websocket'] });
  const b = connect(url, { transports: ['websocket'] });
  try {
    const helloA = await call(a, C.HELLO, { name: 'Ana' });
    const helloB = await call(b, C.HELLO, { name: 'Beto' });
    assert.ok(helloA.credentials.token && helloA.vapidPublicKey);
    assert.equal(helloB.state.me.name, 'Beto');

    // Volver a entrar con las credenciales mantiene la cuenta.
    const again = await call(a, C.HELLO, { ...helloA.credentials, name: 'Ana' });
    assert.equal(again.credentials, null);
    assert.equal(again.state.me.id, helloA.credentials.userId);

    assert.ok((await call(b, C.PUSH_SUBSCRIBE, { subscription: { endpoint: 'https://push.example/b', keys: { p256dh: 'k', auth: 'x' } } })).ok);

    const gotRequest = once(b, C.NOTICE);
    const req = await call(a, C.REQUEST, { code: helloB.state.me.friendCodeLabel });
    assert.equal(req.status, 'sent');
    assert.equal((await gotRequest).kind, 'request');
    assert.equal(sent.at(-1).kind, 'request');

    const bState = (await call(b, C.REFRESH)).state;
    assert.equal(bState.incoming[0].name, 'Ana');
    const aStateP = once(a, C.STATE);
    assert.ok((await call(b, C.RESPOND, { fromId: bState.incoming[0].id, accept: true })).ok);
    const aState = await aStateP;
    assert.equal(aState.friends[0].name, 'Beto');
    assert.equal(aState.friends[0].status, 'online');

    // Sin sala no se puede invitar.
    assert.match((await call(a, C.INVITE, { friendId: aState.friends[0].id })).error, /sala/);

    // Ana crea sala: Beto ve que está en una sala.
    const presence = new Promise((r) => b.on(C.STATE, (s) => s.friends[0]?.status === 'lobby' && r(s)));
    a.emit(EVENTS.CREATE_ROOM, { nickname: 'Ana' });
    const { roomCode } = await once(a, EVENTS.ROOM_CREATED);
    assert.equal((await presence).friends[0].roomCode, roomCode);

    const inviteP = once(b, C.INVITE_RECEIVED);
    const inv = await call(a, C.INVITE, { friendId: aState.friends[0].id });
    assert.ok(inv.ok);
    const invite = await inviteP;
    assert.equal(invite.roomCode, roomCode);
    assert.equal(invite.from.name, 'Ana');
    assert.equal(sent.at(-1).kind, 'invite');
    assert.equal(sent.at(-1).url, `/?room=${roomCode}&invite=1`);
    assert.match((await call(a, C.INVITE, { friendId: aState.friends[0].id })).error, /hace un momento/);

    // Beto entra en la sala: Ana puede ver que el otro jugador ya es su amigo.
    b.emit(EVENTS.JOIN_ROOM, { nickname: 'Beto', roomCode });
    await once(b, EVENTS.ROOM_JOINED);
    const peers = await call(a, C.ROOM_PEERS);
    assert.deepEqual(peers.peers.map((p) => p.relation), ['friend']);

    // Con un desconocido en la sala, se le puede agregar por id.
    const c = connect(url, { transports: ['websocket'] });
    try {
      const helloC = await call(c, C.HELLO, { name: 'Caro' });
      c.emit(EVENTS.JOIN_ROOM, { nickname: 'Caro', roomCode });
      await once(c, EVENTS.ROOM_JOINED);
      const req2 = await call(a, C.REQUEST, { userId: helloC.credentials.userId });
      assert.equal(req2.status, 'sent');
      // Por id no se puede agregar a alguien que no comparte sala.
      c.emit(EVENTS.LEAVE_ROOM);
      await new Promise((r) => setTimeout(r, 50));
      assert.ok((await call(b, C.REQUEST, { userId: helloC.credentials.userId })).error);
    } finally {
      c.close();
    }

    // Al desconectarse, sus amigos lo ven desconectado.
    const offline = new Promise((r) => a.on(C.STATE, (s) => s.friends[0]?.status === 'offline' && r(s)));
    b.disconnect();
    await offline;
  } finally {
    a.close();
    b.close();
    server.close();
  }
});
