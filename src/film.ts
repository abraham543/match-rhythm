// Film mode (?film): the game is stepped frame by frame from outside (tools/record.mjs), players are bots
// with human-like timing, and the sound of each game is rendered offline. Used only to make the demo video.
import type { AudioEngine, AudioEvent } from './audio/engine';
import type { Game } from './game/game';
import { rng } from './core/random';

const KEYS = [['KeyA', 'KeyS', 'KeyD', 'KeyF'], ['KeyJ', 'KeyK', 'KeyL', 'Semicolon']];

interface Bot {
  player: 0 | 1;
  /** Standard deviation of timing error, seconds. */
  spread: number;
  /** Average lateness, seconds. */
  bias: number;
  /** Share of notes the bot does not play. */
  skip: number;
  next: number;
  rand: () => number;
}

type Internals = { now: number; playWall: number; chart?: { notes: { time: number; lane: number }[] }; judgeTime(): number };

function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
}

function wavBase64(buf: AudioBuffer): string {
  const ch = [buf.getChannelData(0), buf.getChannelData(1)];
  const n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 4, true);
  out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) out.setInt16(44 + i * 4 + c * 2, Math.max(-1, Math.min(1, ch[c][i])) * 32767, true);
  }
  const bytes = new Uint8Array(out.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function filmApi(game: Game, audio: AudioEngine) {
  const g = game as unknown as Internals;
  let bots: Bot[] = [];
  let log: AudioEvent[] = [];
  game.film = true;
  audio.disabled = true;
  audio.recorder = (e) => log.push({ ...e, t: g.judgeTime() } as AudioEvent);

  const key = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));

  return {
    /** Advance the game to wall time `now` (seconds), letting the bots press their notes on time. */
    frame(now: number): void {
      if (game.screen === 'play' && g.chart) {
        for (const b of bots) {
          const notes = g.chart.notes;
          while (b.next < notes.length) {
            const n = notes[b.next];
            const at = n.time + b.bias + gauss(b.rand) * b.spread;
            if (at + g.playWall > now) break;
            b.next++;
            if (b.rand() < b.skip) continue;
            g.now = at + g.playWall; // press exactly at its moment, not on the frame grid
            key(KEYS[b.player][n.lane]);
          }
        }
      }
      game.frame(now);
    },
    key,
    setBots(list: { player: 0 | 1; spread: number; bias: number; skip: number; seed: number }[]): void {
      bots = list.map((b) => ({ ...b, next: 0, rand: rng(b.seed) }));
    },
    clearLog(): void {
      log = [];
    },
    playWall(): number {
      return g.playWall;
    },
    state() {
      return { screen: game.screen, playWall: g.playWall, events: log.length };
    },
    async renderWav(seconds: number, pre: number): Promise<string> {
      return wavBase64(await audio.renderOffline(seconds, pre, log));
    },
  };
}
