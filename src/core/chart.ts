// Match timeline -> playable rhythm chart.
// 1. Pick the most dramatic slice of the match that holds the right number of events for the difficulty.
// 2. Stretch that slice over the song and snap every event to the beat grid.
// 3. Each event kind has its own lane, and each note gets a pitch from the song's chord at that moment,
//    so hitting the notes plays the melody of the match.
import type { Caption, Chart, Difficulty, EventKind, MatchEvent, MatchTimeline, Note } from './types';

export const SONG = {
  bpm: 124,
  duration: 60,
  leadIn: 3,
  outro: 2.5,
};

export const LANES = 4;
export const NOTE_TARGET: Record<Difficulty, number> = { casual: 60, standard: 88, pro: 124 };
/** Smallest grid step, in beats, per difficulty. */
const GRID: Record<Difficulty, number> = { casual: 1, standard: 0.5, pro: 0.5 };

const PRIORITY: Record<EventKind, number> = { objective: 4, round: 3, swing: 2, elim: 1 };

/** Lane by meaning: eliminations by team on the outside, objectives and round results in the middle. */
export function laneFor(e: MatchEvent): number {
  if (e.kind === 'elim') return e.team === 0 ? 0 : 3;
  if (e.kind === 'objective') return 1;
  return 2;
}

// Chords (MIDI roots) per bar: Am - F - C - G, a progression that fits any hit order.
const CHORDS = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 52, 55, 60], [55, 59, 62, 67]];

export function chordAt(time: number, bpm = SONG.bpm): number[] {
  const bar = Math.floor(Math.max(0, time) / ((60 / bpm) * 4));
  return CHORDS[bar % CHORDS.length];
}

export function pitchFor(lane: number, time: number, bpm = SONG.bpm): number {
  const chord = chordAt(time, bpm);
  return chord[lane % chord.length] + 12;
}

/** Most dramatic window that contains `count` consecutive events. */
export function pickWindow(events: MatchEvent[], count: number): [number, number] {
  if (events.length === 0) return [0, 1];
  if (events.length <= count) return [events[0].t, events[events.length - 1].t];
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i + count <= events.length; i++) {
    const slice = events.slice(i, i + count);
    const span = slice[slice.length - 1].t - slice[0].t;
    const drama = slice.reduce((s, e) => s + PRIORITY[e.kind], 0);
    // both teams should matter in the slice, and a final result is a good ending
    const teams = new Set(slice.map((e) => e.team)).size;
    const endsOnResult = slice[slice.length - 1].kind === 'round' ? 6 : 0;
    const lateBonus = i / events.length; // late game moments are more exciting
    const score = drama + teams * 4 + endsOnResult + lateBonus * 10 - span / 600;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return [events[best].t, events[best + count - 1].t];
}

export function buildChart(match: MatchTimeline, difficulty: Difficulty = 'standard'): Chart {
  const events = [...match.events].sort((a, b) => a.t - b.t);
  const target = NOTE_TARGET[difficulty];
  const [t0, t1] = pickWindow(events, Math.round(target * 1.25));
  const span = Math.max(1, t1 - t0);
  const beat = 60 / SONG.bpm;
  const step = GRID[difficulty] * beat;
  const playStart = SONG.leadIn;
  const playEnd = SONG.duration - SONG.outro;

  const slots = new Map<number, Note[]>();
  for (const e of events) {
    if (e.t < t0 || e.t > t1) continue;
    const raw = playStart + ((e.t - t0) / span) * (playEnd - playStart);
    const slot = Math.round(raw / step);
    const time = slot * step;
    const lane = laneFor(e);
    const list = slots.get(slot) ?? [];
    const note: Note = { time, lane, kind: e.kind, team: e.team, label: e.label, pitch: pitchFor(lane, time), matchT: e.t };
    const sameLane = list.findIndex((n) => n.lane === lane);
    if (sameLane >= 0) {
      if (PRIORITY[note.kind] > PRIORITY[list[sameLane].kind]) list[sameLane] = note;
    } else {
      list.push(note);
    }
    slots.set(slot, list);
  }

  let notes: Note[] = [];
  for (const list of slots.values()) {
    // at most two simultaneous notes, keep the most meaningful
    list.sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind]);
    notes.push(...list.slice(0, 2));
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  // thin out to the target, dropping the least meaningful notes first
  if (notes.length > target) {
    const ranked = notes.map((n, i) => ({ n, i, p: PRIORITY[n.kind] + ((i * 7919) % 13) / 100 }));
    ranked.sort((a, b) => a.p - b.p);
    const drop = new Set(ranked.slice(0, notes.length - target).map((x) => x.i));
    notes = notes.filter((_, i) => !drop.has(i));
  }

  const captions: Caption[] = notes
    .filter((n) => n.kind !== 'elim')
    .map((n) => ({ time: n.time, text: n.label, team: n.team }));

  return { matchId: match.id, bpm: SONG.bpm, duration: SONG.duration, notes, captions, window: [t0, t1] };
}

/** "mm:ss" of the real match, for on-screen captions. */
export function matchClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
