import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const publicRoot = path.join(root, 'public');
for (const required of ['vendor/runtime.json', 'vendor/vision_bundle.js', 'photos/demo/heart.json', 'photos/demo/xmas.json']) {
  if (!fs.existsSync(path.join(publicRoot, required))) throw new Error(`Missing ${required}; run npm ci and npm run demo:generate.`);
}
const assets = [
  ['vendor/vision_bundle.js', 'vendor/vision_bundle.js'],
  ['vendor/runtime.json', 'vendor/runtime.json'],
  ['vendor/wasm', 'vendor/wasm'],
  ['photos/demo', 'photos/demo'],
];
// All writes belong to the generated dist directory. Personal data and models
// are intentionally absent from this allowlist.
fs.mkdirSync(output, { recursive: true });
function listFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Build inputs and outputs cannot contain symlinks: ${relative}`);
    return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relative) : [relative];
  });
}
const expectedFiles = new Set(['index.html', 'heart.html', 'xmas.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md']);
for (const [from, to] of assets) {
  const source = path.join(publicRoot, from);
  if (fs.statSync(source).isDirectory()) for (const name of listFiles(source)) expectedFiles.add(path.posix.join(to, name));
  else expectedFiles.add(to);
}
for (const name of listFiles(path.join(root, 'LICENSES'))) expectedFiles.add(`LICENSES/${name}`);
for (const name of [...expectedFiles]) if (/\.(html|js|json|wasm)$/.test(name)) expectedFiles.add(name + '.gz');
const unexpected = listFiles(output).filter(name => !expectedFiles.has(name));
if (unexpected.length) throw new Error(`Use a clean build output; unexpected entries: ${unexpected.join(', ')}`);
for (const [preset, name] of [['heart', 'heart.html'], ['xmas2026', 'xmas.html']]) {
  const result = await build({
    entryPoints: [path.join(publicRoot, 'src/main.js')], bundle: true,
    format: 'esm', platform: 'browser', target: 'es2022', write: false,
    legalComments: 'inline',
    define: { __PRESET__: JSON.stringify(preset), __ASSET_BASE__: JSON.stringify('./'), __HAS_CONFIG__: 'false' },
  });
  const code = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8')
    .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/i, '')
    .replace('<script type="module" src="./src/main.js"></script>', `<script type="module">\n${code}\n</script>`);
  fs.writeFileSync(path.join(output, name), html);
}
// The default build opens directly into the scene.
fs.copyFileSync(path.join(output, 'heart.html'), path.join(output, 'index.html'));
for (const [from, to] of assets) fs.cpSync(path.join(publicRoot, from), path.join(output, to), { recursive: true });
for (const file of ['LICENSE', 'LICENSES', 'THIRD_PARTY_NOTICES.md']) fs.cpSync(path.join(root, file), path.join(output, file), { recursive: true });
function compress(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) compress(file);
    else if (/\.(html|js|json|wasm)$/.test(entry.name)) fs.writeFileSync(file + '.gz', gzipSync(fs.readFileSync(file), { level: 9 }));
  }
}
compress(output);
console.log('Built dist/: default heart, heart.html, xmas.html; model and personal photos excluded.');
