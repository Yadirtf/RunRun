// Carga y cachea los recursos (modelos, texturas, cielo). Todo pasa por un LoadingManager
// para poder mostrar una barra de progreso.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export const TEXTURES = {
  asphaltDiff: '/game/textures/asphalt_diff.webp',
  asphaltNor: '/game/textures/asphalt_nor.webp',
  asphaltRough: '/game/textures/asphalt_rough.webp',
  grassDiff: '/game/textures/grass_diff.webp',
  grassNor: '/game/textures/grass_nor.webp',
  concreteDiff: '/game/textures/concrete_diff.webp',
  gravelDiff: '/game/textures/gravel_diff.webp',
};
const SKY_HDR = '/game/env/sky_1k.hdr';
const SKY_BG = '/game/env/sky_bg.jpg';

class AssetStore {
  constructor() {
    this.listeners = new Set();
    this.manager = new THREE.LoadingManager();
    this.manager.onProgress = (_url, loaded, total) => this.listeners.forEach((fn) => fn(loaded / total));
    this.gltfLoader = new GLTFLoader(this.manager).setMeshoptDecoder(MeshoptDecoder);
    this.textureLoader = new THREE.TextureLoader(this.manager);
    this.hdrLoader = new HDRLoader(this.manager);
    this.cache = new Map();
  }

  onProgress(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  #once(key, factory) {
    if (!this.cache.has(key)) {
      const p = factory();
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
    }
    return this.cache.get(key);
  }

  gltf(url) {
    return this.#once(`gltf:${url}`, () => this.gltfLoader.loadAsync(url));
  }

  /** Textura repetible con espacio de color correcto. */
  texture(url, { color = false, repeat = 1 } = {}) {
    return this.#once(`tex:${url}:${color}`, async () => {
      const tex = await this.textureLoader.loadAsync(url);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.anisotropy = 8;
      tex.repeat.set(repeat, repeat);
      return tex;
    });
  }

  skyHdr() {
    return this.#once('sky:hdr', async () => {
      const tex = await this.hdrLoader.loadAsync(SKY_HDR);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      return tex;
    });
  }

  skyBackground() {
    return this.#once('sky:bg', async () => {
      const tex = await this.textureLoader.loadAsync(SKY_BG);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    });
  }

  /** Precarga todo lo necesario para una carrera. */
  async preload(carUrls) {
    await Promise.all([
      ...carUrls.map((u) => this.gltf(u)),
      ...Object.entries(TEXTURES).map(([k, u]) => this.texture(u, { color: k.endsWith('Diff') })),
      this.skyHdr(),
      this.skyBackground(),
    ]);
  }
}

export const assets = new AssetStore();
