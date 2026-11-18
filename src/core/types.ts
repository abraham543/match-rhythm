// Shared data model. A match timeline is game-agnostic: any esports title can be described as a list of
// timed events (eliminations, objectives, round wins, momentum swings) between two teams.

export type EventKind = 'elim' | 'objective' | 'round' | 'swing';

export interface TeamInfo {
  name: string;
  tag: string;
  color: string;
}

export interface MatchEvent {
  /** Seconds since the start of the match. */
  t: number;
  kind: EventKind;
  team: 0 | 1;
  label: string;
}

export interface MatchTimeline {
  id: string;
  title: string;
  /** Free text, e.g. "Tactical shooter, map 3". */
  game: string;
  teams: [TeamInfo, TeamInfo];
  /** Length of the match in seconds. */
  duration: number;
  events: MatchEvent[];
  /** True for the bundled demo matches, which are generated rather than recorded. */
  synthetic?: boolean;
  /** Where the data came from, shown on screen. */
  source: string;
}

export type Difficulty = 'casual' | 'standard' | 'pro';

export interface Note {
  /** Song time in seconds when the note must be hit. */
  time: number;
  lane: number;
  kind: EventKind;
  team: 0 | 1;
  label: string;
  /** MIDI pitch played when the note is hit. */
  pitch: number;
  /** The moment of the real match this note stands for (seconds). */
  matchT: number;
  /** A momentum swing that shares its slot with a round result. */
  accent?: boolean;
  /** The last note of the song: the decisive moment of the match. */
  final?: boolean;
}

export interface Caption {
  time: number;
  text: string;
  team: 0 | 1;
  /** Rounds won by each team after this moment, when the game counts rounds. */
  score?: [number, number];
}

export interface Chart {
  matchId: string;
  bpm: number;
  /** Song length in seconds. */
  duration: number;
  notes: Note[];
  captions: Caption[];
  /** The slice of the real match that the song covers, in match seconds. */
  window: [number, number];
  /** Team that wins the match at the end of the song. */
  winner: 0 | 1;
}

export type Judgement = 'perfect' | 'great' | 'good' | 'miss';
