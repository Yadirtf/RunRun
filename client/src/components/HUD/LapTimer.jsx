import { formatTime } from '../format.js';

export function LapTimer({ lap, laps, lapMs, lastLapMs, bestLapMs, position, total }) {
  return (
    <div className="lap-timer glass">
      <div className="pos-lap">
        <div>
          <span className="label">Posición</span>
          <strong className="big">{position}<small>/{total}</small></strong>
        </div>
        <div>
          <span className="label">Vuelta</span>
          <strong className="big">{lap}<small>/{laps}</small></strong>
        </div>
      </div>
      <div className="times">
        <div><span>Actual</span><b>{formatTime(lapMs)}</b></div>
        <div><span>Última</span><b>{formatTime(lastLapMs)}</b></div>
        <div className="best"><span>Mejor</span><b>{formatTime(bestLapMs)}</b></div>
      </div>
    </div>
  );
}
