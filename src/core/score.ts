// Timing judgment and scoring for one player.
import type { Chart, EventKind, Judgement, Note } from './types';

export const WINDOWS = { perfect: 0.05, great: 0.1, good: 0.15 };
const POINTS: Record<Judgement, number> = { perfect: 300, great: 200, good: 100, miss: 0 };
/** A stray press this close before a note caps that note at "good": mashing does not pay. */
const MASH_WINDOW = 0.25;

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
  /** Seconds; negative = early. */
  delta: number;
}

/** Hits per kind of match event, for the "in match terms" results line. */
export type KindStats = Record<EventKind, { hit: number; total: number }>;

export class Scorer {
  score = 0;
  combo = 0;
  maxCombo = 0;
  /** Presses that hit no note. */
  stray = 0;
  readonly counts: Record<Judgement, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
  readonly byKind: KindStats = { elim: { hit: 0, total: 0 }, objective: { hit: 0, total: 0 }, round: { hit: 0, total: 0 }, swing: { hit: 0, total: 0 } };
  /** Team-split eliminations: hits on each team's elimination lane. */
  readonly elimByTeam: { hit: number; total: number }[] = [{ hit: 0, total: 0 }, { hit: 0, total: 0 }];
  /** Judgment of the final, decisive note (null until it is judged). */
  finalJudgement: Judgement | null = null;
  private readonly done: boolean[];
  private readonly lastStray: number[] = [-Infinity, -Infinity, -Infinity, -Infinity];
  private cursor = 0;

  /** `strict`: a stray press breaks the combo (standard and pro). */
  constructor(readonly chart: Chart, private readonly strict = true) {
    this.done = chart.notes.map(() => false);
    for (const n of chart.notes) {
      this.byKind[n.kind].total++;
      if (n.kind === 'elim') this.elimByTeam[n.team].total++;
    }
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
    if (bestIdx < 0) {
      this.stray++;
      if (lane >= 0 && lane < this.lastStray.length) this.lastStray[lane] = t;
      if (this.strict) this.combo = 0;
      return null;
    }
    const note = this.chart.notes[bestIdx];
    this.done[bestIdx] = true;
    let j = judge(bestDelta);
    if (j !== 'good' && note.time - this.lastStray[lane] < MASH_WINDOW) j = 'good';
    this.apply(j, note);
    return { note, judgement: j, delta: bestDelta };
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
      this.apply('miss', n);
      missed.push(n);
      this.cursor++;
    }
    return missed;
  }

  isDone(i: number): boolean {
    return this.done[i];
  }

  private apply(j: Judgement, note: Note): void {
    this.counts[j]++;
    if (note.final) this.finalJudgement = j;
    if (j === 'miss') {
      this.combo = 0;
      return;
    }
    this.byKind[note.kind].hit++;
    if (note.kind === 'elim') this.elimByTeam[note.team].hit++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += POINTS[j] * multiplier(this.combo - 1) * (note.final ? 3 : 1);
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
