import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildTrackMesh } from './trackMesh.js';
import { asphaltTextures, curbTextures, surfaceTextures, barrierTexture, checkerTexture } from './textures.js';

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
    this.mesh(tm.wallLeft, barrier, { cast: true });
    this.mesh(tm.wallRight, barrier, { cast: true });

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
    const beamMat = new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.5 });
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

    const concrete = new THREE.MeshStandardMaterial({ color: theme.barrier === 'desert' ? '#cbb89c' : '#b9bcc2', roughness: 0.85 });
    const crowdCanvas = document.createElement('canvas');
    crowdCanvas.width = 512;
    crowdCanvas.height = 32;
    const ctx = crowdCanvas.getContext('2d');
    ctx.fillStyle = '#3a3a40';
    ctx.fillRect(0, 0, 512, 32);
    const palette = ['#d62839', '#f4f4f4', '#2a9df4', '#f4a300', '#2bb673', '#222', '#9b5de5', '#e9c46a'];
    for (let x = 0; x < 512; x += 4) {
      ctx.fillStyle = palette[(Math.random() * palette.length) | 0];
      ctx.fillRect(x + 1, 8 + Math.random() * 6, 3, 18);
      ctx.fillStyle = '#e0b48c';
      ctx.fillRect(x + 1, 4 + Math.random() * 4, 3, 4);
    }
    const crowdTex = new THREE.CanvasTexture(crowdCanvas);
    crowdTex.colorSpace = THREE.SRGBColorSpace;
    crowdTex.wrapS = THREE.RepeatWrapping;
    crowdTex.repeat.set(4, 1);
    const crowd = new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.9 });

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
