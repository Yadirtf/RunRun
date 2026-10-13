import * as THREE from 'three';
import { softDotTexture } from './textures.js';

/**
 * Partículas en un único draw call (pool circular de puntos): humo de
 * neumático al derrapar y polvo/tierra al salirse de la pista.
 */
const MAX = 1500;

export class ParticleSystem {
  constructor(scene) {
    this.positions = new Float32Array(MAX * 3).fill(-1e5);
    this.velocities = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX).fill(1);
    this.sizes = new Float32Array(MAX);
    this.alphas = new Float32Array(MAX);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: softDotTexture() }, scale: { value: 400 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying float vAlpha; varying vec3 vColor; uniform float scale;
        void main() {
          vAlpha = alpha; vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying float vAlpha; varying vec3 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.geo = geo;
    scene.add(this.points);
  }

  emit(pos, { color, velocity, spread = 0.6, life = 1.2, size = 1 }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.positions.set([pos.x + (Math.random() - 0.5) * 0.3, pos.y, pos.z + (Math.random() - 0.5) * 0.3], i * 3);
    this.velocities.set([
      velocity.x + (Math.random() - 0.5) * spread,
      velocity.y + Math.random() * spread * 0.6,
      velocity.z + (Math.random() - 0.5) * spread,
    ], i * 3);
    this.colors.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.sizes[i] = size;
  }

  setViewportHeight(h) {
    this.material.uniforms.scale.value = h * 0.5;
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const o = i * 3;
      this.velocities[o] *= 0.97;
      this.velocities[o + 1] = this.velocities[o + 1] * 0.97 + 0.25 * dt;
      this.velocities[o + 2] *= 0.97;
      this.positions[o] += this.velocities[o] * dt;
      this.positions[o + 1] += this.velocities[o + 1] * dt;
      this.positions[o + 2] += this.velocities[o + 2] * dt;
      this.sizes[i] += dt * 2.2;
      this.alphas[i] = Math.sin(Math.PI * Math.min(1, t * 1.2)) * 0.45;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.geo.dispose();
    this.material.dispose();
  }
}
