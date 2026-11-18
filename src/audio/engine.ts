// Procedural soundtrack (no audio files, nothing to license): drums, bass and pads follow the song grid,
// and every hit note plays its pitch, so the players perform the melody of the match.
import { chordAt, SONG } from '../core/chart';

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Sound events of one game, recorded in film mode and rendered offline for the demo video. */
export type AudioEvent =
  | { t: number; type: 'hit'; midi: number; quality: number; pan: number; chord: boolean }
  | { t: number; type: 'miss'; pan: number }
  | { t: number; type: 'stinger'; win: boolean }
  | { t: number; type: 'duck' }
  | { t: number; type: 'intensity'; level: number };

/** An event as the engine reports it; the caller adds the song time. */
export type AudioEventInput = AudioEvent extends infer E ? (E extends AudioEvent ? Omit<E, 't'> : never) : never;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private tone!: BiquadFilterNode;
  private intensity = 0;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private startAt = 0;
  private nextStep = 0;
  private timer: number | null = null;
  private playing = false;
  private started = false;
  volume = 0.8;
  /** Film mode: no live audio; game sounds are recorded with their song time instead. */
  disabled = false;
  recorder: ((e: AudioEventInput) => void) | null = null;

  /** Must be called from a user gesture (key press / tap) the first time. */
  unlock(): void {
    if (this.disabled) return;
    if (!this.ctx) {
      this.initNodes(new AudioContext({ latencyHint: 'interactive' }));
    }
    if (this.ctx!.state === 'suspended') void this.ctx!.resume();
  }

  private initNodes(ctx: AudioContext): void {
    {
      this.ctx = ctx;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      this.master.connect(comp).connect(this.ctx.destination);
      this.music = this.ctx.createGain();
      this.music.gain.value = 0.55;
      this.tone = this.ctx.createBiquadFilter();
      this.tone.type = 'lowpass';
      this.tone.frequency.value = 18000;
      this.music.connect(this.tone).connect(this.master);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.9;
      this.sfx.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
  }

  /** Renders a whole game offline: the soundtrack plus the recorded hits, `pre` seconds of silence first. */
  async renderOffline(seconds: number, pre: number, events: AudioEvent[]): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * 48000), 48000);
    this.initNodes(ctx as unknown as AudioContext);
    this.started = true;
    const sixteenth = 60 / SONG.bpm / 4;
    const levels = events.filter((e) => e.type === 'intensity') as Extract<AudioEvent, { type: 'intensity' }>[];
    for (let step = 0; step * sixteenth < SONG.duration; step++) {
      const songT = step * sixteenth;
      let level = 0;
      for (const l of levels) if (l.t <= songT) level = l.level;
      this.intensity = level;
      this.step(step, pre + songT, songT);
    }
    const rec = this.recorder;
    this.recorder = null;
    for (const e of events) {
      const at = pre + Math.max(0, e.t);
      if (e.type === 'hit') this.hit(e.midi, e.quality, e.pan, e.chord, at);
      else if (e.type === 'miss') this.miss(e.pan, at);
      else if (e.type === 'stinger') this.stinger(e.win, at);
      else if (e.type === 'duck') this.duck(at);
    }
    this.recorder = rec;
    return ctx.startRendering();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Output latency the player hears, used to line up judgment with sound. */
  get latency(): number {
    if (!this.ctx) return 0;
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }

  /** True when sound actually plays (a booth driven only by a gamepad may never unlock audio). */
  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && this.started;
  }

  /** Song clock in seconds (negative before the start). */
  get songTime(): number {
    if (!this.ctx || !this.started) return -1;
    return this.ctx.currentTime - this.startAt;
  }

  start(delay = 0.15): void {
    if (!this.ctx) return;
    this.stop();
    this.playing = true;
    this.started = true;
    this.startAt = this.ctx.currentTime + delay;
    this.nextStep = 0;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** Stops scheduling new sounds; the song clock keeps running until reset(). */
  stop(): void {
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** Stops the music and the song clock. */
  reset(): void {
    this.stop();
    this.started = false;
  }

  private schedule(): void {
    if (!this.ctx || !this.playing) return;
    const sixteenth = 60 / SONG.bpm / 4;
    const horizon = this.ctx.currentTime + 0.12;
    while (this.startAt + this.nextStep * sixteenth < horizon) {
      const step = this.nextStep;
      const t = this.startAt + step * sixteenth;
      const songT = step * sixteenth;
      if (songT >= SONG.duration) {
        this.stop();
        return;
      }
      this.step(step, t, songT);
      this.nextStep++;
    }
  }

  /** 0..3, follows the combo multiplier: the band gets busier as the player gets better. */
  setIntensity(level: number): void {
    const v = Math.max(0, Math.min(3, level));
    if (this.recorder && v !== this.intensity) this.recorder({ type: 'intensity', level: v });
    this.intensity = v;
  }

  /** A miss muffles the music for a moment. */
  duck(at?: number): void {
    this.recorder?.({ type: 'duck' });
    if (!this.ctx) return;
    const f = this.tone.frequency;
    const now = at ?? this.ctx.currentTime;
    f.cancelScheduledValues(now);
    f.setValueAtTime(550, now);
    f.exponentialRampToValueAtTime(18000, now + 0.7);
  }

  private step(step: number, at: number, songT: number): void {
    const inBar = step % 16;
    const fadeOut = songT > SONG.duration - SONG.outro;
    const intro = songT < SONG.leadIn;
    const chord = chordAt(songT);
    // four on the floor after the count-in
    if (inBar % 4 === 0) {
      if (intro) this.click(at, inBar === 0 ? 1600 : 1100);
      else if (!fadeOut || inBar === 0) this.kick(at);
    }
    if (intro) return;
    if (inBar === 4 || inBar === 12) this.snare(at);
    if (inBar % 2 === 1) this.hat(at, inBar % 4 === 3 ? 0.18 : 0.1);
    else if (this.intensity >= 2 && !fadeOut) this.hat(at, 0.05);
    if (this.intensity >= 3 && !fadeOut && inBar % 2 === 0) this.arp(at, chord[(inBar / 2) % chord.length] + 24);
    // bass: root on the off-beats, octave jump at the end of the bar
    if ([2, 6, 10, 14].includes(inBar)) this.bass(at, chord[0] - 24 + (inBar === 14 ? 12 : 0));
    if (inBar === 0) this.pad(at, chord, (60 / SONG.bpm) * 4);
  }

  private env(at: number, attack: number, decay: number, peak: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    return g;
  }

  private kick(at: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, at);
    o.frequency.exponentialRampToValueAtTime(42, at + 0.12);
    const g = this.env(at, 0.002, 0.28, 0.9);
    o.connect(g).connect(this.music);
    o.start(at);
    o.stop(at + 0.32);
  }

  private noiseHit(at: number, freq: number, q: number, decay: number, peak: number, type: BiquadFilterType, out: AudioNode = this.music): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.env(at, 0.001, decay, peak);
    src.connect(f).connect(g).connect(out);
    src.start(at, Math.random() * 0.5);
    src.stop(at + decay + 0.05);
  }

  private snare(at: number): void {
    this.noiseHit(at, 1800, 0.8, 0.16, 0.45, 'bandpass');
    const o = this.ctx!.createOscillator();
    o.frequency.setValueAtTime(220, at);
    o.frequency.exponentialRampToValueAtTime(140, at + 0.08);
    const g = this.env(at, 0.001, 0.1, 0.25);
    o.connect(g).connect(this.music);
    o.start(at);
    o.stop(at + 0.12);
  }

  private hat(at: number, peak: number): void {
    this.noiseHit(at, 8000, 0.7, 0.045, peak, 'highpass');
  }

  private click(at: number, freq: number): void {
    const o = this.ctx!.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = this.env(at, 0.001, 0.05, 0.15);
    o.connect(g).connect(this.music);
    o.start(at);
    o.stop(at + 0.08);
  }

  private arp(at: number, midi: number): void {
    const o = this.ctx!.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midiHz(midi);
    const g = this.env(at, 0.003, 0.12, 0.05);
    o.connect(g).connect(this.music);
    o.start(at);
    o.stop(at + 0.18);
  }

  private bass(at: number, midi: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midiHz(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, at);
    f.frequency.exponentialRampToValueAtTime(180, at + 0.2);
    const g = this.env(at, 0.004, 0.24, 0.35);
    o.connect(f).connect(g).connect(this.music);
    o.start(at);
    o.stop(at + 0.3);
  }

  private pad(at: number, chord: number[], len: number): void {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.06, at + 0.3);
    g.gain.setValueAtTime(0.06, at + len - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.2);
    f.connect(g).connect(this.music);
    for (const m of chord.slice(0, 3)) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(m);
        o.detune.value = det;
        o.connect(f);
        o.start(at);
        o.stop(at + len + 0.3);
      }
    }
  }

  /** The note a player just hit: a bright pluck at the note's pitch. */
  hit(midi: number, quality: number, pan = 0, chord = false, when?: number): void {
    this.recorder?.({ type: 'hit', midi, quality, pan, chord });
    if (!this.ctx) return;
    if (chord) {
      const rec = this.recorder;
      this.recorder = null;
      this.hit(midi - 12, quality, pan, false, when);
      this.hit(midi + 7, quality * 0.6, pan, false, when);
      this.recorder = rec;
    }
    const ctx = this.ctx;
    const at = when ?? ctx.currentTime;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.sfx);
    for (const [type, mult, peak] of [['triangle', 1, 0.32], ['square', 2, 0.06]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = midiHz(midi) * mult;
      const g = this.env(at, 0.003, 0.25 + quality * 0.2, peak);
      o.connect(g).connect(p);
      o.start(at);
      o.stop(at + 0.5);
    }
  }

  /** Final chord when the last note of the match is hit. */
  stinger(win: boolean, when?: number): void {
    this.recorder?.({ type: 'stinger', win });
    if (!this.ctx) return;
    const at = when ?? this.ctx.currentTime;
    const notes = win ? [57, 64, 69, 72, 76] : [57, 60, 64];
    for (const m of notes) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiHz(m);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(400, at);
      f.frequency.exponentialRampToValueAtTime(3000, at + 0.4);
      const g = this.env(at, 0.02, 1.6, 0.07);
      o.connect(f).connect(g).connect(this.sfx);
      o.start(at);
      o.stop(at + 1.8);
    }
  }

  miss(pan = 0, when?: number): void {
    this.recorder?.({ type: 'miss', pan });
    if (!this.ctx) return;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.sfx);
    this.noiseHit(when ?? this.ctx.currentTime, 300, 1.2, 0.09, 0.2, 'lowpass', p);
  }

  /** Short UI blip for menus. */
  blip(freq = 880): void {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = this.env(this.ctx.currentTime, 0.002, 0.08, 0.2);
    o.connect(g).connect(this.sfx);
    o.start();
    o.stop(this.ctx.currentTime + 0.12);
  }
}
