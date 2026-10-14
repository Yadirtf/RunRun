import * as THREE from 'three';
import { POWERUPS } from '@runrun/shared/powerups';
import { POWER_ICON_PATHS } from '../../components/powerIcons.js';
import { softDotTexture } from '../textures.js';

const icons = new Map();

/**
 * Icono de un poder como textura: disco oscuro con borde de color y el
 * pictograma (el mismo trazado SVG que el HUD) en blanco con brillo.
 */
export function iconTexture(type) {
  if (icons.has(type)) return icons.get(type);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const color = POWERUPS[type]?.color ?? '#ffffff';
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c * 0.8, 10, c, c, c);
  g.addColorStop(0, 'rgba(40,44,60,0.95)');
  g.addColorStop(1, 'rgba(8,9,14,0.92)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, c - 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 22;
  ctx.stroke();
  const scale = (size * 0.5) / 24;
  ctx.save();
  ctx.translate(c - 12 * scale, c - 12 * scale);
  ctx.scale(scale, scale);
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fill(new Path2D(POWER_ICON_PATHS[type] ?? ''), 'evenodd');
  ctx.restore();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  icons.set(type, tex);
  return tex;
}

/** Halo luminoso aditivo (supera el umbral del bloom con `intensity` > 1). */
export function glowMaterial(color, intensity = 2) {
  return new THREE.SpriteMaterial({
    map: softDotTexture(),
    color: new THREE.Color(color).multiplyScalar(intensity),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

/** Geometrías y materiales compartidos por todos los poderes de una carrera. */
export function createVisualKit() {
  const missile = new THREE.CapsuleGeometry(0.22, 1.1, 4, 10);
  missile.rotateX(Math.PI / 2);
  const bolt = new THREE.CapsuleGeometry(0.14, 2.2, 3, 8);
  bolt.rotateX(Math.PI / 2);
  const mine = new THREE.CylinderGeometry(0.55, 0.7, 0.28, 16);
  const dome = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const domeWire = new THREE.IcosahedronGeometry(1, 2);
  const bubble = new THREE.SphereGeometry(1, 32, 18);
  bubble.scale(1.55, 1.15, 2.85);
  const padRing = new THREE.RingGeometry(1.5, 1.85, 40);
  const beam = new THREE.CylinderGeometry(0.08, 0.5, 6, 10, 1, true);
  const wave = new THREE.RingGeometry(0.8, 1, 56);

  const missileMat = new THREE.MeshStandardMaterial({
    color: '#2b2d33', metalness: 0.8, roughness: 0.3, emissive: new THREE.Color(POWERUPS.shunt.color), emissiveIntensity: 1.6,
  });
  const mineMat = new THREE.MeshStandardMaterial({
    color: '#1d1f24', metalness: 0.7, roughness: 0.4, emissive: new THREE.Color(POWERUPS.mine.color), emissiveIntensity: 0.35,
  });
  const geometries = [missile, bolt, mine, dome, domeWire, bubble, padRing, beam, wave];
  const shared = new Set([missileMat, mineMat]);
  return {
    missile, bolt, mine, dome, domeWire, bubble, padRing, beam, wave,
    missileMat, mineMat, shared,
    dispose() {
      geometries.forEach((g) => g.dispose());
      shared.forEach((m) => m.dispose());
      icons.forEach((t) => t.dispose());
      icons.clear();
    },
  };
}
