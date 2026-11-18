// Canvas drawing: sky background, note highways, HUD, and the booth screens.
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
}

export interface PlayerView {
  scorer: Scorer;
  effects: Effect[];
  keys: string[];
  name: string;
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

export class Renderer {
  ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  private clouds: { x: number; y: number; r: number; s: number }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
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

  /** Font size scaled to the screen (booth screens range from laptops to 4K TVs). */
  u(n: number): number {
    return (n * Math.min(this.w / 1600, this.h / 900));
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
    const gap = Math.max(this.u(160), this.w * 0.12);
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

  drawHighway(x0: number, x1: number, chart: Chart, match: MatchTimeline, view: PlayerView, t: number, beatPulse: number): void {
    const c = this.ctx;
    const laneW = (x1 - x0) / LANES;
    const top = this.topY;
    const hit = this.hitY;
    const look = 1.6; // seconds of notes visible
    const speed = (hit - top) / look;

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
    const firstBeat = Math.ceil(t / beat);
    for (let b = firstBeat; b * beat < t + look; b++) {
      const y = hit - (b * beat - t) * speed;
      c.fillStyle = b % 4 === 0 ? 'rgba(238,246,255,0.18)' : 'rgba(238,246,255,0.06)';
      c.fillRect(x0, y, x1 - x0, b % 4 === 0 ? 2 : 1);
    }
    // lane headers
    for (let l = 0; l < LANES; l++) {
      this.text(laneTitle(l, match), x0 + laneW * (l + 0.5), top - this.u(16), 13, laneColor(l, match), 'center', 700);
    }
    // hit line and receptors
    c.fillStyle = `rgba(238,246,255,${0.55 + beatPulse * 0.4})`;
    c.fillRect(x0, hit - 1.5, x1 - x0, 3);
    for (let l = 0; l < LANES; l++) {
      const cx = x0 + laneW * (l + 0.5);
      const fx = view.effects.filter((e) => e.lane === l && t - e.at < 0.25 && t >= e.at && e.judgement !== 'miss');
      const glow = fx.length ? Math.min(1, Math.max(0, 1 - (t - fx[fx.length - 1].at) / 0.25)) : 0;
      c.strokeStyle = laneColor(l, match);
      c.globalAlpha = 0.5 + glow * 0.5;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(cx, hit, laneW * 0.32, 0, Math.PI * 2);
      c.stroke();
      if (glow > 0) {
        c.fillStyle = laneColor(l, match);
        c.globalAlpha = glow * 0.35;
        c.beginPath();
        c.arc(cx, hit, laneW * (0.35 + (1 - glow) * 0.4), 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
      this.text(view.keys[l] ?? '', cx, hit + laneW * 0.62, 18, COLORS.dim, 'center', 700);
    }
    // notes
    chart.notes.forEach((n, i) => {
      if (view.scorer.isDone(i)) return;
      const dt = n.time - t;
      if (dt > look || dt < -0.2) return;
      const y = hit - dt * speed;
      this.note(n, x0 + laneW * (n.lane + 0.5), y, laneW, match);
    });
    // judgment popups
    for (const e of view.effects) {
      const age = t - e.at;
      if (age < 0 || age > 0.6) continue;
      const cx = x0 + laneW * (e.lane + 0.5);
      c.globalAlpha = 1 - age / 0.6;
      this.text(e.judgement.toUpperCase(), cx, hit - laneW * 0.75 - age * 60, 17, JUDGE_COLOR[e.judgement], 'center', 800);
      c.globalAlpha = 1;
    }
  }

  private note(n: Note, x: number, y: number, laneW: number, match: MatchTimeline): void {
    const c = this.ctx;
    const r = laneW * 0.3;
    const col = n.kind === 'swing' ? COLORS.swing : laneColor(n.lane, match);
    c.save();
    c.translate(x, y);
    c.shadowColor = col;
    c.shadowBlur = r * 0.9;
    c.fillStyle = col;
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2;
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

  /** Top bar: which match is replayed and where we are in it. */
  ticker(match: MatchTimeline, chart: Chart, t: number, caption: string | null, captionTeam: 0 | 1, captionAge: number): void {
    const c = this.ctx;
    const play0 = SONG.leadIn;
    const play1 = SONG.duration - SONG.outro;
    const p = Math.min(1, Math.max(0, (t - play0) / (play1 - play0)));
    const matchT = chart.window[0] + p * (chart.window[1] - chart.window[0]);
    this.text(`${match.teams[0].tag}  vs  ${match.teams[1].tag}`, this.w / 2, this.h * 0.045, 26, COLORS.white, 'center', 800);
    this.text(`${match.title} · replaying ${matchClock(matchT)}${match.synthetic ? ' · demo data' : ''}`, this.w / 2, this.h * 0.085, 15, COLORS.dim, 'center', 600);
    const bx = this.w * 0.3;
    const bw = this.w * 0.4;
    c.fillStyle = COLORS.faint;
    c.fillRect(bx, this.h * 0.112, bw, 4);
    c.fillStyle = COLORS.sky;
    c.fillRect(bx, this.h * 0.112, bw * Math.min(1, Math.max(0, t / SONG.duration)), 4);
    if (caption && captionAge < 2.4) {
      c.globalAlpha = Math.min(1, (2.4 - captionAge) / 0.4);
      this.text(caption, this.w / 2, this.h * 0.155, 24, match.teams[captionTeam].color, 'center', 800);
      c.globalAlpha = 1;
    }
  }

  countdown(t: number): void {
    if (t >= SONG.leadIn || t < 0) return;
    const beat = 60 / SONG.bpm;
    const left = Math.ceil((SONG.leadIn - t) / (beat * 2));
    this.text(left > 0 ? String(Math.min(3, left)) : 'GO', this.w / 2, this.h * 0.5, 120, COLORS.white, 'center', 900);
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
