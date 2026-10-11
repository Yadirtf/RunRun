// Aviso de la próxima curva: sentido, dureza, distancia y velocidad recomendada.
// Cambia de color según haga falta prepararse, frenar o girar ya.
const STATE_TEXT = {
  info: null,
  prepare: 'Prepárate',
  brake: '¡FRENA!',
  turn: '¡GIRA!',
  in: null,
};

function Arrow({ dir, level }) {
  // Flechas para giro a la derecha; para la izquierda se reflejan. Más cerrada = más doblada.
  const shape = level <= 1
    ? { d: 'M18 58 L18 30 A15 15 0 0 1 48 30 L48 38', head: 'translate(48 46) rotate(90)' }
    : level <= 3
      ? { d: 'M22 58 L22 34 Q22 20 36 20 L44 20', head: 'translate(51 20)' }
      : { d: 'M26 58 L26 38 L41 22', head: 'translate(46 17) rotate(-45)' };
  return (
    <svg viewBox="0 0 64 64" className="corner-arrow" aria-hidden="true">
      <g transform={dir === 'left' ? 'translate(64 0) scale(-1 1)' : undefined}>
        <path d={shape.d} fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        <polygon points="-6,-10 8,0 -6,10" fill="currentColor" transform={shape.head} />
      </g>
    </svg>
  );
}

export default function CornerAlert({ corner, speedKmh }) {
  if (!corner || corner.state === 'in') return null;
  const call = STATE_TEXT[corner.state];
  const tooFast = speedKmh > corner.targetKmh + 5;
  return (
    <div className={`corner-alert ${corner.state}`} role="status">
      <Arrow dir={corner.dir} level={corner.level} />
      <div className="corner-info">
        <b>{corner.label} a la {corner.dir === 'left' ? 'izquierda' : 'derecha'}</b>
        <span>{Math.round(corner.distance)} m · máx. ~{Math.round(corner.targetKmh / 5) * 5} km/h{tooFast ? ' ↓' : ''}</span>
      </div>
      {call && <div className="corner-call">{call}</div>}
    </div>
  );
}
