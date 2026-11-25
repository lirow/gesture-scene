import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

export const root = fileURLToPath(new URL('../', import.meta.url));
export async function startServer(directory = 'public') {
  const child = spawn(process.execPath, [path.join(root, 'serve.mjs'), directory], {
    cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => { child.kill(); reject(new Error('Static server startup timed out')); }, 10000);
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.stdout.on('data', data => {
      const match = data.toString().match(/http:\/\/localhost:\d+\//);
      if (match) { clearTimeout(deadline); resolve(match[0]); }
    });
    child.once('exit', code => { clearTimeout(deadline); reject(new Error(`Static server exited (${code})`)); });
  });
  return { url, close: () => new Promise(resolve => { child.once('exit', resolve); child.kill(); }) };
}

export async function launchBrowser(extra = []) {
  const candidates = [process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  const executablePath = candidates.find(candidate => fs.existsSync(candidate));
  if (!executablePath) throw new Error('Chrome not found; set CHROME_PATH to its executable.');
  return puppeteer.launch({ executablePath, headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars', ...extra] });
}
