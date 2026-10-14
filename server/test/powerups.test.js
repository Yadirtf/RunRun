import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PowerupManager } from '../PowerupManager.js';
import { getTrack, TRACKS } from '@runrun/shared/tracks';
import { buildTrackPath } from '@runrun/shared/trackPath';
import {
  POWERUP_IDS, MAX_SLOTS, HEALTH_MAX, PAD_RESPAWN_MS, WRECK_MS, SHOCK_ARM_MS, MINE_ARM_MS,
  powerupPads, trackPoint, trackTangent, boltPosition,
} from '@runrun/shared/powerups';

function setup(trackId = 'desert') {
  const c = { t: 1_000_000 };
  const pm = new PowerupManager(getTrack(trackId), { now: () => c.t, random: () => 0.5 });
  return { pm, c };
}

/** Coloca a un jugador en la pista (arco `s`, desplazamiento lateral) mirando hacia delante. */
function place(pm, c, id, s, lateral = 0) {
  const [x, y, z] = trackPoint(pm.path, s, lateral);
  const [tx, , tz] = trackTangent(pm.path, s);
  const yaw = Math.atan2(tx, tz);
  pm.updateTransform(id, {
    position: { x, y: y + 0.6, z },
    rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
    speed: 0,
  }, c.t);
  // Puertas superadas en la primera vuelta (lo que validaría CheckpointValidator).
  pm.setRace(id, pm.gates.filter((g) => g.id > 0 && g.s <= s).length, false);
}

/** Avanza el reloj moviendo a cada jugador a velocidad constante por el trazado. */
function drive(pm, c, cars, ms, stepMs = 33) {
  for (let t = 0; t < ms; t += stepMs) {
    c.t += stepMs;
    for (const car of cars) {
      car.s += (car.speed * stepMs) / 1000;
      place(pm, c, car.id, car.s, car.lateral ?? 0);
    }
    pm.tick(c.t);
  }
}

function give(pm, id, type) {
  pm.players.get(id).inventory.push({ type, charges: type === 'bolt' ? 3 : 1 });
}

const kinds = (pm) => pm.drain().map((e) => e.k);

test('cada pista tiene los 8 poderes en grupos de 3 fuera de la parrilla', () => {
  for (const def of Object.values(TRACKS)) {
    const path = buildTrackPath(def, 2);
    const pads = powerupPads(def, path);
    assert.ok(pads.length >= 12 && pads.length % 3 === 0, def.id);
    assert.deepEqual(new Set(pads.map((p) => p.type)), new Set(POWERUP_IDS), def.id);
    for (const p of pads) {
      assert.ok(p.s > 60 && p.s < path.length - 70, `${def.id} pad en la parrilla`);
      assert.ok(Math.abs(p.lateral) < path.width / 2, `${def.id} pad fuera de pista`);
    }
    // Determinista: cliente y servidor calculan lo mismo.
    assert.deepEqual(powerupPads(def, buildTrackPath(def, 2)), pads);
  }
});

test('recoger: solo cerca del icono, con hueco y hasta que reaparece', () => {
  const { pm, c } = setup();
  pm.addPlayer('a');
  pm.addPlayer('b');
  const pad = pm.pads[0];
  place(pm, c, 'a', pad.s - 200, 0);
  assert.equal(pm.pickup('a', pad.id), false, 'lejos del icono');
  place(pm, c, 'a', pad.s, pad.lateral);
  assert.equal(pm.pickup('a', pad.id), true);
  assert.deepEqual(pm.inventoryOf('a'), [{ type: pad.type, charges: pad.type === 'bolt' ? 3 : 1 }]);
  place(pm, c, 'b', pad.s, pad.lateral);
  assert.equal(pm.pickup('b', pad.id), false, 'ya recogido');
  c.t += PAD_RESPAWN_MS;
  assert.equal(pm.pickup('b', pad.id), true, 'reapareció');

  // Inventario lleno: máximo 3.
  for (let i = 0; i < MAX_SLOTS; i++) give(pm, 'a', 'nitro');
  const other = pm.pads[3];
  place(pm, c, 'a', other.s, other.lateral);
  assert.equal(pm.pickup('a', other.id), false);
});

test('disparar exige tener el poder en esa ranura', () => {
  const { pm, c } = setup();
  pm.addPlayer('a');
  place(pm, c, 'a', 300);
  assert.equal(pm.fire('a', { slot: 0, type: 'shunt' }), false);
  give(pm, 'a', 'nitro');
  assert.equal(pm.fire('a', { slot: 0, type: 'shunt' }), false, 'tipo distinto');
  assert.equal(pm.fire('a', { slot: 0, type: 'nitro' }), true);
  assert.deepEqual(pm.inventoryOf('a'), []);
});

