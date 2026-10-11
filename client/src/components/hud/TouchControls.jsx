// Controles táctiles para móvil y tablet.
// - Dirección: botones ◀ ▶ (con rampa, como un volante), deslizador analógico o inclinación.
// - Pedales: acelerador, freno y freno de mano (multitáctil, se pueden pulsar a la vez).
// - Botones rápidos: cámara, volver a pista y pausa.
// Usa Pointer Events con captura: cada dedo se queda con el control que tocó aunque se deslice.
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../store/gameStore.js';
import { vibrate as buzz } from '../../ui/device.js';

const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* puntero ya liberado */ } };

/** Llama a onChange(true/false) mientras haya algún dedo sobre el elemento. */
function usePress(onChange) {
  const ref = useRef(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const pointers = new Set();
    const down = (e) => {
      e.preventDefault();
      capture(el, e.pointerId);
      pointers.add(e.pointerId);
      el.classList.add('pressed');
      if (pointers.size === 1) cb.current(true);
    };
    const up = (e) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size === 0) { el.classList.remove('pressed'); cb.current(false); }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
      if (pointers.size) cb.current(false);
    };
  }, []);
  return ref;
}

const vibrate = (ms) => buzz(ms, useGame.getState().touch.haptics);

/** Dirección con dos botones: el valor sube progresivamente, como girar un volante. */
function SteerButtons({ game, sensitivity }) {
  const held = useRef({ left: false, right: false });
  const [dir, setDir] = useState(0);
  const leftRef = usePress((on) => { held.current.left = on; if (on) vibrate(8); });
  const rightRef = usePress((on) => { held.current.right = on; if (on) vibrate(8); });

  useEffect(() => {
    let raf, last = performance.now(), steer = 0;
    const tick = (t) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      const target = (held.current.right ? 1 : 0) - (held.current.left ? 1 : 0);
      const returning = target === 0 || Math.sign(target) !== Math.sign(steer);
      const rate = (returning ? 6 : 2.8 * sensitivity) * dt;
      steer += Math.max(-rate, Math.min(rate, target - steer));
      game.setTouch({ steer });
      const d = Math.sign(Math.round(steer * 3));
      setDir((prev) => (prev === d ? prev : d));
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); game.setTouch({ steer: 0 }); };
  }, [game, sensitivity]);

  return (
    <div className="tc-steer-buttons">
      <button ref={leftRef} className={`tc-btn tc-arrow ${dir < 0 ? 'active' : ''}`} aria-label="Girar a la izquierda">◀</button>
      <button ref={rightRef} className={`tc-btn tc-arrow ${dir > 0 ? 'active' : ''}`} aria-label="Girar a la derecha">▶</button>
    </div>
  );
}

/** Deslizador analógico: el punto donde apoyas el dedo es el centro; desplaza para girar. */
function SteerSlider({ game, sensitivity }) {
  const ref = useRef(null);
  const [knob, setKnob] = useState(null); // { x0, x, y }

  useEffect(() => {
    const el = ref.current;
    let id = null, x0 = 0;
    const range = () => (el.clientWidth * 0.28) / sensitivity;
    const set = (x, y) => {
      const v = Math.max(-1, Math.min(1, (x - x0) / range()));
      // Curva suave: precisión cerca del centro, giro completo en los extremos.
      game.setTouch({ steer: Math.sign(v) * Math.pow(Math.abs(v), 1.35) });
      setKnob({ x0, x: x0 + v * range(), y });
    };
    const down = (e) => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      capture(el, id);
      const r = el.getBoundingClientRect();
      x0 = e.clientX - r.left;
      set(x0, e.clientY - r.top);
      vibrate(8);
    };
    const move = (e) => {
      if (e.pointerId !== id) return;
      const r = el.getBoundingClientRect();
      set(e.clientX - r.left, e.clientY - r.top);
    };
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      game.setTouch({ steer: 0 });
      setKnob(null);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      game.setTouch({ steer: 0 });
    };
  }, [game, sensitivity]);

  return (
    <div ref={ref} className="tc-slider" aria-label="Zona de dirección: desliza a izquierda o derecha">
      {knob ? (
        <>
          <span className="tc-slider-track" style={{ left: knob.x0, top: knob.y }} />
          <span className="tc-slider-knob" style={{ left: knob.x, top: knob.y }} />
        </>
      ) : (
        <span className="tc-hint">◀ desliza para girar ▶</span>
      )}
    </div>
  );
}

