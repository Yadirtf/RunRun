import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { EV, getTrackLayout } from '@ranran/shared';
import { createGameServer } from '../src/app.js';

let srv, url;

before(async () => {
  srv = createGameServer({ port: 0, clientOrigins: [], staticDir: '/no-existe', maxRooms: 10 });
  await new Promise((r) => srv.server.listen(0, r));
  url = `http://localhost:${srv.server.address().port}`;
});
after(() => srv.close());

const client = () => connect(url, { transports: ['websocket'], forceNew: true });
const call = (s, ev, data) => new Promise((resolve) => s.emit(ev, data, resolve));
const once = (s, ev, pred = () => true) => new Promise((resolve) => {
  const h = (d) => { if (pred(d)) { s.off(ev, h); resolve(d); } };
  s.on(ev, h);
});

test('crear sala, unirse, iniciar y retransmitir estados', { timeout: 15_000 }, async () => {
  const a = client(), b = client();
  try {
    const ra = await call(a, EV.CREATE_ROOM, { nickname: 'Ana', carId: 'gt', color: '#c1121f', sessionId: 'sa' });
    assert.equal(ra.ok, true);
    assert.match(ra.roomCode, /^[A-Z2-9]{5}$/);

    const bad = await call(b, EV.JOIN_ROOM, { roomCode: 'ZZZZZ', nickname: 'Beto', sessionId: 'sb' });
    assert.equal(bad.ok, false);

    // Mismo color pedido: el servidor asigna otro libre.
    const rb = await call(b, EV.JOIN_ROOM, { roomCode: ra.roomCode.toLowerCase(), nickname: 'Beto', carId: 'drift', color: '#c1121f', sessionId: 'sb' });
    assert.equal(rb.ok, true);
    assert.equal(rb.room.players.length, 2);
    assert.notEqual(rb.room.players[0].color, rb.room.players[1].color);

    // No se puede iniciar si el invitado no está listo.
    const early = await call(a, EV.START_RACE, {});
    assert.equal(early.ok, false);

    a.emit(EV.UPDATE_SETTINGS, { trackId: 'spielberg', laps: 1 });
    b.emit(EV.SET_READY, true);
    await once(a, EV.ROOM_STATE, (s) => s.canStart && s.settings.laps === 1);

    // Solo el anfitrión puede iniciar.
    const notHost = await call(b, EV.START_RACE, {});
    assert.equal(notHost.ok, false);

    const countdownP = once(b, EV.COUNTDOWN);
    assert.equal((await call(a, EV.START_RACE, {})).ok, true);
    const cd = await countdownP;
    assert.equal(cd.grid.length, 2);
    await once(a, EV.RACE_GO);

    // Los estados de un piloto llegan al otro en las instantáneas.
    const layout = getTrackLayout('spielberg');
    const slot = layout.gridSlots(2)[0];
    const snapP = once(b, EV.SNAPSHOT, (snap) => snap.cars.some((c) => c.id === ra.playerId && c.p && Math.abs(c.p[0] - slot.x) < 1));
    a.emit(EV.STATE, { t: Date.now() - cd.goAt, p: [slot.x, 0.3, slot.z], q: [0, 0, 0, 1], v: 3 });
    const snap = await snapP;
    assert.equal(snap.cars.length, 2);
    assert.ok(snap.cars.every((c) => c.pos >= 1 && c.lap === 1));
  } finally {
    a.close(); b.close();
  }
});

test('el anfitrión pasa a otro jugador si se va', { timeout: 10_000 }, async () => {
  const a = client(), b = client();
  try {
    const ra = await call(a, EV.CREATE_ROOM, { nickname: 'Host', sessionId: 'h1' });
    await call(b, EV.JOIN_ROOM, { roomCode: ra.roomCode, nickname: 'Guest', sessionId: 'g1' });
    const stateP = once(b, EV.ROOM_STATE, (s) => s.players.length === 1);
    a.emit(EV.LEAVE_ROOM);
    const s = await stateP;
    assert.equal(s.players[0].nickname, 'Guest');
    assert.equal(s.hostId, s.players[0].id);
  } finally {
    a.close(); b.close();
  }
});

test('reconexión con la misma sesión recupera el sitio', { timeout: 10_000 }, async () => {
  const a = client();
  let a2;
  try {
    const ra = await call(a, EV.CREATE_ROOM, { nickname: 'Rita', sessionId: 'same' });
    a.close();
    await new Promise((r) => setTimeout(r, 200));
    a2 = client();
    const r2 = await call(a2, EV.JOIN_ROOM, { roomCode: ra.roomCode, nickname: 'Rita', sessionId: 'same' });
    assert.equal(r2.ok, true);
    assert.equal(r2.playerId, ra.playerId);
    assert.equal(r2.room.players.length, 1);
    assert.equal(r2.room.players[0].connected, true);
  } finally {
    a.close(); a2?.close();
  }
});

test('valida datos basura sin romperse', { timeout: 10_000 }, async () => {
  const a = client();
  try {
    const r = await call(a, EV.CREATE_ROOM, { nickname: '<x>', sessionId: 'junk' });
    assert.equal(r.ok, false);
    a.emit(EV.STATE, { p: ['a', null], q: 5 });
    a.emit(EV.STATE, null);
    a.emit(EV.UPDATE_SETTINGS, 'nope');
    const ok = await call(a, EV.CREATE_ROOM, { nickname: 'Valid', sessionId: 'junk' });
    assert.equal(ok.ok, true);
    const res = await fetch(`${url}/healthz`).then((x) => x.json());
    assert.equal(res.ok, true);
  } finally {
    a.close();
  }
});
