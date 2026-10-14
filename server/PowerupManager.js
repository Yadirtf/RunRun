import { buildTrackPath, checkpointGates, projectToTrack } from '@runrun/shared/trackPath';
import {
  POWERUPS, MAX_SLOTS, HEALTH_MAX, PAD_RADIUS, PAD_RESPAWN_MS,
  SHUNT_LIFE_MS, SHUNT_BACK_RANGE, BOLT_RADIUS, BOLT_AIM_DEG, BOLT_SPEED,
  MINE_RADIUS, MINE_ARM_MS, MINE_LIFE_MS, MINE_THROW,
  SHOCK_ARM_MS, SHOCK_LIFE_MS, SHOCK_RADIUS, BARGE_RADIUS,
  SHIELD_MS, NITRO_MS, NITRO_BRAKE_MS, WRECK_MS, HIT_IMMUNE_MS, RESPAWN_IMMUNE_MS, FIRE_COOLDOWN_MS,
  powerupPads, raceProgress, trackPoint, wrapS, deltaS, boltPosition, boltLifetime, shuntTravel,
  shockDomes, sweptDistance,
} from '@runrun/shared/powerups';

/** Medio ancho de un coche: los radios de impacto se miden desde el centro. */
const CAR_RADIUS = 1.1;
/** Cuánto se extrapola la posición de un coche sin transformaciones nuevas. */
const MAX_EXTRAPOLATION_MS = 200;

/**
 * Autoridad de los poderes en una carrera: iconos de la pista, inventario de
 * cada jugador, proyectiles, salud, escudos e impactos. Es dominio puro (sin
 * sockets): las operaciones devuelven resultados y acumulan eventos que la
 * capa de transporte difunde con `drain()`.
 *
 * Los proyectiles siguen trayectorias deterministas (shared/powerups.js), así
 * que basta con anunciar su salida: cada cliente los dibuja con su reloj. Lo
 * que se decide aquí es quién recoge, quién dispara y a quién se impacta.
 */
export class PowerupManager {
  constructor(trackDef, { now = Date.now, random = Math.random } = {}) {
    this.now = now;
    this.random = random;
    this.path = buildTrackPath(trackDef, 2);
    this.gates = checkpointGates(this.path, trackDef.checkpoints);
    this.pads = powerupPads(trackDef, this.path).map((p) => ({ ...p, until: 0 }));
    this.players = new Map();
    this.projectiles = new Map();
    this.nextId = 1;
    this.events = [];
    this.dirtyInventories = new Set();
    this.lastTick = now();
  }

