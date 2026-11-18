// Timing judgment and scoring for one player.
import type { Chart, Judgement, Note } from './types';

export const WINDOWS = { perfect: 0.05, great: 0.1, good: 0.15 };
const POINTS: Record<Judgement, number> = { perfect: 300, great: 200, good: 100, miss: 0 };

export function judge(delta: number): Judgement {
  const d = Math.abs(delta);
  if (d <= WINDOWS.perfect) return 'perfect';
  if (d <= WINDOWS.great) return 'great';
  if (d <= WINDOWS.good) return 'good';
  return 'miss';
}

export function multiplier(combo: number): number {
  return Math.min(4, 1 + Math.floor(combo / 10));
}

export interface HitResult {
  note: Note;
  judgement: Judgement;
  delta: number;
}

export class Scorer {
  score = 0;
  combo = 0;
  maxCombo = 0;
  readonly counts: Record<Judgement, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
  private readonly done: boolean[];
  private cursor = 0;

  constructor(readonly chart: Chart) {
    this.done = chart.notes.map(() => false);
  }

  /** A press on `lane` at song time `t`. Returns the judged note, or null for a press that hit nothing. */
  press(lane: number, t: number): HitResult | null {
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = this.cursor; i < this.chart.notes.length; i++) {
      const n = this.chart.notes[i];
      if (n.time - t > WINDOWS.good) break;
      if (this.done[i] || n.lane !== lane) continue;
      const d = t - n.time;
      if (Math.abs(d) <= WINDOWS.good && Math.abs(d) < Math.abs(bestDelta)) {
        bestIdx = i;
        bestDelta = d;
      }
    }
    if (bestIdx < 0) return null;
    this.done[bestIdx] = true;
    const j = judge(bestDelta);
    this.apply(j);
    return { note: this.chart.notes[bestIdx], judgement: j, delta: bestDelta };
  }

  /** Marks every note that can no longer be hit at time `t` as missed. */
  sweep(t: number): Note[] {
    const missed: Note[] = [];
    while (this.cursor < this.chart.notes.length) {
      const n = this.chart.notes[this.cursor];
      if (this.done[this.cursor]) {
        this.cursor++;
        continue;
      }
      if (t - n.time <= WINDOWS.good) break;
      this.done[this.cursor] = true;
      this.apply('miss');
      missed.push(n);
      this.cursor++;
    }
    return missed;
  }

  isDone(i: number): boolean {
    return this.done[i];
  }

  private apply(j: Judgement): void {
    this.counts[j]++;
    if (j === 'miss') {
      this.combo = 0;
      return;
    }
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += POINTS[j] * multiplier(this.combo - 1);
  }

  /** 0..1, weighted by judgment. */
  accuracy(): number {
    const total = this.counts.perfect + this.counts.great + this.counts.good + this.counts.miss;
    if (total === 0) return 0;
    return (this.counts.perfect + this.counts.great * 0.7 + this.counts.good * 0.4) / total;
  }

  grade(): string {
    const a = this.accuracy();
    if (a >= 0.95 && this.counts.miss === 0) return 'S+';
    if (a >= 0.9) return 'S';
    if (a >= 0.8) return 'A';
    if (a >= 0.65) return 'B';
    if (a >= 0.5) return 'C';
    return 'D';
  }
}
