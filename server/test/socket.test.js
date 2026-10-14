import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createServer } from '../server.js';
import { EVENTS, CHAT_MAX, CHAT_BURST, encodeTransform, decodeTransform } from '@runrun/shared/protocol';

const once = (s, ev) => new Promise((r) => s.once(ev, (...a) => r(a.length > 1 ? a : a[0])));

test('dos clientes: crear, unirse, iniciar y recibir transformaciones binarias', async () => {
  const { server } = createServer();
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const a = connect(url, { transports: ['websocket'] });
  const b = connect(url, { transports: ['websocket'] });
  try {
    a.emit(EVENTS.CREATE_ROOM, { nickname: 'Ana', carModel: 'sport' });
    const created = await once(a, EVENTS.ROOM_CREATED);
    b.emit(EVENTS.JOIN_ROOM, { nickname: 'Beto', roomCode: created.roomCode.toLowerCase() });
    const joined = await once(b, EVENTS.ROOM_JOINED);
    assert.equal(joined.room.players.length, 2);

    b.emit(EVENTS.PLAYER_READY, { ready: true });
    await once(a, EVENTS.ROOM_STATE);
    a.emit(EVENTS.START_RACE);
    const loading = await once(b, EVENTS.RACE_LOADING);
    assert.equal(loading.trackId, 'alpine');
    a.emit(EVENTS.PLAYER_LOADED);
    b.emit(EVENTS.PLAYER_LOADED);
    const started = await once(b, EVENTS.RACE_STARTED);
    assert.ok(started.startTime > Date.now());

    const t = { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, speed: 120, steer: 0.1, wheelRotation: 4 };
    a.emit(EVENTS.UPDATE_TRANSFORM, encodeTransform(t));
    const [id, buf] = await once(b, EVENTS.PLAYER_MOVED);
    assert.equal(id, a.id);
    const decoded = decodeTransform(buf);
    assert.equal(decoded.position.z, 3);
    assert.equal(Math.round(decoded.speed), 120);

    const aId = a.id;
    a.disconnect();
    const left = await once(b, EVENTS.PLAYER_LEFT);
    assert.equal(left.id, aId);
  } finally {
    a.close();
    b.close();
    server.close();
  }
});

test('un payload nulo no tumba el servidor', async () => {
  const { server } = createServer();
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const a = connect(url, { transports: ['websocket'] });
  try {
    await once(a, 'connect');
    for (const ev of [EVENTS.POWERUP_PICKUP, EVENTS.POWERUP_FIRE, EVENTS.PLAYER_READY, EVENTS.SELECT_CAR, EVENTS.CHECKPOINT_PASSED, EVENTS.SET_OPTIONS, EVENTS.CHAT_SEND]) a.emit(ev, null);
    a.emit(EVENTS.CREATE_ROOM, { nickname: 'Ana' });
    const created = await once(a, EVENTS.ROOM_CREATED);
    assert.equal(created.room.powerups, true);
  } finally {
    a.close();
    server.close();
  }
});

test('chat de sala: solo llega a la sala, se limpia y tiene límite de ritmo', async () => {
  const { server } = createServer();
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const a = connect(url, { transports: ['websocket'] });
  const b = connect(url, { transports: ['websocket'] });
  const c = connect(url, { transports: ['websocket'] });
  try {
    a.emit(EVENTS.CREATE_ROOM, { nickname: 'Ana' });
    const created = await once(a, EVENTS.ROOM_CREATED);
    b.emit(EVENTS.JOIN_ROOM, { nickname: 'Beto', roomCode: created.roomCode });
    await once(b, EVENTS.ROOM_JOINED);
    c.emit(EVENTS.CREATE_ROOM, { nickname: 'Caro' });
    await once(c, EVENTS.ROOM_CREATED);
    let leaked = false;
    c.on(EVENTS.CHAT_MESSAGE, () => { leaked = true; });

    a.emit(EVENTS.CHAT_SEND, { text: '  hola\n\u202Eequipo  ' });
    const msg = await once(b, EVENTS.CHAT_MESSAGE);
    assert.equal(msg.text, 'hola equipo');
    assert.equal(msg.nickname, 'Ana');
    assert.equal(msg.playerId, a.id);

    b.emit(EVENTS.CHAT_SEND, { text: '   ' });
    b.emit(EVENTS.CHAT_SEND, { text: 'x'.repeat(500) });
    const long = await once(a, EVENTS.CHAT_MESSAGE);
    assert.equal(long.text.length, CHAT_MAX);

    for (let i = 0; i < CHAT_BURST; i++) a.emit(EVENTS.CHAT_SEND, { text: `m${i}` });
    const err = await once(a, EVENTS.ERROR_MESSAGE);
    assert.match(err, /espera/);
    assert.equal(leaked, false);
  } finally {
    a.close();
    b.close();
    c.close();
    server.close();
  }
});
