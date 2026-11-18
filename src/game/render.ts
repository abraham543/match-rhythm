// Canvas drawing: sky background, note highways, hit feedback, HUD, and the booth screens.
import type { Chart, Judgement, MatchTimeline, Note } from '../core/types';
import { LANES, matchClock, SONG } from '../core/chart';
import type { Scorer } from '../core/score';

export const COLORS = {
  bg0: '#050d1a',
  bg1: '#0c2342',
  sky: '#4fb3ff',
  gold: '#ffcc4d',
  white: '#eef6ff',
  swing: '#ff7ad9',
  dim: 'rgba(238,246,255,0.55)',
  faint: 'rgba(238,246,255,0.14)',
};

export const FONT = '"Segoe UI", "Inter", system-ui, sans-serif';

export interface Effect {
  lane: number;
  at: number;
  judgement: Judgement;
  /** Seconds; negative = early. */
  delta: number;
}

export interface Particle {
  lane: number;
  at: number;
  vx: number;
  vy: number;
  color: string;
}

export interface PlayerView {
  scorer: Scorer;
  effects: Effect[];
  keys: string[];
  name: string;
  /** Song time of the last press per lane (any press, hit or not). */
  pressedAt: number[];
  particles: Particle[];
  /** 0..1, decays every frame. */
  shake: number;
}

export function laneColor(lane: number, match: MatchTimeline): string {
  if (lane === 0) return match.teams[0].color;
  if (lane === 3) return match.teams[1].color;
  return lane === 1 ? COLORS.gold : COLORS.white;
}

export function laneTitle(lane: number, match: MatchTimeline): string {
  if (lane === 0) return `${match.teams[0].tag} ELIM`;
  if (lane === 3) return `${match.teams[1].tag} ELIM`;
  return lane === 1 ? 'OBJECTIVE' : 'ROUND / SWING';
}

const JUDGE_COLOR: Record<Judgement, string> = { perfect: '#7dffb2', great: COLORS.sky, good: COLORS.gold, miss: '#ff6b6b' };
const LOOK = 1.6; // seconds of notes visible on the highway

export class Renderer {
  ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  private readonly clouds: { x: number; y: number; r: number; s: number }[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 14; i++) {
      this.clouds.push({ x: Math.random(), y: Math.random() * 0.8, r: 0.12 + Math.random() * 0.22, s: 0.004 + Math.random() * 0.01 });
    }
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Size scaled to the screen (booth screens range from laptops to 4K TVs). */
  u(n: number): number {
    return n * Math.min(this.w / 1600, this.h / 900);
  }

  text(s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 600): void {
    const c = this.ctx;
    c.font = `${weight} ${this.u(size)}px ${FONT}`;
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillText(s, x, y);
  }

