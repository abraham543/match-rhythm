// Booth flow: ATTRACT -> JOIN -> PLAY (60 s song with count-in) -> RESULTS (initials, QR) -> BOARD -> ATTRACT.
import qrcode from 'qrcode-generator';
import { buildChart, scoreAt, SONG } from '../core/chart';
import { dayKey, Leaderboard } from '../core/leaderboard';
import { multiplier, Scorer } from '../core/score';
import type { Chart, Difficulty, MatchTimeline } from '../core/types';
import { AudioEngine } from '../audio/engine';
import type { Action, Input, Zone } from './input';
import { COLORS, type PlayerView, Renderer } from './render';
import { matchLine, shareUrl } from './share';

type Screen = 'attract' | 'join' | 'play' | 'results' | 'board';

export interface Settings {
  difficulty: Difficulty;
  /** Match id, or 'rotate' to cycle through all matches. */
  match: string;
  volume: number;
  /** Display lag in ms (TVs often add 30-100 ms): notes are drawn this much later. */
  visualOffsetMs: number;
  /** Input lag in ms (wireless pads, USB hubs): presses are judged this much earlier. */
  inputOffsetMs: number;
  shareBase: string;
  allowTwoPlayers: boolean;
}

const KEYS: [string[], string[]] = [['A', 'S', 'D', 'F'], ['J', 'K', 'L', ';']];
const JOIN_WAIT = 6; // seconds a second player has to join
const RESULTS_LOCK = 1.5; // presses right after the song must not edit initials or skip the QR
const RESULTS_TIMEOUT = 30;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const QR_CACHE = 8;

interface Seat {
  player: 0 | 1;
  view: PlayerView;
  initials: string[];
  slot: number;
  saved: boolean;
  rank: number;
}

export class Game {
  screen: Screen = 'attract';
  private since = 0; // wall clock when the screen started
  private now = 0;
  private matches: MatchTimeline[];
  private rotation = 0;
  private match!: MatchTimeline;
  private chart!: Chart;
  private seats: Seat[] = [];
  private joined: boolean[] = [false, false];
  private demo!: { chart: Chart; match: MatchTimeline; view: PlayerView; start: number };
  private readonly qrCache = new Map<string, boolean[][]>();
  private playWall = 0;
  private stingerPlayed = false;
  private lead = 0; // smoothed tug-of-war position, -1..1
  private lastLeader = 0;
  private finishAt = 0;

  constructor(
    private readonly r: Renderer,
    private readonly input: Input,
    private readonly audio: AudioEngine,
    private readonly board: Leaderboard,
    public settings: Settings,
    matches: MatchTimeline[],
  ) {
    this.matches = matches;
    input.on((a) => this.onAction(a));
    this.newDemo(0);
  }

  setMatches(list: MatchTimeline[]): void {
    this.matches = list;
    this.rotation = 0;
    this.newDemo(this.now);
  }

  get matchList(): MatchTimeline[] {
    return this.matches;
  }

  private go(s: Screen): void {
    this.screen = s;
    this.since = this.now;
  }

  private elapsed(): number {
    return this.now - this.since;
  }

  /** The match the next game will use (also shown by the demo, so the demo is a preview). */
  private peekMatch(): MatchTimeline {
    if (this.settings.match !== 'rotate') {
      const m = this.matches.find((x) => x.id === this.settings.match);
      if (m) return m;
    }
    return this.matches[this.rotation % this.matches.length];
  }

  private nextMatch(): MatchTimeline {
    const m = this.peekMatch();
    if (this.settings.match === 'rotate' || !this.matches.some((x) => x.id === this.settings.match)) this.rotation++;
    return m;
  }

  private newDemo(at: number): void {
    const match = this.peekMatch();
    const chart = buildChart(match, 'standard');
    this.demo = { chart, match, start: at, view: this.view(chart, [], 'DEMO') };
  }

  private view(chart: Chart, keys: string[], name: string): PlayerView {
    return { scorer: new Scorer(chart, this.settings.difficulty !== 'casual'), effects: [], keys, name, pressedAt: [-9, -9, -9, -9], particles: [], shake: 0 };
  }

