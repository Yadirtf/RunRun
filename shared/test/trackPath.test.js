import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS } from '../src/tracks.js';
import { buildTrackPath, projectToTrack, checkpointGates, gridSlot } from '../src/trackPath.js';

for (const def of Object.values(TRACKS)) {
  test(`pista ${def.id}: trazado cerrado, sin cruces y curvas conducibles`, () => {
    const path = buildTrackPath(def, 2);
    assert.ok(path.length > 1000 && path.length < 2500, `longitud ${path.length}`);
    const minRadius = 1 / Math.max(...path.curvature.map(Math.abs));
    assert.ok(minRadius > 15, `radio mínimo ${minRadius}`);
    // Ningún tramo lejano en el trazado está más cerca que 3 anchos de pista.
    for (let i = 0; i < path.count; i += 3) {
      for (let j = i + 3; j < path.count; j += 3) {
        const sep = Math.min(j - i, path.count - (j - i)) * path.step;
        if (sep < 150) continue;
        const d = Math.hypot(path.points[i][0] - path.points[j][0], path.points[i][2] - path.points[j][2]);
        assert.ok(d > def.width * 3, `tramos ${i} y ${j} a ${d.toFixed(1)} m`);
      }
    }
  });

  test(`pista ${def.id}: proyección, checkpoints y parrilla`, () => {
    const path = buildTrackPath(def, 2);
    const p = path.points[100];
    const r = path.rights[100];
    const proj = projectToTrack(path, p[0] + r[0] * 3, p[2] + r[2] * 3);
    assert.equal(proj.index, 100);
    assert.ok(Math.abs(proj.lateral - 3) < 0.01);
    const gates = checkpointGates(path, def.checkpoints);
    assert.equal(gates.length, def.checkpoints);
    assert.equal(gates[0].index, 0);
    const slot = gridSlot(path, 3);
    const sp = projectToTrack(path, slot.position[0], slot.position[2]);
    assert.ok(sp.s > path.length - 40, 'la parrilla está justo detrás de la meta');
    assert.ok(Math.abs(sp.lateral) < def.width / 2);
  });
}
