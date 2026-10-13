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
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(4, 8, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -5; key.shadow.camera.right = 5;
    key.shadow.camera.top = 5; key.shadow.camera.bottom = -5;
    key.shadow.radius = 6;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#e63946', 1.4);
    rim.position.set(-6, 3, -5);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight('#00f5ff', 0.5);
    fill.position.set(-4, 1, 6);
    this.scene.add(fill);

    const floorGeo = new THREE.CircleGeometry(4.2, 64);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({ color: '#15151f', metalness: 0.6, roughness: 0.35 });
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    const ringGeo = new THREE.RingGeometry(4.15, 4.25, 96);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#e63946', transparent: true, opacity: 0.8 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.005;
    this.scene.add(ring);
    this.disposables = [floorGeo, floorMat, ringGeo, ringMat];

    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);
    this.angle = 0.6;
    this.swap = 1;
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.angle += dt * 0.35;
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
    this.turntable.add(car.root);
    this.swap = 0;
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // En pantallas estrechas alejar la cámara para que el coche quepa.
    const dist = w / h < 1 ? 22 : 15.5;
    this.camera.position.setLength(dist);
    this.camera.lookAt(0, 0.35, 0);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    if (this.car) disposeCar(this.car);
    this.disposables.forEach((d) => d.dispose());
    this.envRT.dispose();
    this.renderer.dispose();
  }
}
