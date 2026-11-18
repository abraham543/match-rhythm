// Hidden staff panel (` key, Ctrl+Shift+S, or a 3-second press in the top-left corner):
// match selection, difficulty, volume, timing offset, leaderboard reset, loading a match file, fullscreen.
import type { Game } from './game';
import type { Leaderboard } from '../core/leaderboard';
import { ImportError, parseTimeline } from '../data/importer';

const KEY = 'match-rhythm:settings';

export function loadSettings<T extends object>(defaults: T): T {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

export class StaffPanel {
  private el: HTMLDivElement;
  open = false;

  constructor(private game: Game, private board: Leaderboard, canvas: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'staff';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    let timer: number | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.clientX < 80 && e.clientY < 80) timer = window.setTimeout(() => this.toggle(), 3000);
    });
    canvas.addEventListener('pointerup', () => timer !== null && window.clearTimeout(timer));
  }

  toggle(): void {
    this.open = !this.open;
    this.el.hidden = !this.open;
    if (this.open) this.render();
  }

  private save(): void {
    localStorage.setItem(KEY, JSON.stringify(this.game.settings));
  }

  private render(): void {
    const s = this.game.settings;
    const opts = [['rotate', 'Rotate all matches'], ...this.game.matchList.map((m) => [m.id, `${m.title} (${m.source})`])];
    this.el.innerHTML = `
      <h2>Staff panel</h2>
      <label>Match <select name="match">${opts.map(([v, t]) => `<option value="${v}" ${v === s.match ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Difficulty <select name="difficulty">${['casual', 'standard', 'pro'].map((d) => `<option ${d === s.difficulty ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label>Volume <input name="volume" type="range" min="0" max="1" step="0.05" value="${s.volume}"></label>
      <label>Timing offset (ms) <input name="offsetMs" type="number" step="5" value="${s.offsetMs}"></label>
      <label><input name="allowTwoPlayers" type="checkbox" ${s.allowTwoPlayers ? 'checked' : ''}> Allow 2 players</label>
      <label>Score card link <input name="shareBase" type="url" value="${s.shareBase}"></label>
      <label>Load match file (JSON) <input name="file" type="file" accept=".json,application/json"></label>
      <p class="msg" role="status"></p>
      <div class="row">
        <button data-act="fullscreen">Fullscreen</button>
        <button data-act="reset">Reset today's board</button>
        <button data-act="close">Close</button>
      </div>`;
    const msg = this.el.querySelector('.msg') as HTMLElement;
    this.el.querySelectorAll('select, input').forEach((input) => {
      input.addEventListener('change', async (ev) => {
        const t = ev.target as HTMLInputElement;
        if (t.name === 'file' && t.files?.[0]) {
          try {
            const m = parseTimeline(await t.files[0].text(), t.files[0].name.replace(/\W+/g, '-'));
            this.game.setMatches([m, ...this.game.matchList.filter((x) => x.id !== m.id)]);
            s.match = m.id;
            msg.textContent = `Loaded “${m.title}”: ${m.events.length} events.`;
            this.save();
            this.render();
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
