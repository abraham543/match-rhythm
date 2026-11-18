// Match timeline -> playable rhythm chart.
// 1. Take the end of the match (the song always ends on the decisive moment) with as many events
//    as the difficulty allows.
// 2. Stretch that slice over the song and snap every event to the beat grid, keeping the real order.
// 3. Each event kind has its own lane. Pitches follow the chords of the song with simple voice leading:
//    a run of eliminations by one team climbs, a change of team falls back, objectives ring out on top.
//    Hitting the notes plays the melody of the match.
import type { Caption, Chart, Difficulty, EventKind, MatchEvent, MatchTimeline, Note } from './types';

const BEAT = 60 / 124;

export const SONG = {
  bpm: 124,
  duration: 60,
  /** Two bars of count-in. */
  leadIn: 8 * BEAT,
  outro: 2.5,
};

export const LANES = 4;
export const NOTE_TARGET: Record<Difficulty, number> = { casual: 60, standard: 88, pro: 124 };
/** Smallest grid step, in beats, per difficulty. */
const GRID: Record<Difficulty, number> = { casual: 1, standard: 0.5, pro: 0.5 };
/** Most notes that may sound together. */
const CHORD_MAX: Record<Difficulty, number> = { casual: 1, standard: 2, pro: 2 };
/** Smallest gap between two notes in the same lane, in seconds. */
const SAME_LANE_GAP: Record<Difficulty, number> = { casual: 2 * BEAT - 0.01, standard: 0.48, pro: BEAT / 2 - 0.01 };
/** The first seconds of play are gentler: one note at a time, at least a beat apart. */
export const RAMP = 8;

const PRIORITY: Record<EventKind, number> = { objective: 4, round: 3, swing: 2, elim: 1 };

/** Lane by meaning: eliminations by team on the outside, objectives and round results in the middle. */
export function laneFor(e: MatchEvent): number {
  if (e.kind === 'elim') return e.team === 0 ? 0 : 3;
  if (e.kind === 'objective') return 1;
  return 2;
}

// Chords (MIDI) per bar: Am - F - C - G, a progression that fits any hit order.
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const LOW = 64;
const HIGH = 84;

export function chordAt(time: number, bpm = SONG.bpm): number[] {
  const bar = Math.floor(Math.max(0, time) / ((60 / bpm) * 4));
  return CHORDS[bar % CHORDS.length];
}

/** Chord tones of the bar at `time`, spread over the melody range. */
export function chordTones(time: number): number[] {
  const out: number[] = [];
  for (const m of chordAt(time)) for (let o = -12; o <= 36; o += 12) if (m + o >= LOW && m + o <= HIGH) out.push(m + o);
  return out.sort((a, b) => a - b);
}

/** Voice leading for the melody: the next pitch is the chord tone nearest to where the match "moves". */
export function voice(notes: Note[]): void {
  let prev = 72;
  let prevTeam: 0 | 1 | -1 = -1;
  for (const n of notes) {
    const tones = chordTones(n.time);
    if (n.kind === 'objective') {
      n.pitch = tones[tones.length - 1];
    } else {
      const target = n.kind === 'round' || n.final ? 69 : prev + (n.team === prevTeam ? 3 : -3);
      let best = tones[0];
      for (const t of tones) if (Math.abs(t - target) < Math.abs(best - target) || (Math.abs(t - target) === Math.abs(best - target) && t !== prev)) best = t;
      n.pitch = best;
    }
    prev = n.pitch;
    prevTeam = n.team;
  }
}

/** The slice of the match the song covers: it always ends on the last result of the match. */
export function pickWindow(events: MatchEvent[], count: number): [number, number] {
  if (events.length === 0) return [0, 1];
  let end = events.length - 1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'round') {
      end = i;
      break;
    }
  }
  const start = Math.max(0, end - count + 1);
  return [events[start].t, events[end].t];
}

/** Running score of round-based games, taken from round events. */
function roundScore(events: MatchEvent[]): Map<MatchEvent, [number, number]> {
  const score: [number, number] = [0, 0];
  const out = new Map<MatchEvent, [number, number]>();
  for (const e of events) {
    if (e.kind !== 'round') continue;
    score[e.team]++;
    out.set(e, [score[0], score[1]]);
  }
  return out;
}

