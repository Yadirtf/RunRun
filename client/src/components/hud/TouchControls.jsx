// Controles táctiles para móvil/tablet: volante a la izquierda, pedales a la derecha.
import { useEffect, useRef } from 'react';

export default function TouchControls({ game }) {
  const steerRef = useRef(null);

  useEffect(() => {
    if (!game) return undefined;
    const el = steerRef.current;
    let id = null, cx = 0;
    const down = (e) => {
      const t = e.changedTouches[0];
      id = t.identifier;
      const r = el.getBoundingClientRect();
      cx = r.left + r.width / 2;
      move(e);
    };
    const move = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        const r = el.getBoundingClientRect();
        game.setTouch({ steer: Math.max(-1, Math.min(1, (t.clientX - cx) / (r.width / 2))) });
      }
      e.preventDefault();
    };
    const up = (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) { id = null; game.setTouch({ steer: 0 }); }
    };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
    };
  }, [game]);

  const pedal = (key, value) => ({
    onTouchStart: (e) => { e.preventDefault(); game?.setTouch({ [key]: value }); },
    onTouchEnd: () => game?.setTouch({ [key]: key === 'handbrake' ? false : 0 }),
    onTouchCancel: () => game?.setTouch({ [key]: key === 'handbrake' ? false : 0 }),
  });

  return (
    <div className="touch-controls">
      <div ref={steerRef} className="touch-steer"><span>◀ volante ▶</span></div>
      <div className="touch-pedals">
        <button {...pedal('handbrake', true)}>Mano</button>
        <button {...pedal('brake', 1)}>Freno</button>
        <button className="gas" {...pedal('throttle', 1)}>Gas</button>
      </div>
    </div>
  );
}
