// Cámara de persecución con muelle suave, FOV dinámico según velocidad y temblor por golpes.
import * as THREE from 'three';

const MODES = [
  { name: 'Persecución', dist: 6.2, height: 2.1, look: 1.0, stiffness: 9 },
  { name: 'Lejana', dist: 9.5, height: 3.2, look: 1.0, stiffness: 7 },
  { name: 'Capó', dist: -0.6, height: 1.25, look: 1.05, stiffness: 40, attached: true },
];

const _target = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _look = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.pos = new THREE.Vector3();
    this.heading = new THREE.Vector3(0, 0, 1);
    this.shake = 0;
    this.initialized = false;
  }

  get modeName() { return MODES[this.mode].name; }

  cycle() { this.mode = (this.mode + 1) % MODES.length; this.initialized = false; }

  /** Vista orbital lenta (menú de selección / espectador). */
  orbit(center, time, radius = 7, height = 2.2) {
    this.camera.position.set(center.x + Math.sin(time * 0.25) * radius, center.y + height, center.z + Math.cos(time * 0.25) * radius);
    this.camera.lookAt(center.x, center.y + 0.6, center.z);
  }

  update(dt, state, impact = 0) {
    const m = MODES[this.mode];
    _fwd.set(0, 0, 1).applyQuaternion(state.quaternion);
    // Dirección suavizada (solo en horizontal) para que la cámara no gire de golpe.
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.copy(this.heading);
    _fwd.normalize();
    if (state.speed < -1 && !m.attached) _fwd.negate();
    if (!this.initialized) this.heading.copy(_fwd);
    const k = 1 - Math.exp(-(m.attached ? 30 : 5) * dt);
    this.heading.lerp(_fwd, k).normalize();

    if (m.attached) {
      _target.set(0, m.height, m.dist).applyQuaternion(state.quaternion).add(state.position);
      this.pos.copy(_target);
      _look.set(0, m.look, 12).applyQuaternion(state.quaternion).add(state.position);
    } else {
      _target.copy(state.position).addScaledVector(this.heading, -m.dist);
      _target.y = state.position.y + m.height;
      if (!this.initialized) this.pos.copy(_target);
      this.pos.lerp(_target, 1 - Math.exp(-m.stiffness * dt));
      _look.copy(state.position).addScaledVector(this.heading, 4);
      _look.y += m.look;
    }
    this.initialized = true;

    this.shake = Math.max(this.shake * Math.exp(-6 * dt), impact);
    const speedShake = Math.min(Math.abs(state.speed) / 90, 1) * 0.02;
    const amp = this.shake * 0.25 + speedShake;
    this.camera.position.copy(this.pos);
    if (amp > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * amp;
      this.camera.position.y += (Math.random() - 0.5) * amp;
    }
    this.camera.lookAt(_look);

    const targetFov = 62 + Math.min(Math.abs(state.speed) / 80, 1) * 16;
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-3 * dt));
    this.camera.updateProjectionMatrix();
  }
}