  private onAction(a: Action): void {
    if (a.type === 'staff') return; // handled by the staff panel
    this.audio.unlock();
    switch (this.screen) {
      case 'attract':
      case 'board':
        this.joined = [false, false];
        this.joined[a.player] = true;
        this.audio.blip(660);
        this.go('join');
        break;
      case 'join': {
        const someone = this.joined.some(Boolean);
        if (a.type === 'start' && someone) {
          this.startPlay();
        } else if ((a.type === 'join' || a.type === 'lane') && !this.joined[a.player] && this.settings.allowTwoPlayers) {
          this.joined[a.player] = true;
          this.audio.blip(990);
          this.since = this.now - JOIN_WAIT + 2.5; // short wait once both are in
        }
        break;
      }
      case 'play':
        if (a.type === 'lane') this.press(a.player, a.lane);
        break;
      case 'results':
        if (this.elapsed() < RESULTS_LOCK) return;
        if (a.type === 'lane') this.editInitials(a.player, a.lane);
        else if (a.type === 'start') this.confirm(a.source === 'key' && this.seats.length === 2 ? null : a.player);
        break;
    }
  }

  private seatFor(player: 0 | 1): Seat | undefined {
    return this.seats.find((s) => s.player === player);
  }

  private startPlay(): void {
    this.match = this.nextMatch();
    this.chart = buildChart(this.match, this.settings.difficulty);
    const players: (0 | 1)[] = this.joined[0] && this.joined[1] ? [0, 1] : [this.joined[1] ? 1 : 0];
    this.seats = players.map((p) => ({ player: p, view: this.view(this.chart, KEYS[p], `PLAYER ${p + 1}`), initials: ['A', 'A', 'A'], slot: 0, saved: false, rank: 0 }));
    this.stingerPlayed = false;
    this.lead = 0;
    this.lastLeader = 0;
    this.audio.setVolume(this.settings.volume);
    this.audio.setIntensity(0);
    this.audio.start(0.2);
    this.playWall = this.now + 0.2;
    this.go('play');
  }

  /** Song clock: the audio clock when sound runs, the wall clock otherwise (a silent booth must still finish). */
  private clock(): number {
    if (this.audio.running) return this.audio.songTime - this.audio.latency;
    return this.now - this.playWall;
  }

  private judgeTime(): number {
    return this.clock() - this.settings.inputOffsetMs / 1000;
  }

  private renderTime(): number {
    return this.clock() - this.settings.visualOffsetMs / 1000;
  }

  private press(player: 0 | 1, lane: number): void {
    const seat = this.seatFor(player);
    if (!seat) return;
    const t = this.judgeTime();
    const rt = this.renderTime();
    seat.view.pressedAt[lane] = rt;
    const res = seat.view.scorer.press(lane, t);
    const pan = this.seats.length === 2 ? (seat === this.seats[0] ? -0.5 : 0.5) : 0;
    if (res) {
      seat.view.effects.push({ lane, at: rt, judgement: res.judgement, delta: res.delta });
      this.r.burst(seat.view, lane, res.note, this.match, rt);
      const big = res.note.kind === 'round' || res.note.kind === 'objective' || res.note.final;
      if (big) seat.view.shake = Math.max(seat.view.shake, res.note.final ? 1 : 0.6);
      this.audio.hit(res.note.pitch, res.judgement === 'perfect' ? 1 : 0.5, pan, res.note.kind === 'round' || !!res.note.final);
      if (res.note.final && !this.stingerPlayed) {
        this.stingerPlayed = true;
        this.audio.stinger(true);
      }
    }
  }

  private editInitials(player: 0 | 1, lane: number): void {
    const seat = this.seatFor(player);
    if (!seat || seat.saved || seat.rank === 0) return;
    const cur = LETTERS.indexOf(seat.initials[seat.slot]);
    if (lane === 1) seat.initials[seat.slot] = LETTERS[(cur + LETTERS.length - 1) % LETTERS.length];
    if (lane === 2) seat.initials[seat.slot] = LETTERS[(cur + 1) % LETTERS.length];
    if (lane === 0) seat.slot = Math.max(0, seat.slot - 1);
    if (lane === 3) {
      if (seat.slot < 2) seat.slot++;
      else this.save(seat);
    }
    this.audio.blip(lane === 3 ? 990 : 740);
    this.since = Math.max(this.since, this.now - (RESULTS_TIMEOUT - 12)); // typing keeps the screen alive
    this.maybeFinish();
  }

