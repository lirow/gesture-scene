import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleShape } from '../public/src/engine/showcase-shapes.js';
import { PRESETS } from '../public/src/presets/index.js';

test('showcase samples reproducible, finite geometry from each actual preset', () => {
  for (const preset of Object.values(PRESETS)) {
    const first = sampleShape(preset, 500);
    assert.equal(first.length, 1500);
    assert.ok(first.every(Number.isFinite));
    assert.deepEqual(first, sampleShape(preset, 500));
    const ys = Array.from({ length: 500 }, (_, i) => first[i * 3 + 1]);
    assert.ok(Math.max(...ys) - Math.min(...ys) > 2.4, `${preset.id} must fill its expected vertical span`);
  }
  assert.notDeepEqual(sampleShape(PRESETS.heart, 500), sampleShape(PRESETS.xmas2026, 500));
});