test('el misil persigue al de delante y le quita salud', () => {
  const { pm, c } = setup();
  for (const id of ['a', 'b', 'c']) pm.addPlayer(id);
  const cars = [
    { id: 'a', s: 300, speed: 50 },
    { id: 'b', s: 380, speed: 50, lateral: 3 },
    { id: 'c', s: 520, speed: 50 },
  ];
  drive(pm, c, cars, 100);
  pm.drain();
  give(pm, 'a', 'shunt');
  assert.ok(pm.fire('a', { slot: 0, type: 'shunt' }));
  const spawn = pm.drain().find((e) => e.k === 'spawn');
  assert.equal(spawn.p.target, 'b', 'apunta al inmediatamente delante');
  drive(pm, c, cars, 3000);
  const hit = pm.drain().find((e) => e.k === 'hit');
  assert.equal(hit?.victim, 'b');
  assert.equal(hit.type, 'shunt');
  assert.equal(pm.players.get('b').health, HEALTH_MAX - 45);
});

test('una mina soltada detrás detiene el misil', () => {
  const { pm, c } = setup();
  pm.addPlayer('a');
  pm.addPlayer('b');
  const cars = [{ id: 'a', s: 300, speed: 50 }, { id: 'b', s: 400, speed: 50 }];
  drive(pm, c, cars, 100);
  give(pm, 'b', 'mine');
  assert.ok(pm.fire('b', { slot: 0, type: 'mine', back: true }));
  drive(pm, c, cars, MINE_ARM_MS + 50);
  pm.drain();
  give(pm, 'a', 'shunt');
  pm.fire('a', { slot: 0, type: 'shunt' });
  drive(pm, c, cars, 3000);
  const ev = pm.drain();
  assert.ok(ev.some((e) => e.k === 'gone' && e.reason === 'intercept'));
  assert.ok(!ev.some((e) => e.k === 'hit' && e.victim === 'b'));
  assert.equal(pm.players.get('b').health, HEALTH_MAX);
});

test('el escudo bloquea y el misil lo rompe', () => {
  const { pm, c } = setup();
  pm.addPlayer('a');
  pm.addPlayer('b');
  const cars = [{ id: 'a', s: 300, speed: 50 }, { id: 'b', s: 360, speed: 50 }];
  drive(pm, c, cars, 100);
  give(pm, 'b', 'shield');
  pm.fire('b', { slot: 0, type: 'shield' });
  give(pm, 'a', 'shunt');
  pm.fire('a', { slot: 0, type: 'shunt' });
  pm.drain();
  drive(pm, c, cars, 3000);
  const blocked = pm.drain().find((e) => e.k === 'blocked');
  assert.equal(blocked.victim, 'b');
  assert.equal(blocked.broke, true);
  assert.equal(pm.players.get('b').health, HEALTH_MAX);
  assert.ok(pm.players.get('b').shieldUntil <= c.t);
});

test('los rayos van en línea recta con autoapuntado y tienen 3 cargas', () => {
  const { pm, c } = setup();
  pm.addPlayer('a');
  pm.addPlayer('b');
  // Recta inicial del desierto: b 40 m delante y algo desplazado.
  const cars = [{ id: 'a', s: 80, speed: 30 }, { id: 'b', s: 120, speed: 30, lateral: 2 }];
  drive(pm, c, cars, 100);
  give(pm, 'a', 'bolt');
  pm.drain();
  assert.ok(pm.fire('a', { slot: 0, type: 'bolt' }));
  assert.equal(pm.inventoryOf('a')[0].charges, 2);
  const spawn = pm.drain().find((e) => e.k === 'spawn').p;
  const end = boltPosition(spawn, spawn.expires);
  assert.ok(Number.isFinite(end[0]));
  drive(pm, c, cars, 600);
  const hit = pm.drain().find((e) => e.k === 'hit');
  assert.equal(hit?.victim, 'b');
  assert.equal(hit.type, 'bolt');
  c.t += 300;
  assert.ok(pm.fire('a', { slot: 0, type: 'bolt' }));
  c.t += 300;
  assert.ok(pm.fire('a', { slot: 0, type: 'bolt' }));
  assert.deepEqual(pm.inventoryOf('a'), []);
});

test('la descarga cae delante del líder y se activa tras un aviso', () => {
  const { pm, c } = setup();
  for (const id of ['a', 'b']) pm.addPlayer(id);
  const cars = [{ id: 'a', s: 200, speed: 40 }, { id: 'b', s: 330, speed: 40 }];
  drive(pm, c, cars, 100);
  give(pm, 'a', 'shock');
  pm.drain();
  pm.fire('a', { slot: 0, type: 'shock' });
  const shock = pm.drain().find((e) => e.k === 'spawn').p;
  assert.equal(shock.target, 'b');
  assert.equal(shock.domes.length, 3);
  assert.ok(shock.armAt - shock.t0 === SHOCK_ARM_MS);
  // b conduce por la línea de la cúpula central.
  cars[1].lateral = shock.domes[1].lateral;
  drive(pm, c, cars, 4000);
  const ev = pm.drain();
  assert.ok(ev.some((e) => e.k === 'hit' && e.victim === 'b' && e.type === 'shock'));
  assert.equal(ev.filter((e) => e.k === 'hit' && e.victim === 'b').length, 1, 'una sola vez por descarga');
});

