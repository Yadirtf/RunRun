import { useGameStore } from '../store/gameStore.js';

const OPTIONS = [
  ['auto', 'Auto'],
  ['low', 'Bajo'],
  ['medium', 'Medio'],
  ['high', 'Alto'],
];

/** Calidad gráfica de la carrera (se guarda en el navegador). Bajo = móviles modestos. */
export function QualityPicker() {
  const quality = useGameStore((s) => s.quality);
  const setQuality = useGameStore((s) => s.setQuality);
  return (
    <div className="quality-picker" role="radiogroup" aria-label="Calidad gráfica">
      <span>Gráficos</span>
      <div className="segmented">
        {OPTIONS.map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={quality === id} className={quality === id ? 'on' : ''} onClick={() => setQuality(id)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