export function buildChart(match: MatchTimeline, difficulty: Difficulty = 'standard'): Chart {
  const events = [...match.events].sort((a, b) => a.t - b.t);
  const target = NOTE_TARGET[difficulty];
  const [t0, t1] = pickWindow(events, Math.round(target * 1.3));
  const span = Math.max(1, t1 - t0);
  const step = GRID[difficulty] * BEAT;
  const bar = 4 * BEAT;
  const playStart = SONG.leadIn;
  const lastBar = Math.floor((SONG.duration - SONG.outro) / bar) * bar; // the final note lands on a downbeat
  const firstSlot = Math.ceil(playStart / step - 1e-9);
  const lastSlot = Math.round(lastBar / step);
  const scores = roundScore(events);
  const inWindow = events.filter((e) => e.t >= t0 && e.t <= t1);
  const finalEvent = inWindow[inWindow.length - 1];

  const slots = new Map<number, Note[]>();
  const place = (note: Note, slot: number): boolean => {
    const list = slots.get(slot) ?? [];
    if (list.some((n) => n.lane === note.lane)) return false;
    note.time = slot * step;
    list.push(note);
    slots.set(slot, list);
    return true;
  };

  for (const e of inWindow) {
    const raw = playStart + ((e.t - t0) / span) * (lastBar - playStart);
    const isFinal = e === finalEvent;
    const slot = isFinal ? lastSlot : Math.min(lastSlot - 1, Math.max(firstSlot, Math.round(raw / step)));
    const note: Note = { time: 0, lane: laneFor(e), kind: e.kind, team: e.team, label: e.label, pitch: 0, matchT: e.t, final: isFinal || undefined };
    if (place(note, slot)) continue;
    // same lane already taken: try a little earlier, so swings before a round result are not lost
    if (slot - 1 >= firstSlot && place(note, slot - 1)) continue;
    if (slot - 2 >= firstSlot && place(note, slot - 2)) continue;
    const other = slots.get(slot)!.find((n) => n.lane === note.lane)!;
    if (note.kind === 'swing' && other.kind === 'round') other.accent = true;
    else if (PRIORITY[note.kind] > PRIORITY[other.kind]) Object.assign(other, { ...note, time: other.time });
  }

  let notes: Note[] = [];
  for (const list of slots.values()) {
    list.sort((a, b) => Number(!!b.final) - Number(!!a.final) || PRIORITY[b.kind] - PRIORITY[a.kind]);
    notes.push(...list.slice(0, CHORD_MAX[difficulty]));
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);

  // playability: same-lane spacing, and a gentle opening
  const kept: Note[] = [];
  const lastInLane: (Note | null)[] = [null, null, null, null];
  let lastAny = -Infinity;
  for (const n of notes) {
    const inRamp = n.time < playStart + RAMP;
    const prev = lastInLane[n.lane];
    if (prev && n.time - prev.time < SAME_LANE_GAP[difficulty]) {
      // too close in one lane: keep the more meaningful note; a swing folds into the round it led to
      if (n.final || PRIORITY[n.kind] > PRIORITY[prev.kind]) {
        if (prev.kind === 'swing') n.accent = true;
        kept.splice(kept.indexOf(prev), 1, n);
        n.time = Math.max(n.time, prev.time);
        lastInLane[n.lane] = n;
      } else if (n.kind === 'swing' && prev.kind === 'round') {
        prev.accent = true;
      }
      continue;
    }
    if (!n.final && inRamp && n.time - lastAny < BEAT - 0.01) continue;
    kept.push(n);
    lastInLane[n.lane] = n;
    lastAny = n.time;
  }
  notes = kept;

  // thin out to the target, dropping the least meaningful notes first (never the final one)
  if (notes.length > target) {
    const ranked = notes.map((n, i) => ({ i, p: n.final ? 99 : PRIORITY[n.kind] + (n.accent ? 1 : 0) + ((i * 7919) % 13) / 100 }));
    ranked.sort((a, b) => a.p - b.p);
    const drop = new Set(ranked.slice(0, notes.length - target).map((x) => x.i));
    notes = notes.filter((_, i) => !drop.has(i));
  }
  voice(notes);

  const byEvent = new Map(inWindow.map((e) => [e.t + ':' + e.label, e]));
  const captions: Caption[] = notes
    .filter((n) => n.kind !== 'elim')
    .map((n) => {
      const e = byEvent.get(n.matchT + ':' + n.label);
      return { time: n.time, text: n.label, team: n.team, score: e ? scores.get(e) : undefined };
    });

  return {
    matchId: match.id, bpm: SONG.bpm, duration: SONG.duration, notes, captions, window: [t0, t1],
    winner: finalEvent ? finalEvent.team : 0,
  };
}

/** Running round score at song time `t`, if the match counts rounds. */
export function scoreAt(chart: Chart, t: number): [number, number] | null {
  let s: [number, number] | null = null;
  for (const c of chart.captions) {
    if (c.time > t) break;
    if (c.score) s = c.score;
  }
  return s;
}

/** "mm:ss" of the real match, for on-screen captions. */
export function matchClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
