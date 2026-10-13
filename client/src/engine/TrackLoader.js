import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildTrackMesh, TRACK_LAYOUT, wall } from './trackMesh.js';
import { gridSlot } from '@runrun/shared/trackPath';
import { MAX_PLAYERS } from '@runrun/shared/protocol';
import { asphaltTextures, curbTextures, surfaceTextures, barrierTexture, checkerTexture, bannerTexture, crowdTexture } from './textures.js';

/**
 * Los muros de buildTrackMesh tienen las dos caras sobre los mismos vértices
 * (para el collider); en el render sus normales se anulan y dan NaN, que el
 * bloom extiende a toda la imagen. Para dibujarlos se usa una sola cara con
 * material de doble cara.
 */
function oneSided({ positions, uvs, indices }) {
  const out = new Uint32Array(indices.length / 2);
  for (let i = 0, k = 0; i < indices.length; i += 12, k += 6) out.set(indices.subarray(i, i + 6), k);
  return { positions, uvs, indices: out };
}

/**
 * Construye la pista (visual + colliders de Rapier). Por defecto es procedural
 * a partir del trazado compartido; si la definición trae `assets.visual` y
 * `assets.collider` (GLB), se cargan esos modelos en su lugar sin tocar el
 * motor (ver plan_maestro, Fase 5).
 */
