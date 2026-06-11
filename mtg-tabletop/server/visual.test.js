// Visual smoke test (headless, software WebGL): host + practice bot, then a
// spectator page. Screenshots land in screens/.
// Run: node server/visual.test.js  (server must be running on :8080)

import puppeteer from 'puppeteer';
import fs from 'fs';

const URL = 'http://localhost:8080';
const shots = 'screens';
fs.mkdirSync(shots, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  protocolTimeout: 240000,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
         '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  defaultViewport: { width: 1100, height: 660 },
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function newPage(name) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`[${name}:PAGEERROR]`, e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[${name}:err]`, m.text().slice(0, 180)); });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await sleep(600);
  return page;
}

const host = await newPage('host');
await host.type('#inName', 'Alice');
await host.click('#btnHost');
await host.waitForSelector('#lobbyRoom:not(.hidden)');
const code = await host.$eval('#roomCode', el => el.textContent.trim());
console.log('room:', code);
await host.click('#btnAddBot');
await sleep(400);
await host.click('#btnStart');
await host.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });
console.log('in game');
await sleep(4000);
await host.screenshot({ path: `${shots}/02-seated-mulligan.png` });

// keep hand
await host.evaluate(() => {
  [...document.querySelectorAll('#actionBar button')].find(b => b.textContent.includes('Keep'))?.click();
});
await sleep(3000);
await host.screenshot({ path: `${shots}/03-playing.png` });

// FPS antics mode
await host.keyboard.press('Tab');
await sleep(600);
await host.keyboard.press('Digit3');
await sleep(300);
await host.mouse.click(550, 330);
await sleep(400);
await host.screenshot({ path: `${shots}/04-fps-sandal.png` });
await host.keyboard.press('KeyF');
await sleep(350);
await host.screenshot({ path: `${shots}/05-slam.png` });
await sleep(800);
await host.keyboard.press('Tab');
await sleep(400);

// spectator
const spec = await newPage('spec');
await spec.type('#inName', 'Watcher');
await spec.type('#inCode', code);
await spec.click('#btnSpectate');
await spec.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });
await sleep(3500);
await spec.screenshot({ path: `${shots}/07-spectator.png` });
await spec.mouse.click(550, 330);
await sleep(200);
await spec.keyboard.down('KeyW');
await sleep(800);
await spec.keyboard.up('KeyW');
await sleep(400);
await spec.screenshot({ path: `${shots}/08-spectator-fly.png` });

console.log('done — screenshots in', shots);
await browser.close();
process.exit(0);