  /** Enter / Start / OK: saves the presser's initials (or everyone's, for a shared Enter key). */
  private confirm(player: 0 | 1 | null): void {
    const targets = player === null ? this.seats : this.seats.filter((s) => s.player === player);
    for (const seat of targets) if (seat.rank > 0) this.save(seat);
    if (this.seats.every((s) => s.rank === 0 || s.saved)) this.finishAt = Math.min(this.finishAt || Infinity, this.now + 0.6);
  }

  private maybeFinish(): void {
    if (this.seats.every((s) => s.rank === 0 || s.saved)) this.finishAt = this.now + 2.5;
  }

  private save(seat: Seat, initials?: string): void {
    if (seat.saved) return;
    seat.saved = true;
    const s = seat.view.scorer;
    seat.rank = this.board.add({ initials: initials ?? seat.initials.join(''), score: s.score, grade: s.grade(), match: this.match.title, at: Date.now() });
  }

  private finishResults(): void {
    // nobody typed: keep the place, but without pretending these are someone's initials
    for (const seat of this.seats) if (seat.rank > 0 && !seat.saved) this.save(seat, '???');
    this.finishAt = 0;
    this.go('board');
  }

  // ---------------------------------------------------------------- frame
  frame(now: number): void {
    this.now = now;
    this.input.pollGamepads();
    const r = this.r;
    switch (this.screen) {
      case 'attract':
        this.drawAttract();
        break;
      case 'join':
        this.drawJoin();
        if (this.elapsed() > JOIN_WAIT) this.startPlay();
        break;
      case 'play':
        this.drawPlay();
        break;
      case 'results':
        this.drawResults();
        if (this.elapsed() > RESULTS_TIMEOUT || (this.finishAt && now > this.finishAt)) this.finishResults();
        break;
      case 'board':
        this.input.layout = { lanes: [], buttons: [] };
        r.background(now);
        this.drawBoard(r.h * 0.12);
        r.text('Press any lane button to play', r.w / 2, r.h * 0.9, 26, COLORS.sky, 'center', 700);
        if (this.elapsed() > 12) {
          this.newDemo(now);
          this.go('attract');
        }
        break;
    }
  }

  private drawAttract(): void {
    const r = this.r;
    const d = this.demo;
    const t = this.now - d.start - 1;
    if (t > SONG.duration + 2) {
      this.rotation++;
      this.newDemo(this.now);
    }
    // the demo player hits every note perfectly
    for (let i = 0; i < d.chart.notes.length; i++) {
      const n = d.chart.notes[i];
      if (!d.view.scorer.isDone(i) && n.time <= t) {
        d.view.scorer.press(n.lane, n.time);
        d.view.effects.push({ lane: n.lane, at: n.time, judgement: 'perfect', delta: 0 });
        d.view.pressedAt[n.lane] = n.time;
        r.burst(d.view, n.lane, n, d.match, n.time);
      }
    }
    if (d.view.effects.length > 40) d.view.effects.splice(0, 20);
    const pulse = this.pulse(t);
    r.background(this.now, pulse);
    const [hw] = r.highways(1);
    this.input.layout = { lanes: [], buttons: [] };
    r.drawHighway(hw.x0, hw.x1, d.chart, d.match, d.view, t, pulse);
    let cap = null;
    for (const c of d.chart.captions) if (c.time <= t) cap = c;
    r.ticker(d.match, d.chart, t, cap?.text ?? null, cap?.team ?? 0, cap ? t - cap.time : 99, scoreAt(d.chart, t));
    // title band at the top-left and a call to action at the bottom, so the demo itself stays visible
    r.panel(r.w * 0.03, r.h * 0.22, r.w * 0.27, r.h * 0.42, 0.78);
    r.text('MATCH', r.w * 0.165, r.h * 0.3, 60, COLORS.white, 'center', 900);
    r.text('RHYTHM', r.w * 0.165, r.h * 0.37, 60, COLORS.sky, 'center', 900);
    r.text('Every note is a real', r.w * 0.165, r.h * 0.45, 20, COLORS.dim, 'center', 600);
    r.text('moment of the match.', r.w * 0.165, r.h * 0.485, 20, COLORS.dim, 'center', 600);
    r.text('60 s · 1 or 2 players', r.w * 0.165, r.h * 0.56, 20, COLORS.gold, 'center', 700);
    const blink = Math.floor(this.now * 2) % 2 === 0;
    r.panel(r.w * 0.7, r.h * 0.22, r.w * 0.27, r.h * 0.42, 0.78);
    r.text(blink ? 'PRESS ANY' : '', r.w * 0.835, r.h * 0.3, 40, COLORS.sky, 'center', 900);
    r.text(blink ? 'BUTTON' : '', r.w * 0.835, r.h * 0.36, 40, COLORS.sky, 'center', 900);
    r.text('P1: A S D F', r.w * 0.835, r.h * 0.45, 22, COLORS.white, 'center', 700);
    r.text('P2: J K L ;', r.w * 0.835, r.h * 0.5, 22, COLORS.white, 'center', 700);
    r.text('gamepad or tap the lanes', r.w * 0.835, r.h * 0.56, 18, COLORS.dim, 'center', 600);
    const top = this.board.list()[0];
    if (top) r.text(`Today's best: ${top.initials}  ${top.score.toLocaleString('en-US')}`, r.w / 2, r.h * 0.96, 22, COLORS.gold, 'center', 700);
  }

