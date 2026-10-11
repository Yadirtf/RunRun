// Velocímetro: arco de RPM con zona roja, velocidad digital y marcha.
const START = 135, SWEEP = 270, R = 74, C = 90;

function polar(angle, r = R) {
  const a = (angle * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function arc(from, to, r = R) {
  const [x1, y1] = polar(from, r), [x2, y2] = polar(to, r);
  return `M${x1} ${y1} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

export default function Speedometer({ speedKmh, rpm, redline, gear }) {
  const maxRpm = Math.ceil((redline * 1.08) / 1000) * 1000;
  const frac = Math.min(rpm / maxRpm, 1);
  const redFrac = redline / maxRpm;
  const ticks = [];
  for (let k = 0; k <= maxRpm / 1000; k++) {
    const a = START + (k * 1000 / maxRpm) * SWEEP;
    const [x1, y1] = polar(a, R - 10), [x2, y2] = polar(a, R - 2), [tx, ty] = polar(a, R - 22);
    ticks.push(
      <g key={k}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={k * 1000 >= redline ? '#ff4d4d' : '#cfd6e4'} strokeWidth="2" />
        <text x={tx} y={ty + 4} textAnchor="middle" className="tick-label">{k}</text>
      </g>,
    );
  }
  const needle = START + frac * SWEEP;
  const [nx, ny] = polar(needle, R - 6);
  const gearLabel = gear === -1 ? 'R' : gear === 0 ? 'N' : String(gear);
  return (
    <div className="speedo">
      <svg viewBox="0 0 180 180">
        <path d={arc(START, START + SWEEP)} className="speedo-track" />
        <path d={arc(START + redFrac * SWEEP, START + SWEEP)} className="speedo-red" />
        {frac > 0.001 && <path d={arc(START, needle)} className={`speedo-fill ${rpm > redline * 0.94 ? 'hot' : ''}`} />}
        {ticks}
        <line x1={C} y1={C} x2={nx} y2={ny} className="speedo-needle" />
        <circle cx={C} cy={C} r="5" fill="#e63946" />
      </svg>
      <div className="speedo-readout">
        <b>{Math.round(speedKmh)}</b>
        <small>km/h</small>
      </div>
      <div className="speedo-gear">{gearLabel}</div>
    </div>
  );
}
