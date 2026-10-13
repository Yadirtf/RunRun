import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore.js';

export function Toast() {
  const toast = useGameStore((s) => s.toast);
  const clear = useGameStore((s) => s.clearToast);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(clear, 3800);
    return () => clearTimeout(t);
  }, [toast, clear]);
  if (!toast) return null;
  return (
    <div key={toast.id} className={`toast ${toast.kind}`} role="status" onClick={clear}>
      {toast.message}
    </div>
  );
}