  addPlayer(id) {
    this.players.set(id, {
      id,
      pos: null,
      vel: [0, 0, 0],
      fwd: [0, 0, 1],
      at: 0,
      s: 0,
      lateral: 0,
      hint: -1,
      passed: 0,
      finished: false,
      health: HEALTH_MAX,
      shieldUntil: 0,
      immuneUntil: 0,
      wreckedUntil: 0,
      inventory: [],
      lastFire: 0,
    });
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  /** Checkpoints validados por el servidor: base del progreso de carrera. */
  setRace(id, passed, finished) {
    const p = this.players.get(id);
    if (!p) return;
    p.passed = passed;
    if (finished && !p.finished) {
      p.finished = true;
      p.inventory = [];
      this.dirtyInventories.add(id);
    }
  }

  progressOf(p) {
    return raceProgress(this.path, this.gates, p.passed, p.s);
  }

  /** Posición estimada del coche en el instante `t` (última muestra + velocidad). */
  positionAt(p, t) {
    const dt = Math.max(0, Math.min(MAX_EXTRAPOLATION_MS, t - p.at)) / 1000;
    return [p.pos[0] + p.vel[0] * dt, p.pos[1] + p.vel[1] * dt, p.pos[2] + p.vel[2] * dt];
  }

  alive(p, now) {
    return p.pos && !p.finished && now >= p.wreckedUntil;
  }

  rivals(id, now) {
    return [...this.players.values()].filter((p) => p.id !== id && this.alive(p, now));
  }

  /**
   * Transformación recibida de un jugador (20 Hz). Además de actualizar su
   * posición, comprueba los peligros estáticos (minas y descargas) con el
   * segmento recorrido desde la anterior, para no saltárselos a alta velocidad.
   */
  updateTransform(id, t, now = this.now()) {
    const p = this.players.get(id);
    if (!p) return;
    const pos = [t.position.x, t.position.y, t.position.z];
    const prev = p.pos;
    const dt = (now - p.at) / 1000;
    const teleport = !prev || Math.hypot(pos[0] - prev[0], pos[2] - prev[2]) > 15;
    p.vel = !teleport && dt > 0.005 && dt < 0.5
      ? [(pos[0] - prev[0]) / dt, (pos[1] - prev[1]) / dt, (pos[2] - prev[2]) / dt]
      : [0, 0, 0];
    const q = t.rotation;
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const fl = Math.hypot(fx, fz) || 1;
    p.fwd = [fx / fl, 0, fz / fl];
    p.pos = pos;
    p.at = now;
    const pr = projectToTrack(this.path, pos[0], pos[2], p.hint);
    p.hint = pr.index;
    p.s = pr.s;
    p.lateral = pr.lateral;
    if (!this.alive(p, now)) return;
    this.checkHazards(p, teleport ? pos : prev, pos, now);
  }

  checkHazards(p, from, to, now) {
    for (const pr of [...this.projectiles.values()]) {
      if (pr.type === 'mine') {
        if (now < pr.armAt) continue;
        if (pr.owner === p.id && now - pr.t0 < 3000) continue;
        const at = [pr.x, pr.y, pr.z];
        if (Math.abs(pr.y - to[1]) > 4) continue;
        if (sweptDistance(from, to, at, at) < MINE_RADIUS) {
          this.applyHit(p.id, 'mine', pr.owner, p.fwd, now);
          this.remove(pr, 'hit');
        }
      } else if (pr.type === 'shock') {
        if (now < pr.armAt || pr.owner === p.id || pr.hit.has(p.id)) continue;
        for (const d of pr.domes) {
          const at = [d.x, d.y, d.z];
          if (Math.abs(d.y - to[1]) < 5 && sweptDistance(from, to, at, at) < SHOCK_RADIUS + CAR_RADIUS) {
            pr.hit.add(p.id);
            this.applyHit(p.id, 'shock', pr.owner, p.fwd, now);
            this.events.push({ k: 'shocked', id: pr.id, victim: p.id });
            break;
          }
        }
      }
    }
  }

  /**
   * Petición de recogida: el cliente la detecta al pasar por el icono y el
   * servidor la confirma con su última posición conocida (con margen por la
   * latencia), que el icono siga activo y que quede hueco en el inventario.
   */
  pickup(id, padId, now = this.now()) {
    const p = this.players.get(id);
    const pad = this.pads[padId];
    if (!p || !pad || !this.alive(p, now)) return false;
    if (now < pad.until || p.inventory.length >= MAX_SLOTS) return false;
    const pos = this.positionAt(p, now);
    const speed = Math.hypot(p.vel[0], p.vel[2]);
    const tolerance = PAD_RADIUS + 4 + speed * 0.2;
    if (Math.hypot(pos[0] - pad.position[0], pos[2] - pad.position[2]) > tolerance) return false;
    p.inventory.push({ type: pad.type, charges: POWERUPS[pad.type].charges ?? 1 });
    pad.until = now + PAD_RESPAWN_MS;
    this.dirtyInventories.add(id);
    this.events.push({ k: 'pad', pad: pad.id, by: id, until: pad.until });
    return true;
  }

  /**
   * Disparo del poder en la ranura `slot`. El cliente manda su posición y
   * orientación actuales (más frescas que las del servidor); se aceptan si
   * son coherentes con la última transformación recibida.
   */
  fire(id, { slot, type, back = false, origin, forward } = {}, now = this.now()) {
    const p = this.players.get(id);
    if (!p || !this.alive(p, now)) return false;
    if (now - p.lastFire < FIRE_COOLDOWN_MS) return false;
    const item = p.inventory[slot];
    if (!item || item.type !== type) return false;
    p.lastFire = now;

    let pos = this.positionAt(p, now);
    if (origin && [origin.x, origin.y, origin.z].every(Number.isFinite)) {
      const speed = Math.hypot(p.vel[0], p.vel[2]);
      const o = [origin.x, origin.y, origin.z];
      if (Math.hypot(o[0] - pos[0], o[2] - pos[2]) < 10 + speed * 0.3) pos = o;
    }
    let fwd = p.fwd;
    if (forward && Number.isFinite(forward.x) && Number.isFinite(forward.z)) {
      const l = Math.hypot(forward.x, forward.z);
      const f = l > 0.1 ? [forward.x / l, 0, forward.z / l] : null;
      if (f && f[0] * p.fwd[0] + f[2] * p.fwd[2] > 0.5) fwd = f;
    }
    const pr = projectToTrack(this.path, pos[0], pos[2], p.hint);
    const me = { ...p, pos, fwd, s: pr.s, lateral: pr.lateral };

    item.charges -= 1;
    if (item.charges <= 0) p.inventory.splice(slot, 1);
    this.dirtyInventories.add(id);

    switch (type) {
      case 'shunt': this.fireShunt(me, back, now); break;
      case 'bolt': this.fireBolt(me, back, now); break;
      case 'mine': this.fireMine(me, back, now); break;
      case 'shock': this.fireShock(me, now); break;
      case 'barge': this.fireBarge(me, now); break;
      case 'nitro': this.effect(id, back ? 'nitro_brake' : 'nitro', now + (back ? NITRO_BRAKE_MS : NITRO_MS)); break;
      case 'shield':
        p.shieldUntil = now + SHIELD_MS;
        this.effect(id, 'shield', p.shieldUntil);
        break;
      case 'repair':
        p.health = HEALTH_MAX;
        this.effect(id, 'repair', now);
        this.events.push({ k: 'status', player: id, health: p.health });
        break;
      default: return false;
    }
    return true;
  }

  effect(player, type, until) {
    this.events.push({ k: 'effect', player, type, until });
  }

  add(pr) {
    pr.id = this.nextId++;
    this.projectiles.set(pr.id, pr);
    const { hit, prog0, lastS, ...pub } = pr;
    this.events.push({ k: 'spawn', p: pub });
    return pr;
  }

  remove(pr, reason) {
    if (!this.projectiles.delete(pr.id)) return;
    const at = this.worldPos(pr, this.now());
    this.events.push({ k: 'gone', id: pr.id, reason, x: at[0], y: at[1], z: at[2] });
  }

  worldPos(pr, now) {
    if (pr.type === 'bolt') return boltPosition(pr, Math.min(now, pr.expires));
    if (pr.type === 'shunt') {
      const [x, y, z] = trackPoint(this.path, pr.s0 + shuntTravel(pr, now), pr.lateral);
      return [x, y + 0.8, z];
    }
    if (pr.type === 'shock') return [pr.domes[1].x, pr.domes[1].y, pr.domes[1].z];
    return [pr.x, pr.y, pr.z];
  }

  fireShunt(me, back, now) {
    const myProg = this.progressOf(me);
    let target = null;
    let best = Infinity;
    for (const r of this.rivals(me.id, now)) {
      const gap = (this.progressOf(r) - myProg) * (back ? -1 : 1);
      if (gap <= 0 || (back && gap > SHUNT_BACK_RANGE)) continue;
      if (gap < best) {
        best = gap;
        target = r.id;
      }
    }
    const dir = back ? -1 : 1;
    this.add({
      type: 'shunt',
      owner: me.id,
      target,
      t0: now,
      dir,
      s0: me.s + dir * 4,
      lateral: me.lateral,
      prog0: myProg + dir * 4,
      expires: now + (target ? SHUNT_LIFE_MS : 2500),
    });
  }

  fireBolt(me, back, now) {
    let dx = me.fwd[0] * (back ? -1 : 1);
    let dz = me.fwd[2] * (back ? -1 : 1);
    // Autoapuntado suave: si hay un rival dentro de un cono estrecho, corregir
    // hacia donde estará cuando llegue el rayo.
    const cosMax = Math.cos((BOLT_AIM_DEG * Math.PI) / 180);
    let bestCos = cosMax;
    let best = null;
    for (const r of this.rivals(me.id, now)) {
      const rp = this.positionAt(r, now);
      const dist = Math.hypot(rp[0] - me.pos[0], rp[2] - me.pos[2]);
      if (dist > 150 || dist < 1) continue;
      const lead = dist / BOLT_SPEED;
      const tx = rp[0] + r.vel[0] * lead - me.pos[0];
      const tz = rp[2] + r.vel[2] * lead - me.pos[2];
      const tl = Math.hypot(tx, tz);
      const c = (tx * dx + tz * dz) / tl;
      if (c > bestCos) {
        bestCos = c;
        best = [tx / tl, tz / tl];
      }
    }
    if (best) [dx, dz] = best;
    const bolt = {
      type: 'bolt',
      owner: me.id,
      t0: now,
      x: me.pos[0] + dx * 2.6,
      y: me.pos[1] + 0.5,
      z: me.pos[2] + dz * 2.6,
      dx,
      dz,
    };
    bolt.expires = now + boltLifetime(this.path, bolt, projectToTrack);
    this.add(bolt);
  }

  fireMine(me, back, now) {
    const half = this.path.width / 2 - 1.5;
    const lateral = Math.max(-half, Math.min(half, me.lateral));
    const s = back ? me.s - 4.5 : me.s + MINE_THROW;
    const [x, y, z] = trackPoint(this.path, s, lateral);
    this.add({
      type: 'mine',
      owner: me.id,
      t0: now,
      x,
      y: y + 0.15,
      z,
      s: wrapS(this.path, s),
      lateral,
      from: back ? null : [me.pos[0], me.pos[1] + 0.6, me.pos[2]],
      armAt: now + (back ? MINE_ARM_MS : 700),
      expires: now + MINE_LIFE_MS,
    });
  }

  fireShock(me, now) {
    // Contra el rival que mejor va (si el que dispara es el líder, el segundo).
    let target = null;
    let best = -Infinity;
    for (const r of this.rivals(me.id, now)) {
      const pr = this.progressOf(r);
      if (pr > best) {
        best = pr;
        target = r;
      }
    }
    const t = target ?? me;
    const speed = Math.hypot(t.vel[0], t.vel[2]);
    const s = t.s + Math.max(60, speed * 2.4);
    const seed = Math.floor(this.random() * 1000);
    this.add({
      type: 'shock',
      owner: me.id,
      target: target?.id ?? null,
      t0: now,
      s: wrapS(this.path, s),
      domes: shockDomes(this.path, s, seed),
      armAt: now + SHOCK_ARM_MS,
      expires: now + SHOCK_LIFE_MS,
      hit: new Set(),
    });
  }

  fireBarge(me, now) {
    this.effect(me.id, 'barge', now);
    this.events.push({ k: 'barge', player: me.id, x: me.pos[0], y: me.pos[1], z: me.pos[2] });
    for (const r of this.rivals(me.id, now)) {
      const rp = this.positionAt(r, now);
      const dx = rp[0] - me.pos[0];
      const dz = rp[2] - me.pos[2];
      const d = Math.hypot(dx, dz);
      if (d > BARGE_RADIUS || Math.abs(rp[1] - me.pos[1]) > 4) continue;
      this.applyHit(r.id, 'barge', me.id, d > 0.1 ? [dx / d, 0, dz / d] : r.fwd, now);
    }
    // Barrido defensivo: destruye minas y proyectiles enemigos cercanos.
    for (const pr of [...this.projectiles.values()]) {
      if (pr.type === 'shock' || (pr.owner === me.id && pr.type !== 'mine')) continue;
      const at = this.worldPos(pr, now);
      if (Math.hypot(at[0] - me.pos[0], at[2] - me.pos[2]) < BARGE_RADIUS) this.remove(pr, 'barge');
    }
  }

  /**
   * Impacto sobre un jugador. Devuelve true si el proyectil se consume
   * (golpea o lo para un escudo) y false si lo atraviesa (invulnerable).
   */
  applyHit(victimId, type, attackerId, dir, now = this.now()) {
    const v = this.players.get(victimId);
    if (!v || v.finished || now < v.wreckedUntil || now < v.immuneUntil) return false;
    if (now < v.shieldUntil) {
      // El misil es el único golpe que rompe el escudo al pararlo.
      const broke = type === 'shunt';
      if (broke) v.shieldUntil = now;
      this.events.push({ k: 'blocked', victim: victimId, attacker: attackerId, type, broke });
      return true;
    }
    const damage = POWERUPS[type].damage;
    v.health = Math.max(0, v.health - damage);
    v.immuneUntil = now + HIT_IMMUNE_MS;
    const wrecked = v.health === 0;
    if (wrecked) {
      v.wreckedUntil = now + WRECK_MS;
      v.immuneUntil = v.wreckedUntil + RESPAWN_IMMUNE_MS;
      v.shieldUntil = 0;
    }
    this.events.push({
      k: 'hit',
      victim: victimId,
      attacker: attackerId,
      type,
      damage,
      health: v.health,
      dir: [dir[0], dir[2]],
      wrecked,
    });
    return true;
  }

  /** Avance de los proyectiles en vuelo, colisiones entre ellos y reapariciones. */
  tick(now = this.now()) {
    const prev = this.lastTick;
    this.lastTick = now;
    for (const p of this.players.values()) {
      if (p.wreckedUntil && now >= p.wreckedUntil) {
        p.wreckedUntil = 0;
        p.health = HEALTH_MAX;
        this.events.push({ k: 'status', player: p.id, health: p.health });
      }
    }
    for (const pr of [...this.projectiles.values()]) {
      if (!this.projectiles.has(pr.id)) continue;
      if (now >= pr.expires) {
        this.remove(pr, 'expired');
        continue;
      }
      if (pr.type === 'shunt') this.tickShunt(pr, prev, now);
      else if (pr.type === 'bolt') this.tickBolt(pr, prev, now);
    }
  }

  tickShunt(sh, prev, now) {
    const dt = (now - prev) / 1000;
    const prevS = sh.s0 + shuntTravel(sh, prev);
    const travel = shuntTravel(sh, now);
    const s = sh.s0 + travel;
    const prog = sh.prog0 + travel;
    const target = sh.target ? this.players.get(sh.target) : null;

    // Una mina en su camino lo detiene (defensa clásica: soltarla detrás).
    for (const m of this.projectiles.values()) {
      if (m.type !== 'mine' || now < m.armAt) continue;
      const a = deltaS(this.path, prevS, m.s) * sh.dir;
      const span = Math.abs(deltaS(this.path, prevS, s));
      if (a >= -1 && a <= span + 1 && Math.abs(m.lateral - sh.lateral) < 3.2) {
        this.remove(m, 'intercept');
        this.remove(sh, 'intercept');
        return;
      }
    }

    if (target && this.alive(target, now)) {
      const remaining = (this.progressOf(target) - prog) * sh.dir;
      // En la aproximación final se ciñe a la línea del objetivo.
      if (remaining < 45) sh.lateral += (target.lateral - sh.lateral) * Math.min(1, dt * 6);
      if (remaining <= 1.5) {
        this.applyHit(target.id, 'shunt', sh.owner, target.fwd, now);
        this.remove(sh, 'hit');
      }
      return;
    }
    // Sin objetivo (o ya fuera de la carrera): golpea a quien atraviese.
    for (const r of this.rivals(sh.owner, now)) {
      const gap = deltaS(this.path, prevS, r.s) * sh.dir;
      if (gap >= -1 && gap <= Math.abs(deltaS(this.path, prevS, s)) + 1 && Math.abs(r.lateral - sh.lateral) < 2.6) {
        if (this.applyHit(r.id, 'shunt', sh.owner, r.fwd, now)) {
          this.remove(sh, 'hit');
          return;
        }
      }
    }
  }

  tickBolt(b, prev, now) {
    const t0 = Math.max(prev, b.t0);
    const a0 = boltPosition(b, t0);
    const a1 = boltPosition(b, now);
    for (const r of this.rivals(b.owner, now)) {
      const r0 = this.positionAt(r, t0);
      const r1 = this.positionAt(r, now);
      if (Math.abs(r1[1] - a1[1]) > 4) continue;
      if (sweptDistance(a0, a1, r0, r1) < BOLT_RADIUS) {
        if (this.applyHit(r.id, 'bolt', b.owner, [b.dx, 0, b.dz], now)) {
          this.remove(b, 'hit');
          return;
        }
      }
    }
    // Un rayo derriba misiles y minas que se cruce (también los propios no: solo ajenos).
    for (const pr of this.projectiles.values()) {
      if (pr === b || pr.owner === b.owner) continue;
      if (pr.type !== 'shunt' && pr.type !== 'mine') continue;
      const p0 = this.worldPos(pr, t0);
      const p1 = this.worldPos(pr, now);
      if (sweptDistance(a0, a1, p0, p1) < (pr.type === 'shunt' ? 3 : MINE_RADIUS)) {
        this.remove(pr, 'intercept');
        this.remove(b, 'intercept');
        return;
      }
    }
  }

  /** Inventarios que cambiaron desde la última llamada: `[[id, items]]`. */
  drainInventories() {
    const out = [...this.dirtyInventories]
      .filter((id) => this.players.has(id))
      .map((id) => [id, this.inventoryOf(id)]);
    this.dirtyInventories.clear();
    return out;
  }

  inventoryOf(id) {
    const p = this.players.get(id);
    return p ? p.inventory.map(({ type, charges }) => ({ type, charges })) : [];
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
