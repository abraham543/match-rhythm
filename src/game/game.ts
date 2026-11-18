// Booth flow: ATTRACT -> JOIN -> PLAY (60 s song with count-in) -> RESULTS (initials, QR) -> BOARD -> ATTRACT.
import qrcode from 'qrcode-generator';
import { buildChart, SONG } from '../core/chart';
import { Leaderboard } from '../core/leaderboard';
import { Scorer } from '../core/score';
import type { Chart, Difficulty, MatchTimeline } from '../core/types';
import { AudioEngine } from '../audio/engine';
import type { Action, Input } from './input';
import { COLORS, type PlayerView, Renderer } from './render';
import { shareUrl } from './share';

type Screen = 'attract' | 'join' | 'play' | 'results' | 'board';

export interface Settings {
  difficulty: Difficulty;
  /** Match id, or 'rotate' to cycle through all matches. */
  match: string;
  volume: number;
  /** Extra input offset in milliseconds (positive = player hits late). */
  offsetMs: number;
  shareBase: string;
  allowTwoPlayers: boolean;
}

const KEYS: [string[], string[]] = [['A', 'S', 'D', 'F'], ['J', 'K', 'L', ';']];
const JOIN_WAIT = 6; // seconds a second player has to join
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

interface Seat {
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
  private qrCache = new Map<string, boolean[][]>();

  constructor(
    private r: Renderer,
    private input: Input,
    private audio: AudioEngine,
    private board: Leaderboard,
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
    this.newDemo(0);
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

  private nextMatch(): MatchTimeline {
    if (this.settings.match !== 'rotate') {
      const m = this.matches.find((x) => x.id === this.settings.match);
      if (m) return m;
    }
    const m = this.matches[this.rotation % this.matches.length];
    this.rotation++;
    return m;
  }

  private newDemo(at: number): void {
    const match = this.matches[(this.rotation + 1) % this.matches.length];
    const chart = buildChart(match, 'standard');
    this.demo = { chart, match, start: at, view: { scorer: new Scorer(chart), effects: [], keys: [], name: 'DEMO' } };
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
      case 'join':
        if (a.type === 'start' && this.joined[a.player]) {
          this.startPlay();
        } else if (!this.joined[a.player] && this.settings.allowTwoPlayers) {
          this.joined[a.player] = true;
          this.audio.blip(990);
          this.since = this.now - JOIN_WAIT + 2.5; // short wait once both are in
        }
        break;
      case 'play':
        if (a.type === 'lane') this.press(a.player, a.lane);
        break;
      case 'results':
        if (a.type === 'lane') this.editInitials(a.player, a.lane);
        else if (a.type === 'start') this.finishResults();
        break;
    }
  }

  private seatFor(player: 0 | 1): Seat | undefined {
    const ids = this.joined.map((j, i) => (j ? i : -1)).filter((i) => i >= 0);
    const idx = ids.indexOf(player);
    return idx >= 0 ? this.seats[idx] : undefined;
  }

  private startPlay(): void {
    this.match = this.nextMatch();
    this.chart = buildChart(this.match, this.settings.difficulty);
    const players = this.joined[0] && this.joined[1] ? [0, 1] : [this.joined[1] ? 1 : 0];
    this.seats = players.map((p) => ({
      view: { scorer: new Scorer(this.chart), effects: [], keys: KEYS[p], name: `PLAYER ${p + 1}` },
      initials: ['A', 'A', 'A'],
      slot: 0,
      saved: false,
      rank: 0,
    }));
    this.audio.setVolume(this.settings.volume);
    this.audio.start(0.2);
    this.go('play');
  }

  private songTime(): number {
    return this.audio.songTime - this.audio.latency - this.settings.offsetMs / 1000;
  }

