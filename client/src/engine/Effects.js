// Marcas de neumático en el asfalto y humo al derrapar.
import * as THREE from 'three';

const MAX_MARKS = 4000;
const MAX_SMOKE = 220;

export class Effects {
  constructor(scene) {
    this.scene = scene;

    // Marcas: quads instanciados en un búfer circular.
    const markGeo = new THREE.PlaneGeometry(0.26, 1);
    markGeo.rotateX(-Math.PI / 2);
    this.markMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.marks = new THREE.InstancedMesh(markGeo, this.markMat, MAX_MARKS);
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 1;
    scene.add(this.marks);
    this.markIndex = 0;
    this.lastMark = new Map(); // clave de rueda -> Vector3

    // Humo: sprites con textura radial generada.
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(235,235,235,0.9)');
    grad.addColorStop(0.5, 'rgba(210,210,210,0.35)');
    grad.addColorStop(1, 'rgba(200,200,200,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.smokeTex = new THREE.CanvasTexture(c);
    this.smoke = [];
    for (let i = 0; i < MAX_SMOKE; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.smoke.push({ sprite: s, life: 0, max: 1, vel: new THREE.Vector3() });
    }
    this.smokeIndex = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  /** Llamar por cada rueda en contacto. `key` identifica la rueda (coche+índice). */
  wheel(key, contact, slip, onAsphalt, dt) {
    const last = this.lastMark.get(key);
    if (!onAsphalt || slip < 0.3) { this.lastMark.delete(key); }
    else if (!last) { this.lastMark.set(key, contact.clone()); }
    else {
      const d = last.distanceTo(contact);
      if (d > 0.6) {
        if (d < 4) this.#addMark(last, contact);
        last.copy(contact);
      }
    }
    if (slip > 0.35 && Math.random() < slip * dt * 30) this.#addSmoke(contact, slip);
  }

  #addMark(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    this._p.set((a.x + b.x) / 2, 0.045, (a.z + b.z) / 2);
    this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(dx, dz));
    this._s.set(1, 1, len + 0.05);
    this._m.compose(this._p, this._q, this._s);
    this.marks.setMatrixAt(this.markIndex, this._m);
    this.markIndex = (this.markIndex + 1) % MAX_MARKS;
    this.marks.count = Math.min(this.marks.count + 1, MAX_MARKS);
    this.marks.instanceMatrix.needsUpdate = true;
  }

  #addSmoke(pos, slip) {
    const p = this.smoke[this.smokeIndex];
    this.smokeIndex = (this.smokeIndex + 1) % MAX_SMOKE;
    p.sprite.position.copy(pos);
    p.sprite.position.y = 0.3;
    p.sprite.visible = true;
    p.life = 0;
    p.max = 1.2 + slip * 1.4;
    p.vel.set((Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.5);
    p.base = 0.9 + slip * 0.9;
  }

  update(dt) {
    for (const p of this.smoke) {
      if (!p.sprite.visible) continue;
      p.life += dt;
      const t = p.life / p.max;
      if (t >= 1) { p.sprite.visible = false; continue; }
      p.sprite.position.addScaledVector(p.vel, dt);
      const s = p.base * (1 + t * 3.5);
      p.sprite.scale.set(s, s, s);
      p.sprite.material.opacity = 0.45 * (1 - t) * Math.min(1, t * 6);
    }
  }

  dispose() {
    this.marks.geometry.dispose();
    this.markMat.dispose();
    this.marks.removeFromParent();
    this.smokeTex.dispose();
    for (const p of this.smoke) { p.sprite.material.dispose(); p.sprite.removeFromParent(); }
  }
}
