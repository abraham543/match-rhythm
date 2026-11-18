// Daily leaderboard for a booth, kept in localStorage (works offline).
export interface Entry {
  initials: string;
  score: number;
  grade: string;
  match: string;
  at: number;
}

export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const PREFIX = 'match-rhythm:board:';
export const SIZE = 10;

export function dayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${PREFIX}${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// three-letter words a public booth screen should not show
const BLOCKED = new Set(['ASS', 'FUK', 'FUC', 'FCK', 'SEX', 'CUM', 'DIK', 'DIC', 'KKK', 'NIG', 'FAG', 'TIT', 'XXX', 'WTF', 'GAY', 'NAZ', 'SS1']);

export function cleanInitials(s: string): string {
  const v = s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3).padEnd(3, '-');
  return BLOCKED.has(v) ? 'C9!' : v;
}

export class Leaderboard {
  /** `fixedKey` is for tests; normally the key follows the calendar, so a kiosk left running rolls over at midnight. */
  constructor(private readonly store: Store, private readonly fixedKey?: string) {}

  private get key(): string {
    return this.fixedKey ?? dayKey();
  }

  list(): Entry[] {
    try {
      const raw = JSON.parse(this.store.getItem(this.key) ?? '[]');
      return Array.isArray(raw) ? raw.filter((e) => typeof e?.score === 'number').slice(0, SIZE) : [];
    } catch {
      return [];
    }
  }

  /** Rank (1-based) a score would get today, or 0 if it does not make the board. */
  rankFor(score: number): number {
    const l = this.list();
    const pos = l.findIndex((e) => score > e.score);
    if (pos >= 0) return pos + 1;
    return l.length < SIZE && score > 0 ? l.length + 1 : 0;
  }

  /** Ranks for several scores at once (two players): they compete with each other for the last places. */
  ranksFor(scores: number[]): number[] {
    const board = this.list().map((e) => ({ score: e.score, who: -1 }));
    const all = [...board, ...scores.map((score, who) => ({ score, who }))].filter((x) => x.score > 0);
    all.sort((a, b) => b.score - a.score || a.who - b.who);
    return scores.map((_, who) => {
      const pos = all.findIndex((x) => x.who === who);
      return pos >= 0 && pos < SIZE ? pos + 1 : 0;
    });
  }

  add(e: Entry): number {
    const l = this.list();
    const entry = { ...e, initials: cleanInitials(e.initials) };
    l.push(entry);
    l.sort((a, b) => b.score - a.score || a.at - b.at);
    const top = l.slice(0, SIZE);
    this.store.setItem(this.key, JSON.stringify(top));
    return top.indexOf(entry) + 1;
  }

  reset(): void {
    this.store.removeItem(this.key);
  }
}
