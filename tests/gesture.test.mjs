import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GestureFSM, measure, pinchAmountOf } from '../public/src/engine/gesture.js';

// Synthetic measurements avoid distributing photographs or captured landmarks.
const pose = (count, pinch) => ({ fingers: Array.from({ length: 4 }, (_, i) => ({ ratio: i < count ? 1.5 : 0.7 })), extendCount: count, pinch });

test('gesture state only changes after four stable frames', () => {
  const fsm = new GestureFSM();
  for (let i = 0; i < 3; i++) assert.equal(fsm.update(pose(4, 0.5), i * 33).state, 'none');
  assert.equal(fsm.update(pose(4, 0.5), 99).state, 'open');
});
test('one held pinch produces one pick, release allows the next pick', () => {
  const fsm = new GestureFSM();
  let picks = 0;
  for (let i = 0; i < 240; i++) picks += Number(fsm.update(pose(3, 0.16), 1000 + i * 33).pick);
  assert.equal(picks, 1);
  assert.equal(fsm.pinchAmount, 1);
  assert.equal(fsm.update(pose(4, 0.5), 9000).pinchAmount, 0);
  assert.equal(fsm.update(pose(3, 0.16), 9400).pick, true);
});
test('a fist cannot trigger a pinch even when thumb and index are close', () => {
  const fsm = new GestureFSM();
  for (let i = 0; i < 8; i++) {
    const result = fsm.update(pose(0, 0.17), 1000 + i * 33);
    assert.equal(result.pick, false);
    assert.equal(result.pinchAmount, 0);
  }
  assert.equal(fsm.stable, 'fist');
});
test('rapid alternating poses do not change stable state; release clears a held pinch', () => {
  const fsm = new GestureFSM();
  for (let i = 0; i < 60; i++) assert.equal(fsm.update(pose(i % 2 ? 0 : 4, 0.5), i * 16).changed, false);
  fsm.update(pose(3, 0.16), 2000);
  fsm.release();
  assert.equal(fsm.pinchAmount, 0);
  assert.equal(fsm.pinchActive, false);
  assert.equal(fsm.stable, 'none');
});
test('pinch strength is bounded and increases as distance decreases', () => {
  assert.deepEqual([0.5, 0.36, 0.26, 0.16, 0].map(distance => Number(pinchAmountOf(distance).toFixed(3))), [0, 0, 0.5, 1, 1]);
});
test('measuring synthetic landmarks is invariant under translation and uniform scaling', () => {
  const points = Array.from({ length: 21 }, (_, i) => ({ x: 0.1 + (i % 5) * 0.1, y: 0.1 + i * 0.02, z: 0 }));
  const a = measure(points);
  const b = measure(points.map(p => ({ x: p.x * 0.5 + 0.2, y: p.y * 0.5 + 0.1, z: 0 })));
  assert.ok(Math.abs(a.pinch - b.pinch) < 1e-10);
  assert.equal(a.extendCount, b.extendCount);
});
