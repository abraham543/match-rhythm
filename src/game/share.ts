// Scorecard shared by QR code. The data travels in the URL (#card=...), so no server is needed:
// the phone opens the hosted game page, which shows the card instead of the booth game.
export interface CardData {
  n: string; // initials
  s: number; // score
  g: string; // grade
  a: number; // accuracy %
  c: number; // max combo
  m: string; // match title
  d: string; // date
}

function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(pad), (c) => c.charCodeAt(0)));
}

export function shareUrl(base: string, card: CardData): string {
  return `${base.replace(/#.*$/, '')}#card=${b64url(JSON.stringify(card))}`;
}

export function readCard(hash: string): CardData | null {
  const m = /card=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    const o = JSON.parse(unb64url(m[1]));
    if (typeof o.s !== 'number') return null;
    return {
      n: String(o.n ?? '').slice(0, 3), s: o.s, g: String(o.g ?? '').slice(0, 2), a: Number(o.a) || 0,
      c: Number(o.c) || 0, m: String(o.m ?? '').slice(0, 60), d: String(o.d ?? '').slice(0, 10),
    };
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function renderCard(root: HTMLElement, c: CardData): void {
  document.title = `Match Rhythm — ${c.s.toLocaleString('en-US')} points`;
  root.innerHTML = `
    <main class="card">
      <p class="kicker">MATCH RHYTHM · SCORECARD</p>
      <h1>${esc(c.g)}</h1>
      <p class="score">${c.s.toLocaleString('en-US')}</p>
      <p class="who">${c.n ? esc(c.n) + ' · ' : ''}${esc(c.d)}</p>
      <p class="line">${c.a}% accuracy · max combo ${c.c}</p>
      <p class="line">${esc(c.m)}</p>
      <p class="cta">I played the match at the booth. Your turn.</p>
      <a class="play" href="${esc(location.pathname)}">Play in the browser</a>
    </main>`;
}
