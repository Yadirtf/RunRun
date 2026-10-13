import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../RoomManager.js';
import { CheckpointValidator } from '../CheckpointValidator.js';
import { getTrack } from '@runrun/shared/tracks';
import { ROOM_STATUS, ROOM_CODE_ALPHABET } from '@runrun/shared/protocol';

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

test('crea sala con código legible y el creador es host', () => {
  const rm = new RoomManager();
  const { room, player } = rm.createRoom('a', { nickname: 'Ana', carModel: 'muscle' });
  assert.equal(room.code.length, 6);
  for (const ch of room.code) assert.ok(ROOM_CODE_ALPHABET.includes(ch));
  assert.equal(player.isHost, true);
  assert.equal(player.carModel, 'muscle');
  assert.equal(room.hostId, 'a');
});

test('unirse, sala llena y sala inexistente', () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom('h', { nickname: 'Host' });
  for (let i = 0; i < 7; i++) assert.ok(rm.joinRoom(room.code, `p${i}`, { nickname: `P${i}xx` }).player);
  assert.match(rm.joinRoom(room.code, 'x', { nickname: 'Extra' }).error, /llena/);
  assert.match(rm.joinRoom('ZZZZZZ', 'y', { nickname: 'Nadie' }).error, /no existe/);
  const slots = [...room.players.values()].map((p) => p.slot).sort((a, b) => a - b);
  assert.deepEqual(slots, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('el host se transfiere y la sala se cierra al quedar vacía', () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom('h', { nickname: 'Host' });
  rm.joinRoom(room.code, 'b', { nickname: 'Beto' });
  const left = rm.leave('h');
  assert.equal(left.newHostId, 'b');
  assert.equal(room.players.get('b').isHost, true);
  assert.equal(rm.leave('b').closed, true);
  assert.equal(rm.rooms.size, 0);
});

test('solo el host inicia y cuando los demás están listos', () => {
  const c = clock();
  const rm = new RoomManager({ now: c.now });
  const { room } = rm.createRoom('h', { nickname: 'Host' });
  rm.joinRoom(room.code, 'b', { nickname: 'Beto' });
  assert.match(room.startRace('b').error, /anfitrión/);
  assert.match(room.startRace('h').error, /Beto/);
  room.setReady('b', true);
  const res = room.startRace('h');
  assert.equal(res.ok, true);
  assert.equal(room.status, ROOM_STATUS.LOADING);
  assert.equal(room.markLoaded('h'), null);
  const { startTime } = room.markLoaded('b');
  assert.equal(room.status, ROOM_STATUS.COUNTDOWN);
  c.t = startTime;
  room.tick();
  assert.equal(room.status, ROOM_STATUS.RACING);
});

test('checkpoints: orden, tiempo mínimo y vuelta completa', () => {
  const track = getTrack('alpine');
  const v = new CheckpointValidator(track);
  const s = v.createState(0);
  let t = 0;
  assert.equal(v.validate(s, 2, 10_000).reason, 'out_of_order');
  assert.equal(v.validate(s, 1, 1).reason, 'too_fast');
  for (let lap = 1; lap <= track.laps; lap++) {
    for (let i = 1; i <= track.checkpoints; i++) {
      t += 6000;
      const res = v.validate(s, i % track.checkpoints, t);
      assert.equal(res.ok, true);
      if (i === track.checkpoints) assert.equal(res.lapCompleted.lapNumber, lap);
    }
  }
  assert.equal(s.lap, track.laps);
  assert.ok(s.finishedAt !== null);
  assert.equal(s.totalTime, t);
});

test('carrera completa con dos jugadores produce resultados ordenados', () => {
  const c = clock();
  const rm = new RoomManager({ now: c.now });
  const { room } = rm.createRoom('h', { nickname: 'Host' });
  rm.joinRoom(room.code, 'b', { nickname: 'Beto' });
  room.setReady('b', true);
  room.selectTrack('h', 'desert');
  room.startRace('h');
  room.markLoaded('h');
  const { startTime } = room.markLoaded('b');
  c.t = startTime;
  const track = getTrack('desert');
  let final;
  for (let lap = 0; lap < track.laps; lap++) {
    for (let i = 1; i <= track.checkpoints; i++) {
      c.t += 5000;
      room.passCheckpoint('b', i % track.checkpoints);
      c.t += 100;
      final = room.passCheckpoint('h', i % track.checkpoints);
    }
  }
  assert.ok(final.raceResults);
  assert.equal(room.status, ROOM_STATUS.FINISHED);
  assert.deepEqual(final.raceResults.map((r) => r.id), ['b', 'h']);
  assert.equal(final.raceResults[0].position, 1);
  assert.equal(room.returnToLobby('h'), true);
  assert.equal(room.status, ROOM_STATUS.LOBBY);
});

test('la cuenta atrás arranca sola si alguien no termina de cargar', () => {
  const c = clock();
  const rm = new RoomManager({ now: c.now });
  const { room } = rm.createRoom('h', { nickname: 'Host' });
  rm.joinRoom(room.code, 'b', { nickname: 'Beto' });
  room.setReady('b', true);
  room.startRace('h');
  room.markLoaded('h');
  assert.equal(room.tick(), null);
  c.t += 21_000;
  const ev = room.tick();
  assert.ok(ev.countdown.startTime > c.t);
  assert.equal(room.status, ROOM_STATUS.COUNTDOWN);
});

test('limpieza de salas inactivas', () => {
  const c = clock();
  const rm = new RoomManager({ now: c.now, idleMs: 1000 });
  rm.createRoom('h', { nickname: 'Host' });
  c.t += 2000;
  assert.equal(rm.cleanup().length, 1);
  assert.equal(rm.roomOf('h'), null);
});

test('cada piloto elige pintura libre de la paleta', () => {
  const rm = new RoomManager();
  const { room, player: a } = rm.createRoom('a', { nickname: 'Ana', color: '#2a9df4' });
  assert.equal(a.color, '#2a9df4');
  // Color ocupado o fuera de la paleta: se asigna el primero libre.
  const { player: b } = rm.joinRoom(room.code, 'b', { nickname: 'Beto', color: '#2a9df4' });
  assert.notEqual(b.color, '#2a9df4');
  const { player: c } = rm.joinRoom(room.code, 'c', { nickname: 'Caro', color: 'red' });
  assert.ok(![a.color, b.color].includes(c.color));
  // Cambiar de coche y color en el lobby; no se puede robar el de otro.
  assert.ok(room.selectCar('b', 'gt3', '#2bb673'));
  assert.equal(b.carModel, 'gt3');
  assert.equal(b.color, '#2bb673');
  const before = c.color;
  room.selectCar('c', 'hatch', '#2bb673');
  assert.equal(c.color, before);
});
