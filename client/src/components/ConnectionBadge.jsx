import { useGameStore } from '../store/gameStore.js';

const LABELS = { connecting: 'Conectando…', connected: 'En línea', disconnected: 'Sin conexión · reintentando' };

export function ConnectionBadge() {
  const connection = useGameStore((s) => s.connection);
  return (
    <div className={`conn-badge ${connection}`} title="Estado del servidor">
      <i />
      {LABELS[connection]}
    </div>
  );
}
