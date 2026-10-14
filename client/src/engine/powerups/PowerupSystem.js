import * as THREE from 'three';
import { projectToTrack } from '@runrun/shared/trackPath';
import {
  POWERUPS, MAX_SLOTS, PAD_RADIUS, NITRO_MS, NITRO_BRAKE_MS, SHIELD_MS, CLIENT_FIRE_INTERVAL_MS, CLUSTER_LOCK_MS,
  SHOCK_RADIUS, BARGE_RADIUS, HEALTH_MAX,
  powerupPads, trackPoint, trackTangent, deltaS, boltPosition, shuntTravel, sweptDistance,
} from '@runrun/shared/powerups';
import { iconTexture, glowMaterial, createVisualKit } from './powerupVisuals.js';

const FEED_MS = 3800;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/**
 * Poderes en el cliente: dibuja los iconos de la pista, los proyectiles y los
 * efectos; detecta cuándo el coche pasa por un icono y pide la recogida;
 * dispara desde el inventario; y traduce los impactos que decide el servidor
 * en la reacción física del coche propio (vía `host.applyLocalHit`).
 *
 * `host` es el GameEngine: aporta escena, trazado, red, audio, partículas y
 * el estado de cada coche (`carState(id)`).
 */
export class PowerupSystem {
  constructor(host) {
    this.host = host;
    this.scene = host.scene;
    this.path = host.path;
    this.myId = host.opts.myId;
    this.serverNow = host.opts.serverNow;
    this.kit = createVisualKit();
    this.group = new THREE.Group();
    this.group.name = 'powerups';
    this.scene.add(this.group);

    this.items = [];
    /** Recogidas pedidas y aún sin confirmar: `{type, pad, until}`. */
    this.pendingItems = [];
    this.lastCluster = { id: -1, until: 0 };
    this.prevPos = null;
    this.selected = 0;
    this.health = HEALTH_MAX;
    this.shieldUntil = 0;
    this.boostUntil = 0;
    this.fireLock = 0;
    this.feed = [];
    this.flash = null;
    this.projectiles = new Map();
    this.shields = new Map();
    this.nitros = new Map();
    this.zaps = new Map();
    this.wrecks = new Map();
    this.fx = [];
    this.warnings = [];
    this.time = 0;

    this.pads = powerupPads(host.trackDef, this.path).map((pad) => this.createPad(pad));
  }

  // -------------------------------------------------------------------------
  // Iconos en la pista
  // -------------------------------------------------------------------------

