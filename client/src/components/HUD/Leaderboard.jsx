const ROW = 30;

/** Tabla en vivo: filas posicionadas absolutamente para animar los adelantamientos. */
export function Leaderboard({ standings, myId }) {
  const sorted = [...standings].sort((a, b) => a.id.localeCompare(b.id));
  const posOf = new Map(standings.map((s, i) => [s.id, i]));
  return (
    <div className="leaderboard glass" style={{ height: standings.length * ROW + 12 }}>
      {sorted.map((p) => {
        const i = posOf.get(p.id);
        return (
          <div
            key={p.id}
            className={`lb-row ${p.id === myId ? 'me' : ''}`}
            style={{ transform: `translateY(${i * ROW}px)` }}
          >
            <span className="lb-pos">{i + 1}</span>
            <span className="swatch" style={{ background: p.color }} />
            <span className="lb-name">{p.nickname}</span>
          </div>
        );
      })}
    </div>
  );
}
