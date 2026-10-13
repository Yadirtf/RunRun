import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cached, makeCanvas, toTexture, softDotTexture } from '../textures.js';
import { seededRandom } from './noise.js';

/**
 * Elementos construidos del paisaje: casas (mediterráneas o de madera),
 * faro, veleros, rascacielos con ventanas iluminadas, farolas y neones.
 */

function merge(parts) {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  parts.forEach((p) => p.dispose());
  return g;
}

/** Fachada de casa: muro con ventanas con contraventanas y puerta. */
function facadeTexture(style) {
  return cached(`prop:facade:${style}`, () => {
    const W = 256;
    const H = 128;
    const canvas = makeCanvas(W, H);
    const g = canvas.getContext('2d');
    const wall = { med: '#efe9dc', cabin: '#7a5434', chalet: '#8a6240' }[style];
    g.fillStyle = wall;
    g.fillRect(0, 0, W, H);
    if (style !== 'med') {
      // Troncos/tablones horizontales.
      for (let y = 0; y < H; y += 10) {
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(0, y, W, 2);
        g.fillStyle = 'rgba(255,220,180,0.08)';
        g.fillRect(0, y + 2, W, 3);
      }
    } else {
      for (let i = 0; i < 300; i++) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
        g.fillRect(Math.random() * W, Math.random() * H, 3, 3);
      }
    }
    const shutter = style === 'med' ? '#2f6fa8' : '#3b2a1a';
    for (const x of [40, 180]) {
      g.fillStyle = '#20262c';
      g.fillRect(x, 40, 36, 44);
      g.fillStyle = 'rgba(160,190,210,0.5)';
      g.fillRect(x + 3, 43, 30, 18);
      g.fillStyle = shutter;
      g.fillRect(x - 14, 38, 12, 48);
      g.fillRect(x + 38, 38, 12, 48);
      g.fillStyle = style === 'med' ? '#e8e2d2' : '#5a3d24';
      g.fillRect(x - 4, 86, 44, 5);
    }
    g.fillStyle = style === 'med' ? '#5a3b26' : '#3a2616';
    g.fillRect(112, 58, 34, 70);
    return toTexture(canvas);
  });
}

function roofTexture(style) {
  return cached(`prop:roof:${style}`, () => {
    const S = 128;
    const canvas = makeCanvas(S);
    const g = canvas.getContext('2d');
    const [a, b] = style === 'med' ? ['#b4542e', '#8e3f22'] : ['#3a3633', '#2a2725'];
    g.fillStyle = a;
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 8) {
      g.fillStyle = b;
      g.fillRect(0, y, S, 2);
      for (let x = (y / 8) % 2 ? 0 : 8; x < S; x += 16) g.fillRect(x, y, 1.5, 8);
    }
    return toTexture(canvas);
  });
}

/** Casa: muros con fachada y tejado a cuatro aguas (med) o a dos aguas (madera). */
export function houseMeshes(style = 'med') {
  const walls = new THREE.BoxGeometry(1, 1, 1);
  walls.translate(0, 0.5, 0);
  let roof;
  if (style === 'med') {
    roof = new THREE.ConeGeometry(0.78, 0.38, 4, 1);
    roof.rotateY(Math.PI / 4);
    roof.translate(0, 1.19, 0);
  } else {
    const shape = new THREE.Shape();
    shape.moveTo(-0.62, 0);
    shape.lineTo(0, 0.5);
    shape.lineTo(0.62, 0);
    shape.lineTo(-0.62, 0);
    roof = new THREE.ExtrudeGeometry(shape, { depth: 1.15, bevelEnabled: false });
    roof.translate(0, 1, -0.575);
  }
  const wallMat = new THREE.MeshStandardMaterial({ map: facadeTexture(style), roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTexture(style), roughness: 0.85 });
  return { walls: { geometry: walls, material: wallMat }, roof: { geometry: roof, material: roofMat } };
}

/** Faro de franjas con galería y linterna encendida. */
export function lighthouse() {
  const g = new THREE.Group();
  const canvas = makeCanvas(32, 256);
  const c = canvas.getContext('2d');
  for (let i = 0; i < 8; i++) {
    c.fillStyle = i % 2 ? '#c8202a' : '#f4f2ee';
    c.fillRect(0, i * 32, 32, 32);
  }
  const tex = toTexture(canvas);
  const towerMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, 24, 24), towerMat);
  tower.position.y = 12;
  const dark = new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.6, roughness: 0.4 });
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.4, 24), dark);
  gallery.position.y = 24.2;
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 2.6, 16),
    new THREE.MeshStandardMaterial({ color: '#fff7d6', emissive: '#ffe9a8', emissiveIntensity: 2.5, roughness: 0.1 }),
  );
  lamp.position.y = 25.7;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.1, 2, 16), new THREE.MeshStandardMaterial({ color: '#c8202a', roughness: 0.5 }));
  cap.position.y = 28;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.5, 1.6, 20), new THREE.MeshStandardMaterial({ color: '#d9d4c8', roughness: 0.9 }));
  base.position.y = 0.4;
  g.add(tower, gallery, lamp, cap, base);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Velero sencillo: casco, mástil y vela. */
