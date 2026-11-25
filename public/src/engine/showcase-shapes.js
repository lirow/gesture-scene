import { mulberry32 } from './util.js';

/** Reuse the actual preset geometry so the preview and entered scene agree. */
export function sampleShape(preset, count) {
  const random = mulberry32(preset.seed.particles);
  const positions = new Float32Array(count * 3);
  const values = new Float32Array(24);
  const out = {};
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < values.length; j++) values[j] = random();
    preset.shape.layout(values, out);
    positions.set([out.x, out.y, out.z], i * 3);
  }
  return positions;
}