  background(time: number, pulse = 0): void {
    const c = this.ctx;
    const g = c.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, COLORS.bg1);
    g.addColorStop(1, COLORS.bg0);
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);
    for (const cl of this.clouds) {
      const x = ((cl.x + time * cl.s) % 1.3) * this.w * 1.1 - this.w * 0.15;
      const y = cl.y * this.h;
      const r = cl.r * this.h;
      const rg = c.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(79,179,255,${0.07 + pulse * 0.05})`);
      rg.addColorStop(1, 'rgba(79,179,255,0)');
      c.fillStyle = rg;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  }

  /** Lays out one or two highways; returns their x ranges (also used for touch input). */
  highways(count: 1 | 2): { x0: number; x1: number }[] {
    const laneW = Math.min(this.u(110), this.w / (count === 2 ? 10 : 6));
    const width = laneW * LANES;
    if (count === 1) return [{ x0: this.w / 2 - width / 2, x1: this.w / 2 + width / 2 }];
    const gap = Math.max(this.u(200), this.w * 0.14);
    return [
      { x0: this.w / 2 - gap / 2 - width, x1: this.w / 2 - gap / 2 },
      { x0: this.w / 2 + gap / 2, x1: this.w / 2 + gap / 2 + width },
    ];
  }

  get hitY(): number {
    return this.h * 0.82;
  }

  get topY(): number {
    return this.h * 0.2;
  }

  /** Particles for a hit: lane colour, more for big moments. */
  burst(view: PlayerView, lane: number, note: Note, match: MatchTimeline, at: number): void {
    const n = note.final ? 40 : note.kind === 'objective' || note.kind === 'round' ? 22 : 12;
    const color = note.kind === 'swing' || note.accent ? COLORS.swing : laneColor(lane, match);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * (note.final ? 520 : 260);
      view.particles.push({ lane, at, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, color });
    }
    if (view.particles.length > 400) view.particles.splice(0, view.particles.length - 400);
  }

  drawHighway(x0: number, x1: number, chart: Chart, match: MatchTimeline, view: PlayerView, t: number, beatPulse: number): void {
    const c = this.ctx;
    // screen shake for big moments, decays over ~0.25 s
    const sh = view.shake * this.u(6);
    view.shake = Math.max(0, view.shake - 0.07);
    c.save();
    if (sh > 0.1) c.translate((Math.random() - 0.5) * sh * 2, (Math.random() - 0.5) * sh * 2);
    const laneW = (x1 - x0) / LANES;
    const top = this.topY;
    const hit = this.hitY;
    const speed = (hit - top) / LOOK;

    // track
    const tg = c.createLinearGradient(0, top, 0, hit);
    tg.addColorStop(0, 'rgba(10,30,60,0)');
    tg.addColorStop(1, 'rgba(10,30,60,0.75)');
    c.fillStyle = tg;
    c.fillRect(x0, top, x1 - x0, this.h - top);
    for (let l = 0; l <= LANES; l++) {
      c.fillStyle = COLORS.faint;
      c.fillRect(x0 + l * laneW - 0.5, top, 1, this.h - top);
    }
    // beat lines
    const beat = 60 / chart.bpm;
    for (let b = Math.ceil(t / beat); b * beat < t + LOOK; b++) {
      const y = hit - (b * beat - t) * speed;
      c.fillStyle = b % 4 === 0 ? 'rgba(238,246,255,0.18)' : 'rgba(238,246,255,0.06)';
      c.fillRect(x0, y, x1 - x0, b % 4 === 0 ? 2 : 1);
    }
    for (let l = 0; l < LANES; l++) {
      this.text(laneTitle(l, match), x0 + laneW * (l + 0.5), top - this.u(16), 13, laneColor(l, match), 'center', 700);
    }
    // hit line and receptors: every press lights its receptor, hits glow in the lane colour
    c.fillStyle = `rgba(238,246,255,${0.55 + beatPulse * 0.4})`;
    c.fillRect(x0, hit - 1.5, x1 - x0, 3);
    for (let l = 0; l < LANES; l++) {
      const cx = x0 + laneW * (l + 0.5);
      const pressAge = t - view.pressedAt[l];
      const pressed = pressAge >= 0 && pressAge < 0.12 ? 1 - pressAge / 0.12 : 0;
      const fx = view.effects.filter((e) => e.lane === l && t >= e.at && t - e.at < 0.25 && e.judgement !== 'miss');
      const glow = fx.length ? Math.min(1, Math.max(0, 1 - (t - fx[fx.length - 1].at) / 0.25)) : 0;
      c.strokeStyle = laneColor(l, match);
      c.globalAlpha = 0.5 + Math.max(glow, pressed) * 0.5;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(cx, hit, laneW * 0.32, 0, Math.PI * 2);
      c.stroke();
      if (pressed > 0) {
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.globalAlpha = pressed;
        c.beginPath();
        c.arc(cx, hit, laneW * 0.3, 0, Math.PI * 2);
        c.fill();
      }
      if (glow > 0) {
        c.fillStyle = laneColor(l, match);
        c.globalAlpha = glow * 0.35;
        c.beginPath();
        c.arc(cx, hit, laneW * (0.35 + (1 - glow) * 0.5), 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
      this.text(view.keys[l] ?? '', cx, hit + laneW * 0.62, 18, COLORS.dim, 'center', 700);
    }
    // first note hint: its key pulses until the player gets going
    const first = chart.notes[0];
    if (first && view.keys.length && t < SONG.leadIn + 6 && t > SONG.leadIn - 1.6 && !view.scorer.isDone(0)) {
      const k = 0.5 + 0.5 * Math.sin(t * 10);
      this.text(view.keys[first.lane], x0 + laneW * (first.lane + 0.5), hit + laneW * 0.62, 18 + 10 * k, COLORS.gold, 'center', 900);
    }
    // notes
    chart.notes.forEach((n, i) => {
      if (view.scorer.isDone(i)) return;
      const dt = n.time - t;
      if (dt > LOOK || dt < -0.2) return;
      this.note(n, x0 + laneW * (n.lane + 0.5), hit - dt * speed, laneW, match);
    });
    // particles
    for (const p of view.particles) {
      const age = t - p.at;
      if (age < 0 || age > 0.6) continue;
      const px = x0 + laneW * (p.lane + 0.5) + p.vx * age;
      const py = hit + p.vy * age + 600 * age * age;
      c.globalAlpha = 1 - age / 0.6;
      c.fillStyle = p.color;
      c.fillRect(px - 2, py - 2, 4, 4);
    }
    c.globalAlpha = 1;
    // judgement popups with early / late
    for (const e of view.effects) {
      const age = t - e.at;
      if (age < 0 || age > 0.6) continue;
      const cx = x0 + laneW * (e.lane + 0.5);
      c.globalAlpha = 1 - age / 0.6;
      const y = hit - laneW * 0.8 - age * 60;
      this.text(e.judgement.toUpperCase(), cx, y, 26, JUDGE_COLOR[e.judgement], 'center', 900);
      if (e.judgement === 'great' || e.judgement === 'good') this.text(e.delta < 0 ? 'EARLY' : 'LATE', cx, y + this.u(22), 14, COLORS.dim, 'center', 700);
      c.globalAlpha = 1;
    }
    c.restore();
  }

  private note(n: Note, x: number, y: number, laneW: number, match: MatchTimeline): void {
    const c = this.ctx;
    const r = laneW * (n.final ? 0.4 : 0.3);
    const col = n.kind === 'swing' ? COLORS.swing : laneColor(n.lane, match);
    c.save();
    c.translate(x, y);
    c.shadowColor = n.accent ? COLORS.swing : col;
    c.shadowBlur = r * (n.final ? 1.8 : 0.9);
    c.fillStyle = col;
    c.strokeStyle = n.accent ? COLORS.swing : '#ffffff';
    c.lineWidth = n.accent || n.final ? 4 : 2;
    c.beginPath();
    if (n.kind === 'elim') {
      c.moveTo(0, -r); c.lineTo(r, 0); c.lineTo(0, r); c.lineTo(-r, 0); c.closePath();
    } else if (n.kind === 'objective') {
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        if (i === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
    } else if (n.kind === 'round') {
      const w = r * 1.5;
      c.roundRect(-w, -r * 0.45, w * 2, r * 0.9, r * 0.45);
    } else {
      c.arc(0, 0, r, 0, Math.PI * 2);
    }
    c.fill();
    c.shadowBlur = 0;
    c.stroke();
    c.restore();
  }

  hud(x0: number, x1: number, view: PlayerView, align: 'left' | 'right'): void {
    const s = view.scorer;
    const x = align === 'left' ? x0 - this.u(24) : x1 + this.u(24);
    const a: CanvasTextAlign = align === 'left' ? 'right' : 'left';
    this.text(view.name, x, this.h * 0.32, 22, COLORS.dim, a, 700);
    this.text(s.score.toLocaleString('en-US'), x, this.h * 0.39, 44, COLORS.white, a, 800);
    if (s.combo >= 2) {
      this.text(`${s.combo} combo`, x, this.h * 0.46, 22, COLORS.sky, a, 700);
      const m = Math.min(4, 1 + Math.floor(s.combo / 10));
      if (m > 1) this.text(`x${m}`, x, this.h * 0.51, 30, COLORS.gold, a, 900);
    }
  }

  /** Two-player tug of war between the highways. */
  tugOfWar(lead: number, a: number, b: number): void {
    const c = this.ctx;
    const x = this.w / 2;
    const y0 = this.h * 0.3;
    const y1 = this.h * 0.75;
    const mid = (y0 + y1) / 2;
    const w = this.u(14);
    c.fillStyle = COLORS.faint;
    c.fillRect(x - w / 2, y0, w, y1 - y0);
    const fill = -lead * (y1 - y0) / 2; // P1 ahead pushes the marker up
    c.fillStyle = lead >= 0 ? COLORS.sky : COLORS.swing;
    c.fillRect(x - w / 2, Math.min(mid, mid + fill), w, Math.abs(fill));
    c.fillStyle = COLORS.white;
    c.fillRect(x - w, mid + fill - 2, w * 2, 4);
    const diff = Math.abs(a - b);
    const label = a === b ? 'TIED' : `P${a > b ? 1 : 2} LEADS +${diff.toLocaleString('en-US')}`;
    this.text(label, x, y0 - this.u(26), 18, a >= b ? COLORS.sky : COLORS.swing, 'center', 800);
  }

  /** Top bar: which match is replayed, where we are in it, the live score, the latest moment. */
  ticker(match: MatchTimeline, chart: Chart, t: number, caption: string | null, captionTeam: 0 | 1, captionAge: number, score: [number, number] | null): void {
    const c = this.ctx;
    const play0 = SONG.leadIn;
    const last = chart.notes[chart.notes.length - 1];
    const play1 = last ? last.time : SONG.duration - SONG.outro;
    const p = Math.min(1, Math.max(0, (t - play0) / (play1 - play0)));
    const matchT = chart.window[0] + p * (chart.window[1] - chart.window[0]);
    const [ta, tb] = match.teams;
    if (score) {
      this.text(`${ta.tag}  ${score[0]} : ${score[1]}  ${tb.tag}`, this.w / 2, this.h * 0.045, 30, COLORS.white, 'center', 900);
    } else {
      this.text(`${ta.tag}  vs  ${tb.tag}`, this.w / 2, this.h * 0.045, 26, COLORS.white, 'center', 800);
    }
    this.text(`${match.title} · replaying ${matchClock(matchT)}${match.synthetic ? ' · demo data' : ''}`, this.w / 2, this.h * 0.085, 15, COLORS.dim, 'center', 600);
    const bx = this.w * 0.3;
    const bw = this.w * 0.4;
    c.fillStyle = COLORS.faint;
    c.fillRect(bx, this.h * 0.112, bw, 4);
    c.fillStyle = COLORS.sky;
    c.fillRect(bx, this.h * 0.112, bw * Math.min(1, Math.max(0, t / SONG.duration)), 4);
    if (last && t >= last.time) {
      // the decisive moment has passed: celebrate the winner of the real match
      const winner = match.teams[chart.winner];
      const k = Math.min(1, (t - last.time) / 0.3);
      c.globalAlpha = k;
      this.text(`GG — ${winner.name.toUpperCase()} WINS`, this.w / 2, this.h * 0.16, 30 + 10 * (1 - k), winner.color, 'center', 900);
      c.globalAlpha = 1;
    } else if (caption && captionAge < 2.4) {
      c.globalAlpha = Math.min(1, (2.4 - captionAge) / 0.4);
      this.text(caption, this.w / 2, this.h * 0.155, 24, match.teams[captionTeam].color, 'center', 800);
      c.globalAlpha = 1;
    }
  }

  /** Count-in: two bars of clicks, the numbers follow the beats of the second bar, then GO. */
  countdown(t: number): void {
    const beat = 60 / SONG.bpm;
    if (t < 0 || t > SONG.leadIn + 0.4) return;
    if (t >= SONG.leadIn) {
      this.text('GO!', this.w / 2, this.h * 0.5, 120, COLORS.gold, 'center', 900);
      return;
    }
    const beatsLeft = Math.ceil((SONG.leadIn - t) / beat - 1e-9);
    if (beatsLeft > 4) {
      this.text('GET READY', this.w / 2, this.h * 0.5, 64, COLORS.white, 'center', 900);
      return;
    }
    const ph = 1 - ((SONG.leadIn - t) / beat - (beatsLeft - 1));
    this.text(String(beatsLeft), this.w / 2, this.h * 0.5, 120 + 30 * (1 - ph), COLORS.white, 'center', 900);
  }

  panel(x: number, y: number, w: number, h: number, alpha = 0.72): void {
    const c = this.ctx;
    c.fillStyle = `rgba(5,13,26,${alpha})`;
    c.strokeStyle = 'rgba(79,179,255,0.35)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.roundRect(x, y, w, h, this.u(18));
    c.fill();
    c.stroke();
  }

  button(x: number, y: number, w: number, h: number, label: string): void {
    const c = this.ctx;
    c.fillStyle = 'rgba(79,179,255,0.18)';
    c.strokeStyle = COLORS.sky;
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(x, y, w, h, this.u(12));
    c.fill();
    c.stroke();
    this.text(label, x + w / 2, y + h / 2, 24, COLORS.white, 'center', 800);
  }

  /** What the note shapes mean, drawn with the real shapes. */
  legend(y: number): void {
    const items: [Note['kind'], string, string][] = [['elim', COLORS.sky, 'elimination'], ['objective', COLORS.gold, 'objective'], ['round', COLORS.white, 'round won'], ['swing', COLORS.swing, 'momentum swing']];
    const laneW = this.u(70);
    const step = this.w * 0.16;
    items.forEach(([kind, color, label], i) => {
      const x = this.w / 2 + (i - 1.5) * step;
      const fake = { kind, lane: kind === 'elim' ? 0 : kind === 'objective' ? 1 : 2 } as Note;
      this.note(fake, x - this.u(50), y, laneW, { teams: [{ color }, { color }] } as unknown as MatchTimeline);
      this.text(label, x - this.u(20), y, 18, COLORS.dim, 'left', 600);
    });
  }

  qr(modules: boolean[][], x: number, y: number, size: number): void {
    const c = this.ctx;
    const n = modules.length;
    const q = size / (n + 4);
    c.fillStyle = '#ffffff';
    c.fillRect(x, y, size, size);
    c.fillStyle = '#000000';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (modules[r][k]) c.fillRect(x + (k + 2) * q, y + (r + 2) * q, Math.ceil(q), Math.ceil(q));
  }
}
