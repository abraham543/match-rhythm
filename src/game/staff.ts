// Hidden staff panel (` key, Ctrl+Shift+S, or a 3-second press in the top-left corner):
// match selection, difficulty, volume, display and input lag, leaderboard reset, loading a match file, fullscreen.
import type { Game } from './game';
import type { Input } from './input';
import { STAFF_CORNER } from './input';
import type { Leaderboard } from '../core/leaderboard';
import type { MatchTimeline } from '../core/types';
import { ImportError, parseTimeline } from '../data/importer';
import { esc } from './share';

const KEY = 'match-rhythm:settings';
const MATCHES_KEY = 'match-rhythm:matches';

export function loadSettings<T extends object>(defaults: T): T {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    // older builds had one "offsetMs" for both clocks: it was an input offset in practice
    if (typeof saved.offsetMs === 'number' && saved.inputOffsetMs === undefined) saved.inputOffsetMs = saved.offsetMs;
    delete saved.offsetMs;
    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
}

/** Matches loaded by staff survive a reload of the kiosk. */
export function loadImportedMatches(): MatchTimeline[] {
  try {
    const list = JSON.parse(localStorage.getItem(MATCHES_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((m) => m && Array.isArray(m.events) && m.teams) : [];
  } catch {
    return [];
  }
}

function saveImported(m: MatchTimeline): void {
  const list = loadImportedMatches().filter((x) => x.id !== m.id);
  list.unshift(m);
  try {
    localStorage.setItem(MATCHES_KEY, JSON.stringify(list.slice(0, 5)));
  } catch {
    /* storage full: the match still works until reload */
  }
}

export class StaffPanel {
  private readonly el: HTMLDivElement;
  open = false;

  constructor(private readonly game: Game, private readonly board: Leaderboard, private readonly input: Input, canvas: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'staff';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    let timer: number | null = null;
    const cancel = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.clientX < STAFF_CORNER && e.clientY < STAFF_CORNER) timer = window.setTimeout(() => this.toggle(), 3000);
    });
    canvas.addEventListener('pointerup', cancel);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('pointerleave', cancel);
  }

  toggle(): void {
    this.open = !this.open;
    this.el.hidden = !this.open;
    this.input.paused = this.open;
    document.body.classList.toggle('staff-open', this.open);
    if (this.open) this.render();
  }

  private save(): void {
    localStorage.setItem(KEY, JSON.stringify(this.game.settings));
  }

  private render(): void {
    const s = this.game.settings;
    const opts = [['rotate', 'Rotate all matches'], ...this.game.matchList.map((m) => [m.id, `${m.title} (${m.source})`])];
    const offline = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
    this.el.innerHTML = `
      <h2>Staff panel</h2>
      <label>Match <select name="match">${opts.map(([v, t]) => `<option value="${esc(v)}" ${v === s.match ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label>Difficulty <select name="difficulty">${['casual', 'standard', 'pro'].map((d) => `<option ${d === s.difficulty ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label>Volume <input name="volume" type="range" min="0" max="1" step="0.05" value="${s.volume}"></label>
      <label>Display lag, ms (TV delay: notes drawn later) <input name="visualOffsetMs" type="number" step="5" value="${s.visualOffsetMs}"></label>
      <label>Input lag, ms (controller delay: presses judged earlier) <input name="inputOffsetMs" type="number" step="5" value="${s.inputOffsetMs}"></label>
      <label><input name="allowTwoPlayers" type="checkbox" ${s.allowTwoPlayers ? 'checked' : ''}> Allow 2 players</label>
      <label>Scorecard link (QR code) <input name="shareBase" type="url" value="${esc(s.shareBase)}"></label>
      ${offline ? '<p class="msg">Running locally: keep the scorecard link on the public game URL, or phones cannot open it.</p>' : ''}
      <label>Load match file (JSON) <input name="file" type="file" accept=".json,application/json"></label>
      <p class="msg" role="status"></p>
      <div class="row">
        <button data-act="fullscreen">Fullscreen</button>
        <button data-act="reset">Reset today's board</button>
        <button data-act="close">Close</button>
      </div>`;
    const msgs = this.el.querySelectorAll('.msg');
    const msg = msgs[msgs.length - 1] as HTMLElement;
    this.el.querySelectorAll('select, input').forEach((input) => {
      input.addEventListener('change', async (ev) => {
        const t = ev.target as HTMLInputElement;
        if (t.name === 'file' && t.files?.[0]) {
          try {
            const m = parseTimeline(await t.files[0].text(), t.files[0].name.replace(/\W+/g, '-'));
            saveImported(m);
            this.game.setMatches([m, ...this.game.matchList.filter((x) => x.id !== m.id)]);
            s.match = m.id;
            this.save();
            this.render();
            (this.el.querySelectorAll('.msg')[this.el.querySelectorAll('.msg').length - 1] as HTMLElement).textContent = `Loaded “${m.title}”: ${m.events.length} events.`;
          } catch (e) {
            msg.textContent = e instanceof ImportError ? e.message : 'Could not read the file.';
          }
          return;
        }
        const rec = s as unknown as Record<string, unknown>;
        rec[t.name] = t.type === 'checkbox' ? t.checked : t.type === 'range' || t.type === 'number' ? Number(t.value) : t.value;
        this.save();
      });
    });
    this.el.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'close') this.toggle();
        if (act === 'fullscreen') void document.documentElement.requestFullscreen?.();
        if (act === 'reset' && confirm("Delete today's leaderboard?")) {
          this.board.reset();
          msg.textContent = "Today's board is empty.";
        }
      }),
    );
  }
}
