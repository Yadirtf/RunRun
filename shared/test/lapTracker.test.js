import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LapTracker, getTrackLayout, TRACK_IDS, sanitizeNickname, formatTime } from '../src/index.js';

function drive(tracker, layout, fromS, toS, speed, t0, lateral = 0) {
  const dt = 50;
  let t = t0;
  const events = [];
  for (let s = fromS; s <= toS; s += speed * (dt / 1000)) {
    t += dt;
    const p = layout.offsetPoint(s, lateral);
    events.push(...tracker.update(p.x, p.z, t));
  }
  return { events, t };
}

for (const id of TRACK_IDS) {
  test(`${id}: completa vueltas conduciendo por la pista`, () => {
    const layout = getTrackLayout(id);
    const tracker = new LapTracker(layout, 2);
    const slot = layout.gridSlots(1)[0];
    tracker.place(slot.x, slot.z, 0);
    const { events } = drive(tracker, layout, slot.s, layout.length * 2 + 30, 60, 0, 3);
    const laps = events.filter((e) => e.type === 'lap');
    assert.equal(laps.length, 2);
    assert.ok(events.some((e) => e.type === 'finish'));
    const expected = (layout.length / 60) * 1000;
    assert.ok(Math.abs(laps[1].lapTime - expected) < 400, `vuelta ${laps[1].lapTime} vs ${expected}`);
  });
}

test('un salto (atajo/teletransporte) no cuenta como progreso', () => {
  const layout = getTrackLayout('monza');
  const tracker = new LapTracker(layout, 1);
  const slot = layout.gridSlots(1)[0];
  tracker.place(slot.x, slot.z, 0);
  drive(tracker, layout, slot.s, 200, 50, 0);
  const before = tracker.distance;
  const far = layout.offsetPoint(2500, 0);
  tracker.update(far.x, far.z, 20_000);
  assert.ok(tracker.distance - before < 50);
});

test('utilidades', () => {
  assert.equal(sanitizeNickname('  <b>Ana</b>  '), 'bAna/b');
  assert.equal(sanitizeNickname('ab'), null);
  assert.equal(formatTime(83456), '1:23.456');
});
