# Match Rhythm

**A 60-second booth mini game where every note is a real moment of an esports match.**

Match Rhythm turns a match timeline into a rhythm game. Each elimination, objective, round win and momentum swing becomes a note on the beat. Fans at the booth "play the match": the faster the real game was, the busier the song. When they hit the notes, they play the melody of that match. A crowd watching the screen sees the match unfold again on the ticker at the top.

Built for the Cloud9 x JetBrains "Sky's The Limit" Hackathon 2026, Category 3 (Event Mini Game).

## Play

- Hosted build: see the project page.
- Locally: `npm install`, then `npm run dev`, and open the printed URL.

| | Player 1 | Player 2 |
|---|---|---|
| Keyboard | `A` `S` `D` `F` | `J` `K` `L` `;` |
| Gamepad | D-pad left/up, Y, B (or LB, LT, RT, RB) | second gamepad |
| Touch | tap the lanes | tap the lanes |

Press any button to join. A second player has a few seconds to join, or `Enter`/Start begins at once.

## How a match becomes a song

1. **Pick the slice.** `pickWindow` scores every run of consecutive events in the match. It looks at objectives and round results, whether both teams appear, whether the slice ends on a result, and how late in the match it is. The most dramatic slice that fits the difficulty wins.
2. **Fit it to the song.** The slice is stretched over the 60-second song (124 BPM, with a count-in and an outro) and every event is snapped to the beat grid. Real order is kept.
3. **Lanes have meaning.**

   | Lane | Events | Note shape |
   |---|---|---|
   | Outer left | Team 1 eliminations | diamond |
   | Middle left | Objectives | hexagon |
   | Middle right | Round results | bar |
   | Middle right | Momentum swings | ring |
   | Outer right | Team 2 eliminations | diamond |

4. **The melody is the match.** Each note's pitch comes from the chord playing at that moment (Am–F–C–G). Whatever notes you hit, it sounds musical, and two players hitting the same chart play in unison.
5. **Fair by construction.**
   - There are never two notes in one lane at once, and at most two notes together.
   - The note count is capped per difficulty: casual 60, standard 88, pro 124.

All of this is in `src/core/chart.ts` and covered by unit tests (`npm test`).

## Built for a booth

- **Attract mode.** A demo player performs a match while the screen invites people to join, and shows today's best score.
- **1 or 2 players** on one screen: head-to-head on the same match, with the winner announced.
- **Daily top 10** with arcade-style initials, stored locally. It works offline and resets each day.
- **Score card by QR code.** The result is encoded in the link, so no server and no personal data are needed. The phone shows a shareable card with a "play in the browser" button.
- **Staff panel**, opened with `` ` ``, `Ctrl+Shift+S`, or a 3-second press in the top-left corner:
  - match selection or rotation;
  - difficulty;
  - volume;
  - timing offset;
  - 2-player toggle;
  - score-card link;
  - loading a real match file;
  - fullscreen;
  - leaderboard reset.
- **Never freezes.** A failing frame is logged and the next frame runs anyway.
- **No audio files.** The soundtrack is synthesized live with the Web Audio API, so there is nothing to license and nothing to download.

## Match data

The three bundled matches are **generated demo data**: two tactical-shooter maps and one arena game, between fictional teams. The game says so on screen. Real matches load as JSON from the staff panel:

```json
{
  "title": "Grand Final · Map 3",
  "teams": [{ "name": "Team A", "tag": "TMA", "color": "#4fb3ff" }, { "name": "Team B", "tag": "TMB", "color": "#ff6b6b" }],
  "events": [
    { "t": 34.2, "kind": "elim", "team": 0, "label": "TMA opens the round" },
    { "t": 61.0, "kind": "objective", "team": 1, "label": "Round 1: TMB plants" },
    { "t": 80.5, "kind": "round", "team": 1, "label": "Round 1 to TMB — 0:1" }
  ]
}
```

`kind` is one of `elim`, `objective`, `round` or `swing`. `t` is the number of seconds since the match started. Any esports data feed, including GRID series events, can be exported to this format. `examples/sample-match.json` is a complete file.

## Development

```bash
npm install
npm run dev        # dev server
npm test           # unit tests (vitest)
npm run typecheck  # TypeScript
npm run build      # static build in dist/
```

**Demo video footage** is recorded frame by frame with `node tools/record.mjs <url> <out>`: the game runs in film mode (`?film`), bots play with human-like timing, and the game's own audio engine renders the soundtrack offline, so the footage is smooth and in sync.

The project is developed in **WebStorm**. Its run configurations, inspection profile and code style are committed in `.idea/`.

## License

MIT, see [LICENSE](LICENSE).