export function sailboat() {
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-1.6, 0);
  hullShape.quadraticCurveTo(-1.6, 3.6, 0, 5.2);
  hullShape.quadraticCurveTo(1.6, 3.6, 1.6, 0);
  hullShape.lineTo(-1.6, 0);
  const hull = new THREE.ExtrudeGeometry(hullShape, { depth: 1.1, bevelEnabled: true, bevelSize: 0.2, bevelThickness: 0.2, bevelSegments: 2 });
  hull.rotateX(-Math.PI / 2);
  hull.translate(0, -0.4, 2.4);
  const mast = new THREE.CylinderGeometry(0.06, 0.08, 9, 6);
  mast.translate(0, 5, 0);
  const sail = new THREE.BufferGeometry();
  sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.4, -0.1, 0, 9.2, 0, 0, 1.4, -3.4], 3));
  sail.computeVertexNormals();
  const hullMat = new THREE.MeshStandardMaterial({ color: '#f6f6f2', roughness: 0.4 });
  const mastMat = new THREE.MeshStandardMaterial({ color: '#b8b8b8', metalness: 0.7, roughness: 0.3 });
  const sailMat = new THREE.MeshStandardMaterial({ color: '#fbfaf5', roughness: 0.8, side: THREE.DoubleSide });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(hull, hullMat), new THREE.Mesh(mast, mastMat), new THREE.Mesh(sail, sailMat));
  return g;
}

/**
 * Rascacielos instanciados (caja unitaria escalada por instancia) con ventanas
 * calculadas en el shader a partir de la posición en el mundo: plantas de
 * 3.6 m, módulos de 3.2 m, ventanas encendidas al azar y bajos comerciales.
 */
export function buildingMaterial({ night = true } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0.2, emissive: '#000000' });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBPos;\nvarying vec3 vBNrm;\nvarying float vBSeed;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 bw = vec4(transformed, 1.0);
        vec3 bnObj = objectNormal;
        #ifdef USE_INSTANCING
          bw = instanceMatrix * bw;
          bnObj = mat3(instanceMatrix) * bnObj;
          vBSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        #else
          vBSeed = 0.5;
        #endif
        vBPos = (modelMatrix * bw).xyz;
        vBNrm = normalize(mat3(modelMatrix) * bnObj);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBPos; varying vec3 vBNrm; varying float vBSeed;
        float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `
        vec3 bn = normalize(vBNrm);
        float roof = step(0.6, abs(bn.y));
        float along = abs(bn.x) > 0.5 ? vBPos.z : vBPos.x;
        vec2 cell = vec2(along / 3.2, vBPos.y / 3.6);
        vec2 id = floor(cell);
        vec2 f = fract(cell);
        float win = step(0.14, f.x) * step(f.x, 0.86) * step(0.22, f.y) * step(f.y, 0.88);
        float ground = 1.0 - step(4.2, vBPos.y);
        float r = bHash(id + vBSeed * 91.0);
        vec3 glass = mix(vec3(0.05, 0.07, 0.09), vec3(0.12, 0.16, 0.2), bHash(id * 1.7));
        vec3 wall = diffuseColor.rgb;
        vec3 facade = mix(wall, glass, win * (1.0 - ground));
        facade = mix(facade, vec3(0.06), ground * 0.7);
        diffuseColor.rgb = mix(facade, vec3(0.09, 0.09, 0.1), roof);
        float bLit = ${night ? '1.0' : '0.0'} * win * (1.0 - ground) * (1.0 - roof) * step(0.62, r);
        vec3 warm = mix(vec3(1.0, 0.78, 0.48), vec3(0.75, 0.88, 1.0), step(0.85, r));
        vec3 shop = mix(vec3(1.0, 0.6, 0.3), vec3(0.4, 0.9, 1.0), bHash(vec2(floor(along / 9.0), vBSeed)));
        vec3 bEmissive = warm * bLit * (0.18 + 0.32 * bHash(id + 3.1))
          + shop * ground * (1.0 - roof) * step(0.8, f.y + 0.3) * ${night ? '0.45' : '0.0'};`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += bEmissive;');
  };
  mat.customProgramCacheKey = () => `building${night}`;
  return mat;
}

/** Farola de dos brazos con globo luminoso. */
export function streetLampMeshes() {
  const pole = new THREE.CylinderGeometry(0.1, 0.16, 9, 8);
  pole.translate(0, 4.5, 0);
  const arm = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6);
  arm.rotateZ(Math.PI / 2);
  arm.translate(-1.2, 8.8, 0);
  const head = new THREE.BoxGeometry(0.9, 0.18, 0.45);
  head.translate(-2.4, 8.75, 0);
  const lens = new THREE.BoxGeometry(0.8, 0.04, 0.38);
  lens.translate(-2.4, 8.64, 0);
  return {
    pole: { geometry: merge([pole, arm, head]), material: new THREE.MeshStandardMaterial({ color: '#3a3e44', metalness: 0.7, roughness: 0.4 }) },
    lens: { geometry: lens, material: new THREE.MeshStandardMaterial({ color: '#fff3d8', emissive: '#ffd9a0', emissiveIntensity: 4 }) },
  };
}

/** Charco de luz en el suelo bajo una farola (sumado al asfalto). */
export function lightPoolMaterial(color = '#ffcf8a', opacity = 0.55) {
  return new THREE.MeshBasicMaterial({
    map: softDotTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });
}

/** Rótulo de neón con texto, fondo oscuro y halo. */
export function neonSign(text, color, seed = 1) {
  return cached(`prop:neon:${text}:${color}`, () => {
    const W = 512;
    const H = 160;
    const canvas = makeCanvas(W, H);
    const g = canvas.getContext('2d');
    const rand = seededRandom(seed);
    g.fillStyle = '#07070a';
    g.fillRect(0, 0, W, H);
    g.font = `bold ${rand() > 0.5 ? 104 : 92}px Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 26;
    g.fillStyle = color;
    g.fillText(text, W / 2, H / 2 + 4);
    g.shadowBlur = 0;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.55;
    g.fillText(text, W / 2, H / 2 + 4);
    return toTexture(canvas);
  });
}
