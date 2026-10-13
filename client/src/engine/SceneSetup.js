import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { softDotTexture } from './textures.js';

/**
 * Renderer, cielo físico (Rayleigh/Mie), iluminación basada en imagen desde
 * ese cielo, sol con sombras suaves que siguen al jugador, niebla atmosférica
 * y post-proceso (bloom + tone mapping ACES).
 */
export class SceneSetup {
  constructor(canvas, theme, { quality = 'high' } = {}) {
    this.theme = theme;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.25));
    renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = theme.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(theme.fog.color, theme.fog.density);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 6000);
    this.camera = camera;

    // Cielo físico y dirección del sol.
    const sky = new Sky();
    sky.scale.setScalar(5000);
    const u = sky.material.uniforms;
    u.turbidity.value = theme.sky.turbidity;
    u.rayleigh.value = theme.sky.rayleigh;
    u.mieCoefficient.value = theme.sky.mieCoefficient;
    u.mieDirectionalG.value = theme.sky.mieDirectionalG;
    const phi = THREE.MathUtils.degToRad(90 - theme.sky.elevation);
    const thetaA = THREE.MathUtils.degToRad(theme.sky.azimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, thetaA);
    u.sunPosition.value.copy(this.sunDir);
    scene.add(sky);
    this.sky = sky;

    // IBL: el entorno refleja el mismo cielo (pintura y cristales lo reflejan).
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(1000);
    Object.assign(envSky.material.uniforms, THREE.UniformsUtils.clone(u));
    envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
    envScene.add(envSky);
    const hemiGround = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: theme.hemi.ground, side: THREE.BackSide }),
    );
    envScene.add(hemiGround);
    this.envRT = pmrem.fromScene(envScene, 0.02);
    scene.environment = this.envRT.texture;
    envSky.geometry.dispose();
    envSky.material.dispose();
    hemiGround.geometry.dispose();
    hemiGround.material.dispose();
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    const sc = sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70;
    sc.near = 10; sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    // Destello del sol.
    const flareTex = softDotTexture();
    const flare = new Lensflare();
    flare.addElement(new LensflareElement(flareTex, 380, 0, new THREE.Color(theme.sun.color)));
    flare.addElement(new LensflareElement(flareTex, 60, 0.6, new THREE.Color('#ffd9a0')));
    flare.addElement(new LensflareElement(flareTex, 90, 0.75));
    flare.addElement(new LensflareElement(flareTex, 40, 1.0, new THREE.Color('#a0c8ff')));
    this.flareLight = new THREE.PointLight(0xffffff, 0, 1);
    this.flareLight.add(flare);
    scene.add(this.flareLight);
    this.flare = flare;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    if (quality === 'high') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.5, 0.92);
      composer.addPass(this.bloom);
    }
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  /** Mantiene sombras y destello alrededor del punto de interés (el coche). */
  follow(focus) {
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 200);
    this.sun.target.position.copy(focus);
    // Ajustar a texeles del mapa de sombras para evitar parpadeo al moverse.
    const texel = 140 / this.sun.shadow.mapSize.x;
    this.sun.position.x = Math.round(this.sun.position.x / texel) * texel;
    this.sun.position.z = Math.round(this.sun.position.z / texel) * texel;
    this.sun.target.position.x = this.sun.position.x - this.sunDir.x * 200;
    this.sun.target.position.z = this.sun.position.z - this.sunDir.z * 200;
    this.flareLight.position.copy(this.camera.position).addScaledVector(this.sunDir, 3000);
  }

  resize(width, height) {
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.envRT.dispose();
    this.flare.dispose();
    this.composer.dispose?.();
    this.renderer.dispose();
  }
}
