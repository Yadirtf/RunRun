import { useEffect, useRef, useState } from 'react';
import { isTouchDevice } from '../lib/landscape.js';

/**
 * Controles táctiles para móvil y tablet:
 *  - izquierda: volante deslizante (proporcional a la posición del dedo)
 *  - derecha: pedal de freno (mantenido con el coche parado = marcha atrás),
 *    pedal de acelerador y palanca de freno de mano
 * Cada control captura su propio dedo, así que se pueden usar a la vez.
 */
export function TouchControls({ engineRef }) {
  const [touch, setTouch] = useState(isTouchDevice);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const on = (e) => setTouch(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  if (!touch) return null;

  const input = () => engineRef.current?.input;
  return (
    <div className="touch-controls" onContextMenu={(e) => e.preventDefault()}>
      <SteerPad input={input} />
      <div className="touch-actions">
        <button type="button" className="touch-mini" onPointerDown={() => input()?.actions.add('reset')} aria-label="Recolocar coche">↺</button>
        <button type="button" className="touch-mini" onPointerDown={() => input()?.actions.add('camera')} aria-label="Cambiar cámara">◉</button>
      </div>
      <div className="pedals">
        <Pedal input={input} field="handbrake" className="handbrake" label="Freno de mano" short="P" />
        <Pedal input={input} field="brake" className="brake" label="Freno · mantener para reversa" short="FRENO" sub="R" />
        <Pedal input={input} field="throttle" className="gas" label="Acelerador" short="GAS" />
      </div>
    </div>
  );
}

/** Captura el dedo en el control aunque se deslice fuera de él. */
function capture(el, id) {
  try {
    el.setPointerCapture?.(id);
  } catch {
    /* puntero ya liberado */
  }
}

function Pedal({ input, field, className, label, short, sub }) {
  const [down, setDown] = useState(false);
  const press = (on) => (e) => {
    e.preventDefault();
    if (on) capture(e.currentTarget, e.pointerId);
    const i = input();
    if (i) i.touch[field] = on ? 1 : 0;
    setDown(on);
    if (on) navigator.vibrate?.(8);
  };
  return (
    <button
      type="button"
      className={`pedal ${className} ${down ? 'down' : ''}`}
      aria-label={label}
      onPointerDown={press(true)}
      onPointerUp={press(false)}
      onPointerCancel={press(false)}
    >
      <span className="pedal-grip" aria-hidden="true" />
      <b>{short}</b>
      {sub && <small>{sub}</small>}
    </button>
  );
}

function SteerPad({ input }) {
  const ref = useRef(null);
  const [value, setValue] = useState(0);
  const apply = (v) => {
    const i = input();
    if (i) i.touch.steer = v;
    setValue(v);
  };
  const fromEvent = (e) => {
    const r = ref.current.getBoundingClientRect();
    // El pad puede estar rotado por CSS (modo horizontal forzado): proyectar sobre su eje largo.
    const rotated = r.height > r.width;
    const pos = rotated ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    const dx = (pos - 0.5) * 2; // -1 izquierda … 1 derecha
    const dead = 0.08;
    const mag = Math.min(1, Math.max(0, (Math.abs(dx) - dead) / 0.62));
    return -Math.sign(dx) * mag; // positivo = izquierda (convención del vehículo)
  };
  const onDown = (e) => {
    e.preventDefault();
    capture(ref.current, e.pointerId);
    apply(fromEvent(e));
  };
  const onMove = (e) => {
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    if (ref.current.hasPointerCapture?.(e.pointerId)) apply(fromEvent(e));
  };
  const onUp = () => apply(0);
  return (
    <div
      ref={ref}
      className="steer-pad"
      role="slider"
      aria-label="Volante: desliza a izquierda o derecha"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={-value}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <span className={`steer-arrow left ${value > 0.05 ? 'on' : ''}`}>◀</span>
      <span className="steer-track"><i style={{ left: `${50 - value * 42}%` }} /></span>
      <span className={`steer-arrow right ${value < -0.05 ? 'on' : ''}`}>▶</span>
    </div>
  );
}
