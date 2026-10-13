import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createServer } from '../server.js';
import { EVENTS, encodeTransform, decodeTransform } from '@runrun/shared/protocol';

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
