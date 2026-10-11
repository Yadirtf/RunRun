// Pruebas de la lógica de sala con un reloj simulado (sin red ni esperas reales).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EV, PHASE, COUNTDOWN_MS, FINISH_GRACE_MS, getTrackLayout } from '@ranran/shared';
import { Room } from '../src/Room.js';

function setup() {
  let now = 1_000_000;
  const sent = [];
  const room = new Room('ABCDE', (target, event, payload) => sent.push({ target, event, payload }), () => now);
  return { room, sent, advance: (ms) => { now += ms; }, now: () => now };
}

test('carrera completa: vueltas, llegada, resultados y vuelta a la sala', () => {
  const ctx = setup();
  const { room, sent } = ctx;
  const a = room.addPlayer({ socketId: 's1', sessionId: 'a', nickname: 'Ana', carId: 'gt' }).player;
  const b = room.addPlayer({ socketId: 's2', sessionId: 'b', nickname: 'Beto', carId: 'sport' }).player;
  room.updateSettings(a.id, { trackId: 'monza', laps: 2 });
  assert.equal(room.settings.trackId, 'monza');
  assert.equal(room.settings.laps, 2);
  assert.equal(room.startRace(a.id).error !== undefined, true, 'Beto aún no está listo');
  room.setReady(b.id, true);
  assert.deepEqual(room.startRace(a.id), { ok: true });
  assert.equal(room.phase, PHASE.COUNTDOWN);

  ctx.advance(COUNTDOWN_MS + 10);
  room.tick();
  assert.equal(room.phase, PHASE.RACING);

  const layout = getTrackLayout('monza');
  const slots = layout.gridSlots(2);
  // El servidor procesa el tiempo del cliente; avanzamos el reloj al ritmo de las muestras.
  const goAt = room.race.goAt;
  const run = (player, slot, speed) => {
    let s = slot.s, t = 0;
    while (s < layout.length * 2 + 15) {
      t += 50;
      s = slot.s + speed * (t / 1000);
      const p = layout.offsetPoint(s, 0);
      room.receiveState(player.id, { t, p: [p.x, 0.3, p.z], q: [0, 0, 0, 1], v: speed });
    }
    return t;
  };
  // Para que el tiempo del cliente sea aceptado, el reloj del servidor debe ir parejo:
  const origNow = room.now;
  let virtual = 0;
  room.now = () => goAt + virtual;
  const wrap = room.receiveState.bind(room);
  room.receiveState = (id, st) => { virtual = st.t; wrap(id, st); };
  run(a, slots[0], 80);
  room.tick();
  assert.equal(room.phase, PHASE.RACING, 'Beto aún corre');
  run(b, slots[1], 70);
  room.tick();
  room.now = origNow;

  assert.equal(room.phase, PHASE.FINISHED);
  const laps = sent.filter((m) => m.event === EV.LAP);
  assert.equal(laps.length, 4);
  const res = sent.find((m) => m.event === EV.RESULTS).payload.results;
  assert.equal(res[0].nickname, 'Ana');
  assert.equal(res[1].nickname, 'Beto');
  assert.ok(res.every((r) => r.finished));
  const expectedLap = (layout.length / 80) * 1000;
  assert.ok(Math.abs(res[0].bestLap - expectedLap) < 300, `${res[0].bestLap} ≈ ${expectedLap}`);

  room.backToLobby(b.id); // solo el anfitrión
  assert.equal(room.phase, PHASE.FINISHED);
  room.backToLobby(a.id);
  assert.equal(room.phase, PHASE.LOBBY);
});

test('si alguien no termina, la carrera se cierra tras el margen', () => {
  const ctx = setup();
  const { room } = ctx;
  const a = room.addPlayer({ socketId: 's1', sessionId: 'a', nickname: 'Ana' }).player;
  const b = room.addPlayer({ socketId: 's2', sessionId: 'b', nickname: 'Beto' }).player;
  room.updateSettings(a.id, { trackId: 'spielberg', laps: 1 });
  room.setReady(b.id, true);
  room.startRace(a.id);
  ctx.advance(COUNTDOWN_MS + 10);
  room.tick();
  const layout = getTrackLayout('spielberg');
  const slot = layout.gridSlots(2)[0];
  const goAt = room.race.goAt;
  let t = 0, s = slot.s;
  room.now = () => goAt + t;
  while (s < layout.length + 15) {
    t += 50; s = slot.s + 90 * (t / 1000);
    const p = layout.offsetPoint(s, 0);
    room.receiveState(a.id, { t, p: [p.x, 0.3, p.z], q: [0, 0, 0, 1] });
  }
  room.tick();
  assert.equal(room.phase, PHASE.RACING);
  t += FINISH_GRACE_MS + 100;
  room.tick();
  assert.equal(room.phase, PHASE.FINISHED);
  const res = room.race.results;
  assert.equal(res[0].finished, true);
  assert.equal(res[1].finished, false);
});

test('límites: máximo 8 pilotos y apodos válidos', () => {
  const { room } = setup();
  assert.ok(room.addPlayer({ socketId: 'x', sessionId: 'x', nickname: 'ab' }).error);
  for (let i = 0; i < 8; i++) assert.ok(room.addPlayer({ socketId: `s${i}`, sessionId: `p${i}`, nickname: 'Piloto' }).player);
  assert.ok(room.addPlayer({ socketId: 's9', sessionId: 'p9', nickname: 'Otro' }).error);
  const names = room.publicState().players.map((p) => p.nickname);
  assert.equal(new Set(names).size, 8, 'los nombres repetidos se numeran');
  const colors = room.publicState().players.map((p) => p.color);
  assert.equal(new Set(colors).size, 8, 'cada piloto tiene un color distinto');
});
