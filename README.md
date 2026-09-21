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
node bot-skill.test.js   # the skill ladder, position, bluffing, sizing tells, learning — on duplicate deals
node coach.test.js       # the coach's odds against textbook numbers and an exact count; its advice; the truth view
node fairness.test.js    # reshuffles every card you can't see — no bot, and not the coach, may change its mind
node luck.test.js        # table code 2 wins the all-ins it can, deals ordinary-looking boards, touches nothing else
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
node shoot-promo.js      # table code 1: hidden, wrong codes refused, right one reveals the table
node shoot-luck.js       # table code 2: no mark on screen, the dealer carries it, it switches off
node shoot-seat.js       # taking a seat works first time, with or without table code 2
node shoot-table-feel.js # seat action badges, bets sliding to the pot, the log, motion setting
node shoot-phone.js      # phone layout: seats off the felt, nothing covers the board, desktop untouched
node shoot-kick.js       # only the table's creator can add or remove a bot
node shoot-winner.js     # the end of a hand names the winner, the amount and the hand
node shoot-bots.js       # the table's bot setting reaches the bots; learning keeps its notes on the table
node shoot-coach.js      # Learn poker: the coach's pick glows, Why? explains it, and no hidden card ever appears
node shoot-master.js     # the table master's panel: bottom left, mid-game settings, handing the table to a person
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

There are two secret **table codes**, typed in the same hidden place (tap the table's name
four times). Neither is in this repo, and neither is in the built page. What ships for each
is `PBKDF2-SHA-256(code, salt, 250000 rounds)` and the salt — one-way, and deliberately slow,
so working a code back out would mean 250k SHA-256 rounds per guess against an ~80-bit code.
To set new ones:

```bash
POKER_CODE="YOUR-NEW-CODE"  node build.js    # the first code  (see the cards)
POKER_CODE2="YOUR-NEW-CODE" node build.js    # the second code (all-ins)
# each prints a new salt + key to paste into build.js so later builds keep it
```

## Notes

- Blinds: small blind is always half the big blind.
- **Table styles are per player.** The 🎨 button beside the sound button opens a picker with six
  backgrounds, six table felts and six decks. Each player's choice is saved in their own browser
  (`poker_bg` / `poker_table` / `poker_cards`) and changes nothing for anyone else at the table.
  A style is only a set of CSS variables, switched by `data-bg` / `data-table` / `data-cards` on
  `<html>` — adding a seventh is a few lines at the bottom of `styles.css` plus one entry in `THEMES`.
- **The end of a hand is spelled out.** A gold glow on a seat and a small floating "+60"
  were not enough — people genuinely could not tell who had won. A banner now sits over the
  middle of the table from the moment the hand ends until the dealer starts collecting the
  cards, naming the winner, the amount and the hand that won it ("Two Pair, Kings and Twos",
  or "everyone else folded" when there was no showdown), and the winning seat carries a gold
  WINNER tag. Split pots list every winner. It's built once per hand — rebuilding it would
  restart its animation on every table update — and it's positioned clear of the community
  cards, because the first thing people look at next is what won.
- **Learn poker is a coach, switched on for the table.** Tick "🎓 Learn poker" when you set
  the table up and everyone seated gets it. On your turn a line above the buttons gives the
  play — *Call 30 · win 44% · need 20%* — and the button it would press glows with a COACH
  tag (for a raise, the slider is already set to its size). **Why ›** opens the reasoning:
  your hand, your seat, how often you win against the hands the others are *likely* to hold,
  what the pot is asking you to pay, and what the call is worth in chips on average. Every
  decision is graded the moment you make it, and the sheet keeps a session report: how often
  you matched the coach and which leak — calling without the odds, folding with them,
  playing strong hands too passively — has cost you most.
- **The coach plays like a real player sitting beside you.** It works only from what you can
  see at a real table: your cards, the board, the pot, your seat, and a picture of each
  opponent's range drawn from how they've played — a preflop raiser holds good starting
  hands, a big bet after the flop is rarely nothing. That picture is proper weighted
  sampling (`equity()` in the engine weights every possible two-card hand and draws from the
  weighting), so it moves the way it should: ace-high on K♥9♥2♣ wins 34% against a small
  bet and 24% against an overbet. An earlier version had a "What's really happening" panel
  showing the bots' actual cards and the board to come; it was taken out on purpose — a
  coach that can see the cards teaches you nothing you can use at a real table — and the
  engine no longer contains any function that could produce it. `shoot-coach.js` searches
  the Why sheet for every opponent card and every undealt card and requires none to appear.
