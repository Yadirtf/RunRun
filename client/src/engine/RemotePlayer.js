import * as THREE from 'three';
import { createCar, poseWheels, disposeCar } from './CarFactory.js';

const INTERP_DELAY_MS = 110;
const BUFFER_SIZE = 8;

/**
 * Vehículo de otro jugador. Guarda las últimas instantáneas recibidas (20 Hz)
 * y dibuja el coche ~110 ms en el pasado interpolando entre las dos que rodean
 * ese instante: movimiento suave aunque lleguen paquetes con jitter. No tiene
 * cuerpo físico: el choque con el coche local lo resuelve carContacts.js con
 * un empuje acotado (un sólido cinemático de masa infinita lanzaba los coches).
 */
export class RemotePlayer {
  constructor({ id, nickname, color, carDef, scene, detail }) {
    this.id = id;
    this.nickname = nickname;
    this.carDef = carDef;
    this.scene = scene;
    this.buffer = [];
    this.position = new THREE.Vector3(0, -100, 0);
    this.quaternion = new THREE.Quaternion();
    this.speed = 0;
    this.spin = 0;
    this.steer = 0;
    this.ready = false;
    /** Velocidad estimada a partir de las instantáneas (m/s), para los choques. */
    this.velocity = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1);

    this.label = makeLabel(nickname, color);
    createCar(carDef, color, { detail: detail === 'high' ? 'low' : detail }).then((car) => {
      if (this.disposed) return disposeCar(car);
      this.car = car;
      car.root.add(this.label);
      this.label.position.set(0, 1.9, 0);
      scene.add(car.root);
      car.root.visible = false;
    });
  }

  pushSnapshot(t, receivedAt) {
    this.buffer.push({ t: receivedAt, ...t });
    if (this.buffer.length > BUFFER_SIZE) this.buffer.shift();
  }

  update(now) {
    const b = this.buffer;
    if (!b.length) return;
    const renderTime = now - INTERP_DELAY_MS;
    let a = b[0];
    let c = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++) {
      if (b[i].t <= renderTime && b[i + 1].t >= renderTime) {
        a = b[i];
        c = b[i + 1];
        break;
      }
    }
    const span = c.t - a.t;
    // Un salto de más de 10 m entre instantáneas es un recolocado en pista: se
    // dibuja ya en su nuevo sitio, sin deslizarlo ni contar ese salto como velocidad.
    const jump = Math.hypot(c.position.x - a.position.x, c.position.y - a.position.y, c.position.z - a.position.z) > 10;
    let k = span > 0 && !jump ? (renderTime - a.t) / span : 1;
    // Extrapolación corta si no llegan paquetes (máx. 1 intervalo).
    k = Math.max(0, Math.min(k, renderTime > c.t ? 1 + Math.min(1, (renderTime - c.t) / 50) * 0.5 : 1));
    const qa = tmpQ.set(a.rotation.x, a.rotation.y, a.rotation.z, a.rotation.w);
    const qc = tmpQ2.set(c.rotation.x, c.rotation.y, c.rotation.z, c.rotation.w);
    this.position.set(
      a.position.x + (c.position.x - a.position.x) * k,
      a.position.y + (c.position.y - a.position.y) * k,
      a.position.z + (c.position.z - a.position.z) * k,
    );
    this.quaternion.slerpQuaternions(qa, qc, Math.min(k, 1));
    this.speed = a.speed + (c.speed - a.speed) * Math.min(k, 1);
    this.steer = a.steer + (c.steer - a.steer) * Math.min(k, 1);
    this.spin = a.wheelRotation + (c.wheelRotation - a.wheelRotation) * Math.min(k, 1);

    if (jump) {
      this.velocity.set(0, 0, 0);
    } else if (span > 0) {
      const s = 1000 / span;
      this.velocity.set((c.position.x - a.position.x) * s, (c.position.y - a.position.y) * s, (c.position.z - a.position.z) * s);
    }
    this.forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.ready = true;

    if (this.car) {
      this.car.root.visible = true;
      this.car.root.position.copy(this.position);
      this.car.root.quaternion.copy(this.quaternion);
      poseWheels(this.car.wheels, this.car.dim, { steer: this.steer, spin: this.spin });
    }
  }

  dispose() {
    this.disposed = true;
    if (this.car) disposeCar(this.car);
    this.label.material.map.dispose();
    this.label.material.dispose();
  }
}

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();

function makeLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 30px Inter, sans-serif';
  const w = Math.min(240, ctx.measureText(text).width + 36);
  ctx.fillStyle = 'rgba(10,10,15,0.65)';
  ctx.beginPath();
  ctx.roundRect((256 - w) / 2, 8, w, 46, 23);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc((256 - w) / 2 + 18, 31, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128 + 8, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sprite.scale.set(3.2, 0.8, 1);
  return sprite;
}
