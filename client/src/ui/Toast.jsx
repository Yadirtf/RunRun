import { useGame } from '../store/gameStore.js';

export default function Toast() {
  const notice = useGame((s) => s.notice);
  if (!notice) return null;
  return <div className="toast" role="status" key={notice.at}>{notice.text}</div>;
}
