// Demo matches. They are generated (seeded, so always the same) and clearly marked as synthetic:
// the booth can run without any data feed. Real matches can be loaded as JSON in the staff panel.
import type { MatchEvent, MatchTimeline, TeamInfo } from '../core/types';
import { pick, rng } from '../core/random';

const SKY: TeamInfo = { name: 'Sky Hawks', tag: 'SKY', color: '#4fb3ff' };
const TIDE: TeamInfo = { name: 'Iron Tide', tag: 'TIDE', color: '#ff6b6b' };
const NOVA: TeamInfo = { name: 'Nova Unit', tag: 'NOVA', color: '#b98cff' };

/** A round-based tactical shooter: 5v5, first to 13 rounds. */
export function tacticalMatch(seed: number, a: TeamInfo, b: TeamInfo, id: string, title: string): MatchTimeline {
  const r = rng(seed);
  const events: MatchEvent[] = [];
  const score = [0, 0];
  let t = 0;
  let round = 0;
  let lastWinner = -1;
  let streak = 0;
  while (score[0] < 13 && score[1] < 13 && round < 30) {
    round += 1;
    t += 25 + r() * 10; // buy phase
    const alive = [5, 5];
    const strength = 0.5 + (score[1] - score[0]) * 0.02 + (r() - 0.5) * 0.3; // comeback pull
    const roundLen = 55 + r() * 45;
    const roundStart = t;
    let planted = false;
    let winner: 0 | 1 = r() < strength ? 0 : 1;
    // eliminations come in bursts (fights), not evenly spread
    const fights = 2 + Math.floor(r() * 3);
    let cursor = roundStart + 8 + r() * 10;
    for (let f = 0; f < fights && alive[0] > 0 && alive[1] > 0; f++) {
      const kills = 1 + Math.floor(r() * 3);
      for (let k = 0; k < kills && alive[0] > 0 && alive[1] > 0; k++) {
        const killer: 0 | 1 = r() < (winner === 0 ? 0.62 : 0.38) ? 0 : 1;
        alive[1 - killer] -= 1;
        cursor += 0.4 + r() * 1.6;
        const team = killer === 0 ? a : b;
        events.push({ t: cursor, kind: 'elim', team: killer, label: `${team.tag} takes a duel (${alive[0]}v${alive[1]})` });
      }
      if (!planted && r() < 0.55) {
        planted = true;
        cursor += 2 + r() * 4;
        const attacker: 0 | 1 = round <= 12 ? 0 : 1;
        events.push({ t: cursor, kind: 'objective', team: attacker, label: `Round ${round}: ${(attacker === 0 ? a : b).tag} plants` });
      }
      cursor += 6 + r() * 12;
    }
    if (alive[0] === 0) winner = 1;
    if (alive[1] === 0) winner = 0;
    const end = Math.max(cursor + 1, roundStart + roundLen);
    const clutch = alive[winner] === 1 && alive[1 - winner] >= 1;
    score[winner] += 1;
    const w = winner === 0 ? a : b;
    streak = winner === lastWinner ? streak + 1 : 1;
    const swing = streak === 1 && lastWinner !== -1 && Math.abs(score[0] - score[1]) <= 2 && r() < 0.5;
    lastWinner = winner;
    if (clutch || swing) {
      events.push({ t: end - 0.6, kind: 'swing', team: winner, label: clutch ? `${w.tag} clutch!` : `${w.tag} breaks the streak` });
    }
    events.push({ t: end, kind: 'round', team: winner, label: `Round ${round} to ${w.tag} — ${score[0]}:${score[1]}` });
    t = end;
  }
  return {
    id, title, game: 'Tactical shooter (5v5, first to 13)', teams: [a, b], duration: t + 5,
    events: events.sort((x, y) => x.t - y.t), synthetic: true, source: 'Demo data (generated)',
  };
}

/** A lane-based team arena game: towers, epic monsters, teamfights. */
export function arenaMatch(seed: number, a: TeamInfo, b: TeamInfo, id: string, title: string): MatchTimeline {
  const r = rng(seed);
  const events: MatchEvent[] = [];
  const duration = 1900 + r() * 500;
  const towers = [0, 0];
  let t = 90 + r() * 60;
  while (t < duration - 30) {
    const lead = (towers[0] - towers[1]) * 0.04;
    const side: 0 | 1 = r() < 0.5 + lead ? 0 : 1;
    const roll = r();
    if (roll < 0.45) {
      // teamfight: a burst of eliminations, sometimes followed by an objective
      const n = 2 + Math.floor(r() * 5);
      let c = t;
      for (let i = 0; i < n; i++) {
        c += 0.5 + r() * 2.2;
        const killer: 0 | 1 = r() < 0.7 ? side : (1 - side) as 0 | 1;
        events.push({ t: c, kind: 'elim', team: killer, label: `${(killer === 0 ? a : b).tag} wins a fight` });
      }
      if (n >= 4) events.push({ t: c + 1, kind: 'swing', team: side, label: `${(side === 0 ? a : b).tag} ${pick(r, ['ace', 'teamfight win', 'big pick'])}` });
      if (r() < 0.5) {
        c += 10 + r() * 15;
        events.push({ t: c, kind: 'objective', team: side, label: `${(side === 0 ? a : b).tag} ${pick(r, ['takes the dragon', 'secures the herald', 'claims the titan'])}` });
      }
      t = c + 12 + r() * 30;
    } else if (roll < 0.8 && towers[side] < 11) {
      towers[side] += 1;
      events.push({ t, kind: 'objective', team: side, label: `${(side === 0 ? a : b).tag} destroys a tower (${towers[side]})` });
      t += 8 + r() * 25;
    } else {
      events.push({ t, kind: 'elim', team: side, label: `${(side === 0 ? a : b).tag} catches a roamer` });
      t += 6 + r() * 20;
    }
  }
  const winner: 0 | 1 = towers[0] >= towers[1] ? 0 : 1;
  events.push({ t: duration - 4, kind: 'swing', team: winner, label: `${(winner === 0 ? a : b).tag} pushes for the win` });
  events.push({ t: duration, kind: 'round', team: winner, label: `${(winner === 0 ? a : b).name} wins the game` });
  return {
    id, title, game: 'Team arena (lanes, towers, epic monsters)', teams: [a, b], duration: duration + 5,
    events: events.sort((x, y) => x.t - y.t), synthetic: true, source: 'Demo data (generated)',
  };
}

export const SAMPLE_MATCHES: MatchTimeline[] = [
  tacticalMatch(20261118, SKY, TIDE, 'grand-final-map-3', 'Grand Final · Map 3'),
  arenaMatch(77, SKY, NOVA, 'arena-semifinal', 'Arena Semifinal · Game 5'),
  tacticalMatch(9001, NOVA, SKY, 'overtime-thriller', 'Upper Bracket · Map 2'),
];
