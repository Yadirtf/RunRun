import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getCar } from '@runrun/shared/cars';
import { createCar, disposeCar } from '../engine/CarFactory.js';

/**
 * Escena de exposición para el lobby: el coche elegido gira sobre una
 * plataforma con iluminación de estudio y reflejos. Cambia de coche con un
 * pequeño fundido de escala.
 */
export class Showroom {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{shiftX?: number, shiftY?: number, fill?: number}} framing desplazamiento del
   *   coche (fracción del ancho/alto, solo en pantallas anchas) y fracción del ancho que ocupa.
   */
  constructor(canvas, { shiftX = 0, shiftY = 0, fill = 0.42 } = {}) {
    this.canvas = canvas;
    this.framing = { shiftX, shiftY, fill };
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(renderer), 0.04);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.camera.position.set(7.2, 2.2, 7.8);
    this.camera.lookAt(0, 0.35, 0);

    const key = new THREE.DirectionalLight('#ffffff', 2.4);
    key.position.set(3, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -5; key.shadow.camera.right = 5;
    key.shadow.camera.top = 5; key.shadow.camera.bottom = -5;
    key.shadow.radius = 8;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#ff5a64', 0.9);
    rim.position.set(-6, 3, -5);
    this.scene.add(rim);
    const fillLight = new THREE.DirectionalLight('#7fdcff', 0.6);
    fillLight.position.set(-5, 2, 6);
    this.scene.add(fillLight);

    // Suelo de estudio que se funde con el fondo (sin bordes duros).
    const floorGeo = new THREE.CircleGeometry(6.5, 72);
    floorGeo.rotateX(-Math.PI / 2);
    const fade = document.createElement('canvas');
    fade.width = fade.height = 256;
    const g = fade.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const fadeTex = new THREE.CanvasTexture(fade);
    // Suelo sin iluminar (las luces de color no lo tiñen) + capa que solo recibe la sombra.
    const floorMat = new THREE.MeshBasicMaterial({ color: '#14151d', alphaMap: fadeTex, transparent: true, depthWrite: false });
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.scene.add(this.floor);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.55 });
    const shadowFloor = new THREE.Mesh(floorGeo, shadowMat);
    shadowFloor.position.y = 0.002;
    shadowFloor.receiveShadow = true;
    this.scene.add(shadowFloor);
    // Anillos luminosos de la plataforma giratoria.
    const ringGeo = new THREE.RingGeometry(3.25, 3.3, 128);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ff3b47', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.006;
    this.scene.add(ring);
    const ring2Geo = new THREE.RingGeometry(3.45, 3.47, 128);
    ring2Geo.rotateX(-Math.PI / 2);
    const ring2Mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18 });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.position.y = 0.006;
    this.scene.add(ring2);
    this.disposables = [floorGeo, floorMat, shadowMat, fadeTex, ringGeo, ringMat, ring2Geo, ring2Mat];

    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);
    this.angle = 0.6;
    this.spin = 0.3;
    this.swap = 1;
    this.drag = null;
    this.onDown = (e) => {
      this.drag = { x: e.clientX, t: performance.now() };
      canvas.setPointerCapture?.(e.pointerId);
    };
    this.onMove = (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const now = performance.now();
      this.angle += dx * 0.008;
      this.spin = (dx * 0.008) / Math.max(0.016, (now - this.drag.t) / 1000);
      this.drag = { x: e.clientX, t: now };
    };
    this.onUp = () => {
      this.drag = null;
      this.spin = Math.max(-6, Math.min(6, this.spin));
    };
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
      // Arrastrar para girar el coche; al soltar conserva la inercia y vuelve al giro lento.
      if (!this.drag) {
        this.spin += (0.3 - this.spin) * Math.min(1, dt * 1.5);
        this.angle += dt * this.spin;
      }
      this.turntable.rotation.y = this.angle;
      this.swap = Math.min(1, this.swap + dt * 3);
      const e = 1 - (1 - this.swap) ** 3;
      this.turntable.scale.setScalar(0.85 + 0.15 * e);
      this.turntable.position.y = (1 - e) * -0.3;
      renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  async show(carId, color) {
    const key = `${carId}:${color}`;
    if (key === this.key) return;
    this.key = key;
    const def = getCar(carId);
    const car = await createCar(def, color ?? def.defaultColor);
    if (this.key !== key) return disposeCar(car);
    if (this.car) disposeCar(this.car);
    this.car = car;
    // El origen del modelo es el centro del chasis: apoyarlo en el suelo.
    car.root.position.y = -car.dim.visualOffsetY;
    // El estudio ya tiene sombras reales: sin la sombra de contacto falsa.
    const blob = car.root.getObjectByName('contactShadow');
    if (blob) blob.visible = false;
    this.turntable.add(car.root);
    this.swap = 0;
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const wide = aspect > 1.15;
    // Distancia para que el coche (≈5 m girando) ocupe la fracción pedida del ancho.
    const halfTan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fill = wide ? this.framing.fill : 0.9;
    const byWidth = (wide ? 5 : 4.6) / (fill * 2 * halfTan * aspect);
    const byHeight = 2.2 / (0.6 * 2 * halfTan);
    const dist = THREE.MathUtils.clamp(Math.max(byWidth, byHeight), 8, 26);
    this.camera.position.set(0.66, 0.3, 0.69).normalize().multiplyScalar(dist);
    this.camera.lookAt(0, 0.45, 0);
    const sx = wide ? this.framing.shiftX : 0;
    const sy = wide ? this.framing.shiftY : 0;
    if (sx || sy) this.camera.setViewOffset(w, h, -sx * w, sy * h, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    if (this.car) disposeCar(this.car);
    this.disposables.forEach((d) => d.dispose());
    this.envRT.dispose();
    this.renderer.dispose();
  }
}
