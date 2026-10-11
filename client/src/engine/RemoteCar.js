// Coche de otro jugador: interpola entre instantáneas del servidor (con un pequeño retardo)
// y mantiene un cuerpo cinemático para que se pueda chocar contra él.
import * as THREE from 'three';
import { INTERP_DELAY_MS, getCar } from '@ranran/shared';
import { createCarVisual } from './CarModel.js';
import { CarSound } from './Audio.js';

const BUFFER = 30;
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

export class RemoteCar {
  static async create(physics, scene, player, { audio = true } = {}) {
    const def = getCar(player.carId);
    const visual = await createCarVisual(def, player.color);
    return new RemoteCar(physics, scene, player, def, visual, audio);
  }

  constructor(physics, scene, player, def, visual, audio) {
    this.id = player.id;
    this.player = player;
    this.def = def;
    this.visual = visual;
    this.scene = scene;
    this.physics = physics;
    scene.add(visual.root);
    visual.root.visible = false;

    const { RAPIER, world } = physics;
    const b = visual.bounds;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
    const halfX = Math.min((b.max.x - b.min.x) / 2, 1.05) * 0.9;
    const halfZ = ((b.max.z - b.min.z) / 2) * 0.96;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfX, 0.38, halfZ).setTranslation(0, 0.74, (b.max.z + b.min.z) / 2).setFriction(0.25).setRestitution(0.1),
      this.body,
    );

    this.samples = [];
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.speed = 0;
    this.rpm = 900;
    this.slip = 0;
    this.steer = 0;
    this.braking = false;
    this.spin = 0;
    this.hasPose = false;
    this.sound = audio ? new CarSound({ spatial: true, volume: 0.8 }) : null;
    this.wheelRadius = visual.wheels[2]?.radius ?? 0.36;
  }

  /** Añade una muestra recibida en una instantánea del servidor. */
  push(car) {
    if (!car.p || !car.q || !car.ts) return;
    const last = this.samples[this.samples.length - 1];
    if (last && car.ts <= last.t) return;
    this.samples.push({
      t: car.ts,
      p: new THREE.Vector3(car.p[0], car.p[1], car.p[2]),
      q: new THREE.Quaternion(car.q[0], car.q[1], car.q[2], car.q[3]),
      v: car.v ?? 0, st: car.st ?? 0, r: car.r ?? 900, b: !!car.b, sl: car.sl ?? 0,
    });
    if (this.samples.length > BUFFER) this.samples.shift();
  }

  /** Calcula la pose a mostrar para el instante de servidor `serverNow`. */
  update(serverNow, dt) {
    const s = this.samples;
    if (s.length === 0) return;
    const renderTime = serverNow - INTERP_DELAY_MS;
    let a = s[0], b = s[0];
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].t <= renderTime) { a = s[i]; b = s[i + 1] ?? s[i]; break; }
    }
    if (b === a && s.length >= 2 && a === s[s.length - 1]) {
      // Sin datos nuevos: extrapola un poco con la velocidad de las dos últimas muestras.
      const prev = s[s.length - 2];
      const span = Math.max(a.t - prev.t, 1);
      const ahead = Math.min(renderTime - a.t, 250) / span;
      this.position.copy(a.p).lerp(prev.p, -ahead);
      this.quaternion.copy(a.q);
    } else {
      const t = b.t > a.t ? Math.min(Math.max((renderTime - a.t) / (b.t - a.t), 0), 1) : 0;
      this.position.lerpVectors(a.p, b.p, t);
      _qa.copy(a.q); _qb.copy(b.q);
      this.quaternion.slerpQuaternions(_qa, _qb, t);
    }
    const cur = b;
    this.speed = cur.v; this.rpm = cur.r; this.slip = cur.sl; this.steer = cur.st; this.braking = cur.b;
    this.hasPose = true;

    this.spin += (this.speed / this.wheelRadius) * dt;
    const steerAngle = -this.steer * this.def.physics.steerMax * 0.8;
    this.visual.root.visible = true;
    this.visual.root.position.copy(this.position);
    this.visual.root.quaternion.copy(this.quaternion);
    this.visual.setWheels([steerAngle, steerAngle, 0, 0], [this.spin, this.spin, this.spin, this.spin]);
    this.visual.setBraking(this.braking);
    if (this.sound) {
      this.sound.setPosition(this.position.x, this.position.y + 0.5, this.position.z);
      this.sound.update(this.rpm, Math.min(Math.abs(this.speed) / 40, 1) * 0.7, this.slip, this.speed);
    }
  }

  /** Antes de cada paso de física: mueve el cuerpo cinemático a la pose mostrada. */
  syncBody() {
    if (!this.hasPose) return;
    this.body.setNextKinematicTranslation(this.position);
    this.body.setNextKinematicRotation(this.quaternion);
  }

  dispose() {
    this.physics.world.removeRigidBody(this.body);
    this.visual.root.removeFromParent();
    this.visual.dispose();
    this.sound?.dispose();
  }
}
