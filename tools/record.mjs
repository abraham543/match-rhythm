// Records the demo-video footage of Match Rhythm, frame by frame and deterministically.
// The game runs in film mode (?film): this script sets the clock for every frame, bots press the notes with
// human-like timing, and the sound of each game is rendered offline by the game's own audio engine.
//   node tools/record.mjs http://localhost:5200/ D:/out
// Output: <out>/<scene>/00001.jpg ... plus <scene>.wav for the games, and stills.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5200/';
const OUT = process.argv[3] ?? 'footage';
const FPS = 30;
const BROWSER = process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: true,
  args: ['--window-size=1920,1080', '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});

async function openGame() {
  const page = await browser.newPage();
  await page.goto(`${BASE}?film`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.matchRhythm?.film);
  return page;
}

/** Captures `seconds` of footage starting at wall time `t0`; `events` maps a time to an action. */
async function capture(page, scene, t0, seconds, events = []) {
  const dir = path.join(OUT, scene);
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.createCDPSession();
  const todo = [...events].sort((a, b) => a.at - b.at);
  const frames = Math.round(seconds * FPS);
  for (let i = 0; i < frames; i++) {
    const now = t0 + i / FPS;
    while (todo.length && todo[0].at <= now) await todo.shift().run(now);
    await page.evaluate((n) => window.matchRhythm.film.frame(n), now);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
    fs.writeFileSync(path.join(dir, `${String(i + 1).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
    if (i % 150 === 0) console.log(scene, i, '/', frames);
  }
  return t0 + seconds;
}

const key = (page, code) => async () => page.evaluate((c) => window.matchRhythm.film.key(c), code);
const at = (t, run) => ({ at: t, run });

// ---- 1. attract mode (a demo match plays by itself)
let page = await openGame();
await capture(page, 'attract', 1, 8);

// ---- 2. one player: join, play the whole song, enter initials, see the board
await page.evaluate(() => {
  const f = window.matchRhythm.film;
  f.setBots([{ player: 0, spread: 0.028, bias: 0.006, skip: 0.04, seed: 7 }]);
  f.clearLog();
});
const s1 = 10;
let end = await capture(page, 'solo', s1, 82, [
  at(s1 + 0.6, key(page, 'KeyA')),
  at(s1 + 1.6, key(page, 'Enter')),
  // initials "C9X" after the results reveal: D = next letter, F = next slot
  ...[...'DDF', ...'SF', ...'DDDDDDDDDDDDDDDDDDDDDDDF'].map((c, i) => at(s1 + 68 + i * 0.12, key(page, { D: 'KeyD', S: 'KeyS', F: 'KeyF' }[c]))),
]);
let st = await page.evaluate(() => window.matchRhythm.film.state());
fs.writeFileSync(path.join(OUT, 'solo.json'), JSON.stringify({ start: s1, playWall: st.playWall, events: st.events }));
let wav = await page.evaluate((secs, pre) => window.matchRhythm.film.renderWav(secs, pre), 82, st.playWall - s1);
fs.writeFileSync(path.join(OUT, 'solo.wav'), Buffer.from(wav, 'base64'));
await capture(page, 'board', end, 5);
await page.close();

// ---- 3. two players head to head (fresh page, same leaderboard)
page = await openGame();
await page.evaluate(() => {
  const f = window.matchRhythm.film;
  f.setBots([
    { player: 0, spread: 0.03, bias: 0.004, skip: 0.05, seed: 11 },
    { player: 1, spread: 0.045, bias: 0.02, skip: 0.09, seed: 23 },
  ]);
  f.clearLog();
});
const s2 = 5;
await capture(page, 'duel', s2, 72, [at(s2 + 0.5, key(page, 'KeyA')), at(s2 + 1.2, key(page, 'KeyJ')), at(s2 + 2.0, key(page, 'Enter'))]);
st = await page.evaluate(() => window.matchRhythm.film.state());
fs.writeFileSync(path.join(OUT, 'duel.json'), JSON.stringify({ start: s2, playWall: st.playWall, events: st.events }));
wav = await page.evaluate((secs, pre) => window.matchRhythm.film.renderWav(secs, pre), 72, st.playWall - s2);
fs.writeFileSync(path.join(OUT, 'duel.wav'), Buffer.from(wav, 'base64'));

// ---- 4. stills: staff panel, phone scorecard
await page.evaluate(() => window.matchRhythm.film.key('Backquote'));
await page.evaluate(() => window.matchRhythm.film.frame(200));
await page.screenshot({ path: path.join(OUT, 'staff.png') });
await page.close();

const phone = await browser.newPage();
await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const card = { n: 'C9X', s: 41250, g: 'S', a: 91, c: 47, m: 'Grand Final · Map 3', d: '2026-11-18', x: '27/28 SKY eliminations · 12/12 objectives · final moment: PERFECT' };
const b64 = Buffer.from(JSON.stringify(card)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
await phone.goto(`${BASE}#card=${b64}`, { waitUntil: 'networkidle0' });
await phone.screenshot({ path: path.join(OUT, 'phone.png') });

await browser.close();
console.log('done');
