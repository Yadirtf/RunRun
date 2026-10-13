import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { carDimensions } from './carGeometry.js';
import { softDotTexture } from './textures.js';

/**
 * Modelos de coche. La jerarquía sigue la especificación de assets del README
 * (`chassis`, `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr`), así que un GLB
 * con esos nodos puede sustituir al modelo procedural sin tocar el motor.
 *
 * Estructura devuelta:
 *   root (origen = cuerpo rígido)
 *     chassis (desplazado al suelo)
 *     wheel_xx (pivote de dirección) > spin (giro de rodadura)
 */
export const WHEEL_NAMES = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];

/** Rutas GLB opcionales por modelo, p. ej. { sport: '/assets/cars/car_sport.glb' }. */
export const CAR_GLB = {};

const shared = {};
function sharedMaterials() {
  if (shared.glass) return shared;
  shared.glass = new THREE.MeshPhysicalMaterial({ color: '#0d1117', metalness: 0.2, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.6 });
  shared.trim = new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.55, metalness: 0.3 });
  shared.tire = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.92 });
  shared.rim = new THREE.MeshStandardMaterial({ color: '#c9ccd2', metalness: 0.95, roughness: 0.22 });
  shared.disc = new THREE.MeshStandardMaterial({ color: '#555', metalness: 0.8, roughness: 0.4 });
  shared.chrome = new THREE.MeshStandardMaterial({ color: '#dddddd', metalness: 1, roughness: 0.15 });
  shared.headlight = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6e0', emissiveIntensity: 1.6, roughness: 0.1 });
  shared.caliper = new THREE.MeshStandardMaterial({ color: '#d11f1f', roughness: 0.4, metalness: 0.3 });
  shared.carbon = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.35, metalness: 0.5 });
  shared.lens = new THREE.MeshPhysicalMaterial({ color: '#ffffff', emissive: '#fff3d6', emissiveIntensity: 2.2, roughness: 0.05, clearcoat: 1 });
  shared.shadow = new THREE.MeshBasicMaterial({ map: softDotTexture(), color: '#000', transparent: true, opacity: 0.55, depthWrite: false });
  return shared;
}

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Interpola linealmente una polilínea [[z, y], ...] ordenada por z. */
function profile(points, z) {
  if (z <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [z1, y1] = points[i];
    if (z <= z1) {
      const [z0, y0] = points[i - 1];
      const t = (z - z0) / (z1 - z0);
      return lerp(y0, y1, t * t * (3 - 2 * t));
    }
  }
  return points[points.length - 1][1];
}

/**
 * Superficie "lofteada": secciones transversales superelípticas a lo largo
 * del eje Z. Da carrocerías suaves con normales correctas, cosa que un
 * extruido no consigue.
 * @param {(z: number) => {yb: number, yt: number, w: number, n?: number, taper?: number}} section
 */