  createPad(pad) {
    const color = new THREE.Color(POWERUPS[pad.type].color);
    const root = new THREE.Group();
    root.position.set(pad.position[0], pad.position[1], pad.position[2]);
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(pad.type), transparent: true, depthWrite: false, toneMapped: false }));
    icon.material.color.setScalar(1.35);
    icon.scale.setScalar(1.7);
    const halo = new THREE.Sprite(glowMaterial(color, 1.6));
    halo.scale.setScalar(3.6);
    halo.renderOrder = -1;
    // Anillo en el asfalto y haz de luz: el icono se localiza de lejos.
    const ring = new THREE.Mesh(this.kit.padRing, new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(1.6), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -pad.position[1] + trackPoint(this.path, pad.s, pad.lateral)[1] + 0.06;
    const beam = new THREE.Mesh(this.kit.beam, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    beam.position.y = ring.position.y + 3;
    root.add(halo, icon, ring, beam);
    this.group.add(root);
    return { ...pad, until: 0, pendingUntil: 0, root, icon, halo, ring, beam, shown: 1 };
  }

  updatePads(dt, now, me) {
    this.pendingItems = this.pendingItems.filter((p) => p.until > now);
    const free = MAX_SLOTS - this.items.length - this.pendingItems.length;
    // Prueba con el segmento recorrido desde el fotograma anterior: a 30 fps y
    // 70 m/s el coche avanza más de 2 m por fotograma y podría saltarse un icono.
    const from = this.prevPos && me ? this.prevPos : null;
    const cur = me ? [me.x, me.y, me.z] : null;
    this.prevPos = cur;
    for (const pad of this.pads) {
      const active = now >= pad.until && now >= pad.pendingUntil;
      // Reaparición con "pop" de escala.
      pad.shown = active ? Math.min(1, pad.shown + dt * 3) : 0;
      const k = easeOutBack(pad.shown);
      const bob = Math.sin(this.time * 2.4 + pad.id) * 0.15;
      pad.icon.visible = pad.halo.visible = pad.shown > 0;
      pad.icon.scale.setScalar(1.7 * k);
      pad.icon.position.y = bob;
      pad.icon.material.rotation = Math.sin(this.time * 1.6 + pad.id) * 0.12;
      pad.halo.scale.setScalar(3.6 * k * (1 + Math.sin(this.time * 4 + pad.id) * 0.06));
      pad.halo.position.y = bob;
      pad.ring.material.opacity = active ? 0.55 + Math.sin(this.time * 3 + pad.id) * 0.2 : 0.12;
      pad.beam.visible = active;

      if (!active || free <= 0 || !cur) continue;
      if (pad.cluster === this.lastCluster.id && now < this.lastCluster.until) continue;
      const seg = from && Math.hypot(cur[0] - from[0], cur[2] - from[2]) < 10 ? from : cur;
      if (sweptDistance(seg, cur, pad.position, pad.position) < PAD_RADIUS && Math.abs(me.y - pad.position[1]) < 3.5) {
        // Predicción: se oculta ya y se reserva hueco; el servidor confirma.
        pad.pendingUntil = now + 900;
        this.pendingItems.push({ type: pad.type, pad: pad.id, until: now + 900 });
        this.lastCluster = { id: pad.cluster, until: now + CLUSTER_LOCK_MS };
        this.host.opts.net.pickupPowerup?.(pad.id);
        this.host.audio?.sfx('pickup');
        this.burst(pad.position, POWERUPS[pad.type].color, 18, 5);
        navigator.vibrate?.(12);
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Inventario y disparo
  // -------------------------------------------------------------------------

  setInventory(items) {
    this.items = items.filter((i) => POWERUPS[i.type]);
    if (this.selected >= this.items.length) this.selected = Math.max(0, this.items.length - 1);
  }

  cycle() {
    if (this.items.length < 2) return;
    this.selected = (this.selected + 1) % this.items.length;
    this.host.audio?.sfx('cycle');
  }

  select(slot) {
    if (slot >= 0 && slot < this.items.length) this.selected = slot;
  }

  /** Dispara el poder seleccionado hacia delante o hacia atrás. */
  fire(back = false) {
    const now = this.serverNow();
    const item = this.items[this.selected];
    if (!item || now < this.fireLock || !this.host.canUsePower()) return;
    this.fireLock = now + CLIENT_FIRE_INTERVAL_MS;
    const v = this.host.vehicle;
    const p = v.position;
    const f = v.localToWorld({ x: 0, y: 0, z: 1 });
    this.host.opts.net.firePowerup?.({
      slot: this.selected,
      type: item.type,
      back,
      origin: { x: p.x, y: p.y, z: p.z },
      forward: { x: f.x, z: f.z },
    });
    // Predicción local de lo que no admite espera: nitro y escudo.
    if (item.type === 'nitro') this.startNitro(this.myId, back, now + (back ? NITRO_BRAKE_MS : NITRO_MS), true);
    if (item.type === 'shield') this.addShield(this.myId, now + SHIELD_MS);
    this.host.audio?.sfx(item.type === 'nitro' ? 'nitro' : item.type === 'shield' ? 'shield' : 'fire');
    item.charges -= 1;
    if (item.charges <= 0) this.items.splice(this.selected, 1);
    if (this.selected >= this.items.length) this.selected = Math.max(0, this.items.length - 1);
  }

  // -------------------------------------------------------------------------
  // Eventos del servidor
  // -------------------------------------------------------------------------

  onEvents(events) {
    for (const e of events) {
      switch (e.k) {
        case 'pad': {
          const pad = this.pads[e.pad];
          if (pad) {
            pad.until = e.until;
            pad.pendingUntil = 0;
            // Confirmada: el poder ya viene (o vendrá) en el inventario.
            if (e.by === this.myId) this.pendingItems = this.pendingItems.filter((p) => p.pad !== e.pad);
            if (e.by !== this.myId) this.burst(pad.position, POWERUPS[pad.type].color, 12, 4);
          }
          break;
        }
        case 'spawn': this.spawn(e.p); break;
        case 'gone': this.gone(e); break;
        case 'hit': this.onHit(e); break;
        case 'blocked': this.onBlocked(e); break;
        case 'effect': this.onEffect(e); break;
        case 'barge': this.shockwave([e.x, e.y, e.z]); break;
        case 'status':
          if (e.player === this.myId) this.health = e.health;
          break;
        case 'shocked': {
          const pr = this.projectiles.get(e.id);
          if (pr) pr.flashAt = this.time;
          break;
        }
        default:
      }
    }
  }

  spawn(d) {
    if (this.projectiles.has(d.id)) return;
    const kit = this.kit;
    const color = new THREE.Color(POWERUPS[d.type].color);
    const obj = new THREE.Group();
    const pr = { d, obj, color, lateral: d.lateral ?? 0, hint: -1, flashAt: -10 };
    if (d.type === 'shunt') {
      const body = new THREE.Mesh(kit.missile, kit.missileMat);
      const glow = new THREE.Sprite(glowMaterial(color, 4));
      glow.scale.setScalar(2.6);
      obj.add(body, glow);
    } else if (d.type === 'bolt') {
      const core = new THREE.Mesh(kit.bolt, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(3), toneMapped: false }));
      const glow = new THREE.Sprite(glowMaterial(color, 3));
      glow.scale.set(2.2, 2.2, 1);
      obj.add(core, glow);
    } else if (d.type === 'mine') {
      const disc = new THREE.Mesh(kit.mine, kit.mineMat);
      const light = new THREE.Sprite(glowMaterial(color, 3));
      light.scale.setScalar(1.6);
      light.position.y = 0.35;
      obj.add(disc, light);
      pr.light = light;
    } else if (d.type === 'shock') {
      pr.domes = d.domes.map((dome) => {
        const g = new THREE.Group();
        g.position.set(dome.x, dome.y, dome.z);
        const shell = new THREE.Mesh(kit.dome, new THREE.MeshBasicMaterial({
          color: color.clone().multiplyScalar(1.4), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
        }));
        shell.scale.setScalar(SHOCK_RADIUS);
        const wire = new THREE.Mesh(kit.domeWire, new THREE.MeshBasicMaterial({
          color: color.clone().multiplyScalar(2.2), wireframe: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }));
        wire.scale.setScalar(SHOCK_RADIUS * 1.01);
        const bolt = new THREE.Mesh(kit.beam, new THREE.MeshBasicMaterial({
          color: color.clone().multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }));
        bolt.scale.set(0.6, 6, 0.6);
        bolt.position.y = 18;
        g.add(shell, wire, bolt);
        obj.add(g);
        return { g, shell, wire, bolt };
      });
      if (d.target === this.myId) this.host.audio?.sfx('warn');
    }
    this.group.add(obj);
    this.projectiles.set(d.id, pr);
    this.updateProjectile(pr, 0, this.serverNow());
    if (d.type === 'shunt' && d.target === this.myId) this.host.audio?.sfx('warn');
  }

  gone(e) {
    const pr = this.projectiles.get(e.id);
    if (!pr) return;
    this.removeProjectile(pr);
    if (e.reason === 'hit') return; // la explosión la dibuja el impacto
    const big = pr.d.type === 'shunt' || pr.d.type === 'mine';
    this.explosion([e.x, e.y, e.z], pr.d.type, big ? 1 : 0.5);
    if (e.reason !== 'expired') this.host.audio?.sfx('explode', big ? 0.6 : 0.3, this.distanceTo(e));
  }

  removeProjectile(pr) {
    this.projectiles.delete(pr.d.id);
    pr.obj.removeFromParent();
    pr.obj.traverse((o) => {
      if (o.material && !this.kit.shared.has(o.material)) o.material.dispose();
    });
  }

  onHit(e) {
    const car = this.host.carState(e.victim);
    const at = car ? [car.position.x, car.position.y + 0.6, car.position.z] : null;
    if (at) this.explosion(at, e.type, e.type === 'shunt' || e.type === 'mine' || e.wrecked ? 1 : 0.6);
    if (e.type === 'shock' && car) this.zaps.set(e.victim, this.time + 1.2);
    this.host.flipCar?.(e.victim, e.wrecked ? 'wreck' : e.type);
    if (e.wrecked) this.wrecks.set(e.victim, this.time + 2.4);

    const name = (id) => (id === this.myId ? 'Tú' : this.host.nameOf(id));
    const label = POWERUPS[e.type].name;
    if (e.victim === this.myId) {
      this.health = e.health;
      this.flash = { type: e.type, at: performance.now() };
      this.host.applyLocalHit(e);
      this.host.audio?.sfx('explode', 0.9);
      this.say(e.wrecked ? `¡Destrozado por ${name(e.attacker)}!` : `${name(e.attacker)} te dio con ${label} (−${e.damage})`, 'bad');
    } else {
      this.host.audio?.sfx('explode', 0.5, at ? this.distanceTo({ x: at[0], z: at[2] }) : 60);
      if (e.attacker === this.myId) {
        this.host.audio?.sfx('confirm');
        this.say(e.wrecked ? `¡Destrozaste a ${name(e.victim)}!` : `¡${label} a ${name(e.victim)}!`, 'good');
      } else if (e.wrecked) {
        this.say(`${name(e.attacker)} destrozó a ${name(e.victim)}`, 'info');
      }
    }
  }

  onBlocked(e) {
    const car = this.host.carState(e.victim);
    if (car) this.burst([car.position.x, car.position.y + 0.6, car.position.z], POWERUPS.shield.color, 30, 7);
    const shield = this.shields.get(e.victim);
    if (e.broke && shield) shield.until = this.time + 0.15;
    if (e.victim === this.myId) {
      if (e.broke) this.shieldUntil = 0;
      this.host.audio?.sfx('block');
      this.say(`Escudo: bloqueado ${POWERUPS[e.type].name}${e.broke ? ' (roto)' : ''}`, 'good');
    } else if (e.attacker === this.myId) {
      this.say(`${this.host.nameOf(e.victim)} bloqueó tu ${POWERUPS[e.type].name}`, 'info');
    }
  }

  onEffect(e) {
    if (e.type === 'shield') this.addShield(e.player, e.until);
    else if (e.type === 'nitro' || e.type === 'nitro_brake') this.startNitro(e.player, e.type === 'nitro_brake', e.until, false);
    else if (e.type === 'repair') {
      const car = this.host.carState(e.player);
      if (car) this.burst([car.position.x, car.position.y + 0.5, car.position.z], POWERUPS.repair.color, 40, 3, 2.5);
      if (e.player === this.myId) this.host.audio?.sfx('repair');
    }
  }

  addShield(id, until) {
    const remain = (until - this.serverNow()) / 1000;
    if (remain <= 0) return;
    if (id === this.myId) this.shieldUntil = until;
    let sh = this.shields.get(id);
    if (!sh) {
      const mesh = new THREE.Mesh(this.kit.bubble, shieldMaterial(POWERUPS.shield.color));
      this.group.add(mesh);
      sh = { mesh, until: 0, born: this.time };
      this.shields.set(id, sh);
    }
    sh.until = this.time + remain;
  }

  startNitro(id, brake, until, local) {
    const remain = (until - this.serverNow()) / 1000;
    if (id === this.myId) {
      // El propio ya se aplicó al disparar (predicción); el eco del servidor no repite.
      if (local) this.host.localNitro(brake, Math.max(0.1, remain));
      if (!brake) this.boostUntil = until;
    }
    this.nitros.set(id, { until: this.time + Math.max(0.1, remain), brake });
  }

  // -------------------------------------------------------------------------
  // Fotograma
  // -------------------------------------------------------------------------

  update(dt, { canPickup }) {
    this.time += dt;
    const now = this.serverNow();
    const me = this.host.carState(this.myId)?.position;
    this.updatePads(dt, now, canPickup ? me : null);
    this.warnings = [];
    for (const pr of [...this.projectiles.values()]) {
      if (now >= pr.d.expires) {
        this.removeProjectile(pr);
        if (pr.d.type === 'bolt') this.burst(pr.obj.position.toArray(), pr.color, 8, 3);
        continue;
      }
      this.updateProjectile(pr, dt, now);
    }
    this.updateCarEffects(dt);
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      if (f.t >= f.dur) {
        f.obj.removeFromParent();
        f.obj.material?.dispose();
        this.fx.splice(i, 1);
      } else {
        f.update(f.t / f.dur);
      }
    }
    const ms = performance.now();
    this.feed = this.feed.filter((f) => f.until > ms);
  }

  updateProjectile(pr, dt, now) {
    const d = pr.d;
    const sparks = this.host.sparks;
    if (d.type === 'shunt') {
      const s = d.s0 + shuntTravel(d, now);
      const target = d.target ? this.host.carState(d.target) : null;
      let blend = 0;
      let remaining = Infinity;
      if (target) {
        const tp = projectToTrack(this.path, target.position.x, target.position.z, pr.hint);
        pr.hint = tp.index;
        remaining = deltaS(this.path, s, tp.s) * d.dir;
        if (remaining < 45) pr.lateral += (tp.lateral - pr.lateral) * Math.min(1, dt * 6);
        if (remaining < 12 && remaining > -4) blend = 1 - Math.max(0, remaining) / 12;
      }
      const [x, y, z] = trackPoint(this.path, s, pr.lateral);
      const pos = tmpV.set(x, y + 0.9 + Math.sin(this.time * 18) * 0.05, z);
      if (blend > 0) pos.lerp(tmpV2.copy(target.position).setY(target.position.y + 0.5), blend);
      const [tx, , tz] = trackTangent(this.path, s);
      pr.obj.position.copy(pos);
      pr.obj.quaternion.setFromUnitVectors(UP_Z, tmpV2.set(tx * d.dir, 0, tz * d.dir));
      this.trail(pos, pr.color, 3, 1.1);
      if (d.target === this.myId && remaining > -4) this.warnings.push({ type: 'shunt', dist: Math.max(0, Math.round(remaining)), dir: d.dir > 0 ? 'back' : 'front' });
    } else if (d.type === 'bolt') {
      const [x, y, z] = boltPosition(d, now);
      pr.obj.position.set(x, y, z);
      pr.obj.quaternion.setFromUnitVectors(UP_Z, tmpV2.set(d.dx, 0, d.dz));
      this.trail(pr.obj.position, pr.color, 2, 0.7);
    } else if (d.type === 'mine') {
      const t = now - d.t0;
      if (d.from && t < 700) {
        const u = Math.max(0, t / 700);
        pr.obj.position.set(
          d.from[0] + (d.x - d.from[0]) * u,
          d.from[1] + (d.y - d.from[1]) * u + 6 * u * (1 - u),
          d.from[2] + (d.z - d.from[2]) * u,
        );
        pr.obj.rotation.x += dt * 9;
      } else {
        pr.obj.position.set(d.x, d.y, d.z);
        pr.obj.rotation.set(0, this.time * 1.5, 0);
      }
      const armed = now >= d.armAt;
      const blink = armed ? (Math.sin(this.time * 14) > 0 ? 1 : 0.25) : 0.4;
      pr.light.material.opacity = blink;
    } else if (d.type === 'shock') {
      const armed = now >= d.armAt;
      const arming = Math.min(1, (now - d.t0) / (d.armAt - d.t0));
      const flash = Math.max(0, 1 - (this.time - pr.flashAt) * 3);
      for (const dome of pr.domes) {
        dome.shell.material.opacity = armed ? 0.22 + Math.random() * 0.12 + flash * 0.4 : 0.05 + arming * 0.1;
        dome.wire.material.opacity = armed ? 0.35 + Math.random() * 0.35 : 0.15 * arming;
        dome.wire.rotation.y += dt * (armed ? 2.5 : 0.8);
        // Rayo que cae del cielo justo al activarse.
        const strike = armed ? Math.max(0, 1 - (now - d.armAt) / 350) : 0;
        dome.bolt.visible = strike > 0;
        dome.bolt.material.opacity = strike;
        if (armed && Math.random() < 0.5) {
          const a = Math.random() * Math.PI * 2;
          const r = SHOCK_RADIUS * Math.sqrt(Math.random());
          sparks.emit({ x: dome.g.position.x + Math.cos(a) * r, y: dome.g.position.y + Math.random() * 1.6, z: dome.g.position.z + Math.sin(a) * r }, {
            color: pr.color, velocity: { x: 0, y: 1.5, z: 0 }, spread: 2, life: 0.35, size: 0.5,
          });
        }
      }
      if (d.target === this.myId && now < d.armAt + 1500) this.warnings.push({ type: 'shock', dist: null, dir: 'front' });
    }
  }

  updateCarEffects(dt) {
    for (const [id, sh] of this.shields) {
      const car = this.host.carState(id);
      if (!car || this.time >= sh.until) {
        sh.mesh.removeFromParent();
        sh.mesh.material.dispose();
        this.shields.delete(id);
        if (id === this.myId) this.shieldUntil = 0;
        continue;
      }
      sh.mesh.position.copy(car.position);
      sh.mesh.position.y += 0.35;
      sh.mesh.quaternion.copy(car.quaternion);
      const fade = Math.min(1, (sh.until - this.time) / 0.4, (this.time - sh.born) / 0.2);
      const pulse = 1 + Math.sin(this.time * 6) * 0.025;
      sh.mesh.scale.setScalar(pulse * (0.7 + 0.3 * fade));
      // Parpadea en el último segundo y medio para avisar de que se acaba.
      const ending = sh.until - this.time < 1.5 && Math.sin(this.time * 20) < 0;
      sh.mesh.material.uniforms.opacity.value = fade * (ending ? 0.35 : 1);
      sh.mesh.material.uniforms.time.value = this.time;
    }
    for (const [id, n] of this.nitros) {
      const car = this.host.carState(id);
      if (!car || this.time >= n.until) {
        this.nitros.delete(id);
        continue;
      }
      const f = tmpV.set(0, 0, 1).applyQuaternion(car.quaternion);
      if (n.brake) {
        // Chispas delante de las ruedas: frenazo nitro.
        for (const side of [-1, 1]) {
          const r = tmpV2.set(side, 0, 0).applyQuaternion(car.quaternion);
          this.host.sparks.emit({ x: car.position.x + f.x * 1.6 + r.x * 0.9, y: car.position.y - 0.3, z: car.position.z + f.z * 1.6 + r.z * 0.9 }, {
            color: NITRO_BRAKE_COLOR, velocity: { x: f.x * 3, y: 0.8, z: f.z * 3 }, spread: 1.2, life: 0.3, size: 0.35,
          });
        }
      } else {
        for (const side of [-0.45, 0.45]) {
          const r = tmpV2.set(side, 0, 0).applyQuaternion(car.quaternion);
          this.host.sparks.emit({ x: car.position.x - f.x * 2.4 + r.x, y: car.position.y - 0.05, z: car.position.z - f.z * 2.4 + r.z }, {
            color: NITRO_COLOR, velocity: { x: -f.x * 8, y: 0.3, z: -f.z * 8 }, spread: 0.6, life: 0.28, size: 0.7,
          });
        }
      }
    }
    for (const [id, until] of this.zaps) {
      const car = this.host.carState(id);
      if (!car || this.time >= until) {
        this.zaps.delete(id);
        continue;
      }
      for (let k = 0; k < 3; k++) {
        this.host.sparks.emit({ x: car.position.x + (Math.random() - 0.5) * 2.2, y: car.position.y + Math.random() * 1.2, z: car.position.z + (Math.random() - 0.5) * 3.6 }, {
          color: SHOCK_COLOR, velocity: { x: 0, y: 0.5, z: 0 }, spread: 3, life: 0.18, size: 0.45,
        });
      }
    }
    for (const [id, until] of this.wrecks) {
      const car = this.host.carState(id);
      if (!car || this.time >= until) {
        this.wrecks.delete(id);
        continue;
      }
      this.host.particles.emit({ x: car.position.x, y: car.position.y + 0.6, z: car.position.z }, {
        color: WRECK_SMOKE, velocity: { x: 0, y: 2.2, z: 0 }, spread: 1, life: 1.6, size: 2.2,
      });
      if (Math.random() < 0.6) {
        this.host.sparks.emit({ x: car.position.x, y: car.position.y + 0.5, z: car.position.z }, {
          color: FIRE_COLOR, velocity: { x: 0, y: 1.8, z: 0 }, spread: 1.2, life: 0.4, size: 1.1,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Efectos
  // -------------------------------------------------------------------------

  trail(pos, color, count, size) {
    for (let k = 0; k < count; k++) {
      this.host.sparks.emit(pos, { color, velocity: { x: 0, y: 0.2, z: 0 }, spread: 0.4, life: 0.35, size });
    }
  }

  burst(at, color, count, speed, size = 0.8) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color).multiplyScalar(1.5);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * Math.PI * 0.5;
      this.host.sparks.emit({ x: at[0], y: at[1], z: at[2] }, {
        color: c, velocity: { x: Math.cos(a) * Math.cos(e) * speed, y: Math.sin(e) * speed + 1, z: Math.sin(a) * Math.cos(e) * speed },
        spread: 1, life: 0.5 + Math.random() * 0.3, size,
      });
    }
  }

  explosion(at, type, scale = 1) {
    const color = new THREE.Color(POWERUPS[type]?.color ?? '#ff8c1a');
    this.burst(at, color.clone().multiplyScalar(2), Math.round(40 * scale), 9 * scale, 1.1);
    this.burst(at, FIRE_COLOR, Math.round(26 * scale), 5 * scale, 1.6);
    for (let k = 0; k < 10 * scale; k++) {
      this.host.particles.emit({ x: at[0], y: at[1], z: at[2] }, { color: WRECK_SMOKE, velocity: { x: 0, y: 1.5, z: 0 }, spread: 3, life: 1.4, size: 2 });
    }
    const flash = new THREE.Sprite(glowMaterial(color, 5));
    flash.position.set(at[0], at[1], at[2]);
    this.group.add(flash);
    this.fx.push({
      obj: flash, t: 0, dur: 0.35,
      update: (u) => {
        flash.scale.setScalar((2 + u * 7) * scale);
        flash.material.opacity = 1 - u;
      },
    });
  }

  shockwave(at) {
    const ring = new THREE.Mesh(this.kit.wave, new THREE.MeshBasicMaterial({
      color: new THREE.Color(POWERUPS.barge.color).multiplyScalar(2), transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at[0], at[1] + 0.3, at[2]);
    this.group.add(ring);
    this.fx.push({
      obj: ring, t: 0, dur: 0.45,
      update: (u) => {
        ring.scale.setScalar(0.5 + easeOut(u) * BARGE_RADIUS);
        ring.material.opacity = 0.9 * (1 - u);
      },
    });
    this.burst([at[0], at[1] + 0.5, at[2]], POWERUPS.barge.color, 50, 14, 1);
    this.host.audio?.sfx('barge', 0.8, this.distanceTo({ x: at[0], z: at[2] }));
  }

  say(text, kind) {
    this.feed.push({ id: Math.random(), text, kind, until: performance.now() + FEED_MS });
    if (this.feed.length > 4) this.feed.shift();
  }

  distanceTo({ x, z }) {
    const me = this.host.carState(this.myId)?.position;
    return me ? Math.hypot(me.x - x, me.z - z) : 0;
  }

  /** Estado para el HUD (React). */
  hudState() {
    const now = this.serverNow();
    return {
      items: this.items.map((i) => ({ type: i.type, charges: i.charges })),
      pending: this.pendingItems.map((p) => p.type),
      selected: this.selected,
      health: this.health,
      shieldMs: Math.max(0, this.shieldUntil - now),
      boostMs: Math.max(0, this.boostUntil - now),
      warnings: this.warnings.slice(0, 2),
      feed: this.feed.map(({ id, text, kind }) => ({ id, text, kind })),
      flash: this.flash,
    };
  }

  dispose() {
    for (const pr of [...this.projectiles.values()]) this.removeProjectile(pr);
    this.group.traverse((o) => {
      if (o.material && !this.kit.shared.has(o.material)) o.material.dispose?.();
    });
    this.group.removeFromParent();
    this.kit.dispose();
  }
}

/**
 * Animación visual del coche al recibir un golpe (el vuelco espectacular del
 * misil): una rotación extra del modelo sobre la pose física, que no afecta a
 * las físicas. Devuelve false cuando termina.
 */
export function applyHitAnim(root, anim, nowSec) {
  if (!anim) return false;
  const spec = HIT_ANIMS[anim.kind];
  if (!spec) return false;
  const u = (nowSec - anim.t0) / spec.dur;
  if (u >= 1 || u < 0) return false;
  const e = easeOut(u);
  tmpV.set(spec.axis[0], spec.axis[1], spec.axis[2]);
  tmpQ.setFromAxisAngle(tmpV, spec.turns * Math.PI * 2 * e * (anim.sign ?? 1));
  root.quaternion.multiply(tmpQ);
  root.position.y += Math.sin(Math.PI * u) * spec.lift;
  return true;
}

const HIT_ANIMS = {
  shunt: { dur: 1.0, axis: [0, 0, 1], turns: 1, lift: 1.6 },
  mine: { dur: 0.9, axis: [1, 0, 0], turns: 1, lift: 1.4 },
  wreck: { dur: 1.2, axis: [0.4, 0, 1], turns: 1.5, lift: 2.2 },
};

function easeOut(u) {
  return 1 - (1 - u) * (1 - u) * (1 - u);
}

function easeOutBack(u) {
  const c = 1.7;
  return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
}

/** Burbuja de escudo: casi transparente de frente y brillante en el borde (fresnel) con bandas que suben. */
function shieldMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color).multiplyScalar(1.8) }, opacity: { value: 1 }, time: { value: 0 } },
    vertexShader: `
      varying vec3 vNormal; varying vec3 vView; varying float vY;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        vY = position.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color; uniform float opacity; uniform float time;
      varying vec3 vNormal; varying vec3 vView; varying float vY;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
        float bands = 0.5 + 0.5 * sin(vY * 9.0 - time * 5.0);
        float a = opacity * (0.04 + rim * 0.75 + bands * rim * 0.25);
        gl_FragColor = vec4(color, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

const UP_Z = new THREE.Vector3(0, 0, 1);
const NITRO_COLOR = new THREE.Color('#2ee88f').multiplyScalar(2.2);
const NITRO_BRAKE_COLOR = new THREE.Color('#ffd23a').multiplyScalar(2);
const SHOCK_COLOR = new THREE.Color('#7cc8ff').multiplyScalar(2.5);
const FIRE_COLOR = new THREE.Color('#ff7a1a').multiplyScalar(2);
const WRECK_SMOKE = new THREE.Color('#2a2a2a');
