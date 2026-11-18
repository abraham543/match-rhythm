// Loads a match timeline from JSON (staff panel: "Load match file").
// Accepts the native format (see README) or a simple event list exported from a data feed:
//   { "title", "teams": [{name, tag, color}, ...], "events": [{ "t": seconds, "kind": "elim|objective|round|swing", "team": 0|1, "label" }] }
import type { EventKind, MatchEvent, MatchTimeline, TeamInfo } from '../core/types';

const KINDS: EventKind[] = ['elim', 'objective', 'round', 'swing'];
const DEFAULT_COLORS = ['#4fb3ff', '#ff6b6b'];

export class ImportError extends Error {}

function team(raw: unknown, i: number): TeamInfo {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 32) : `Team ${i + 1}`;
  const tag = typeof o.tag === 'string' && o.tag.trim() ? o.tag.trim().slice(0, 6).toUpperCase() : name.slice(0, 4).toUpperCase();
  const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : DEFAULT_COLORS[i];
  return { name, tag, color };
}

export function parseTimeline(text: string, fallbackId = 'imported'): MatchTimeline {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('The file is not valid JSON.');
  }
  const o = (data ?? {}) as Record<string, unknown>;
  if (!Array.isArray(o.events)) throw new ImportError('The file has no "events" list.');
  const teamsRaw = Array.isArray(o.teams) ? o.teams : [];
  const teams: [TeamInfo, TeamInfo] = [team(teamsRaw[0], 0), team(teamsRaw[1], 1)];
  const events: MatchEvent[] = [];
  for (const raw of o.events as unknown[]) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const t = Number(e.t);
    const kind = String(e.kind) as EventKind;
    const side = Number(e.team);
    if (!Number.isFinite(t) || t < 0 || !KINDS.includes(kind) || (side !== 0 && side !== 1)) continue;
    const label = typeof e.label === 'string' ? e.label.slice(0, 80) : `${teams[side].tag} ${kind}`;
    events.push({ t, kind, team: side as 0 | 1, label });
  }
  if (events.length < 20) throw new ImportError(`Only ${events.length} usable events; at least 20 are needed for a song.`);
  events.sort((a, b) => a.t - b.t);
  const duration = Math.max(Number(o.duration) || 0, events[events.length - 1].t + 1);
  return {
    id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : fallbackId,
    title: typeof o.title === 'string' && o.title ? o.title.slice(0, 60) : 'Imported match',
    game: typeof o.game === 'string' ? o.game.slice(0, 60) : 'Imported match',
    teams,
    duration,
    events,
    synthetic: o.synthetic === true,
    source: typeof o.source === 'string' && o.source ? o.source.slice(0, 60) : 'Imported file',
  };
}