function loft(z0, z1, section, { rings = 64, segs = 40, phiFrom = -Math.PI / 2, phiTo = Math.PI * 1.5, closed = true } = {}) {
  const positions = [];
  const indices = [];
  const cols = segs + 1;
  for (let i = 0; i <= rings; i++) {
    const z = lerp(z0, z1, i / rings);
    const { yb, yt, w, n = 4, taper = 0 } = section(z);
    const yc = (yb + yt) / 2;
    const hh = Math.max(0.001, (yt - yb) / 2);
    for (let j = 0; j <= segs; j++) {
      const phi = lerp(phiFrom, phiTo, j / segs);
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      const y = yc + hh * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
      let x = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      x *= 1 - taper * Math.max(0, (y - yc) / hh);
      positions.push(x, y, z);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * cols + j;
      const b = a + cols;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  if (closed) mergeSeam(geo, rings, cols);
  return geo;
}

/** Promedia las normales de la costura del anillo (primer y último punto coinciden). */
function mergeSeam(geo, rings, cols) {
  const n = geo.attributes.normal;
  for (let i = 0; i <= rings; i++) {
    const a = i * cols;
    const b = a + cols - 1;
    const x = n.getX(a) + n.getX(b);
    const y = n.getY(a) + n.getY(b);
    const z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
}

/** Perfil de la carrocería en función de las proporciones del modelo. */
function bodyDesign(dim, body) {
  const L = dim.length;
  const H = dim.height;
  const half = L / 2;
  const zf = dim.wheelBase / 2;
  const wc = dim.wheelRadius;
  const ra = dim.wheelRadius + 0.07;
  const hood = H * (body.hood ?? 0.68);
  const deck = H * (body.deck ?? 0.72);
  const front = L * (body.front ?? 0.17);
  const back = -L * (body.back ?? 0.3);
  const roofLen = L * body.cabinScale * 0.5;
  const wsTop = front - (H - hood) * 2.1;
  const rearTop = Math.min(wsTop - 0.3, Math.max(back + (body.tailDrop ?? 0.15), wsTop - roofLen));
  const top = [
    [-half, deck - 0.2],
    [Math.min(-half + 0.25, back - 0.06), deck - 0.02],
    [back, deck],
    [front, hood + 0.04],
    [Math.max(half - 0.45, front + 0.1), hood - 0.08],
    [half, hood - 0.3],
  ];
  const bottomBase = [
    [-half, 0.36],
    [-half + 0.3, 0.22],
    [half - 0.35, 0.2],
    [half, 0.3],
  ];
  const yt = (z) => {
    let y = profile(top, z);
    // Aletas: la carrocería se abomba sobre cada rueda.
    for (const c of [-zf, zf]) {
      const d = Math.abs(z - c) / (ra + 0.35);
      if (d < 1) y = Math.max(y, wc + ra + 0.06 - d * d * 0.12);
    }
    return y;
  };
  const yb = (z) => {
    let y = profile(bottomBase, z);
    for (const c of [-zf, zf]) {
      const dz = z - c;
      if (Math.abs(dz) < ra) y = Math.max(y, wc + Math.sqrt(ra * ra - dz * dz) * 0.92);
    }
    return y;
  };
  const endRound = (z) => {
    const r = 0.42;
    const d = Math.abs(z) - (half - r);
    return d > 0 ? Math.sqrt(Math.max(0, 1 - (d / r) ** 2)) : 1;
  };
  const halfW = dim.width / 2;
  const widthAt = (z) => halfW * (1 - 0.1 * Math.pow(Math.abs(z) / half, 4)) * endRound(z);
  return { L, H, half, hood, deck, front, back, roofLen, wsTop, rearTop, yt, yb, widthAt, halfW };
}

function roofLine(d, z) {
  const { front, back, rearTop, wsTop, H, yt } = d;
  const base = yt(z) - 0.04;
  if (z >= front || z <= back) return base;
  if (z >= wsTop) return lerp(H, base, smooth(wsTop, front, z) ** 0.8);
  if (z >= rearTop) return H + 0.015 * Math.sin(((z - rearTop) / (wsTop - rearTop)) * Math.PI);
  return lerp(base, H, smooth(back, rearTop, z) ** 0.7);
}

const rimMaterials = {};
function rimMaterial(color) {
  if (!color) return sharedMaterials().rim;
  rimMaterials[color] ??= new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.28 });
  return rimMaterials[color];
}

/** Rueda con neumático de flanco redondeado, pinza de freno y llanta según estilo. */
function buildWheel(dim, body) {
  const m = sharedMaterials();
  const r = dim.wheelRadius;
  const w = 0.27;
  const spin = new THREE.Group();
  spin.name = 'spin';
  // Neumático por revolución: banda de rodadura plana y flancos redondeados.
  const pts = [];
  const ri = r * 0.66;
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    pts.push(new THREE.Vector2(ri + (r - ri) * (0.55 + 0.45 * Math.sin(a)), (-Math.cos(a) * w) / 2));
  }
  const tireGeo = new THREE.LatheGeometry(pts, 32);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, m.tire);
  tire.castShadow = true;
  spin.add(tire);
  const rim = rimMaterial(body.rimColor);
  const style = body.rim ?? 'spoke5';
  const barrelGeo = new THREE.CylinderGeometry(ri, ri, w * 0.92, 28, 1, true);
  barrelGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(barrelGeo, m.trim));
  const face = new THREE.Group();
  face.position.x = 0;
  spin.add(face);
  const discGeo = new THREE.CylinderGeometry(r * 0.46, r * 0.46, w * 0.5, 20);
  discGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(discGeo, m.disc));
  if (style === 'classic') {
    const dishGeo = new THREE.CylinderGeometry(ri * 0.98, ri * 0.8, w + 0.02, 28);
    dishGeo.rotateZ(Math.PI / 2);
    face.add(new THREE.Mesh(dishGeo, m.chrome));
    const ringGeo = new THREE.TorusGeometry(ri * 0.55, 0.02, 6, 24);
    ringGeo.rotateY(Math.PI / 2);
    for (const sx of [-1, 1]) {
      const ring = new THREE.Mesh(ringGeo, m.trim);
      ring.position.x = sx * (w / 2 + 0.012);
      face.add(ring);
    }
  } else {
    const n = style === 'mesh' ? 10 : 5;
    const spokeGeo = new THREE.BoxGeometry(w + 0.04, ri * 1.95, style === 'mesh' ? 0.04 : 0.075);
    for (let i = 0; i < n; i++) {
      const spoke = new THREE.Mesh(spokeGeo, rim);
      spoke.rotation.x = (i / n) * Math.PI + (style === 'mesh' ? 0.15 * (i % 2 ? 1 : -1) : 0);
      face.add(spoke);
    }
    const lipGeo = new THREE.TorusGeometry(ri * 0.97, 0.022, 6, 32);
    lipGeo.rotateY(Math.PI / 2);
    for (const sx of [-1, 1]) {
      const lip = new THREE.Mesh(lipGeo, rim);
      lip.position.x = sx * (w / 2 - 0.01);
      face.add(lip);
    }
  }
  const hubGeo = new THREE.CylinderGeometry(0.07, 0.07, w + 0.06, 10);
  hubGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(hubGeo, style === 'classic' ? m.chrome : rim));
  return spin;
}