- **The advice never contradicts its own numbers.** "Win 61% · need 35% · Fold" once appeared —
  for a call that was the player's last chips. Before the flop, facing a raise, the coach fell
  back on a rule of thumb ("calling a raise out of position needs a top-7% hand") and ignored
  the win chance and the price it was showing. Now that decision follows the numbers: call
  when the win chance beats what's needed. When the call puts (nearly) everything in, nothing
  is added, because with no betting left position means nothing and only the price matters.
  Otherwise it asks for some room above break-even for the betting still to come (about 5
  points with position, 10 without, more against a re-raise). The "need" on screen is always
  the number it actually applies, not the bare price, and `coach.test.js` checks 360 random
  spots: it never folds with more than it needs or calls with less. The bots got the same
  all-in rule, so they no longer fold A-J for their last few big blinds.
- **The odds are fast because they have to be.** A coach decision runs about 1,200
  simulated runouts against every opponent's range. `evaluate7()` builds and sorts every
  five-card subset — right for settling a showdown, but 160µs a hand, which made one
  decision take over a second. `fastScore()` packs a seven-card hand into one integer whose
  numeric order is the hand order (category in the top bits, then the tie-breaking ranks,
  four bits each) and brings the whole calculation to about 10ms. `coach.test.js` plays it
  against `evaluate7()` on 40,000 random showdowns — they agree on every one — and checks the
  simulation against the numbers every player knows (aces against kings 82%, ace-king
  against queens 46%, the coin flip) and against an exact card-by-card count.
- **Nobody at the table can see a card you can't — and there's a test that proves it.**
  The bots and the coach's advice use their own two cards, the board, the pot, the stacks and
  how people have acted. Never another player's cards, never the undealt deck. With no server,
  the whole game state sits in every browser, so this is a promise the code has to keep —
  `fairness.test.js` takes 1,500 real mid-hand situations, deals every card the deciding
  player can't see all over again, and requires every bot at every setting, and the coach,
  to make exactly the same decision. To show the check has teeth it runs a deliberately
  cheating bot through it too (it folds whenever an opponent holds an ace) and requires it to
  be caught.
- **Counting raises, not guessing them.** The first version of the bots and the coach decided
  "that's a re-raise" when the bet passed 3.4 big blinds — and the bots' own standard open is
  3.5, so every ordinary opening raise was treated as a 3-bet and nearly everything folded to
  it (it's how the coach came to say "fold" with K♠Q♠ on the button). `preflopRaises()` now
  counts the actual raises from the hand's record, and position for a preflop call means
  acting after the raiser on later streets (`ipVsRaiser()`) rather than how many people are
  still to act right now — by that old measure the big blind, last to speak preflop, looked
  "in position", and the button didn't. The same spot now reads *Call 70 · win 54% · need 41%*.
- **How good the bots are is a table setting.** Five of them, chosen when the table is made
  (`meta.botSkill`, in the settings panel next to the blinds):

  | | |
  |---|---|
  | **Easy** | The original bot: plays a third of its hands, limps, calls too much, raises rarely. A beginner can beat it. |
  | **Medium** | Raises or folds before the flop and knows where it's sitting. Bets its good hands, bluffs a little. |
  | **Hard** | The full game — board texture, blockers, bluffs that hold together across streets, sizing that gives nothing away. |
  | **Hardcore** | Hard with the pressure up: more three-bets, thinner value, the odd overbet, and it acts on a read hardest. |
  | **Tricksters** | Hard, but each seat keeps a temperament — a rock, a shark, a trapper, a maniac — so the table feels like people. |

  What every setting above Easy has that the old bot didn't: **position** (`seatsAfterMe`
  counts who still acts behind it, and the opening range widens from about 4% under the gun
  to 21% one off the button), **a real preflop range** (Bill Chen's formula, with thresholds
  per seat and separate 3-bet, defend and 4-bet ranges), **board texture** (top pair on
  9♦7♦6♠ is not the same hand as top pair on K♠7♦2♣), **blockers**, **stack depth**, and an
  awareness of **how many people are in the pot** — bluffing five players is just giving
  chips away, so the frequency scales down with each extra opponent.
