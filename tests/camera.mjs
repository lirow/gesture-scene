import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { startServer, launchBrowser } from './helpers.mjs';

const input = process.env.CAMERA_FIXTURE;
if (!input || !fs.existsSync(input)) throw new Error('Set CAMERA_FIXTURE to an authorized open-hand y4m video. See README.');
const server = await startServer(process.env.TEST_ROOT || 'public');
const browser = await launchBrowser(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${resolve(input)}`]);
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.MODEL_FIXTURE) {
    const bytes = fs.readFileSync(resolve(process.env.MODEL_FIXTURE));
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().endsWith('/hand_landmarker.task')) {
        request.respond({ status: 200, contentType: 'application/octet-stream', body: bytes });
      } else request.continue();
    });
  }
  const entry = process.env.TEST_ROOT === 'dist' ? 'heart.html' : 'scene.html';
  await page.goto(`${server.url}${entry}?ui=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('m-detect').textContent !== '-', { timeout: 90000 });
  await page.waitForFunction(() => window.__tree.progress > 0.8, { timeout: 15000 });
  assert.ok(await page.evaluate(() => document.getElementById('cam').videoWidth > 0));
  const winners = await page.evaluate(() => window.__resourceLoads);
  assert.ok(winners.wasm && winners.model);
  assert.deepEqual(errors, []);
  console.log('PASS camera -> real model -> gesture -> expanded scene; selected sources:', winners);
} finally { await browser.close(); await server.close(); }
