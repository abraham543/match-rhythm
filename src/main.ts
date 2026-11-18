import './style.css';
import { AudioEngine } from './audio/engine';
import { Leaderboard } from './core/leaderboard';
import { SAMPLE_MATCHES } from './data/samples';
import { Game, type Settings } from './game/game';
import { Input } from './game/input';
import { Renderer } from './game/render';
import { readCard, renderCard } from './game/share';
import { loadImportedMatches, loadSettings, StaffPanel } from './game/staff';
import { filmApi } from './film';

const PUBLIC_URL = 'https://abraham543.github.io/match-rhythm/';
const app = document.querySelector<HTMLDivElement>('#app')!;
const card = readCard(location.hash);

if (card) {
  // opened from a QR code on a phone: show the scorecard, not the booth game
  document.body.classList.add('card-mode');
  renderCard(app, card);
} else {
  const canvas = document.createElement('canvas');
  canvas.className = 'stage';
  app.appendChild(canvas);

  // a booth PC running a local copy still needs QR codes that phones can open
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
  const settings = loadSettings<Settings>({
    difficulty: 'standard',
    match: 'rotate',
    volume: 0.8,
    visualOffsetMs: 0,
    inputOffsetMs: 0,
    shareBase: local ? PUBLIC_URL : location.origin + location.pathname,
    allowTwoPlayers: true,
  });

  const renderer = new Renderer(canvas);
  const input = new Input(canvas);
  const audio = new AudioEngine();
  const board = new Leaderboard(localStorage);
  const imported = loadImportedMatches();
  const matches = [...imported, ...SAMPLE_MATCHES.filter((m) => !imported.some((x) => x.id === m.id))];
  const game = new Game(renderer, input, audio, board, settings, matches);
  const staff = new StaffPanel(game, board, input, canvas);
  input.on((a) => a.type === 'staff' && staff.toggle());

  const resize = () => renderer.resize();
  window.addEventListener('resize', resize);
  resize();

  // kiosk: keep the screen awake while the game is visible
  const wake = () => {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<unknown> } };
    nav.wakeLock?.request('screen').catch(() => undefined);
  };
  wake();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());

  const film = new URLSearchParams(location.search).has('film');
  if (!film) {
    // a booth must never freeze: one bad frame is logged and the next frame runs anyway
    const loop = (ms: number) => {
      requestAnimationFrame(loop);
      try {
        game.frame(ms / 1000);
      } catch (e) {
        console.error('frame failed', e);
      }
    };
    requestAnimationFrame(loop);
  }

  // for automated checks, and film mode for the demo video (frames driven by tools/record.mjs)
  (window as unknown as { matchRhythm: unknown }).matchRhythm = { game, audio, board, film: film ? filmApi(game, audio) : null };
}
