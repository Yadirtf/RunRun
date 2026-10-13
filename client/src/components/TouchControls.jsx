import { useEffect, useState } from 'react';

/** Pedales y volante táctiles para móviles/tablets (solo con puntero grueso). */
export function TouchControls({ engineRef }) {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    setCoarse(mq.matches);
    const on = (e) => setCoarse(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  if (!coarse) return null;

  const set = (key, value) => (e) => {
    e.preventDefault();
    const input = engineRef.current?.input;
    if (input) input.touch[key] = value;
  };
  const btn = (label, key, down, cls) => (
    <button
      type="button"
      className={`touch-btn ${cls}`}
      onPointerDown={set(key, down)}
      onPointerUp={set(key, 0)}
      onPointerCancel={set(key, 0)}
      onPointerLeave={set(key, 0)}
    >
      {label}
    </button>
  );
  return (
    <div className="touch-controls">
      <div className="touch-left">
        {btn('◀', 'steer', 1, 'steer')}
        {btn('▶', 'steer', -1, 'steer')}
      </div>
      <div className="touch-right">
        {btn('Freno', 'brake', 1, 'brake')}
        {btn('Gas', 'throttle', 1, 'gas')}
      </div>
    </div>
  );
}