- **A bluff has to be a story.** The old bot rolled a die on every street, which produced
  hands that bet the flop, gave up on the turn and then raised the river with the same air —
  a line nobody has ever taken. Now "am I bluffing this hand" is a hash of the hand number
  and the seat, fixed before the flop and re-read on each street, so a bluff that starts gets
  carried on or abandoned coherently: about 44% of flop bets are bluffs, 32% of turn bets,
  6% of river bets, and a flop bluff gets a second barrel about a quarter of the time. The
  same seed picks the bet size, and value bets and bluffs draw from one distribution, so
  within a street a big bet means no more about the hand than a small one (measured gap:
  0.05 on a 0–1 strength scale).
- **Adapting is a separate switch.** With "Bots adapt to you" ticked, every answer to
  a bet is recorded — kept apart for before and after the flop, because nearly everyone folds
  most hands preflop and mixing the two makes every opponent look like a folder. The notes
  live on the table (`/model`), not in one browser, so they survive whoever is running the
  game closing their laptop, and old evidence halves once there's enough of it so somebody
  who tightens up isn't judged for ever on how they played an hour ago. Against somebody who
  folds to everything the bots go from bluffing 48% of the time to 54%; against somebody who
  calls with anything they drop to 42% and start value-betting hands they'd otherwise check,
  which is worth about 38 bb/100 against that player. Switched off, the read function returns
  a flat "ordinary player" and none of it does anything.
- **Measuring any of this is harder than it sounds.** A single hand swings tens of big
  blinds, so "A beat B by 5 bb/100 over 4000 hands" is mostly a statement about who was dealt
  aces. `bot-skill.test.js` plays every deal **twice from the same deck** with the two
  strategies swapped between seats, the way a bridge club scores a duplicate tournament, and
  every bot decision is a hash rather than a call to `Math.random`, so the numbers are
  repeatable to the chip. On that footing: Medium beats Easy by about 13 bb/100, Hard by 18,
  Hardcore by 19. Hard and Hardcore are within a blind of each other against *bots* — their
  extra pressure is aimed at people, who fold far more often than these bots do.
- **The table master.** Whoever makes the table is its master, marked with a 👑 on their seat
  so everyone knows. Once the game is running, the master gets a **👑 Table** button bottom
  left — the corner of the table on a computer, the start of the bottom bar on a phone — with
  the table's settings: turn timer, blinds, chips for new players, how the bots play, whether
  they adapt, and Learn poker. Nothing in it touches the hand being played: blinds and the
  timer apply from the next hand (`startNextHand()` reads them fresh), and the chip setting
  only affects people who join or rebuy, so nobody's stack is reset. The same panel can hand
  the table to someone else: it lists the people at the table — never a bot; `promoteMaster()`
  refuses a bot even if asked — and takes two taps, the second to confirm. The new master
  gets a message and the panel; the old one loses both. The table master is `meta.hostId`,
  and `isTableMaster()` is the one check everything uses — the lobby settings, the Start
  button, adding and kicking bots. It's deliberately not "whoever is running the game engine",
  since that moves between browsers; if the master leaves, whoever is running it stands in.
- **Bots belong to whoever made the table.** `meta.hostId` is written once when the table is
  created and never reassigned — which is deliberately *not* `amHost`, the browser currently
  running the engine, since that moves between players. Only the creator sees the ✕ on a bot's
  seat and the "+ Bot" button, in the lobby and mid-hand alike. Kicking during a hand is safe:
  the seat goes immediately, the hand that bot was already dealt into plays out, and
  `settleStacks()` only writes chips back to seats that still exist. If the creator has left
  the table, whoever is running it can manage bots instead, so a table can't get stuck full
  of them. The ✕ sits on the bot's picture on a phone and on its name
  plate on a desktop — and moves to the plate on a phone too when the first table code is on, because
  then the revealed hand is what's over the picture.
