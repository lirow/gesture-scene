import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, startServer, launchBrowser } from './helpers.mjs';

const server = await startServer(process.env.TEST_ROOT || 'public');
const browser = await launchBrowser();
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.setViewport({ width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1 });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__showcase?.ready);
    await page.waitForFunction(() => window.__showcase.frames > 5);
    const pixels = await page.evaluate(() => {
      window.__showcase.render();
      const copy = document.createElement('canvas'); copy.width = 120; copy.height = 100;
      const ctx = copy.getContext('2d'); ctx.drawImage(document.getElementById('stage'), 0, 0, 120, 100);
      const data = ctx.getImageData(0, 0, 120, 100).data;
      let bright = 0; for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) > 60) bright++;
      return bright;
    });
    assert.ok(pixels > 80, `Particle canvas must be nonblank (${pixels} bright pixels)`);
    await page.screenshot({ path: path.join(root, `test-results/showcase-heart-${width}.png`) });
    await page.click('[data-theme="xmas2026"]');
    await page.waitForFunction(() => window.__showcase.morph === 1);
    assert.equal(await page.$eval('[data-theme="xmas2026"]', button => button.getAttribute('aria-pressed')), 'true');
    const href = await page.$eval('#enter', link => link.getAttribute('href'));
    assert.equal(href, process.env.TEST_ROOT === 'dist' ? './xmas.html' : './scene.html?preset=xmas2026');
    await page.screenshot({ path: path.join(root, `test-results/showcase-xmas-${width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.click('#rotate');
    await page.waitForFunction(() => document.getElementById('status').textContent === '静止');
    const frames = await page.evaluate(() => window.__showcase.frames);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await page.evaluate(() => window.__showcase.frames), frames);
    assert.ok(!requests.some(url => /\.wasm|\.task|vision_bundle/.test(url)), 'Homepage must not download the hand runtime or model');
    assert.deepEqual(errors, []);
    console.log(`PASS showcase ${width}px: rendered pixels, motion, switch, pause, link, zero model requests`);
    await context.close();
  }
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(server.url);
  await page.waitForFunction(() => window.__showcase?.ready);
  assert.equal(await page.$eval('#rotate', input => input.checked), false);
  await page.click('[data-theme="xmas2026"]');
  await page.waitForFunction(() => window.__showcase.morph === 1);
  console.log('PASS showcase reduced-motion: static initial view and immediate theme switch');
  await context.close();
} finally { await browser.close(); await server.close(); }