/** Pinza de freno: va en el pivote (gira con la dirección pero no rueda). */
function buildCaliper(dim) {
  const m = sharedMaterials();
  const geo = new THREE.BoxGeometry(0.1, 0.16, 0.2);
  const c = new THREE.Mesh(geo, m.caliper);
  c.position.set(0, dim.wheelRadius * 0.28, -dim.wheelRadius * 0.3);
  return c;
}

/** Modelo procedural de un coche con la pintura indicada. */
export function createProceduralCar(def, color) {
  const dim = carDimensions(def);
  const body = def.body;
  const m = sharedMaterials();
  const root = new THREE.Group();
  root.name = `car_${def.id}`;

  const paint = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.55,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.2,
  });
  const tailMat = new THREE.MeshStandardMaterial({ color: '#4a0000', emissive: '#ff1010', emissiveIntensity: 0.6, roughness: 0.2 });
  const reverseMat = new THREE.MeshStandardMaterial({ color: '#cfcfcf', emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.2 });

  const chassis = new THREE.Group();
  chassis.name = 'chassis';
  chassis.position.y = dim.visualOffsetY;
  root.add(chassis);

  const d = bodyDesign(dim, body);
  const bodyGeo = loft(-d.half, d.half, (z) => ({
    yb: d.yb(z),
    yt: d.yt(z),
    w: d.widthAt(z),
    n: 7,
    taper: 0.14,
  }), { rings: 90, segs: 44 });
  const bodyMesh = new THREE.Mesh(bodyGeo, paint);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  chassis.add(bodyMesh);

  // Habitáculo de cristal y techo pintado encima (parabrisas y ventanillas a la vista).
  const cabinSection = (inflate) => (z) => {
    const yb = d.yt(z) - 0.12;
    return { yb, yt: Math.max(yb + 0.01, roofLine(d, z)) + inflate, w: d.widthAt(z) * 0.86 + inflate, n: 3.4, taper: 0.34 };
  };
  const cabin = new THREE.Mesh(loft(d.back, d.front, cabinSection(0), { rings: 50, segs: 36 }), m.glass);
  cabin.castShadow = true;
  chassis.add(cabin);
  const roofGeo = loft(d.rearTop - 0.12, d.wsTop + 0.02, cabinSection(0.012), {
    rings: 24, segs: 18, phiFrom: Math.PI / 2 - 0.85, phiTo: Math.PI / 2 + 0.85, closed: false,
  });
  const roofMesh = new THREE.Mesh(roofGeo, paint);
  roofMesh.castShadow = true;
  chassis.add(roofMesh);
  // Montantes traseros pintados (pilar C) para un perfil de coupé.
  for (const side of [-1, 1]) {
    const pillar = loft(d.back + 0.1, d.rearTop + 0.05, cabinSection(0.008), {
      rings: 16, segs: 6,
      phiFrom: side > 0 ? -0.2 : Math.PI - 0.9,
      phiTo: side > 0 ? 0.9 : Math.PI + 0.2,
      closed: false,
    });
    chassis.add(new THREE.Mesh(pillar, paint));
  }

  // Bajos oscuros: faldones, splitter y difusor.
  const L = dim.length;
  const skirtGeo = new THREE.BoxGeometry(dim.width * 0.9, 0.1, L * 0.86);
  const skirt = new THREE.Mesh(skirtGeo, m.trim);
  skirt.position.y = 0.2;
  chassis.add(skirt);
  const splitW = body.splitter ? dim.width * 0.98 : dim.width * 0.8;
  const splitterGeo = new THREE.BoxGeometry(splitW, 0.05, body.splitter ? 0.45 : 0.3);
  const splitter = new THREE.Mesh(splitterGeo, body.splitter ? m.carbon : m.trim);
  splitter.position.set(0, 0.2, L / 2 - (body.splitter ? 0.3 : 0.4));
  chassis.add(splitter);
  const diffuserGeo = new THREE.BoxGeometry(dim.width * 0.7, 0.12, 0.35);
  const diffuser = new THREE.Mesh(diffuserGeo, m.carbon);
  diffuser.position.set(0, 0.26, -L / 2 + 0.2);
  diffuser.rotation.x = -0.25;
  chassis.add(diffuser);

  // Franjas de carreras sobre el eje central (capó, techo y maletero).
  if (body.stripes) {
    const stripeMat = new THREE.MeshPhysicalMaterial({ color: body.stripes, roughness: 0.3, clearcoat: 1, envMapIntensity: 1.1 });
    root.userData.stripeMat = stripeMat;
    const stripeY = (z) => (z > d.back && z < d.front ? Math.max(d.yt(z), roofLine(d, z)) + 0.016 : d.yt(z) + 0.008);
    for (const side of [-1, 1]) {
      const pos = [];
      const idx = [];
      const rings = 120;
      for (let i = 0; i <= rings; i++) {
        const z = lerp(-d.half + 0.12, d.half - 0.12, i / rings);
        const y = stripeY(z);
        const x0 = side * 0.1;
        const x1 = side * 0.26;
        pos.push(x0, y + 0.004, z, x1, y + 0.004, z);
        if (i < rings) {
          const k = i * 2;
          if (side > 0) idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
          else idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sg.setIndex(idx);
      sg.computeVertexNormals();
      chassis.add(new THREE.Mesh(sg, stripeMat));
    }
  }

  // Faros apoyados sobre la superficie del capó, con su misma inclinación.
  const hlZ = L / 2 - 0.36;
  const hlSlope = Math.atan2(d.yt(hlZ + 0.1) - d.yt(hlZ - 0.1), 0.2);
  const lightGeo = new THREE.BoxGeometry(0.42, 0.03, 0.2);
  const roundGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 20);
  roundGeo.rotateX(Math.PI / 2);
  const tailZ = -L / 2 + 0.24;
  const tailGeo = body.roundLights ? new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16).rotateX(Math.PI / 2) : new THREE.BoxGeometry(0.42, 0.06, 0.05);
  const tailY = d.yt(tailZ) - 0.12;
  for (const side of [-1, 1]) {
    if (body.roundLights) {
      const hl = new THREE.Mesh(roundGeo, m.lens);
      hl.position.set(side * dim.width * 0.32, d.yt(L / 2 - 0.2) - 0.1, L / 2 - 0.14);
      hl.rotation.x = -0.15;
      chassis.add(hl);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.018, 6, 20), m.chrome);
      bezel.position.copy(hl.position).add(new THREE.Vector3(0, 0, 0.02));
      chassis.add(bezel);
    } else {
      const hl = new THREE.Mesh(lightGeo, m.headlight);
      hl.position.set(side * dim.width * 0.29, d.yt(hlZ) - 0.005, hlZ);
      hl.rotation.x = -hlSlope;
      chassis.add(hl);
      // Tira LED diurna bajo el faro.
      const drl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.015, 0.03), m.lens);
      drl.position.set(side * dim.width * 0.3, d.yt(hlZ + 0.12) - 0.05, hlZ + 0.16);
      chassis.add(drl);
    }
    const tl = new THREE.Mesh(tailGeo, tailMat);
    tl.position.set(side * d.widthAt(tailZ - 0.14) * (body.roundLights ? 0.62 : 0.5), tailY, tailZ - 0.14);
    chassis.add(tl);
    // Luz de marcha atrás junto al piloto.
    const rv = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.04), reverseMat);
    rv.position.set(side * d.widthAt(tailZ - 0.14) * (body.roundLights ? 0.36 : 0.22), tailY - 0.02, tailZ - 0.15);
    chassis.add(rv);
    const mirrorGeo = new THREE.BoxGeometry(0.16, 0.09, 0.14);
    const mirror = new THREE.Mesh(mirrorGeo, body.chrome ? m.chrome : paint);
    mirror.position.set(side * (d.widthAt(d.front) * 0.9), d.yt(d.front) + 0.02, d.front - 0.18);
    chassis.add(mirror);
    const exhaustGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.2, 12);
    exhaustGeo.rotateX(Math.PI / 2);
    for (const k of body.wing === 'gt' || body.scoop ? [0.28, 0.42] : [0.35]) {
      const exhaust = new THREE.Mesh(exhaustGeo, m.chrome);
      exhaust.position.set(side * k, 0.3, -L / 2 + 0.16);
      chassis.add(exhaust);
    }
    if (body.intakes) {
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.5), m.carbon);
      const iz = -dim.wheelBase / 2 + 0.75;
      intake.position.set(side * d.widthAt(iz) * 0.985, 0.46, iz);
      chassis.add(intake);
    }
  }
  if (body.chrome) {
    for (const zz of [L / 2 - 0.04, -L / 2 + 0.06]) {
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 0.86, 0.07, 0.08), m.chrome);
      bumper.position.set(0, 0.34, zz);
      chassis.add(bumper);
    }
  }
  const grilleGeo = new THREE.BoxGeometry(dim.width * (body.chrome ? 0.36 : 0.46), 0.14, 0.08);
  const grille = new THREE.Mesh(grilleGeo, body.chrome ? m.chrome : m.trim);
  grille.position.set(0, body.chrome ? 0.46 : 0.36, L / 2 - 0.06);
  chassis.add(grille);
  if (body.scoop) {
    const sz = d.front + (d.half - d.front) * 0.45;
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.7), paint);
    scoop.position.set(0, d.yt(sz) + 0.03, sz);
    chassis.add(scoop);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.02), m.trim);
    mouth.position.set(0, d.yt(sz) + 0.04, sz + 0.36);
    chassis.add(mouth);
  }
  const belt = d.deck;
  const wing = body.wing === true ? 'gt' : body.wing ?? 'none';
  if (wing === 'gt') {
    const ws = body.wingSize ?? 1;
    const wingGeo = new THREE.BoxGeometry(dim.width * 0.94, 0.04, 0.36 * ws);
    const wingMesh = new THREE.Mesh(wingGeo, m.carbon);
    const wy = belt + 0.3 * ws;
    wingMesh.position.set(0, wy, -L / 2 + 0.3);
    wingMesh.rotation.x = 0.14;
    wingMesh.castShadow = true;
    chassis.add(wingMesh);
    const postGeo = new THREE.BoxGeometry(0.03, 0.3 * ws, 0.09);
    const plateGeo = new THREE.BoxGeometry(0.02, 0.2, 0.46 * ws);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, m.carbon);
      post.position.set(side * dim.width * 0.28, belt + 0.15 * ws, -L / 2 + 0.34);
      chassis.add(post);
      const plate = new THREE.Mesh(plateGeo, m.carbon);
      plate.position.set(side * dim.width * 0.47, wy - 0.04, -L / 2 + 0.3);
      chassis.add(plate);
    }
  } else if (wing === 'duck') {
    const lipZ = -L / 2 + 0.2;
    const lip = new THREE.Mesh(new THREE.BoxGeometry(d.widthAt(lipZ) * 1.5, 0.035, 0.18), paint);
    lip.position.set(0, d.yt(lipZ) + 0.04, lipZ);
    lip.rotation.x = 0.35;
    chassis.add(lip);
  } else if (wing === 'roof') {
    const rz = d.rearTop - 0.05;
    const sp = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 0.78, 0.04, 0.32), paint);
    sp.position.set(0, d.H + 0.03, rz);
    sp.rotation.x = 0.18;
    sp.castShadow = true;
    chassis.add(sp);
  }

  // Sombra de contacto suave bajo el coche.
  const blobGeo = new THREE.PlaneGeometry(dim.width * 1.5, dim.length * 1.25);
  blobGeo.rotateX(-Math.PI / 2);
  const blob = new THREE.Mesh(blobGeo, m.shadow);
  blob.position.y = 0.03;
  blob.renderOrder = -1;
  chassis.add(blob);

  const zf = dim.wheelBase / 2;
  const wheels = WHEEL_NAMES.map((name, i) => {
    const pivot = new THREE.Group();
    pivot.name = name;
    const left = i % 2 === 0;
    const front = i < 2;
    pivot.position.set((left ? 1 : -1) * dim.halfTrack, dim.visualOffsetY + dim.wheelRadius, (front ? 1 : -1) * zf);
    const spin = buildWheel(dim, body);
    pivot.add(spin);
    const caliper = buildCaliper(dim);
    caliper.position.x = (left ? -1 : 1) * 0.06;
    pivot.add(caliper);
    root.add(pivot);
    return pivot;
  });

  root.userData = { ...root.userData, paint, tailMat, reverseMat, dim, disposables: [paint, tailMat, reverseMat, root.userData.stripeMat].filter(Boolean) };
  root.traverse((o) => {
    if (o.isMesh && o.geometry && !root.userData.disposables.includes(o.geometry)) root.userData.disposables.push(o.geometry);
  });
  return { root, wheels, tailMat, reverseMat, dim };
}