/** Inclinación: gira el dispositivo como un volante. */
function SteerTilt({ game, sensitivity }) {
  const [status, setStatus] = useState('idle'); // idle | on | denied | unsupported
  const [angle, setAngle] = useState(0);
  const center = useRef(0);
  const lastRaw = useRef(0);

  const start = async () => {
    try {
      const DM = window.DeviceMotionEvent;
      if (!DM) { setStatus('unsupported'); return; }
      if (typeof DM.requestPermission === 'function') {
        const res = await DM.requestPermission();
        if (res !== 'granted') { setStatus('denied'); return; }
      }
      setStatus('on');
    } catch {
      setStatus('denied');
    }
  };

  useEffect(() => {
    // En Android no hace falta permiso: se activa directamente.
    if (typeof window.DeviceMotionEvent?.requestPermission !== 'function') start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== 'on') return undefined;
    let smooth = 0, frame = 0;
    const onMotion = (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x === null) return;
      const orient = ((screen.orientation?.angle ?? window.orientation ?? 0) + 360) % 360;
      // Componente de la gravedad en el eje que gira al mover el dispositivo como un volante.
      let g;
      if (orient === 90) g = a.y;
      else if (orient === 270) g = -a.y;
      else if (orient === 180) g = a.x;
      else g = -a.x;
      const deg = (Math.asin(Math.max(-1, Math.min(1, g / 9.81))) * 180) / Math.PI;
      lastRaw.current = deg;
      const rel = deg - center.current;
      const maxDeg = 26 / sensitivity;
      const dead = 1.5;
      const v = Math.abs(rel) < dead ? 0 : Math.max(-1, Math.min(1, (rel - Math.sign(rel) * dead) / maxDeg));
      smooth += (v - smooth) * 0.35;
      game.setTouch({ steer: smooth });
      if (++frame % 4 === 0) setAngle(rel);
    };
    window.addEventListener('devicemotion', onMotion);
    return () => { window.removeEventListener('devicemotion', onMotion); game.setTouch({ steer: 0 }); };
  }, [status, game, sensitivity]);

  if (status !== 'on') {
    return (
      <div className="tc-tilt">
        {status === 'idle' && <button className="tc-btn tc-wide" onClick={start}>Activar inclinación</button>}
        {status === 'denied' && <p className="tc-hint">Permiso denegado. Usa botones o deslizador en Ajustes.</p>}
        {status === 'unsupported' && <p className="tc-hint">Este dispositivo no tiene sensor de inclinación.</p>}
      </div>
    );
  }
  return (
    <div className="tc-tilt">
      <div className="tc-tilt-wheel" style={{ transform: `rotate(${Math.max(-90, Math.min(90, angle * 2))}deg)` }}>⎈</div>
      <button className="tc-btn tc-small" onClick={() => { center.current = lastRaw.current; vibrate(15); }}>Centrar</button>
    </div>
  );
}

function Pedals({ game, autoGas }) {
  const state = useRef({ gas: false, brake: false });
  const apply = () => {
    const { gas, brake } = state.current;
    game.setTouch({ throttle: brake ? 0 : gas || autoGas ? 1 : 0, brake: brake ? 1 : 0 });
  };
  const gasRef = usePress((on) => { state.current.gas = on; apply(); });
  const brakeRef = usePress((on) => { state.current.brake = on; if (on) vibrate(10); apply(); });
  const handRef = usePress((on) => { game.setTouch({ handbrake: on }); if (on) vibrate(20); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { apply(); }, [autoGas]);
  useEffect(() => () => game.setTouch({ throttle: 0, brake: 0, handbrake: false }), [game]);

  return (
    <div className="tc-pedals">
      <div className="tc-pedal-col">
        <button ref={handRef} className="tc-btn tc-hand" aria-label="Freno de mano">Freno<br />de mano</button>
        <button ref={brakeRef} className="tc-btn tc-brake" aria-label="Freno">FRENO</button>
      </div>
      {!autoGas && <button ref={gasRef} className="tc-btn tc-gas" aria-label="Acelerador">GAS</button>}
      {autoGas && <div className="tc-autogas">Acelerador automático</div>}
    </div>
  );
}

export default function TouchControls({ game, onPause }) {
  const settings = useGame((s) => s.touch);
  const style = { '--tc-opacity': settings.opacity };
  const Steer = settings.mode === 'tilt' ? SteerTilt : settings.mode === 'slider' ? SteerSlider : SteerButtons;

  return (
    <div className={`touch-controls ${settings.leftHanded ? 'left-handed' : ''}`} style={style}>
      <div className="tc-toolbar">
        <button className="tc-btn tc-icon" onClick={() => game.cycleCamera()} aria-label="Cambiar cámara">🎥</button>
        <button className="tc-btn tc-icon" onClick={() => { game.resetToTrack(); vibrate(20); }} aria-label="Volver a la pista">↺</button>
        <button className="tc-btn tc-icon" onClick={onPause} aria-label="Pausa y ajustes">⏸</button>
      </div>
      <div className="tc-side tc-steer-side">
        <Steer game={game} sensitivity={settings.sensitivity} />
      </div>
      <div className="tc-side tc-pedal-side">
        <Pedals game={game} autoGas={settings.autoGas} />
      </div>
    </div>
  );
}
