const MAX = 240;
const START = 135;
const SWEEP = 270;

function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [100 + Math.cos(a) * r, 100 + Math.sin(a) * r];
}

function arc(r, from, to) {
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  return `M${x1} ${y1} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

const ticks = Array.from({ length: MAX / 20 + 1 }, (_, i) => i * 20);

/** Velocímetro analógico SVG con aguja, arco de RPM, marcha y lectura digital. */
export function Speedometer({ speed, rpm, gear }) {
  const angle = START + (Math.min(speed, MAX) / MAX) * SWEEP;
  const rpmEnd = START + Math.max(0.001, Math.min(1, rpm)) * SWEEP;
  return (
    <div className="speedometer">
      <svg viewBox="0 0 200 200">
        <path d={arc(88, START, START + SWEEP)} className="dial-bg" />
        <path d={arc(88, START, rpmEnd)} className={`dial-rpm ${rpm > 0.9 ? 'redline' : ''}`} />
        {ticks.map((t) => {
          const a = START + (t / MAX) * SWEEP;
          const [x1, y1] = polar(76, a);
          const [x2, y2] = polar(t % 40 === 0 ? 66 : 71, a);
          const [lx, ly] = polar(54, a);
          return (
            <g key={t}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} className="tick" />
              {t % 40 === 0 && <text x={lx} y={ly} className="tick-label">{t}</text>}
            </g>
          );
        })}
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '100px 100px' }} className="needle">
          <line x1="112" y1="100" x2="172" y2="100" />
        </g>
        <circle cx="100" cy="100" r="22" className="gear-bg" />
        <text x="100" y="101" className="gear">{gear ?? 'N'}</text>
      </svg>
      <div className="digital">
        <strong>{Math.round(speed)}</strong>
        <span>KM/H</span>
      </div>
    </div>
  );
}
