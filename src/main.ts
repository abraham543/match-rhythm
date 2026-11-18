import './style.css';
import { AudioEngine } from './audio/engine';
import { Leaderboard } from './core/leaderboard';
import { SAMPLE_MATCHES } from './data/samples';
import { Game, type Settings } from './game/game';
import { Input } from './game/input';
import { Renderer } from './game/render';
import { readCard, renderCard } from './game/share';
import { loadSettings, StaffPanel } from './game/staff';

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

  const settings = loadSettings<Settings>({
    difficulty: 'standard',
    match: 'rotate',
    volume: 0.8,
    offsetMs: 0,
    shareBase: location.origin + location.pathname,
    allowTwoPlayers: true,
  });

  const renderer = new Renderer(canvas);
  const input = new Input(canvas);
  const audio = new AudioEngine();
  const board = new Leaderboard(localStorage);
  const game = new Game(renderer, input, audio, board, settings, SAMPLE_MATCHES);
  const staff = new StaffPanel(game, board, canvas);
  input.on((a) => a.type === 'staff' && staff.toggle());

  const resize = () => renderer.resize();
  window.addEventListener('resize', resize);
  resize();

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

  // for automated checks and the demo video
  (window as unknown as { matchRhythm: unknown }).matchRhythm = { game, audio, board };
}
