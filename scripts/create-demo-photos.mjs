// Original, deterministic abstract raster artwork. No photographs or external assets.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = fileURLToPath(new URL('../public/photos/demo/', import.meta.url));
fs.mkdirSync(out, { recursive: true });
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}
function picture(index, christmas) {
  const size = 512;
  const rows = Buffer.alloc((1 + size * 3) * size);
  const stars = Array.from({ length: 36 }, (_, n) => [((n * 73 + index * 41) % 490) + 11, ((n * 113 + index * 17) % 390) + 10]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const wave = Math.sin(u * 6 + index * 0.25) * 0.07 + 0.66;
    const hill = v > wave;
    let rgb = christmas ? [22 + v * 19, 59 + v * 65, 75 + v * 48] : [47 + v * 66, 31 + v * 25, 81 + v * 53];
    if (hill) rgb = christmas ? [17, 37 + v * 24, 43] : [36, 24, 61 + v * 15];
    const dx = u - (0.3 + (index % 5) * 0.09), dy = v - 0.32;
    if (dx * dx + dy * dy < 0.012) rgb = christmas ? [247, 213, 137] : [248, 161, 173];
    if (christmas) {
      const ty = (v - 0.34) / 0.42;
      if (ty >= 0 && ty <= 1 && Math.abs(u - 0.67) < ty * 0.21) rgb = [35, 105 + ty * 40, 96];
    } else {
      const hx = (u - 0.64) * 5.4, hy = -(v - 0.58) * 5.4;
      if ((hx * hx + hy * hy - 1) ** 3 - hx * hx * hy ** 3 < 0) rgb = [224, 110 + (index % 4) * 12, 150];
    }
    if (stars.some(([sx, sy]) => Math.abs(x - sx) + Math.abs(y - sy) < 2)) rgb = [244, 234, 206];
    const offset = y * (size * 3 + 1) + 1 + x * 3;
    rows[offset] = rgb[0]; rows[offset + 1] = rgb[1]; rows[offset + 2] = rgb[2];
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
for (const theme of ['heart', 'xmas']) {
  const photos = [];
  for (let index = 1; index <= 20; index++) {
    const name = `${theme}-${String(index).padStart(2, '0')}`;
    const file = `photos/demo/${name}.png`;
    fs.writeFileSync(out + `${name}.png`, picture(index, theme === 'xmas'));
    photos.push({ name, thumb: file, mid: file });
  }
  fs.writeFileSync(out + `${theme}.json`, JSON.stringify({ count: photos.length, photos }, null, 2) + '\n');
}
console.log('Generated 40 original 512px abstract demo images (MIT).');