  private press(player: 0 | 1, lane: number): void {
    const seat = this.seatFor(player);
    if (!seat) return;
    const t = this.songTime();
    const res = seat.view.scorer.press(lane, t);
    const pan = this.seats.length === 2 ? (seat === this.seats[0] ? -0.5 : 0.5) : 0;
    if (res) {
      seat.view.effects.push({ lane, at: t, judgement: res.judgement });
      this.audio.hit(res.note.pitch, res.judgement === 'perfect' ? 1 : 0.5, pan);
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
    this.since = Math.max(this.since, this.now - 20); // typing keeps the screen alive
  }

  private save(seat: Seat): void {
    if (seat.saved) return;
    seat.saved = true;
    const s = seat.view.scorer;
    seat.rank = this.board.add({ initials: seat.initials.join(''), score: s.score, grade: s.grade(), match: this.match.title, at: Date.now() });
  }

  private finishResults(): void {
    for (const seat of this.seats) if (seat.rank > 0 && !seat.saved) this.save(seat);
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
        if (this.elapsed() > 30) this.finishResults();
        break;
      case 'board':
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
        d.view.effects.push({ lane: n.lane, at: n.time, judgement: 'perfect' });
      }
    }
    if (d.view.effects.length > 40) d.view.effects.splice(0, 20);
    const pulse = this.pulse(t);
    r.background(this.now, pulse);
    const [hw] = r.highways(1);
    this.input.layout = { lanes: [] };
    r.ctx.globalAlpha = 0.45;
    r.drawHighway(hw.x0, hw.x1, d.chart, d.match, d.view, t, pulse);
    r.ctx.globalAlpha = 1;
    r.panel(r.w * 0.18, r.h * 0.3, r.w * 0.64, r.h * 0.36, 0.8);
    r.text('MATCH RHYTHM', r.w / 2, r.h * 0.38, 76, COLORS.white, 'center', 900);
    r.text('Play the match. Every note is a real moment of the game.', r.w / 2, r.h * 0.47, 26, COLORS.dim, 'center', 600);
    const blink = Math.floor(this.now * 2) % 2 === 0;
    r.text(blink ? 'PRESS ANY BUTTON  ·  60 SECONDS  ·  1 OR 2 PLAYERS' : '', r.w / 2, r.h * 0.57, 28, COLORS.sky, 'center', 800);
    const top = this.board.list()[0];
    if (top) r.text(`Today's best: ${top.initials}  ${top.score.toLocaleString('en-US')}`, r.w / 2, r.h * 0.74, 22, COLORS.gold, 'center', 700);
    r.text('P1: A S D F     P2: J K L ;     or gamepad / tap the lanes', r.w / 2, r.h * 0.93, 18, COLORS.dim, 'center', 600);
  }

  private drawJoin(): void {
    const r = this.r;
    r.background(this.now, 0);
    const left = Math.max(0, Math.ceil(JOIN_WAIT - this.elapsed()));
    r.text('GET READY', r.w / 2, r.h * 0.2, 64, COLORS.white, 'center', 900);
    const m = this.settings.match === 'rotate' ? this.matches[this.rotation % this.matches.length] : this.matches.find((x) => x.id === this.settings.match) ?? this.matches[0];
    r.text(`${m.teams[0].name} vs ${m.teams[1].name} — ${m.title}`, r.w / 2, r.h * 0.29, 26, COLORS.dim, 'center', 600);
    for (const p of [0, 1] as const) {
      const x = r.w * (p === 0 ? 0.3 : 0.7);
      r.panel(x - r.w * 0.16, r.h * 0.38, r.w * 0.32, r.h * 0.3);
      r.text(`PLAYER ${p + 1}`, x, r.h * 0.45, 34, this.joined[p] ? COLORS.sky : COLORS.dim, 'center', 800);
      const msg = this.joined[p] ? 'READY' : this.settings.allowTwoPlayers ? `press ${KEYS[p].join(' ')} to join` : '—';
      r.text(msg, x, r.h * 0.53, 26, this.joined[p] ? COLORS.white : COLORS.dim, 'center', 700);
      r.text(`lanes: ${KEYS[p].join('  ')}`, x, r.h * 0.61, 18, COLORS.dim, 'center', 600);
    }
    r.text(`Starting in ${left}…  (Enter / Start to go now)`, r.w / 2, r.h * 0.78, 24, COLORS.gold, 'center', 700);
    r.text('Hit the notes when they cross the line. Diamonds = eliminations, hexagons = objectives, bars = rounds, rings = momentum swings.', r.w / 2, r.h * 0.88, 17, COLORS.dim, 'center', 600);
  }

  private pulse(t: number): number {
    const beat = 60 / SONG.bpm;
    const ph = ((t % beat) + beat) % beat;
    return Math.max(0, 1 - ph / 0.15);
  }

  private drawPlay(): void {
    const r = this.r;
    const t = this.songTime();
    for (const seat of this.seats) {
      const missed = seat.view.scorer.sweep(t);
      for (const n of missed) seat.view.effects.push({ lane: n.lane, at: t, judgement: 'miss' });
      if (seat.view.effects.length > 60) seat.view.effects.splice(0, 30);
    }
    const pulse = this.pulse(t);
    r.background(this.now, pulse);
    const hws = r.highways(this.seats.length as 1 | 2);
    const ids = this.joined.map((j, i) => (j ? i : -1)).filter((i) => i >= 0) as (0 | 1)[];
    this.input.layout = { lanes: hws.map((h, i) => ({ player: ids[i], x0: h.x0, x1: h.x1, count: 4 })) };
    this.seats.forEach((seat, i) => {
      r.drawHighway(hws[i].x0, hws[i].x1, this.chart, this.match, seat.view, t, pulse);
      r.hud(hws[i].x0, hws[i].x1, seat.view, i === 0 ? 'left' : 'right');
    });
    let cap = null;
    for (const c of this.chart.captions) if (c.time <= t) cap = c;
    r.ticker(this.match, this.chart, t, cap?.text ?? null, cap?.team ?? 0, cap ? t - cap.time : 99);
    r.countdown(t);
    if (t > SONG.duration + 0.5) {
      this.audio.reset();
      for (const seat of this.seats) seat.rank = this.board.rankFor(seat.view.scorer.score);
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
      this.qrCache.clear();
      this.qrCache.set(url, m);
    }
    return m;
  }

  private drawResults(): void {
    const r = this.r;
    r.background(this.now, 0);
    const two = this.seats.length === 2;
    if (two) {
      const [a, b] = this.seats.map((s) => s.view.scorer.score);
      const title = a === b ? 'DRAW!' : `PLAYER ${a > b ? 1 : 2} WINS`;
      r.text(title, r.w / 2, r.h * 0.1, 60, COLORS.gold, 'center', 900);
    } else {
      r.text('MATCH COMPLETE', r.w / 2, r.h * 0.1, 56, COLORS.white, 'center', 900);
    }
    r.text(`${this.match.title} · ${this.match.teams[0].tag} vs ${this.match.teams[1].tag}`, r.w / 2, r.h * 0.17, 22, COLORS.dim, 'center', 600);
    this.seats.forEach((seat, i) => {
      const cx = two ? r.w * (i === 0 ? 0.28 : 0.72) : r.w * 0.36;
      const s = seat.view.scorer;
      r.panel(cx - r.w * 0.2, r.h * 0.23, r.w * 0.4, r.h * 0.62);
      r.text(seat.view.name, cx, r.h * 0.28, 24, COLORS.dim, 'center', 700);
      r.text(s.grade(), cx, r.h * 0.37, 90, COLORS.gold, 'center', 900);
      r.text(s.score.toLocaleString('en-US'), cx, r.h * 0.47, 48, COLORS.white, 'center', 800);
      r.text(`${Math.round(s.accuracy() * 100)}% accuracy · max combo ${s.maxCombo}`, cx, r.h * 0.53, 19, COLORS.dim, 'center', 600);
      r.text(`perfect ${s.counts.perfect} · great ${s.counts.great} · good ${s.counts.good} · miss ${s.counts.miss}`, cx, r.h * 0.57, 16, COLORS.dim, 'center', 600);
      if (seat.rank > 0) {
        r.text(seat.saved ? `#${seat.rank} on today's board!` : `#${seat.rank} today — enter your initials`, cx, r.h * 0.64, 22, COLORS.sky, 'center', 800);
        const letters = seat.initials;
        for (let k = 0; k < 3; k++) {
          const x = cx + (k - 1) * r.u(70);
          const active = !seat.saved && k === seat.slot && Math.floor(this.now * 3) % 2 === 0;
          r.text(letters[k], x, r.h * 0.72, 56, active ? COLORS.gold : COLORS.white, 'center', 900);
        }
        if (!seat.saved) r.text(`${seat.view.keys[1]}/${seat.view.keys[2]} letter · ${seat.view.keys[3]} next · ${seat.view.keys[0]} back`, cx, r.h * 0.8, 16, COLORS.dim, 'center', 600);
      } else {
        r.text('Not on today\'s board — try again!', cx, r.h * 0.68, 20, COLORS.dim, 'center', 600);
      }
      // scorecard QR: big on the right for one player, in the corner of each card for two
      const url = shareUrl(this.settings.shareBase, {
        n: seat.saved ? seat.initials.join('') : '',
        s: s.score, g: s.grade(), a: Math.round(s.accuracy() * 100), c: s.maxCombo, m: this.match.title, d: new Date().toISOString().slice(0, 10),
      });
      if (two) {
        const size = r.h * 0.13;
        r.qr(this.qrFor(url), cx + r.w * 0.2 - size - r.u(14), r.h * 0.85 - size - r.u(14), size);
      } else {
        const size = r.h * 0.36;
        const qx = r.w * 0.62;
        r.text('Scan for your scorecard', qx + size / 2, r.h * 0.27, 20, COLORS.dim, 'center', 700);
        r.qr(this.qrFor(url), qx, r.h * 0.31, size);
      }
    });
    r.text('Enter / Start to continue', r.w / 2, r.h * 0.965, 16, COLORS.dim, 'center', 600);
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
