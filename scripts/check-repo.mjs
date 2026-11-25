import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
if (pkg.license !== 'MIT' || lock.packages[''].license !== 'MIT') throw new Error('Root license metadata must match MIT.');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const rejected = files.filter(file => /(^|\/)(node_modules|dist|ref|\.backup|testimg|models|vendor)(\/|$)|\.zip$|\.env($|\.)/.test(file));
if (rejected.length) throw new Error(`Unexpected publishable files: ${rejected.join(', ')}`);
for (const file of files.filter(file => /\.(m?js|json|md|html|ya?ml)$/.test(file))) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  if (/\/Users\/[A-Za-z0-9_.-]+\//.test(content) || /(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{30,})/.test(content)) throw new Error(`Local path or credential-like content: ${file}`);
  if (file.endsWith('.md')) for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (!fs.existsSync(path.resolve(root, path.dirname(file), target))) throw new Error(`Broken document link in ${file}: ${target}`);
  }
}
const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  if (fs.existsSync(path.join(dist, 'models'))) throw new Error('Distribution must not include the model.');
  for (const entry of fs.readdirSync(path.join(dist, 'photos'))) if (entry !== 'demo') throw new Error('Distribution contains a custom photo set.');
  for (const file of ['index.html', 'heart.html', 'xmas.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'LICENSES/Apache-2.0.txt', 'LICENSES/three-MIT.txt']) {
    if (!fs.existsSync(path.join(dist, file))) throw new Error(`Missing distribution file: ${file}`);
  }
}
console.log(`Checked ${files.length} publishable files: MIT metadata, notices, generated output, model, photo boundaries, and local paths.`);
