# WSOP Poker Demo

Play-money No-Limit Texas Hold'em you can play with friends from their own phones.
Create a table, share the 4-letter code, everyone joins. Backend is your own Firebase
Realtime Database; the site itself is a single static HTML file.

**Live:** https://wsopoker.netlify.app/

---

## Repo layout

This project is **built** from small source files into one self-contained `index.html`.
Edit the sources, run the build, commit the result.

| File | What it is |
|---|---|
| `engine.js` | Pure poker rules + bot AI. No DOM, no network — fully unit-testable. |
| `app.js` | UI, Firebase multiplayer, host-authority game loop, sounds, animations. |
| `styles.css` | All styling. |
| `template.html` | HTML shell: `<head>`, Firebase config, logo, screens. |
| `build.js` | Inlines the four files above into `index.html`. |
| `index.html` | **The build output — this is what gets deployed.** Don't edit by hand. |
| `google7f47f86e3fd25909.html` | Google Search Console verification file. Must stay at the site root. |

## Build

```bash
node build.js        # writes index.html
```

No dependencies, no npm install. Node only.

## Tests

```bash
node engine.test.js      # 64 rule checks (hand ranking, side pots, blinds, min-raise)
node fuzz.test.js        # 4000 random hands — asserts no chip leaks, all hands terminate
node bot-skill.test.js   # bot must beat calling-station and random opponents
```

Browser tests (need `npx playwright install chromium` once):

```bash
node makepreview.js      # builds preview.html with a mock Firebase
node shoot-play.js       # hole cards + flop/turn/river actually deal
node shoot-reveal.js     # end-of-hand reveal + winner animation
node shoot-timer.js      # countdown is smooth and never jumps up
node shoot-soak.js       # 75s soak — no freezes, every turn resolves
node shoot-showcards.js  # per-player show/muck at the end of a hand
node shoot-fit.js        # fits one screen at 5 phone/desktop sizes, nothing clipped
node shoot-showtable.js  # showing a hand you didn't fold still lands it on the table + audio settings
node shoot-style.js      # the style picker: 6 backgrounds / 6 tables / 6 decks, applied and remembered
node shoot-anim.js       # cards dealt off the deck, swept back into it, riffled; nothing shown mid-hand
node shoot-promo.js      # promo code: hidden, wrong codes refused, right one reveals the table
node shoot-table-feel.js # seat action badges, bets sliding to the pot, the log, motion setting
node shoot-phone.js      # phone layout: hand clear of the board, dock never moves, desktop untouched
node shoot-kick.js       # only the table's creator can add or remove a bot
```

> The mock database in `mockfb.js` deliberately mimics a real Firebase quirk: it **drops
> empty arrays**. That's what once made the flop silently fail to deal (an empty `board: []`
> vanished on write). Keep that behaviour — it catches a whole class of bugs.

## Deploying from this repo

Push this whole folder to GitHub — sources, tests, `build.js` and the built `index.html`.
Then connect the repo to a static host:

**Cloudflare Pages** (free, unlimited bandwidth for static sites, no credit system):

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `node build.js` |
| Build output directory | `/` |
| Root directory | `/` (or the subfolder if the project isn't at the repo root) |

Every push rebuilds `index.html` from the sources and redeploys. **Netlify** is the same two
settings. If you'd rather not build at all, leave the build command empty — the committed
`index.html` is served as-is, but then you have to run `node build.js` yourself before pushing.

Two files must end up at the root of the site: `index.html` (the game) and
`google7f47f86e3fd25909.html` (Google's verification file — delete it and Search Console
un-verifies the site).

The promo code is **not** in this repo, and not in the built page either. What ships is
`PBKDF2-SHA-256(code, salt, 250000 rounds)` and the salt — one-way, and deliberately slow,
so working the code back out would mean 250k SHA-256 rounds per guess against an 80-bit
code. Safe to make the repo public. To set a new code:

```bash
POKER_CODE="YOUR-NEW-CODE" node build.js     # prints a new salt + key to paste into build.js
```

## Notes

- Blinds: small blind is always half the big blind.
- **Table styles are per player.** The 🎨 button beside the sound button opens a picker with six
  backgrounds, six table felts and six decks. Each player's choice is saved in their own browser
  (`poker_bg` / `poker_table` / `poker_cards`) and changes nothing for anyone else at the table.
  A style is only a set of CSS variables, switched by `data-bg` / `data-table` / `data-cards` on
  `<html>` — adding a seventh is a few lines at the bottom of `styles.css` plus one entry in `THEMES`.
- **Bots belong to whoever made the table.** `meta.hostId` is written once when the table is
  created and never reassigned — which is deliberately *not* `amHost`, the browser currently
  running the engine, since that moves between players. Only the creator sees the ✕ on a bot's
  seat and the "+ Bot" button, in the lobby and mid-hand alike. Kicking during a hand is safe:
  the seat goes immediately, the hand that bot was already dealt into plays out, and
  `settleStacks()` only writes chips back to seats that still exist. If the creator has left
  the table, whoever is running it can manage bots instead, so a table can't get stuck full
  of them.
- **On a phone the layout is a different shape.** Below 980px two things change, and both
  are load-bearing. My own two cards leave the felt and get their own row between the table
  and the buttons (`phoneLayout()` in `renderSeats` puts them in `#my-hand` instead of my
  pod) — on a small oval a hand held at my seat sits on top of the community cards, which
  made the game genuinely unplayable. And the action dock keeps a fixed height in every
  state (`--dock-h`, with an `.idle` state instead of `hidden`): it used to disappear
  whenever it wasn't my turn, which resized the table and moved every button on screen
  twice a turn, so you'd reach for Call and hit Fold. The seats are also smaller and sit
  further out on a phone (`seatXY` widens the ring), and on very short screens the per-seat
  bet chips are dropped — the action badge already carries the number. `shoot-phone.js`
  measures all of it, including that the desktop layout is untouched.
- **The table tells you what happened, not a text feed.** When someone acts, a badge appears
  on *their seat* — FOLD, CHECK, CALL 20, RAISE 200, ALL IN — and stays there until the street
  clears, exactly as it does on a real client. The engine records it as `p.act` and `resetRound()`
  wipes every badge when the dealer pulls the bets in. Those bets don't blink out either: they
  slide into the pot (`flyChipsToPot()` measures the pot's real position, so they land on it at
  any screen size). The flying chips live in `#bets-layer`, which — unlike `#seats-layer` — is
  never cleared on render, because a street closing is exactly when a burst of renders arrives
  and would otherwise wipe them mid-flight.
- **Motion is a player setting, never the OS's.** The style panel has Full / Reduced, saved as
  `poker_motion`. This used to be `@media(prefers-reduced-motion: reduce)`, which meant anyone
  whose system had "reduce animations" switched on silently lost the dealing, the sweep, the
  flips and the winner glow — with no way to turn them back on and no clue why. In a card game
  the motion *is* the game telling you what happened, so it defaults to on. `shoot-table-feel.js`
  launches a browser that asks for reduced motion and asserts the cards still move.
- **The hand log is formatted for humans.** The engine writes the PokerStars export format
  (`*** FLOP *** [8c 7h Kc]`) because that's what tracking software reads; `renderLog()` turns
  streets into dividers and card codes into little cards. Bots get names (Mason, Ivy, Duke…)
  rather than "Bot 3 🤖" — the seat carries a BOT tag instead — because a table of labels is what
  made the log read like a server log. The panel remembers whether you left it open.
- **Cards are dealt one at a time.** Each card's `animation-delay` is measured from when the hand
  began, so it can be negative — meaning "already in flight". That's what lets the round of
  dealing survive the burst of re-renders a new hand arrives in: a re-render picks the animation
  up where it is instead of snapping it back to the start.
- **There's a deck on the table** — a stack of card backs pinned to the right of the community
  cards (CSS keeps it exactly one gap away from the fifth card at every screen size, so it can
  never land on top of them). Every card is dealt *out of* it: `applyCardOrigins()` measures the
  deck's real position on screen and writes each card's starting offset into `--dx`/`--dy`, so
  hole cards and the flop/turn/river all fly off the stack and turn face up as they land.
  When a hand ends the whole table is swept back *into* the deck (`--sx`/`--sy`, same
  measurement), and then the deck riffles — two halves springing apart and squaring up, twice —
  before the next hand is dealt. Sequence and timing: sweep at `nextHandAt − 1880ms`, riffle at
  `−1260ms`, deal at `0`. Each stage has its own synthesized sound.
  The deal and reveal animations are held on a short *time window* rather than a single render:
  a hand starts as a burst of updates and a one-shot flag gets wiped before the cards ever paint.
- **Showing hands is per player.** Folding throws your two cards face down onto the table
  (the muck). At the end of the hand each player gets a "Show my cards" button — press it and
  your mucked cards flip over; ignore it and they stay face down. Nobody is forced. Players who
  reach a real showdown are revealed automatically, because that's how the pot is decided.
  Choices are stored under `shown/<handNo>/<playerId>` and cleared when the next hand starts.
  Nothing goes face up while a hand is live: `hasShown()` returns false unless `handOver` is set,
  so a stray `shown` entry can't leak a live hand.
- Turn timer is configurable in the lobby; on timeout a player auto-checks, or auto-folds
  if facing a bet.
- The table is host-authoritative: one client runs the engine and writes results. If that
  client leaves, another seated player automatically takes over.
- On a PC the whole app is a fixed-size "cabinet" centred on a blurred wood backdrop, with the
  table on the left and the action column on the right. On phones it becomes a single column.
  Nothing ever scrolls — the table flexes into whatever space is left.
- **Audio is fully synthesized** — no audio files, so nothing extra to download. The background
  music is an original looping chord progression (Am7–Fmaj7–Cmaj7–G6) generated live in the
  Web Audio API, with its own gain bus separate from the sound effects. The 🔊 button opens a
  panel with independent Music and Sound-effects volume sliders, saved to localStorage. Browsers
  block audio until the first tap, so the loop starts on the first click.
- **What the promo code can and can't do.** It stops anyone from *finding* the code: it isn't in
  the page, and PBKDF2 at 250k rounds makes guessing it hopeless. It does not make the cards
  themselves secret — this table has no server, so one of the players' browsers runs the dealer
  and every browser holds the whole game state. Someone who knows their way around devtools could
  read the other hands out of the database without any code at all. Fixing *that* would mean
  moving the dealer onto a server (Cloud Functions), which is a different, paid, project.
- Play money only.
