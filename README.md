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
node shoot-anim.js       # cards dealt onto the table, swept off before the next hand, nothing shown mid-hand
```

> The mock database in `mockfb.js` deliberately mimics a real Firebase quirk: it **drops
> empty arrays**. That's what once made the flop silently fail to deal (an empty `board: []`
> vanished on write). Keep that behaviour — it catches a whole class of bugs.

## Deploying

The site is a static file, so any static host works. Drag-and-drop or connect this repo:

- **Cloudflare Pages** — free, unlimited bandwidth for static sites, no credit system.
  Connect the repo, set build command to `node build.js` and output directory to `/`.
- **Netlify** — connect the repo; same build command.

Deploy **both** `index.html` and `google7f47f86e3fd25909.html`, or Google un-verifies the site.

## Notes

- Blinds: small blind is always half the big blind.
- **Table styles are per player.** The 🎨 button beside the sound button opens a picker with six
  backgrounds, six table felts and six decks. Each player's choice is saved in their own browser
  (`poker_bg` / `poker_table` / `poker_cards`) and changes nothing for anyone else at the table.
  A style is only a set of CSS variables, switched by `data-bg` / `data-table` / `data-cards` on
  `<html>` — adding a seventh is a few lines at the bottom of `styles.css` plus one entry in `THEMES`.
- **Cards fly on and off the felt.** Hole cards deal outward from the middle of the table to each
  seat (the direction is set per seat as `--dx`/`--dy`), the flop, turn and river arrive off the
  dealer's deck and turn face up as they land, and just before the next hand the dealer sweeps the
  board and every hand still lying on the felt off to the side. Both are held on a short time
  window, not a single render — a hand starts as a burst of updates and a one-shot flag gets wiped
  before the cards ever paint.
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
- Play money only.
