import * as THREE from 'three';

/**
 * Cámara en tercera persona: sigue al coche con amortiguación, se aleja y
 * abre el FOV con la velocidad, y se adelanta ligeramente en la dirección de
 * giro. Modos: persecución, persecución lejana y capó.
 */
const MODES = [
  { name: 'chase', distance: 6.4, height: 2.2, look: 1.0 },
  { name: 'far', distance: 9.5, height: 3.4, look: 1.2 },
  { name: 'hood', distance: -0.6, height: 1.05, look: 0.9 },
];

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.position = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.initialized = false;
    this.shake = 0;
    /** Segundos de nitro: abre el FOV para dar sensación de empuje. */
    this.boost = 0;
    this.boostFov = 0;
  }

  cycle() {
    this.mode = (this.mode + 1) % MODES.length;
    this.initialized = false;
  }

  /**
   * @param {THREE.Vector3} carPos
   * @param {THREE.Quaternion} carQuat
   * @param {number} speedKmh
   */
  update(dt, carPos, carQuat, speedKmh, steer = 0) {
    const m = MODES[this.mode];
    const speedT = Math.min(1, speedKmh / 200);
    const forward = tmp.set(0, 0, 1).applyQuaternion(carQuat);
    forward.y *= 0.3;
    forward.normalize();

    const dist = m.distance + (m.distance > 0 ? speedT * 1.6 : 0);
    const desired = tmp2.copy(carPos).addScaledVector(forward, -dist);
    desired.y += m.height - (m.distance > 0 ? speedT * 0.3 : 0);

    const lookAhead = tmp3.copy(carPos).addScaledVector(forward, 4 + speedT * 6);
    lookAhead.y += m.look;
    // Desplazar el punto de mira hacia el interior de la curva.
    const side = tmp4.set(1, 0, 0).applyQuaternion(carQuat);
    lookAhead.addScaledVector(side, steer * 2.5 * speedT);

    if (!this.initialized) {
      this.position.copy(desired);
      this.target.copy(lookAhead);
      this.initialized = true;
    }
    if (m.name === 'hood') {
      this.position.copy(desired);
      this.target.copy(lookAhead);
    } else {
      const k = 1 - Math.exp(-dt * 7);
      this.position.lerp(desired, k);
      this.target.lerp(lookAhead, 1 - Math.exp(-dt * 12));
    }

    this.camera.position.copy(this.position);
    if (this.shake > 0) {
      const s = this.shake * 0.05;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 4);
    }
    this.camera.lookAt(this.target);
    this.boost = Math.max(0, this.boost - dt);
    this.boostFov += ((this.boost > 0 ? 10 : 0) - this.boostFov) * (1 - Math.exp(-dt * (this.boost > 0 ? 6 : 2)));
    const fov = 62 + speedT * 14 + this.boostFov;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
    }
  }

  /** Órbita lenta alrededor de un punto (cuenta atrás / fin de carrera). */
  orbit(dt, center, time, radius = 9) {
    const a = time * 0.25;
    this.position.set(center.x + Math.sin(a) * radius, center.y + 3, center.z + Math.cos(a) * radius);
    this.camera.position.copy(this.position);
    this.camera.lookAt(center.x, center.y + 0.6, center.z);
    this.initialized = false;
  }
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmp3 = new THREE.Vector3();
const tmp4 = new THREE.Vector3();
