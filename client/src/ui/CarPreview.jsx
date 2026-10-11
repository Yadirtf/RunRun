// Visor 3D giratorio del coche elegido (menú y sala).
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getCar } from '@ranran/shared';
import { assets } from '../engine/Assets.js';
import { createCarVisual } from '../engine/CarModel.js';

export default function CarPreview({ carId, color, className = '' }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);

  // Escena (una vez)
  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(6.5, 2.4, 6.5);
    camera.lookAt(0, 0.55, 0.2);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 8, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.ShadowMaterial({ opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    let envMap = null;
    assets.skyHdr().then((hdr) => {
      if (!ctxRef.current) return;
      const pmrem = new THREE.PMREMGenerator(renderer);
      envMap = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      scene.environment = envMap;
    }).catch(() => {});

    const pivot = new THREE.Group();
    scene.add(pivot);
    const ctx = { renderer, scene, camera, pivot, visual: null, raf: 0 };
    ctxRef.current = ctx;

    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const loop = (t) => {
      ctx.raf = requestAnimationFrame(loop);
      pivot.rotation.y = t * 0.00035;
      renderer.render(scene, camera);
    };
    ctx.raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(ctx.raf);
      ro.disconnect();
      ctx.visual?.dispose();
      envMap?.dispose();
      renderer.dispose();
      ctxRef.current = null;
    };
  }, []);

  // Coche (al cambiar modelo o color)
  useEffect(() => {
    let cancelled = false;
    createCarVisual(getCar(carId), color).then((visual) => {
      const ctx = ctxRef.current;
      if (cancelled || !ctx) { visual.dispose(); return; }
      if (ctx.visual) { ctx.visual.root.removeFromParent(); ctx.visual.dispose(); }
      const c = visual.bounds.getCenter(new THREE.Vector3());
      visual.root.position.set(-c.x, 0, -c.z);
      ctx.pivot.add(visual.root);
      ctx.visual = visual;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [carId, color]);

  return <canvas ref={canvasRef} className={`car-preview ${className}`} aria-label="Vista previa del coche" />;
}
