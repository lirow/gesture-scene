import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const expected = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';
const target = fileURLToPath(new URL('../public/models/hand_landmarker.task', import.meta.url));
let bytes;
if (process.argv[2]) {
  bytes = fs.readFileSync(path.resolve(process.argv[2]));
} else {
  console.log('Downloading the official Hand Landmarker model for local use...');
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Model SHA-256 mismatch; no file was installed.');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, bytes);
console.log('Model verified and installed in ignored public/models/. It is excluded from the distribution build.');