/** Carga un GLB con nodos chassis/wheel_*; si no hay GLB devuelve el procedural. */
export async function createCar(def, color) {
  const url = CAR_GLB[def.id];
  if (!url) return createProceduralCar(def, color);
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = new THREE.Group();
  const chassis = gltf.scene.getObjectByName('chassis') ?? gltf.scene;
  root.add(gltf.scene);
  gltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const wheels = WHEEL_NAMES.map((n) => {
    const w = gltf.scene.getObjectByName(n);
    const pivot = new THREE.Group();
    pivot.name = n;
    if (w) {
      pivot.position.copy(w.position);
      w.position.set(0, 0, 0);
      w.name = 'spin';
      pivot.add(w);
      root.add(pivot);
    }
    return pivot;
  });
  chassis.traverse((o) => {
    if (o.isMesh && o.material?.color && /paint|body/i.test(o.material.name)) o.material.color.set(color);
  });
  const dim = carDimensions(def);
  root.userData = { dim, disposables: [] };
  return { root, wheels, tailMat: null, dim };
}

/**
 * Aplica el estado de las ruedas (de físicas o de red) al modelo.
 * @param {THREE.Object3D[]} wheels pivotes
 */
export function poseWheels(wheels, dim, { steer, spin, suspension }) {
  for (let i = 0; i < wheels.length; i++) {
    const pivot = wheels[i];
    if (!pivot) continue;
    if (i < 2) pivot.rotation.y = steer;
    const s = pivot.children[0];
    if (s) s.rotation.x = spin;
    if (suspension) pivot.position.y = dim.connectionY - suspension[i];
  }
}

export function disposeCar(car) {
  car.root.removeFromParent();
  car.root.userData.disposables?.forEach((d) => d.dispose());
}
