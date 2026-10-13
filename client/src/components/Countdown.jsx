/** Cuenta atrás 3-2-1-¡YA! sincronizada con el reloj del servidor. */
export function Countdown({ raceMs }) {
  if (raceMs == null || raceMs > 900) return null;
  let label;
  if (raceMs >= 0) label = '¡YA!';
  else label = String(Math.ceil(-raceMs / 1000));
  if (raceMs < -3000) return null;
  return (
    <div className="countdown" aria-live="assertive">
      <span key={label} className={label === '¡YA!' ? 'go' : ''}>{label}</span>
    </div>
  );
}