  private drawJoin(): void {
    const r = this.r;
    r.background(this.now, 0);
    const left = Math.max(0, Math.ceil(JOIN_WAIT - this.elapsed()));
    r.text('GET READY', r.w / 2, r.h * 0.17, 64, COLORS.white, 'center', 900);
    const m = this.peekMatch();
    r.text(`${m.teams[0].name} vs ${m.teams[1].name} — ${m.title}`, r.w / 2, r.h * 0.26, 26, COLORS.dim, 'center', 600);
    const buttons: Zone[] = [];
    for (const p of [0, 1] as const) {
      const x = r.w * (p === 0 ? 0.3 : 0.7);
      const box = { x0: x - r.w * 0.16, y0: r.h * 0.33, x1: x + r.w * 0.16, y1: r.h * 0.63 };
      r.panel(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
      r.text(`PLAYER ${p + 1}`, x, r.h * 0.4, 34, this.joined[p] ? COLORS.sky : COLORS.dim, 'center', 800);
      const msg = this.joined[p] ? 'READY' : this.settings.allowTwoPlayers ? `press ${KEYS[p].join(' ')} or tap here` : '—';
      r.text(msg, x, r.h * 0.48, 24, this.joined[p] ? COLORS.white : COLORS.dim, 'center', 700);
      r.text(`lanes: ${KEYS[p].join('  ')}`, x, r.h * 0.56, 18, COLORS.dim, 'center', 600);
      if (!this.joined[p]) buttons.push({ ...box, action: { type: 'join', player: p } });
    }
    const start = { x0: r.w * 0.4, y0: r.h * 0.68, x1: r.w * 0.6, y1: r.h * 0.78 };
    r.button(start.x0, start.y0, start.x1 - start.x0, start.y1 - start.y0, `START${left ? ` · ${left}` : ''}`);
    buttons.push({ ...start, action: { type: 'start', player: this.joined[0] ? 0 : 1, source: 'tap' } });
    this.input.layout = { lanes: [], buttons };
    r.text('Enter / Start to go now', r.w / 2, r.h * 0.82, 18, COLORS.dim, 'center', 600);
    r.legend(r.h * 0.9);
  }

  private pulse(t: number): number {
    const beat = 60 / SONG.bpm;
    const ph = ((t % beat) + beat) % beat;
    return Math.max(0, 1 - ph / 0.15);
  }

  private drawPlay(): void {
    const r = this.r;
    const t = this.judgeTime();
    const rt = this.renderTime();
    let best = 0;
    for (const seat of this.seats) {
      const missed = seat.view.scorer.sweep(t);
      for (const n of missed) seat.view.effects.push({ lane: n.lane, at: rt, judgement: 'miss', delta: 0 });
      if (missed.length) {
        this.audio.miss(this.seats.length === 2 ? (seat === this.seats[0] ? -0.5 : 0.5) : 0);
        this.audio.duck();
      }
      if (seat.view.effects.length > 60) seat.view.effects.splice(0, 30);
      best = Math.max(best, multiplier(seat.view.scorer.combo) - 1);
    }
    this.audio.setIntensity(best);
    const pulse = this.pulse(rt);
    r.background(this.now, pulse);
    const hws = r.highways(this.seats.length as 1 | 2);
    this.input.layout = { lanes: hws.map((h, i) => ({ player: this.seats[i].player, x0: h.x0, x1: h.x1, count: 4 })), buttons: [] };
    this.seats.forEach((seat, i) => {
      r.drawHighway(hws[i].x0, hws[i].x1, this.chart, this.match, seat.view, rt, pulse);
      r.hud(hws[i].x0, hws[i].x1, seat.view, i === 0 ? 'left' : 'right');
    });
    if (this.seats.length === 2) {
      const [a, b] = this.seats.map((s) => s.view.scorer.score);
      const target = (a - b) / Math.max(a, b, 1);
      this.lead += (target - this.lead) * 0.1;
      const leader = a === b ? 0 : a > b ? 1 : 2;
      if (leader && leader !== this.lastLeader) this.audio.blip(leader === 1 ? 520 : 780);
      this.lastLeader = leader || this.lastLeader;
      r.tugOfWar(this.lead, a, b);
    }
    let cap = null;
    for (const c of this.chart.captions) if (c.time <= rt) cap = c;
    r.ticker(this.match, this.chart, rt, cap?.text ?? null, cap?.team ?? 0, cap ? rt - cap.time : 99, scoreAt(this.chart, rt));
    r.countdown(rt);
    if (!this.audio.running) r.text('Sound is off — tap the screen or press a button for music', r.w / 2, r.h * 0.97, 16, COLORS.gold, 'center', 700);
    if (t > SONG.duration + 0.5) {
      this.audio.reset();
      const ranks = this.board.ranksFor(this.seats.map((s) => s.view.scorer.score));
      this.seats.forEach((s, i) => (s.rank = ranks[i]));
      this.finishAt = 0;
      this.go('results');
    }
  }

  private qrFor(url: string): boolean[][] {
    let m = this.qrCache.get(url);
    if (!m) {
      const q = qrcode(0, 'M');
      q.addData(url);
      q.make();
      const n = q.getModuleCount();
      m = Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => q.isDark(row, col)));
      if (this.qrCache.size >= QR_CACHE) this.qrCache.delete(this.qrCache.keys().next().value!);
      this.qrCache.set(url, m);
    }
    return m;
  }

  private drawResults(): void {
    const r = this.r;
    const e = this.elapsed();
    r.background(this.now, 0);
    const two = this.seats.length === 2;
    if (two) {
      const [a, b] = this.seats.map((s) => s.view.scorer.score);
      const title = a === b ? 'DRAW!' : `PLAYER ${(a > b ? this.seats[0] : this.seats[1]).player + 1} WINS`;
      r.text(title, r.w / 2, r.h * 0.08, 60, COLORS.gold, 'center', 900);
    } else {
      r.text('MATCH COMPLETE', r.w / 2, r.h * 0.08, 56, COLORS.white, 'center', 900);
    }
    const w = this.match.teams[this.chart.winner];
    r.text(`${this.match.title} · ${w.name} won the match`, r.w / 2, r.h * 0.15, 22, w.color, 'center', 700);
    const buttons: Zone[] = [];
    this.seats.forEach((seat, i) => {
      const cx = two ? r.w * (i === 0 ? 0.28 : 0.72) : r.w * 0.36;
      const s = seat.view.scorer;
      r.panel(cx - r.w * 0.2, r.h * 0.2, r.w * 0.4, r.h * 0.68);
      r.text(seat.view.name, cx, r.h * 0.25, 24, COLORS.dim, 'center', 700);
      // reveal step by step: score counts up, then the grade lands
      const count = Math.min(1, e / 1.2);
      if (e < 1.2 && Math.floor(e * 20) !== Math.floor((e - 1 / 60) * 20)) this.audio.blip(500 + count * 600);
      r.text(Math.round(s.score * count).toLocaleString('en-US'), cx, r.h * 0.43, 48, COLORS.white, 'center', 800);
      if (e > 1.4) {
        const k = Math.min(1, (e - 1.4) / 0.25);
        r.text(s.grade(), cx, r.h * 0.33, 90 * (1.6 - 0.6 * k), COLORS.gold, 'center', 900);
      }
      r.text(`${Math.round(s.accuracy() * 100)}% accuracy · max combo ${s.maxCombo}`, cx, r.h * 0.49, 19, COLORS.dim, 'center', 600);
      if (e > 1.6) r.text(matchLine(s, this.match), cx, r.h * 0.535, 17, COLORS.sky, 'center', 700);
      if (seat.rank > 0) {
        r.text(seat.saved ? `#${seat.rank} on today's board!` : `#${seat.rank} today — enter your initials`, cx, r.h * 0.6, 22, COLORS.gold, 'center', 800);
        for (let k = 0; k < 3; k++) {
          const x = cx + (k - 1) * r.u(70);
          const active = !seat.saved && k === seat.slot && Math.floor(this.now * 3) % 2 === 0;
          r.text(seat.initials[k], x, r.h * 0.68, 56, active ? COLORS.gold : COLORS.white, 'center', 900);
        }
        if (!seat.saved) {
          r.text(`${seat.view.keys[1]}/${seat.view.keys[2]} letter · ${seat.view.keys[3]} next · ${seat.view.keys[0]} back`, cx, r.h * 0.745, 16, COLORS.dim, 'center', 600);
          // touch buttons: back, letter down, letter up, next/OK
          const labels = ['◀', '▲', '▼', seat.slot < 2 ? '▶' : 'OK'];
          const bw = r.u(70);
          labels.forEach((label, k) => {
            const x0 = cx + (k - 2) * (bw + r.u(10)) + r.u(5);
            const y0 = r.h * 0.775;
            r.button(x0, y0, bw, r.u(52), label);
            const lane = [0, 1, 2, 3][k];
            buttons.push({ x0, y0, x1: x0 + bw, y1: y0 + r.u(52), action: { type: 'lane', player: seat.player, lane } });
          });
        }
      } else {
        r.text("Not on today's board — try again!", cx, r.h * 0.64, 20, COLORS.dim, 'center', 600);
      }
      // scorecard QR: big on the right for one player, in the corner of each card for two
      const url = shareUrl(this.settings.shareBase, {
        n: seat.saved ? seat.initials.join('') : '',
        s: s.score, g: s.grade(), a: Math.round(s.accuracy() * 100), c: s.maxCombo, m: this.match.title, d: dayKey().slice(-10),
        x: matchLine(s, this.match),
      });
      if (two) {
        const size = r.h * 0.12;
        r.qr(this.qrFor(url), cx + r.w * 0.2 - size - r.u(12), r.h * 0.21 + r.u(12), size);
      } else {
        const size = r.h * 0.36;
        const qx = r.w * 0.62;
        r.text('Scan for your scorecard', qx + size / 2, r.h * 0.25, 20, COLORS.dim, 'center', 700);
        r.qr(this.qrFor(url), qx, r.h * 0.29, size);
      }
    });
    this.input.layout = { lanes: [], buttons };
    r.text(e < RESULTS_LOCK ? '' : 'Enter / Start to continue', r.w / 2, r.h * 0.95, 16, COLORS.dim, 'center', 600);
  }

  private drawBoard(y0: number): void {
    const r = this.r;
    r.text("TODAY'S TOP 10", r.w / 2, y0, 56, COLORS.white, 'center', 900);
    const list = this.board.list();
    if (!list.length) r.text('No scores yet — be the first!', r.w / 2, y0 + r.h * 0.2, 30, COLORS.dim);
    list.forEach((e, i) => {
      const y = y0 + r.h * 0.09 + i * r.h * 0.065;
      const col = i === 0 ? COLORS.gold : COLORS.white;
      r.text(`${i + 1}.`, r.w * 0.3, y, 30, col, 'right', 800);
      r.text(e.initials, r.w * 0.33, y, 30, col, 'left', 800);
      r.text(e.grade, r.w * 0.47, y, 30, COLORS.sky, 'center', 900);
      r.text(e.score.toLocaleString('en-US'), r.w * 0.68, y, 30, col, 'right', 800);
    });
  }
}
