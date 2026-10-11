// Herramientas de prueba solo para desarrollo (no se incluyen en producción).
// Desde la consola: await __test.start('spielberg'); __test.skidpad(); __test.brake(); __test.lap();

function headless(g) {
  if (g.__headless) return g.__headless;
  let sim = g.opts.goAt + 10;
  const realRender = g.renderer.render.bind(g.renderer);
  const frame = g.frame.bind(g);
  const h = {
    step(dt = 1 / 60) { sim += dt * 1000; frame(dt); },
    restore() { g.renderer.render = realRender; g.serverNow = () => (g.opts.net ? g.opts.net.serverNow() : Date.now()); delete g.__headless; },
  };
  g.serverNow = () => sim;
  g.renderer.render = () => {};
  g.__headless = h;
  return h;
}

const heading = (body) => {
  const q = body.rotation();
  return { fx: 2 * (q.x * q.z + q.w * q.y), fz: 1 - 2 * (q.x * q.x + q.y * q.y) };
};

window.__test = {
  async start(trackId = 'spielberg', laps = 1) {
    window.__store.getState().setProfile({ nickname: 'Tester' });
    window.__store.getState().startPractice(trackId, laps);
    for (let i = 0; i < 100 && !(window.__game && !window.__game.disposed && window.__game.running); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    return !!window.__game;
  },

  /** Aceleración lateral sostenida en círculo (en g). */
  skidpad(speeds = [20, 35]) {
    const g = window.__game, v = g.vehicle, L = g.layout, h = headless(g);
    const setSurface = v.setSurface;
    v.setSurface('asphalt'); v.setSurface = () => {};
    const out = [];
    for (const target of speeds) {
      v.teleport(L.bounds.maxX + 300, L.bounds.maxZ + 300, 0);
      const acc = [];
      for (let i = 0; i < 60 * 16; i++) {
        const sp = g.state.speed;
        g.setTouch({ throttle: sp < target ? 0.8 : 0, brake: 0, steer: i > 60 * 7 ? 0.8 : 0 });
        h.step();
        if (i > 60 * 11) acc.push(Math.abs(v.body.angvel().y * sp));
      }
      out.push({ target, speed: +g.state.speed.toFixed(1), g: +(acc.reduce((a, b) => a + b, 0) / acc.length / 9.81).toFixed(2), slip: +v.slip.toFixed(2) });
    }
    v.setSurface = setSurface;
    g.setTouch({ throttle: 0, steer: 0 });
    h.restore();
    return out;
  },

  /** 0-100, velocidad punta y frenada 100-0. */
  brake() {
    const g = window.__game, v = g.vehicle, L = g.layout, h = headless(g);
    const setSurface = v.setSurface;
    v.setSurface('asphalt'); v.setSurface = () => {};
    const half = g.track.groundSize / 2, cx = (L.bounds.minX + L.bounds.maxX) / 2;
    const stopFrom = (kmh) => {
      v.teleport(cx - half + 60, L.bounds.minZ - 450, Math.PI / 2);
      let t100 = null, i = 0;
      while (g.state.speed * 3.6 < kmh && i < 60 * 30) {
        g.setTouch({ throttle: 1, brake: 0, steer: 0 }); h.step(); i++;
        if (t100 === null && g.state.speed >= 27.78) t100 = i / 60;
      }
      const p0 = v.body.translation();
      let frames = 0;
      while (g.state.speed > 0.3 && frames < 60 * 20) { g.setTouch({ throttle: 0, brake: 1, steer: 0 }); h.step(); frames++; }
      const p1 = v.body.translation();
      return { t100, dist: +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1), secs: +(frames / 60).toFixed(2) };
    };
    const a = stopFrom(100), b = stopFrom(200);
    v.setSurface = setSurface;
    g.setTouch({ throttle: 0, brake: 0 });
    h.restore();
    return { t0_100: a.t100, brake100m: a.dist, brake200m: b.dist, brake200s: b.secs };
  },


  /** Frenar a fondo girando a la vez (como con teclado): cuánto gira y cuánto frena. */
  trailBrake(kmh = 150, seconds = 2) {
    const g = window.__game, v = g.vehicle, L = g.layout, h = headless(g);
    const setSurface = v.setSurface; v.setSurface('asphalt'); v.setSurface = () => {};
    v.teleport(L.bounds.maxX + 300, L.bounds.maxZ + 300, 0);
    v.body.setLinvel({ x: 0, y: 0, z: kmh / 3.6 }, true);
    for (let i = 0; i < 30; i++) { g.setTouch({ throttle: 0.3, brake: 0, steer: 0 }); h.step(); }
    const y0 = heading(v.body); const v0 = g.state.speed;
    for (let i = 0; i < 60 * seconds; i++) { g.setTouch({ throttle: 0, brake: 1, steer: 1 }); h.step(); }
    const y1 = heading(v.body);
    const turned = Math.atan2(y0.fx * y1.fz - y0.fz * y1.fx, y0.fx * y1.fx + y0.fz * y1.fz) * 180 / Math.PI;
    const vel = v.body.linvel(); const travel = Math.atan2(vel.x, vel.z) * 180 / Math.PI;
    v.setSurface = setSurface; g.setTouch({ throttle: 0, brake: 0, steer: 0 }); h.restore();
    return { fromKmh: Math.round(v0 * 3.6), toKmh: Math.round(g.state.speed * 3.6), headingDeg: +turned.toFixed(1), travelDeg: +travel.toFixed(1) };
  },

  /** Freno de mano + volante: cuánto rota el coche y cuánto cambia su trayectoria. */
  handbrakeTurn(kmh = 80, seconds = 1.5) {
    const g = window.__game, v = g.vehicle, L = g.layout, h = headless(g);
    const setSurface = v.setSurface; v.setSurface('asphalt'); v.setSurface = () => {};
    v.teleport(L.bounds.maxX + 300, L.bounds.maxZ + 300, 0);
    v.body.setLinvel({ x: 0, y: 0, z: kmh / 3.6 }, true);
    for (let i = 0; i < 30; i++) { g.setTouch({ throttle: 0.3, brake: 0, steer: 0 }); h.step(); }
    for (let i = 0; i < 60 * seconds; i++) { g.setTouch({ throttle: 0.4, brake: 0, steer: 1, handbrake: true }); h.step(); }
    const hd = heading(v.body); const vel = v.body.linvel();
    const out = { headingDeg: +(Math.atan2(hd.fx, hd.fz) * 180 / Math.PI).toFixed(1), travelDeg: +(Math.atan2(vel.x, vel.z) * 180 / Math.PI).toFixed(1), kmh: Math.round(g.state.speed * 3.6) };
    for (let i = 0; i < 60; i++) { g.setTouch({ throttle: 0.6, brake: 0, steer: 0, handbrake: false }); h.step(); }
    const vel2 = v.body.linvel(); out.travelAfterDeg = +(Math.atan2(vel2.x, vel2.z) * 180 / Math.PI).toFixed(1);
    out.yawRateAfter = +v.body.angvel().y.toFixed(2);
    v.setSurface = setSurface; g.setTouch({ throttle: 0, brake: 0, steer: 0, handbrake: false }); h.restore();
    return out;
  },

  /**
   * Curva "humana" con teclado simulado (eventos de tecla reales, con su rampa): acelera,
   * frena cuando el aviso dice FRENA, gira con la tecla cuando dice GIRA. Devuelve si chocó.
   */
  humanCorner(index = 2, kmh = 220) {
    const g = window.__game, v = g.vehicle, L = g.layout, h = headless(g);
    const keys = new Set();
    const key = (code, down) => {
      if (down === keys.has(code)) return;
      down ? keys.add(code) : keys.delete(code);
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    };
    g.setTouch({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    const c = g.cornerGuide.corners[index];
    // Sale de la curva anterior a la velocidad de esa curva y acelera hacia esta.
    const cs = g.cornerGuide.corners;
    const prev = cs[(index - 1 + cs.length) % cs.length];
    const startS = Math.max(prev.exitS + 10, c.entryS - (kmh / 3.6) * 7);
    const v0 = Math.min(kmh / 3.6, prev.exitS + 10 >= c.entryS - (kmh / 3.6) * 7 ? prev.speed : kmh / 3.6);
    const s0 = L.sampleAt(startS);
    v.teleport(s0.x, s0.z, Math.atan2(s0.tx, s0.tz));
    v.body.setLinvel({ x: s0.tx * v0, y: 0, z: s0.tz * v0 }, true);
    g.tracker.hint = -1; g.tracker.wrongWay = 0;
    let braking = false, hits = 0, maxLat = 0, firstBrakeAt = null;
    const log = [];
    for (let i = 0; i < 60 * 14; i++) {
      const t = v.body.translation();
      const p = L.project(t.x, t.z, g.tracker.hint);
      const sp = g.state.speed;
      const info = g.cornerGuide.next(p.s, sp);
      // Frenar: cuando el aviso diga FRENA y hasta bajar a la velocidad recomendada.
      if (info && info.state === 'brake' && !braking) { braking = true; firstBrakeAt = Math.round(info.distance); }
      if (braking && (!info || sp <= info.speed * 1.03)) braking = false;
      key('KeyS', braking);
      // Volante: apunta a un punto 12 m por delante en la línea central (como mira un piloto).
      const ahead = L.offsetPoint(p.s + 12 + sp * 0.3, 0);
      const hd = heading(v.body);
      const ang = Math.atan2(hd.fx * (ahead.z - t.z) - hd.fz * (ahead.x - t.x), hd.fx * (ahead.x - t.x) + hd.fz * (ahead.z - t.z));
      key('KeyD', ang > 0.05); key('KeyA', ang < -0.05);
      key('KeyW', !braking && (!info || info.state === 'info' || sp < info.speed * 0.95));
      h.step();
      if (v.impact > 0.15) hits++;
      maxLat = Math.max(maxLat, Math.abs(p.lateral));
      if (i % 30 === 0) log.push([Math.round(sp * 3.6), info ? info.state : '-', Math.round(p.lateral)]);
      if (p.s > c.exitS + 60 && p.s < c.exitS + 200) break;
    }
    for (const k of [...keys]) key(k, false);
    h.restore();
    return { corner: c.label + ' ' + c.dir, fromKmh: kmh, firstBrakeAt, wallHits: hits, maxLat: +maxLat.toFixed(1), offTrack: maxLat > L.halfWidth + 1.5, log };
  },


  /** Vuelta completa "con teclado" siguiendo solo los avisos de curva (FRENA/GIRA). */
  humanLap() {
    const g = window.__game, v = g.vehicle, L = g.layout, h = headless(g);
    let sim = 0; g.serverNow = () => sim; g.opts.goAt = 0;
    const keys = new Set();
    const key = (code, down) => {
      if (down === keys.has(code)) return;
      down ? keys.add(code) : keys.delete(code);
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    };
    g.setTouch({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    const s0 = L.gridSlots(1)[0];
    v.teleport(s0.x, s0.z, s0.yaw);
    g.tracker.reset(); g.tracker.totalLaps = 1; g.tracker.place(s0.x, s0.z, 0); g.finished = false;
    let braking = false, hits = 0, off = 0, maxLat = 0;
    for (let i = 0; i < 60 * 240 && g.tracker.lapsDone < 1; i++) {
      const t = v.body.translation();
      const p = L.project(t.x, t.z, g.tracker.hint);
      const sp = g.state.speed;
      const info = g.cornerGuide.next(p.s, sp);
      if (info && info.state === 'brake') braking = true;
      if (braking && (!info || sp <= info.speed * 1.03 || (info.state !== 'brake' && sp <= info.speed * 1.1))) braking = false;
      key('KeyS', braking);
      const ahead = L.offsetPoint(p.s + 12 + sp * 0.3, 0);
      const hd = heading(v.body);
      const ang = Math.atan2(hd.fx * (ahead.z - t.z) - hd.fz * (ahead.x - t.x), hd.fx * (ahead.x - t.x) + hd.fz * (ahead.z - t.z));
      key('KeyD', ang > 0.05); key('KeyA', ang < -0.05);
      key('KeyW', !braking && (!info || info.state === 'info' || sp < info.speed * 0.95));
      sim += 1000 / 60;
      g.frame(1 / 60);
      if (v.impact > 0.15) hits++;
      maxLat = Math.max(maxLat, Math.abs(p.lateral));
      if (Math.abs(p.lateral) > L.halfWidth + 1.5) off++;
    }
    for (const k of [...keys]) key(k, false);
    h.restore();
    return { lapTime: g.tracker.lapTimes[0] ?? null, wallHits: hits, offTrackFrames: off, maxLat: +maxLat.toFixed(1) };
  },

  /** Vuelta con piloto automático simple. Devuelve tiempo y salidas de pista. */
  lap(mu = 1.25, decel = 9) {
    const g = window.__game, v = g.vehicle, L = g.layout, h = headless(g);
    const s0 = L.gridSlots(1)[0];
    v.teleport(s0.x, s0.z, s0.yaw);
    g.tracker.reset(); g.tracker.totalLaps = 1; g.tracker.place(s0.x, s0.z, 0); g.finished = false;
    g.opts.goAt = 0; let sim = 0; g.serverNow = () => sim;
    let off = 0, hits = 0, maxLat = 0;
    const trace = [];
    for (let i = 0; i < 60 * 300 && g.tracker.lapsDone < 1; i++) {
      const t = v.body.translation();
      const p = L.project(t.x, t.z, g.tracker.hint);
      const sp = g.state.speed;
      const ahead = L.offsetPoint(p.s + Math.max(9, Math.abs(sp) * 0.5), 0);
      const { fx, fz } = heading(v.body);
      const dx = ahead.x - t.x, dz = ahead.z - t.z;
      const ang = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
      let vmax = 200;
      for (let d = 0; d < 300; d += 5) {
        const s = L.sampleAt(p.s + d);
        const k = Math.max(Math.abs(L.curvature[s.i]), 1e-4);
        const vc = Math.sqrt((9.81 * mu) / k);
        vmax = Math.min(vmax, Math.sqrt(vc * vc + 2 * decel * d));
      }
      g.setTouch({ steer: Math.max(-1, Math.min(1, ang * 2.2)), throttle: sp < vmax ? 1 : 0, brake: sp > vmax + 1.5 ? 1 : 0 });
      sim += 1000 / 60;
      g.frame(1 / 60);
      if (v.impact > 0.15) hits++;
      maxLat = Math.max(maxLat, Math.abs(p.lateral));
      if (Math.abs(p.lateral) > L.halfWidth + 1.4) off++;
      if (i % 600 === 0) trace.push([i / 60, Math.round(sp * 3.6), g.state.gear, Math.round(p.s)]);
    }
    g.setTouch({ throttle: 0, brake: 0, steer: 0 });
    h.restore();
    return { lapTime: g.tracker.lapTimes[0] ?? null, offTrackFrames: off, wallHits: hits, maxLat: +maxLat.toFixed(1), trace };
  },
};
