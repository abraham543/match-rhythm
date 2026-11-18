import { describe, expect, it } from 'vitest';
import { buildChart, laneFor, NOTE_TARGET, pickWindow, RAMP, scoreAt, SONG } from './chart';
import { judge, multiplier, Scorer, WINDOWS } from './score';
import { cleanInitials, Leaderboard, SIZE } from './leaderboard';
import { SAMPLE_MATCHES, tacticalMatch } from '../data/samples';
import { ImportError, parseTimeline } from '../data/importer';
import type { Chart, MatchEvent } from './types';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('demo matches', () => {
  it('are deterministic', () => {
    const a = tacticalMatch(5, SAMPLE_MATCHES[0].teams[0], SAMPLE_MATCHES[0].teams[1], 'x', 'x');
    const b = tacticalMatch(5, SAMPLE_MATCHES[0].teams[0], SAMPLE_MATCHES[0].teams[1], 'x', 'x');
    expect(a).toEqual(b);
  });
  it('end with a decisive round and are marked synthetic', () => {
    for (const m of SAMPLE_MATCHES) {
      expect(m.synthetic).toBe(true);
      expect(m.events.length).toBeGreaterThan(100);
      expect(m.events[m.events.length - 1].kind).toBe('round');
      for (let i = 1; i < m.events.length; i++) expect(m.events[i].t).toBeGreaterThanOrEqual(m.events[i - 1].t);
    }
  });
});

describe('chart', () => {
  for (const d of ['casual', 'standard', 'pro'] as const) {
    it(`${d}: fits the song, stays on the grid and never exceeds the target`, () => {
      for (const m of SAMPLE_MATCHES) {
        const c = buildChart(m, d);
        expect(c.notes.length).toBeLessThanOrEqual(NOTE_TARGET[d]);
        expect(c.notes.length).toBeGreaterThan(NOTE_TARGET[d] * 0.5);
        const half = 30 / SONG.bpm;
        for (const n of c.notes) {
          expect(n.time).toBeGreaterThanOrEqual(SONG.leadIn - 0.3);
          expect(n.time).toBeLessThanOrEqual(SONG.duration - SONG.outro + 0.3);
          expect(Math.abs(n.time / half - Math.round(n.time / half))).toBeLessThan(1e-6);
        }
      }
    });
  }
  it('never puts two notes in one lane at the same moment, and at most two at once', () => {
    const c = buildChart(SAMPLE_MATCHES[0], 'pro');
    const seen = new Map<string, number>();
    const perTime = new Map<number, number>();
    for (const n of c.notes) {
      const k = `${n.time.toFixed(4)}:${n.lane}`;
      expect(seen.has(k)).toBe(false);
      seen.set(k, 1);
      perTime.set(+n.time.toFixed(4), (perTime.get(+n.time.toFixed(4)) ?? 0) + 1);
    }
    for (const v of perTime.values()) expect(v).toBeLessThanOrEqual(2);
  });
  it('keeps the order of the real match', () => {
    const c = buildChart(SAMPLE_MATCHES[1], 'standard');
    const byTime = [...c.notes].sort((a, b) => a.time - b.time || a.matchT - b.matchT);
    for (let i = 1; i < byTime.length; i++) expect(byTime[i].matchT).toBeGreaterThanOrEqual(byTime[i - 1].matchT - 30);
    expect(c.window[0]).toBeLessThan(c.window[1]);
  });
  it('lanes follow the meaning of the event', () => {
    const e = (kind: MatchEvent['kind'], team: 0 | 1): MatchEvent => ({ t: 0, kind, team, label: '' });
    expect(laneFor(e('elim', 0))).toBe(0);
    expect(laneFor(e('elim', 1))).toBe(3);
    expect(laneFor(e('objective', 1))).toBe(1);
    expect(laneFor(e('round', 0))).toBe(2);
  });
  it('window prefers dramatic slices that end on a result', () => {
    const ev: MatchEvent[] = [];
    for (let i = 0; i < 40; i++) ev.push({ t: i, kind: 'elim', team: 0, label: '' });
    for (let i = 40; i < 50; i++) ev.push({ t: i, kind: i === 49 ? 'round' : 'objective', team: (i % 2) as 0 | 1, label: '' });
    const [, end] = pickWindow(ev, 10);
    expect(end).toBe(49);
  });
});

describe('scoring', () => {
  const chart: Chart = {
    matchId: 't', bpm: 120, duration: 10, window: [0, 1], captions: [], winner: 0,
    notes: [1, 2, 3].map((time, i) => ({ time, lane: i % 2, kind: 'elim' as const, team: 0 as const, label: '', pitch: 60, matchT: time })),
  };
  it('judges by timing windows', () => {
    expect(judge(0.01)).toBe('perfect');
    expect(judge(-WINDOWS.great)).toBe('great');
    expect(judge(0.14)).toBe('good');
    expect(judge(0.2)).toBe('miss');
  });
  it('hits only the right lane inside the window and sweeps misses', () => {
    const s = new Scorer(chart);
    expect(s.press(1, 1.0)).toBeNull();
    expect(s.press(0, 1.02)?.judgement).toBe('perfect');
    expect(s.press(0, 1.02)).toBeNull(); // already hit
    expect(s.sweep(2.5).length).toBe(1); // note at 2 s missed
    expect(s.combo).toBe(0);
    expect(s.press(0, 3.08)?.judgement).toBe('great');
    expect(s.counts).toEqual({ perfect: 1, great: 1, good: 0, miss: 1 });
  });
  it('multiplier grows every 10 combo up to x4', () => {
    expect(multiplier(0)).toBe(1);
    expect(multiplier(10)).toBe(2);
    expect(multiplier(99)).toBe(4);
  });
});

