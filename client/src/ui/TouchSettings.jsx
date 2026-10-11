// Ajustes de los controles táctiles (menú principal y pausa).
import { useGame } from '../store/gameStore.js';

const MODES = [
  ['buttons', 'Botones', 'Dos botones ◀ ▶; el giro aumenta poco a poco, como un volante.'],
  ['slider', 'Deslizador', 'Apoya el dedo y deslízalo: dirección analógica y precisa.'],
  ['tilt', 'Inclinación', 'Gira el móvil o la tablet como si fuera un volante.'],
];

export default function TouchSettings() {
  const t = useGame((s) => s.touch);
  const set = useGame((s) => s.setTouchSettings);
  const mode = MODES.find((m) => m[0] === t.mode) ?? MODES[0];
  return (
    <div className="touch-settings">
      <div className="settings-row">
        <span>Dirección</span>
        <div className="segmented">
          {MODES.map(([id, label]) => (
            <button key={id} className={t.mode === id ? 'active' : ''} onClick={() => set({ mode: id })}>{label}</button>
          ))}
        </div>
      </div>
      <p className="muted">{mode[2]}</p>
      <label className="settings-row">
        <span>Sensibilidad</span>
        <input type="range" min="0.5" max="1.5" step="0.05" value={t.sensitivity} onChange={(e) => set({ sensitivity: Number(e.target.value) })} />
      </label>
      <label className="settings-row">
        <span>Transparencia de los botones</span>
        <input type="range" min="0.25" max="0.9" step="0.05" value={t.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />
      </label>
      <label className="settings-row check">
        <span>Acelerador automático (solo frenas)</span>
        <input type="checkbox" checked={t.autoGas} onChange={(e) => set({ autoGas: e.target.checked })} />
      </label>
      <label className="settings-row check">
        <span>Modo zurdo (pedales a la izquierda)</span>
        <input type="checkbox" checked={t.leftHanded} onChange={(e) => set({ leftHanded: e.target.checked })} />
      </label>
      <label className="settings-row check">
        <span>Vibración</span>
        <input type="checkbox" checked={t.haptics} onChange={(e) => set({ haptics: e.target.checked })} />
      </label>
    </div>
  );
}
