import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, startServer, launchBrowser } from './helpers.mjs';

const server = await startServer(process.env.TEST_ROOT || 'public');
const browser = await launchBrowser();
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });
try {
  for (const preset of ['heart', 'xmas2026']) for (const mobile of [false, true]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (mobile) await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    await page.setViewport({ width: mobile ? 390 : 1440, height: mobile ? 844 : 900, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    const entry = process.env.TEST_ROOT === 'dist' ? (preset === 'heart' ? 'heart.html' : 'xmas.html') : 'scene.html';
    await page.goto(`${server.url}${entry}?nocam=1&preset=${preset}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__tree?.photoList?.length === 20
      && window.__tree.atlas?.validIndices?.length === Math.min(20, window.__tree.tier.photoCount)
      && document.querySelector('#boot.gone'), { timeout: 20000 });
    const info = await page.evaluate(() => ({ preset: window.__preset.id,
      particles: window.__tree.points.geometry.attributes.position.count,
      ready: window.__tree.renderer.domElement.width > 0,
      rotation: window.__tree.group.rotation.y,
    }));
    assert.equal(info.preset, preset);
    assert.equal(info.particles, preset === 'heart' ? (mobile ? 8000 : 11000) : (mobile ? 3400 : 4200));
    assert.ok(info.ready);
    await page.screenshot({ path: path.join(output, `${preset}-${mobile ? 'mobile' : 'desktop'}.png`) });
    const pixels = await page.evaluate(() => {
      // Read in the same task as rendering; WebGL's default buffer is transient.
      window.__tree.update(0);
      const canvas = document.getElementById('gl');
      const copy = document.createElement('canvas'); copy.width = 120; copy.height = 120;
      copy.getContext('2d').drawImage(canvas, 0, 0, 120, 120);
      const bytes = copy.getContext('2d').getImageData(0, 0, 120, 120).data;
      let lit = 0, min = 255, max = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        const value = Math.max(bytes[i], bytes[i + 1], bytes[i + 2]);
        if (value > 60) lit++;
        min = Math.min(min, value); max = Math.max(max, value);
      }
      return { lit, range: max - min };
    });
    assert.ok(pixels.lit > 100 && pixels.range > 50, `Nonblank rendered scene: ${JSON.stringify(pixels)}`);
    await page.keyboard.press('o');
    await page.waitForFunction(() => window.__tree.progress > 0.95);
    await page.keyboard.down('p');
    await page.waitForFunction(() => window.__tree.card.visible && window.__tree.cardAmount > 0.9);
    await page.keyboard.up('p');
    await page.waitForFunction(() => window.__tree.cardAmount < 0.05);
    await page.keyboard.press('f');
    await page.waitForFunction(() => window.__tree.progress < 0.05);
    assert.notEqual(await page.evaluate(() => window.__tree.group.rotation.y), info.rotation);
    await page.keyboard.press('d');
    assert.equal(await page.evaluate(() => document.body.classList.contains('demo')), false);
    assert.deepEqual(errors, []);
    console.log(`PASS ${preset} ${mobile ? 'mobile' : 'desktop'}: pixels, motion, expand, pinch, release, mode`);
    await context.close();
  }
} finally { await browser.close(); await server.close(); }
