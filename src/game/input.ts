// Keyboard, gamepads and touch, all turned into the same small set of actions.
// Booth layout: player 1 on A S D F, player 2 on J K L ; (or one gamepad each, or tapping the lanes).

export type Action =
  | { type: 'lane'; player: 0 | 1; lane: number }
  | { type: 'start'; player: 0 | 1 }
  | { type: 'staff' };

const P1 = ['KeyA', 'KeyS', 'KeyD', 'KeyF'];
const P2 = ['KeyJ', 'KeyK', 'KeyL', 'Semicolon'];
// gamepad: d-pad left / up, Y, B  -- or LB, LT, RT, RB
const PAD_LANES: number[][] = [[14, 4], [12, 6], [3, 7], [1, 5]];
const PAD_START = [9, 0];

export interface TouchLayout {
  /** Screen x ranges of each player's lanes, in CSS pixels. */
  lanes: { player: 0 | 1; x0: number; x1: number; count: number }[];
}

export class Input {
  private handlers: ((a: Action) => void)[] = [];
  private padState = new Map<number, boolean[]>();
  layout: TouchLayout = { lanes: [] };
  /** Gamepad index -> player. */
  private padPlayer = new Map<number, 0 | 1>();

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKey(e));
    el.addEventListener('pointerdown', (e) => this.onPointer(e));
  }

  on(h: (a: Action) => void): void {
    this.handlers.push(h);
  }

  private emit(a: Action): void {
    for (const h of this.handlers) h(a);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (e.code === 'Backquote' || (e.ctrlKey && e.shiftKey && e.code === 'KeyS')) {
      e.preventDefault();
      this.emit({ type: 'staff' });
      return;
    }
    if ((e.target as HTMLElement | null)?.closest?.('.staff')) return;
    const i1 = P1.indexOf(e.code);
    const i2 = P2.indexOf(e.code);
    if (i1 >= 0) this.emit({ type: 'lane', player: 0, lane: i1 });
    else if (i2 >= 0) this.emit({ type: 'lane', player: 1, lane: i2 });
    else if (e.code === 'Enter' || e.code === 'Space') this.emit({ type: 'start', player: 0 });
    else return;
    e.preventDefault();
  }

  private onPointer(e: PointerEvent): void {
    const rect = this.el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    for (const l of this.layout.lanes) {
      if (x >= l.x0 && x < l.x1) {
        const lane = Math.min(l.count - 1, Math.floor(((x - l.x0) / (l.x1 - l.x0)) * l.count));
        this.emit({ type: 'lane', player: l.player, lane });
        return;
      }
    }
    // a tap outside the lanes starts the game for player 1 or 2 depending on the side
    this.emit({ type: 'start', player: x < rect.width / 2 ? 0 : 1 });
  }

  /** Call every frame: gamepads have no events for buttons. */
  pollGamepads(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      if (!this.padPlayer.has(pad.index)) this.padPlayer.set(pad.index, this.padPlayer.size % 2 === 0 ? 0 : 1);
      const player = this.padPlayer.get(pad.index)!;
      const prev = this.padState.get(pad.index) ?? [];
      const now = pad.buttons.map((b) => b.pressed);
      const down = (i: number) => now[i] && !prev[i];
      PAD_LANES.forEach((btns, lane) => {
        if (btns.some(down)) this.emit({ type: 'lane', player, lane });
      });
      if (PAD_START.some(down)) this.emit({ type: 'start', player });
      this.padState.set(pad.index, now);
    }
  }
}