test('la onda empuja a los cercanos y barre minas', () => {
  const { pm, c } = setup();
  for (const id of ['a', 'b', 'c']) pm.addPlayer(id);
  place(pm, c, 'a', 300, 0);
  place(pm, c, 'b', 306, 3);
  place(pm, c, 'c', 400, 0);
  give(pm, 'c', 'mine');
  pm.fire('c', { slot: 0, type: 'mine', back: true });
  place(pm, c, 'c', 302, 0); // se coloca cerca para que su mina (en 395) quede lejos
  give(pm, 'b', 'mine');
  pm.fire('b', { slot: 0, type: 'mine', back: true });
  pm.drain();
  give(pm, 'a', 'barge');
  c.t += 300;
  pm.fire('a', { slot: 0, type: 'barge' });
  const ev = pm.drain();
  const hits = ev.filter((e) => e.k === 'hit').map((e) => e.victim).sort();
  assert.deepEqual(hits, ['b', 'c']);
  assert.equal(ev.filter((e) => e.k === 'gone' && e.reason === 'barge').length, 1, 'solo la mina cercana');
});

test('salud a cero destroza el coche, reaparece con salud llena; reparar cura', () => {
  const { pm, c } = setup();
  pm.addPlayer('a');
  pm.addPlayer('b');
  place(pm, c, 'a', 300);
  place(pm, c, 'b', 320);
  const b = pm.players.get('b');
  b.health = 20;
  pm.applyHit('b', 'shunt', 'a', [0, 0, 1], c.t);
  const hit = pm.drain().find((e) => e.k === 'hit');
  assert.equal(hit.wrecked, true);
  assert.equal(pm.applyHit('b', 'bolt', 'a', [0, 0, 1], c.t + 100), false, 'invulnerable mientras está destrozado');
  c.t += WRECK_MS;
  pm.tick(c.t);
  assert.ok(kinds(pm).includes('status'));
  assert.equal(b.health, HEALTH_MAX);

  b.health = 30;
  give(pm, 'b', 'repair');
  place(pm, c, 'b', 330);
  pm.fire('b', { slot: 0, type: 'repair' });
  assert.equal(b.health, HEALTH_MAX);
});

test('los que terminaron no pueden ser blanco ni disparar', () => {
  const { pm, c } = setup();
  pm.addPlayer('a');
  pm.addPlayer('b');
  place(pm, c, 'a', 300);
  place(pm, c, 'b', 340);
  give(pm, 'b', 'nitro');
  pm.setRace('b', 30, true);
  assert.deepEqual(pm.inventoryOf('b'), []);
  assert.equal(pm.applyHit('b', 'bolt', 'a', [0, 0, 1], c.t), false);
  give(pm, 'a', 'shunt');
  pm.drain();
  pm.fire('a', { slot: 0, type: 'shunt' });
  assert.equal(pm.drain().find((e) => e.k === 'spawn').p.target, null);
});

test('un icono por grupo y pasada; la mina no se gasta con un coche invulnerable', () => {
  const { pm, c } = setup();
  pm.addPlayer('a');
  pm.addPlayer('b');
  const [p0, p1] = pm.pads.filter((p) => p.cluster === 0);
  place(pm, c, 'a', p0.s, p0.lateral);
  assert.equal(pm.pickup('a', p0.id), true);
  place(pm, c, 'a', p1.s, p1.lateral);
  assert.equal(pm.pickup('a', p1.id), false, 'mismo grupo en la misma pasada');

  place(pm, c, 'b', 600, 0);
  give(pm, 'b', 'mine');
  pm.fire('b', { slot: 0, type: 'mine', back: true });
  c.t += 4000;
  pm.players.get('a').immuneUntil = c.t + 5000;
  place(pm, c, 'a', 590, 0);
  place(pm, c, 'a', 600, 0);
  assert.equal([...pm.projectiles.values()].filter((p) => p.type === 'mine').length, 1);
});

test('la mina propia no detiene el misil propio', () => {
  const { pm, c } = setup();
  pm.addPlayer('a');
  pm.addPlayer('b');
  const cars = [{ id: 'a', s: 300, speed: 0 }, { id: 'b', s: 420, speed: 0 }];
  drive(pm, c, cars, 100);
  give(pm, 'a', 'mine');
  pm.fire('a', { slot: 0, type: 'mine' });
  drive(pm, c, cars, 1000);
  give(pm, 'a', 'shunt');
  pm.drain();
  pm.fire('a', { slot: 0, type: 'shunt' });
  drive(pm, c, cars, 2500);
  assert.ok(pm.drain().some((e) => e.k === 'hit' && e.victim === 'b'));
});