- **On a phone the seats come off the felt entirely.** This is the one structural difference
  between the two layouts, and it exists because shrinking the seats never worked. A phone
  browser gives a page about 700px of height, not the 844px on the box: take off the header,
  my own hand, the action dock and the history drawer and the oval is ~130px tall — barely
  taller than the board itself. Seats pinned around an oval that size land *on* the community
  cards and *on* the pot at any size you draw them. So below 980px `placeSeat()` puts the
  opponents in a rail above the table (`#rail`) and my own seat below it (`#my-hand`), and the
  felt holds nothing but the pot, the street and the board. Overlap stops being something to
  tune and becomes impossible. Each rail seat is a picture, a name over a stack, the action
  badge under it and the dealer button; face-down cards shrink to a hint behind the picture,
  and a hand the first table code has revealed stays full size in front of it. Bets aren't drawn at the
  seat here — the badge already says CALL 60 — but they still fly into the pot when the street
  closes, from the rail rather than from a point on the felt. The action dock keeps a fixed
  height in every state (`--dock-h`, with an `.idle` state instead of `hidden`): it used to
  disappear whenever it wasn't my turn, which resized the table and moved every button on
  screen twice a turn, so you'd reach for Call and hit Fold. The header is one line on a
  phone, and the dock tightens on short screens, because both of those are board pixels. The
  two screens *before* the table matter just as much: the table settings are a fixed, centred
  panel capped at `100dvh - 92px`, and on short screens the front page shrinks its logo and
  fields, so neither one scrolls — you can't create a table you can't see the Start button on.
  `shoot-phone.js` measures all of it at four phone sizes — including 393x700, what a phone
  browser really gives you — at two, four, six and eight players: no seat element may touch
  the pot, the street, the board or the deck; the board must sit inside the felt; nothing may
  scroll; the dock and the table must not move between states; and the desktop must still put
  every seat around the oval with my cards at my own.
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
- **The second table code wins all-ins, and looks like luck.** Entered, it shows nothing but
  a tick — no banner, no badge — and switches off the same way. It's noted in its own small list
  at the table (`lk/<player>`), because the dealing happens in whichever browser is running the
  table, and the dealer passes it into each hand it starts (`g.ls`). It must never be written
  into `seats`: taking a seat is a Firebase transaction, and a write from the same browser on the
  same data before the server confirms it *cancels* the transaction — the first version did
  exactly that, so with the code on you could never sit down, and each try left a broken seat
  behind. `mockfb.js` now runs transactions the way the real SDK does (shown at once, confirmed
  a moment later, cancelled by an overlapping local write), `normSeats()` treats a seat with no
  player in it as empty so old broken seats clear themselves, and `takeSeat()` tries again if
  it's ever cancelled. It acts at exactly one moment: when nobody left can bet
  and the rest of the board is about to be dealt out in one go (`advanceStreets` →
  `settleRunout`). Then, from the cards genuinely left in the deck, it picks at random among
  the runouts where the holder has the best hand and puts them where the dealer will take them
  from (burn, three, burn, one, burn, one). Nothing is added or removed — the deck is still
  one deck, everybody's hole cards are what they were dealt — and because the pick is random
  among winning boards, the boards look like any others (300 rigged all-ins in `luck.test.js`
  came out on 300 different boards). Every other hand is dealt straight: hands played out to a
  showdown come out identical with the code on or off. It can't save a hand that is drawing
  dead, and an all-in on the river has no cards left to choose. The same caveat as the first
  code applies, more so: the codes can't be found, but the logic is in the page source for
  anyone who reads it.
- **What the first table code can and can't do.** With it on, an opponent's hand is drawn at 1.5x
  *in front of* their picture (`.pod.peeking`, `z-index:7`) rather than tucked behind it —
  a peeked hand you can't read is no use — greyed so it's never mistaken for a real showdown.
  It stops anyone from *finding* the code: it isn't in
  the page, and PBKDF2 at 250k rounds makes guessing it hopeless. It does not make the cards
  themselves secret — this table has no server, so one of the players' browsers runs the dealer
  and every browser holds the whole game state. Someone who knows their way around devtools could
  read the other hands out of the database without any code at all. Fixing *that* would mean
  moving the dealer onto a server (Cloud Functions), which is a different, paid, project.
- Play money only.
