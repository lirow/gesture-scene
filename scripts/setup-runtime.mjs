import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'public/vendor');
const modules = path.join(root, 'node_modules');
const mp = path.join(modules, '@mediapipe/tasks-vision');
const three = path.join(modules, 'three');
const visionVersion = JSON.parse(fs.readFileSync(path.join(mp, 'package.json'))).version;
fs.mkdirSync(vendor, { recursive: true });
fs.copyFileSync(path.join(mp, 'vision_bundle.mjs'), path.join(vendor, 'vision_bundle.js'));
fs.cpSync(path.join(mp, 'wasm'), path.join(vendor, 'wasm'), { recursive: true });
fs.copyFileSync(path.join(three, 'build/three.module.min.js'), path.join(vendor, 'three.module.js'));
fs.cpSync(path.join(three, 'examples/jsm'), path.join(vendor, 'jsm'), { recursive: true });
const files = {};
for (const name of fs.readdirSync(path.join(vendor, 'wasm')).filter(name => name.endsWith('.wasm'))) {
  const bytes = fs.readFileSync(path.join(vendor, 'wasm', name));
  files[name] = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
fs.writeFileSync(path.join(vendor, 'runtime.json'), JSON.stringify({ visionVersion, files }, null, 2) + '\n');
console.log(`Prepared three.js and MediaPipe ${visionVersion} from locked npm packages.`);
