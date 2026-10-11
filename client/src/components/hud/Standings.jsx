// Clasificación en vivo (según el servidor).
export default function Standings({ rows, meId }) {
  if (!rows.length) return null;
  return (
    <ol className="standings">
      {rows.map((r) => (
        <li key={r.id} className={r.id === meId ? 'me' : ''}>
          <span className="pos">{r.pos}</span>
          <span className="dot" style={{ background: r.color }} />
          <span className="name">{r.nickname}</span>
          <span className="lap">{r.fin ? '🏁' : `V${r.lap}`}</span>
        </li>
      ))}
    </ol>
  );
}
