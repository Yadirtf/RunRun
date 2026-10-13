import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { softDotTexture, cloudTexture } from './textures.js';
import { QUALITY_PRESETS } from './quality.js';

/**
 * Renderer, cielo (físico de día, cúpula estrellada de noche), iluminación
 * basada en imagen, sol con sombras suaves que siguen al jugador, capa de
 * nubes, niebla atmosférica y post-proceso: antialiasing MSAA, bloom, tone
 * mapping ACES y gradación de color con viñeta.
 */
export class SceneSetup {
  constructor(canvas, theme, { quality = QUALITY_PRESETS.high } = {}) {
    this.theme = theme;
    this.quality = quality;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
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

    const phi = THREE.MathUtils.degToRad(90 - theme.sky.elevation);
    const thetaA = THREE.MathUtils.degToRad(theme.sky.azimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, thetaA);

    this.sky = theme.night ? this.buildNightSky(theme) : this.buildSky(theme);
    scene.add(this.sky);
    this.envRT = this.skyEnvironment(theme);
    scene.environment = this.envRT.texture;

    const hemi = new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    const sc = sun.shadow.camera;
    const r = quality.shadowRange;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r;
    sc.near = 10; sc.far = 450;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.5;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    if (!theme.night) {
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
    }

    if (quality.clouds && theme.clouds) this.buildClouds(theme.clouds);

    // Post-proceso sobre un render target con MSAA (el antialias del canvas
    // no se aplica cuando se renderiza a través del composer).
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality.msaa });
    const composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    if (quality.bloom) {
      const b = theme.bloom ?? { strength: 0.22, radius: 0.5, threshold: 0.92 };
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), b.strength, b.radius, b.threshold);
      composer.addPass(this.bloom);
    }
    composer.addPass(new OutputPass());
    if (quality.grading) {
      this.grading = new ShaderPass(GradingShader);
      const g = theme.grading ?? {};
      this.grading.uniforms.saturation.value = g.saturation ?? 1.08;
      this.grading.uniforms.contrast.value = g.contrast ?? 1.06;
      this.grading.uniforms.tint.value.set(g.tint ?? '#ffffff');
      this.grading.uniforms.vignette.value = g.vignette ?? 0.32;
      composer.addPass(this.grading);
    }
    this.composer = composer;
  }

  buildSky(theme) {
    const sky = new Sky();
    sky.scale.setScalar(5000);
    const u = sky.material.uniforms;
    u.turbidity.value = theme.sky.turbidity;
    u.rayleigh.value = theme.sky.rayleigh;
    u.mieCoefficient.value = theme.sky.mieCoefficient;
    u.mieDirectionalG.value = theme.sky.mieDirectionalG;
    u.sunPosition.value.copy(this.sunDir);
    return sky;
  }

  /** Cúpula nocturna: degradado con resplandor de ciudad, estrellas y luna. */
  buildNightSky(theme) {
    const n = theme.nightSky;
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        zenith: { value: new THREE.Color(n.zenith) },
        horizon: { value: new THREE.Color(n.horizon) },
        glow: { value: new THREE.Color(n.glow) },
        moonDir: { value: this.sunDir.clone() },
      },
      vertexShader: `varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: `varying vec3 vDir;
        uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow; uniform vec3 moonDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 col = mix(horizon, zenith, pow(h, 0.45));
          col += glow * pow(1.0 - h, 6.0);
          // Estrellas: celdas en la esfera con brillo aleatorio.
          vec3 cell = floor(d * 380.0);
          float s = hash(cell);
          float star = step(0.9975, s) * smoothstep(0.05, 0.3, h) * (0.6 + 0.4 * sin(s * 80.0));
          col += vec3(star * 1.2);
          // Luna con halo.
          float m = dot(d, normalize(moonDir));
          col += vec3(1.0, 0.97, 0.9) * smoothstep(0.9993, 0.9996, m) * 3.0;
          col += vec3(0.5, 0.6, 0.8) * pow(max(m, 0.0), 200.0) * 0.5;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    sky.scale.setScalar(4000);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    return sky;
  }

  /** IBL inicial: el entorno refleja el mismo cielo (pintura y cristales lo reflejan). */
  skyEnvironment(theme) {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = theme.night ? this.buildNightSky(theme) : this.buildSky(theme);
    envSky.scale.setScalar(theme.night ? 900 : 1000);
    envScene.add(envSky);
    const hemiGround = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: theme.hemi.ground, side: THREE.BackSide }),
    );
    envScene.add(hemiGround);
    const rt = pmrem.fromScene(envScene, 0.02);
    envSky.geometry.dispose();
    envSky.material.dispose();
    hemiGround.geometry.dispose();
    hemiGround.material.dispose();
    pmrem.dispose();
    return rt;
  }

  /**
   * Sustituye el IBL de solo cielo por uno capturado desde la pista con el
   * paisaje ya construido: la carrocería refleja árboles, montañas, edificios
   * y luces reales en vez de un cielo genérico.
   */
  bakeSceneEnvironment(at) {
    if (!this.quality.sceneEnv) return;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const { scene } = this;
    const prevEnv = scene.environment;
    scene.environment = this.envRT.texture;
    if (this.flareLight) this.flareLight.visible = false;
    // fromScene captura desde el origen: se desplaza la escena para que el
    // punto de captura (a altura de techo sobre la pista) quede en él.
    scene.position.set(-at.x, -at.y - 2.2, -at.z);
    scene.updateMatrixWorld(true);
    const rt = pmrem.fromScene(scene, 0.015, 0.5, 6000);
    scene.position.set(0, 0, 0);
    scene.updateMatrixWorld(true);
    if (this.flareLight) this.flareLight.visible = true;
    pmrem.dispose();
    this.envRT.dispose();
    this.envRT = rt;
    scene.environment = rt.texture;
    if (prevEnv && prevEnv !== rt.texture) prevEnv.dispose?.();
  }

  /** Capa de nubes a gran altura que sigue a la cámara y se desplaza con el viento. */
  buildClouds(cfg) {
    const tex = cloudTexture(cfg.cover ?? 0.5);
    tex.repeat.set(5, 5);
    const geo = new THREE.PlaneGeometry(9000, 9000, 1, 1);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: cfg.color ?? '#ffffff',
      transparent: true,
      opacity: cfg.opacity ?? 0.85,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    // Se desvanecen hacia el horizonte para no cortar el cielo con un borde.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCloudXY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloudXY = position.xz / 4500.0;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCloudXY;')
        .replace('#include <opaque_fragment>', 'diffuseColor.a *= 1.0 - smoothstep(0.35, 0.95, length(vCloudXY));\n#include <opaque_fragment>');
    };
    const clouds = new THREE.Mesh(geo, mat);
    clouds.position.y = cfg.height ?? 650;
    clouds.renderOrder = -5;
    clouds.frustumCulled = false;
    this.scene.add(clouds);
    this.clouds = { mesh: clouds, tex, mat, geo };
  }

  /** Mantiene sombras, destello y nubes alrededor del punto de interés (el coche). */
  follow(focus, time = 0) {
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 220);
    this.sun.target.position.copy(focus);
    // Ajustar a texeles del mapa de sombras para evitar parpadeo al moverse.
    const texel = (this.quality.shadowRange * 2) / this.sun.shadow.mapSize.x;
    this.sun.position.x = Math.round(this.sun.position.x / texel) * texel;
    this.sun.position.z = Math.round(this.sun.position.z / texel) * texel;
    this.sun.target.position.x = this.sun.position.x - this.sunDir.x * 220;
    this.sun.target.position.z = this.sun.position.z - this.sunDir.z * 220;
    this.flareLight?.position.copy(this.camera.position).addScaledVector(this.sunDir, 3000);
    if (this.clouds) {
      this.clouds.mesh.position.x = this.camera.position.x;
      this.clouds.mesh.position.z = this.camera.position.z;
      this.clouds.tex.offset.set(this.camera.position.x / 1800 + time * 0.002, this.camera.position.z / 1800 + time * 0.0008);
    }
    if (this.sky.isMesh && !this.sky.isSky) this.sky.position.copy(this.camera.position);
  }

  resize(width, height) {
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
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
    this.flare?.dispose();
    if (this.clouds) {
      this.clouds.geo.dispose();
      this.clouds.mat.dispose();
    }
    this.composer.renderTarget1?.dispose();
    this.composer.renderTarget2?.dispose();
    this.composer.dispose?.();
    this.renderer.dispose();
  }
}

/** Gradación final: saturación, contraste, tinte y viñeta suave. */
const GradingShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.08 },
    contrast: { value: 1.06 },
    tint: { value: new THREE.Color('#ffffff') },
    vignette: { value: 0.32 },
  },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float saturation; uniform float contrast; uniform vec3 tint; uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 col = mix(vec3(l), c.rgb, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col *= tint;
      vec2 q = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};