export class TrackLoader {
  constructor(RAPIER, world, scene) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'track';
    this.colliders = [];
    this.disposables = [];
    this.startLights = [];
  }

  async load(trackDef, path, theme) {
    if (trackDef.assets?.visual && trackDef.assets?.collider) {
      await this.loadGlb(trackDef.assets);
    } else {
      this.buildProcedural(path, theme);
    }
    this.buildGantry(path);
    this.buildGrandstand(path, theme);
    if (!trackDef.assets?.visual) this.buildTrackDetails(path);
    this.scene.add(this.group);
    return this;
  }

  addCollider(positions, indices, friction = 1.0) {
    const desc = this.RAPIER.ColliderDesc.trimesh(positions, indices).setFriction(friction);
    this.colliders.push(this.world.createCollider(desc));
  }

  geometry({ positions, uvs, indices }) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeVertexNormals();
    this.disposables.push(g);
    return g;
  }

  mesh(data, material, { cast = false } = {}) {
    const m = new THREE.Mesh(this.geometry(data), material);
    m.receiveShadow = true;
    m.castShadow = cast;
    this.group.add(m);
    return m;
  }

  buildProcedural(path, theme) {
    const tm = buildTrackMesh(path);
    this.layout = tm;

    const asphalt = asphaltTextures();
    const road = new THREE.MeshStandardMaterial({
      map: asphalt.map,
      normalMap: asphalt.normalMap,
      roughnessMap: asphalt.roughnessMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.92,
      metalness: 0.0,
    });
    const curb = new THREE.MeshStandardMaterial({ map: curbTextures().map, roughness: 0.6 });
    const runoffTex = surfaceTextures(theme.runoff);
    const runoff = new THREE.MeshStandardMaterial({
      map: runoffTex.map,
      normalMap: runoffTex.normalMap,
      roughness: 1,
    });
    const barrier = new THREE.MeshStandardMaterial({
      map: barrierTexture(theme.barrier),
      roughness: 0.55,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    this.disposables.push(road, curb, runoff, barrier);

    this.mesh(tm.road, road);
    this.mesh(tm.curbLeft, curb);
    this.mesh(tm.curbRight, curb);
    this.mesh(tm.runoffLeft, runoff);
    this.mesh(tm.runoffRight, runoff);
    this.mesh(oneSided(tm.wallLeft), barrier, { cast: true });
    this.mesh(oneSided(tm.wallRight), barrier, { cast: true });
    this.buildRails(path, tm.outerOffset, theme);

    // Colliders: asfalto y pianos con agarre pleno, escapatoria con menos agarre.
    this.addCollider(tm.road.positions, tm.road.indices, 1.0);
    this.addCollider(tm.curbLeft.positions, tm.curbLeft.indices, 0.9);
    this.addCollider(tm.curbRight.positions, tm.curbRight.indices, 0.9);
    this.addCollider(tm.runoffLeft.positions, tm.runoffLeft.indices, 0.6);
    this.addCollider(tm.runoffRight.positions, tm.runoffRight.indices, 0.6);
    this.addCollider(tm.wallLeftCollider.positions, tm.wallLeftCollider.indices, 0.2);
    this.addCollider(tm.wallRightCollider.positions, tm.wallRightCollider.indices, 0.2);

    // Línea de meta a cuadros.
    const p = path.points[0];
    const t = path.tangents[0];
    const lineGeo = new THREE.PlaneGeometry(path.width, 1.6);
    lineGeo.rotateX(-Math.PI / 2);
    const lineMat = new THREE.MeshStandardMaterial({
      map: checkerTexture(),
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.position.set(p[0], p[1] + 0.01, p[2]);
    line.rotation.y = Math.atan2(t[0], t[2]);
    line.receiveShadow = true;
    this.group.add(line);
    this.disposables.push(lineGeo, lineMat);
  }

  /**
   * Guardarraíl de doble onda sobre postes por la cara interior del muro y,
   * en la ciudad, valla de protección alta. Solo visual: los colliders son los
   * muros de buildTrackMesh.
   */
  buildRails(path, outer, theme) {
    const steel = new THREE.MeshStandardMaterial({ color: '#b9bec4', metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide });
    this.disposables.push(steel);
    const off = outer - 0.32;
    for (const side of [-1, 1]) {
      for (const y of [0.62, 0.92]) {
        const g = this.geometry(oneSided(wall(path, side * off, 0.2, y, 0)));
        const m = new THREE.Mesh(g, steel);
        m.castShadow = true;
        m.receiveShadow = true;
        this.group.add(m);
      }
    }
    const postGeo = new THREE.BoxGeometry(0.12, 1.15, 0.12);
    postGeo.translate(0, 0.55, 0);
    this.disposables.push(postGeo);
    const every = Math.max(1, Math.round(4 / path.step));
    const n = Math.ceil(path.count / every) * 2;
    const posts = new THREE.InstancedMesh(postGeo, steel, n);
    const mtx = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < path.count; i += every) {
      for (const side of [-1, 1]) {
        const p = path.points[i];
        const r = path.rights[i];
        mtx.makeTranslation(p[0] + r[0] * side * (off + 0.12), p[1], p[2] + r[2] * side * (off + 0.12));
        posts.setMatrixAt(k++, mtx);
      }
    }
    posts.count = k;
    posts.castShadow = true;
    this.group.add(posts);

    if (theme.barrier === 'city') {
      // Valla metálica de malla sobre el muro (alpha recortada).
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      g.strokeStyle = '#c8ccd2';
      g.lineWidth = 2;
      for (let i = -64; i < 128; i += 12) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke();
        g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 3);
      const fenceMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide });
      this.disposables.push(tex, fenceMat);
      for (const side of [-1, 1]) {
        const fm = new THREE.Mesh(this.geometry(oneSided(wall(path, side * outer, 3, 1.15, 0))), fenceMat);
        this.group.add(fm);
      }
    }
  }

  async loadGlb({ visual, collider }) {
    const loader = new GLTFLoader();
    const [vis, col] = await Promise.all([loader.loadAsync(visual), loader.loadAsync(collider)]);
    vis.scene.traverse((o) => {
      if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; }
    });
    this.group.add(vis.scene);
    col.scene.updateMatrixWorld(true);
    col.scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const idx = g.index ? g.index.array : Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i);
      this.addCollider(new Float32Array(g.attributes.position.array), new Uint32Array(idx));
      g.dispose();
    });
    this.layout = { outerOffset: 20, halfWidth: 7 };
  }

  /**
   * Detalles de circuito profesional: cajones de parrilla pintados y carteles
   * de frenada (150/100/50 m) antes de cada curva cerrada, por el exterior.
   */
  buildTrackDetails(path) {
    const paint = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 });
    const lineGeo = new THREE.PlaneGeometry(1, 1);
    lineGeo.rotateX(-Math.PI / 2);
    this.disposables.push(paint, lineGeo);
    const addLine = (pos, yaw, w, l, dx, dz) => {
      const m = new THREE.Mesh(lineGeo, paint);
      m.scale.set(w, 1, l);
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      m.position.set(pos[0] + dx * c + dz * sn, pos[1] + 0.012, pos[2] - dx * sn + dz * c);
      m.rotation.y = yaw;
      m.receiveShadow = true;
      this.group.add(m);
    };
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const { position, yaw } = gridSlot(path, slot);
      const pos = [position[0], position[1] - 1.2, position[2]];
      // Cajón en "U" abierto hacia atrás: línea frontal y dos laterales cortas.
      addLine(pos, yaw, 2.6, 0.18, 0, 2.6);
      addLine(pos, yaw, 0.18, 1.4, 1.3, 1.9);
      addLine(pos, yaw, 0.18, 1.4, -1.3, 1.9);
    }

    // Curvas: entradas donde el radio (curvatura suavizada ~30 m) baja de 60 m.
    const { curvature, count, step } = path;
    const W = 8;
    const smooth = curvature.map((_, i) => {
      let sum = 0;
      for (let k = -W; k <= W; k++) sum += curvature[(i + k + count) % count];
      return sum / (2 * W + 1);
    });
    const corners = [];
    let inCorner = false;
    for (let i = 0; i < count; i++) {
      const radius = 1 / Math.max(Math.abs(smooth[i]), 1e-5);
      if (!inCorner && radius < 60) {
        corners.push(i);
        inCorner = true;
      } else if (inCorner && radius > 110) inCorner = false;
    }
    if (!corners.length) return;
    const boardTex = {};
    const boardGeo = new THREE.PlaneGeometry(2.1, 1.45);
    const postGeo = new THREE.BoxGeometry(0.14, 1.6, 0.14);
    const postMat = new THREE.MeshStandardMaterial({ color: '#30343b', metalness: 0.6, roughness: 0.4 });
    this.disposables.push(boardGeo, postGeo, postMat);
    const offset = path.width / 2 + TRACK_LAYOUT.curbWidth + 2.4;
    corners.forEach((ci, n) => {
      const outside = smooth[ci] > 0 ? -1 : 1;
      const prev = corners[(n - 1 + corners.length) % corners.length];
      const gap = corners.length > 1 ? (((ci - prev + count) % count) * step) : Infinity;
      for (const d of [150, 100, 50]) {
        if (d + 25 > gap) continue;
        const idx = (ci - Math.round(d / step) + count) % count;
        const p = path.points[idx];
        const t = path.tangents[idx];
        const r = path.rights[idx];
        if (!boardTex[d]) {
          const c = document.createElement('canvas');
          c.width = 256;
          c.height = 176;
          const g = c.getContext('2d');
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, 256, 176);
          g.fillStyle = '#d62839';
          g.fillRect(0, 0, 256, 18);
          g.fillRect(0, 158, 256, 18);
          g.fillStyle = '#111';
          g.font = 'bold 104px Arial, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(String(d), 128, 92);
          const tex = new THREE.CanvasTexture(c);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          boardTex[d] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, side: THREE.DoubleSide });
          this.disposables.push(tex, boardTex[d]);
        }
        const board = new THREE.Group();
        board.name = 'brake-board';
        const panel = new THREE.Mesh(boardGeo, boardTex[d]);
        panel.position.y = 2.2;
        panel.castShadow = true;
        board.add(panel);
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.y = 0.8;
        board.add(post);
        board.position.set(p[0] + r[0] * offset * outside, p[1], p[2] + r[2] * offset * outside);
        // De cara a los coches que se acercan, ligeramente girado hacia la pista.
        board.rotation.y = Math.atan2(-t[0], -t[2]) - outside * 0.25;
        this.group.add(board);
      }
    });
  }

  /** Pórtico de salida con semáforo de 5 luces (se encienden en la cuenta atrás). */
  buildGantry(path) {
    const p = path.points[0];
    const t = path.tangents[0];
    const span = (this.layout?.outerOffset ?? path.width) * 2;
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: '#2b2f36', metalness: 0.8, roughness: 0.35 });
    const pillarGeo = new THREE.BoxGeometry(0.8, 8, 0.8);
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo, steel);
      pillar.position.set((side * span) / 2, 4, 0);
      pillar.castShadow = true;
      g.add(pillar);
    }
    const beamGeo = new THREE.BoxGeometry(span + 0.8, 1.6, 1.0);
    const beamMat = new THREE.MeshStandardMaterial({ map: bannerTexture(), roughness: 0.45, metalness: 0.2, emissive: '#ffffff', emissiveMap: bannerTexture(), emissiveIntensity: 0.25 });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, 8.2, 0);
    beam.castShadow = true;
    g.add(beam);

    const lampGeo = new THREE.CircleGeometry(0.32, 20);
    const housingGeo = new THREE.BoxGeometry(0.9, 0.9, 0.3);
    const housingMat = new THREE.MeshStandardMaterial({ color: '#0b0b0d', roughness: 0.4 });
    for (let i = 0; i < 5; i++) {
      const housing = new THREE.Mesh(housingGeo, housingMat);
      const x = (i - 2) * 1.1;
      housing.position.set(x, 6.7, -0.4);
      g.add(housing);
      const lampMat = new THREE.MeshStandardMaterial({ color: '#220000', emissive: '#ff1a1a', emissiveIntensity: 0 });
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(x, 6.7, -0.56);
      lamp.rotation.y = Math.PI;
      g.add(lamp);
      this.startLights.push(lampMat);
      this.disposables.push(lampMat);
    }
    g.position.set(p[0], p[1], p[2]);
    g.rotation.y = Math.atan2(t[0], t[2]);
    this.group.add(g);
    this.disposables.push(steel, pillarGeo, beamGeo, beamMat, lampGeo, housingGeo, housingMat);
  }

  /**
   * @param {number} lit cuántas luces rojas encendidas (0-5); -1 = verde (todas apagadas)
   */
  setStartLights(lit) {
    this.startLights.forEach((m, i) => {
      const on = i < lit;
      m.emissive.set(lit < 0 ? '#22ff55' : '#ff1a1a');
      m.emissiveIntensity = lit < 0 ? 3 : on ? 4 : 0;
    });
  }

  /** Tribuna con público a lo largo de la recta de meta. */
  buildGrandstand(path, theme) {
    const outer = this.layout?.outerOffset ?? path.width;
    const length = 64;
    const centerIdx = (path.count - Math.round(18 / path.step)) % path.count;
    const p = path.points[centerIdx];
    const t = path.tangents[centerIdx];
    const r = path.rights[centerIdx];
    const g = new THREE.Group();

    const concrete = new THREE.MeshStandardMaterial({ color: theme.barrier === 'desert' ? '#cbb89c' : '#9da1a8', roughness: 0.85 });
    const crowdTex = crowdTexture().clone();
    crowdTex.needsUpdate = true;
    crowdTex.repeat.set(4, 1);
    const crowd = new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.9, alphaTest: 0.5, side: THREE.DoubleSide });

    const rows = 9;
    for (let i = 0; i < rows; i++) {
      const stepGeo = new THREE.BoxGeometry(length, 0.6, 1.1);
      const step = new THREE.Mesh(stepGeo, concrete);
      step.position.set(0, 0.3 + i * 0.6, i * 1.1);
      step.receiveShadow = true;
      step.castShadow = true;
      g.add(step);
      const peopleGeo = new THREE.PlaneGeometry(length, 0.8);
      const people = new THREE.Mesh(peopleGeo, crowd);
      people.position.set(0, 0.95 + i * 0.6, i * 1.1 - 0.2);
      people.rotation.y = Math.PI;
      g.add(people);
      this.disposables.push(stepGeo, peopleGeo);
    }
    const roofGeo = new THREE.BoxGeometry(length + 2, 0.3, rows * 1.1 + 3);
    const roofMat = new THREE.MeshStandardMaterial({ color: '#e8e8ea', metalness: 0.4, roughness: 0.4 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(0, rows * 0.6 + 4.2, (rows * 1.1) / 2 - 0.5);
    roof.castShadow = true;
    g.add(roof);
    const postGeo = new THREE.CylinderGeometry(0.18, 0.18, rows * 0.6 + 4.2, 8);
    for (let x = -length / 2; x <= length / 2; x += 16) {
      const post = new THREE.Mesh(postGeo, roofMat);
      post.position.set(x, (rows * 0.6 + 4.2) / 2, rows * 1.1);
      post.castShadow = true;
      g.add(post);
    }
    // Orientada mirando a la pista desde el lado derecho del trazado.
    const offset = outer + 3;
    g.position.set(p[0] + r[0] * offset, p[1] - 0.4, p[2] + r[2] * offset);
    g.rotation.y = Math.atan2(t[0], t[2]) - Math.PI / 2;
    this.group.add(g);
    this.disposables.push(concrete, crowd, crowdTex, roofGeo, roofMat, postGeo);
  }

  dispose() {
    this.colliders.forEach((c) => this.world.removeCollider(c, false));
    this.disposables.forEach((d) => d.dispose());
    this.scene.remove(this.group);
  }
}