describe('leaderboard', () => {
  it('keeps the top 10 of the day, highest first', () => {
    const b = new Leaderboard(memory(), 'k');
    for (let i = 0; i < 15; i++) b.add({ initials: 'ab', score: i * 100, grade: 'A', match: 'm', at: i });
    const l = b.list();
    expect(l.length).toBe(SIZE);
    expect(l[0].score).toBe(1400);
    expect(l[0].initials).toBe('AB-');
    expect(b.rankFor(50)).toBe(0);
    expect(b.rankFor(1450)).toBe(1);
  });
  it('cleans initials', () => {
    expect(cleanInitials('a!bcd')).toBe('ABC');
  });
});

describe('import', () => {
  it('rejects broken files with a clear message', () => {
    expect(() => parseTimeline('nope')).toThrow(ImportError);
    expect(() => parseTimeline('{"events": []}')).toThrow(/at least 20/);
  });
  it('accepts a minimal event list and builds a chart from it', () => {
    const events = Array.from({ length: 60 }, (_, i) => ({ t: i * 7, kind: i % 9 === 0 ? 'round' : 'elim', team: i % 2, label: `e${i}` }));
    const m = parseTimeline(JSON.stringify({ title: 'Test', teams: [{ name: 'A' }, { name: 'B' }], events }));
    expect(m.teams[1].tag).toBe('B');
    const c = buildChart(m, 'casual');
    expect(c.notes.length).toBeGreaterThan(20);
  });
});

describe('song structure (review fixes)', () => {
  const all = SAMPLE_MATCHES.flatMap((m) => (['casual', 'standard', 'pro'] as const).map((d) => ({ m, d, c: buildChart(m, d) })));
  it('no note before the count-in ends', () => {
    for (const { c } of all) expect(c.notes[0].time).toBeGreaterThanOrEqual(SONG.leadIn - 1e-9);
  });
  it('the song ends on the decisive moment of the match', () => {
    for (const { m, c } of all) {
      const lastRound = [...m.events].reverse().find((e) => e.kind === 'round')!;
      const last = c.notes[c.notes.length - 1];
      expect(last.final).toBe(true);
      expect(last.matchT).toBe(lastRound.t);
      expect(c.winner).toBe(lastRound.team);
    }
  });
  it('momentum swings survive next to round results', () => {
    const c = buildChart(SAMPLE_MATCHES[0], 'standard');
    expect(c.notes.some((n) => n.kind === 'swing' || n.accent)).toBe(true);
  });
  it('the opening is gentle: one note at a time, a beat apart', () => {
    const beat = 60 / SONG.bpm;
    for (const { c } of all) {
      const early = c.notes.filter((n) => n.time < SONG.leadIn + RAMP);
      for (let i = 1; i < early.length; i++) expect(early[i].time - early[i - 1].time).toBeGreaterThanOrEqual(beat - 0.02);
    }
  });
  it('casual never asks for two notes at once', () => {
    for (const { d, c } of all) {
      if (d !== 'casual') continue;
      const times = c.notes.map((n) => n.time.toFixed(4));
      expect(new Set(times).size).toBe(times.length);
    }
  });
  it('the melody moves (voice leading, not one pitch per lane)', () => {
    for (const { c } of all) expect(new Set(c.notes.map((n) => n.pitch)).size).toBeGreaterThanOrEqual(6);
  });
  it('the ticker can show the running round score', () => {
    const c = buildChart(SAMPLE_MATCHES[0], 'standard');
    const s = scoreAt(c, SONG.duration);
    expect(s).not.toBeNull();
    expect(Math.max(...s!)).toBe(13);
  });
});

describe('fair scoring (review fixes)', () => {
  it('mashing all lanes at 10 Hz scores far below a clean run', () => {
    const c = buildChart(SAMPLE_MATCHES[0], 'standard');
    const clean = new Scorer(c);
    for (const n of c.notes) clean.press(n.lane, n.time);
    const masher = new Scorer(c);
    for (let t = 0; t < SONG.duration; t += 0.1) {
      for (let l = 0; l < 4; l++) masher.press(l, t);
      masher.sweep(t);
    }
    masher.sweep(SONG.duration + 1);
    expect(masher.score).toBeLessThan(clean.score * 0.25);
  });
  it('a clean run hits the final note and earns the bonus', () => {
    const c = buildChart(SAMPLE_MATCHES[1], 'casual');
    const s = new Scorer(c, false);
    for (const n of c.notes) s.press(n.lane, n.time);
    expect(s.finalJudgement).toBe('perfect');
    expect(s.counts.miss).toBe(0);
  });
});

describe('leaderboard (review fixes)', () => {
  it('two players compete for the last places', () => {
    const b = new Leaderboard(memory(), 'k');
    for (let i = 0; i < 9; i++) b.add({ initials: 'x', score: 1000 + i, grade: 'A', match: 'm', at: i });
    expect(b.ranksFor([5000, 4000])).toEqual([1, 2]);
    expect(b.ranksFor([10, 20])).toEqual([0, 10]);
  });
  it('the day key follows the calendar', () => {
    const store = memory();
    const b = new Leaderboard(store);
    b.add({ initials: 'abc', score: 5, grade: 'A', match: 'm', at: 1 });
    expect(b.list().length).toBe(1);
    const keys: string[] = [];
    const s2 = { ...store, setItem: (k: string, v: string) => { keys.push(k); store.setItem(k, v); } };
    new Leaderboard(s2).add({ initials: 'abc', score: 5, grade: 'A', match: 'm', at: 2 });
    expect(keys[0]).toMatch(/^match-rhythm:board:\d{4}-\d{2}-\d{2}$/);
  });
  it('blocks rude initials', () => {
    expect(cleanInitials('ass')).toBe('C9!');
  });
});
