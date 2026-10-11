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
    v.teleport(cx - half + 60, L.bounds.minZ - 450, Math.PI / 2);
    let t100 = null, i = 0;
    for (; i < 60 * 40 && v.body.translation().x < cx + half - 400; i++) {
      g.setTouch({ throttle: 1, brake: 0, steer: 0 }); h.step();
      if (t100 === null && g.state.speed >= 27.78) t100 = i / 60;
    }
    const vmax = g.state.speed * 3.6;
    while (g.state.speed > 27.78) { g.setTouch({ throttle: 0, brake: 1 }); h.step(); }
    const p0 = v.body.translation();
    let frames = 0;
    while (g.state.speed > 0.3 && frames < 600) { g.setTouch({ throttle: 0, brake: 1 }); h.step(); frames++; }
    const p1 = v.body.translation();
    v.setSurface = setSurface;
    g.setTouch({ throttle: 0, brake: 0 });
    h.restore();
    return { t0_100: t100, vmaxKmh: +vmax.toFixed(0), brake100m: +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1) };
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
