// How good are the bots, really?
//
// Measuring poker skill by playing hands and counting chips is harder than it looks: the
// swing on a single hand is worth tens of big blinds, so a few thousand hands of "A beat B
// by 5" is mostly a statement about who got dealt aces. Two things fix that here.
//
//   1. DUPLICATE DEALS. Every deal is played twice from the same shuffled deck — once with
//      strategy A in the even seats, once with them swapped. The cards cancel out and what
//      is left is the decisions. (Bridge clubs have scored their tournaments this way for
//      a century, for exactly this reason.)
//   2. NO LOOSE RANDOMNESS. Every bot decision is a hash of the hand number, the seat and
//      what it's deciding, so a rerun of this file gives the same numbers to the chip.
//
// It also checks the things that make a bot feel like a player rather than a slot machine:
// that it opens more hands the later it sits, that a bluff is a story told across streets
// instead of a coin flipped on each one, that its bet size gives nothing away — and that
// switching learning on actually changes how it plays against a folder and against a
// station, in the right direction.
const E = require("./engine.js");
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
let handNo = 0;
function playDeal(deck, skillOf, button, n, rng, model, watch) {
  const ps = []; for (let i = 0; i < n; i++) ps.push({ id: "p" + i, name: "p" + i, stack: 1000 });
  const g = E.startHand(ps, { button, sb: 10, bb: 20, deck: deck.slice(), rng });
  g.handNo = ++handNo;
  let guard = 0;
  while (!g.handOver && guard++ < 400) {
    const p = g.players[g.toAct]; if (!p) break;
    const sk = skillOf(p.id);
    let a;
    if (typeof sk === "function") a = sk(g, p.id);
    else {
      a = E.botDecision(g, p.id, rng, { skill: sk, model: model });
      if (watch) watch(g, p, a);
    }
    const r = E.applyAction(g, p.id, a);
    if (!r.ok) { const la = E.legalActions(g); E.applyAction(g, p.id, la && la.check ? { type: "check" } : { type: "fold" }); }
  }
  return g;
}
// A against B, duplicate, both sides taking every seat and every button in turn.
function match(a, b, deals, n = 6, seedNo = 4242, opts = {}) {
  const rng = lcg(seedNo); handNo = 0;
  const net = { a: 0, b: 0 };
  let model = {};
  for (let d = 0; d < deals; d++) {
    const deck = E.shuffle(E.makeDeck(), rng);
    for (const flip of [0, 1]) {
      const at = i => ((i + flip) % 2 === 0) ? a : b;
      const g = playDeal(deck, id => at(Number(id.slice(1))), d % n, n, rng,
        opts.learn ? model : null, opts.watch && ((gg, p, act) => { if (at(Number(p.id.slice(1))) === a) opts.watch(gg, p, act); }));
      for (let i = 0; i < n; i++) net[at(i) === a ? "a" : "b"] += g.players[i].stack - 1000;
      if (opts.learn) model = E.mergeObservations(model, g.obs);
    }
  }
  const per = deals * 2 * (n / 2);
  return { a: net.a / per / 20 * 100, b: net.b / per / 20 * 100, hands: deals * 2 };
}
const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(0) + "%";
let ok = true;
const check = (cond, line) => { if (!cond) ok = false; console.log((cond ? "  ✅ " : "  ❌ ") + line); };

/* ---- 1. the ladder ------------------------------------------------------- */
console.log("— Each setting against the one below it (duplicate deals, bb/100) —");
const D = Number(process.env.DEALS || 1200);
const ladder = [["medium", "easy"], ["hard", "easy"], ["hardcore", "easy"], ["tricky", "easy"], ["hard", "medium"]];
ladder.forEach(([x, y]) => {
  const r = match(x, y, D);
  check(r.a > 0, x.padEnd(9) + "beats " + y.padEnd(7) + r.a.toFixed(1).padStart(7) + " bb/100 over " + (r.hands * 3) + " player-hands");
});

/* ---- 2. position --------------------------------------------------------- */
console.log("— Does it know where it's sitting? (how often it opens the pot) —");
const opens = {};
match("hard", "hard", 400, 6, 99, { watch: (g, p, act) => {
  if (g.board && g.board.length) return;
  if (g.currentBet > g.bb) return;                      // only unopened pots
  if (g.currentBet - p.bet <= 0) return;                // the big blind's option isn't an open
  const k = E.seatsAfterMe(g, p);
  opens[k] = opens[k] || [0, 0]; opens[k][1]++; if (act.type === "raise") opens[k][0]++;
} });
// before the flop, "players still to act behind you" IS the seat: 5 behind is under the
// gun at a six-handed table, 3 is the cutoff, 2 is the button (only the blinds are left)
const early = opens[5] || [0, 1], co = opens[3] || [0, 1], late = opens[2] || [0, 1];
console.log("   under the gun: opens " + pct(early[0], early[1]) + " of hands   |   cutoff: " + pct(co[0], co[1]) + "   |   button: " + pct(late[0], late[1]));
check(late[0] / late[1] > co[0] / co[1] && co[0] / co[1] > early[0] / early[1] && late[0] / late[1] > early[0] / early[1] * 2.5, "the later its seat, the more hands it opens — about as widely as a good regular");

/* ---- 3. a bluff is a story, not a coin flip ------------------------------ */
console.log("— Bluffs (betting with a hand that can't win a showdown) —");
const bets = { flop: [0, 0], turn: [0, 0], river: [0, 0] };
const barrel = { fired: 0, followed: 0 };
const seen = {};
match("hard", "hard", 700, 6, 7, { watch: (g, p, act) => {
  const b = (g.board || []).length; if (!b) return;
  const st = b === 3 ? "flop" : b === 4 ? "turn" : "river";
  const air = E.handStrength(g, p) < 0.45;
  if (act.type === "raise") {
    bets[st][1]++; if (air) bets[st][0]++;
    const key = g.handNo + p.id;
    if (st === "flop" && air) { seen[key] = 1; barrel.fired++; }
    if (st === "turn" && seen[key]) { barrel.followed++; delete seen[key]; }
  } else if (st === "turn" && seen[g.handNo + p.id]) delete seen[g.handNo + p.id];
} });
["flop", "turn", "river"].forEach(st => console.log("   " + st.padEnd(6) + pct(bets[st][0], bets[st][1]) + " of its bets are bluffs (" + bets[st][1] + " bets)"));
console.log("   a flop bluff is followed by a second barrel " + pct(barrel.followed, barrel.fired) + " of the time (" + barrel.fired + " started)");
check(bets.flop[0] > 0 && bets.turn[0] > 0 && bets.river[0] > 0, "it bluffs on every street, not just the flop");
check(bets.flop[0] / bets.flop[1] > bets.river[0] / bets.river[1], "it bluffs most on the flop and gives most of them up later, the way players do");
check(barrel.followed / Math.max(1, barrel.fired) > 0.2, "a bluff that starts gets carried on often enough to be a story");

/* ---- 4. does the size give the hand away? -------------------------------- */
console.log("— What a bet size tells you about the hand behind it —");
// Compared WITHIN a street: bets do get bigger as a hand goes on, and everybody's range
// is stronger by the river, so mixing the streets together would show a correlation that
// tells an opponent nothing. What matters is whether, on this street, a big bet means a
// big hand — and it mustn't.
const buckets = {};
match("hard", "hard", 900, 6, 21, { watch: (g, p, act) => {
  const b = (g.board || []).length;
  if (act.type !== "raise" || !b) return;
  const st = b === 3 ? "flop" : b === 4 ? "turn" : "river";
  const pot = E.potTotal(g), frac = (act.amount - p.bet) / Math.max(1, pot);
  const k = st + (frac < 0.55 ? " small" : " big");
  (buckets[k] = buckets[k] || []).push(E.handStrength(g, p));
} });
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
let worst = 0;
["flop", "turn", "river"].forEach(st => {
  const sm = buckets[st + " small"] || [], bg = buckets[st + " big"] || [];
  if (sm.length < 25 || bg.length < 25) return;
  const d = Math.abs(avg(sm) - avg(bg));
  worst = Math.max(worst, d);
  console.log("   " + st.padEnd(6) + "small bets " + avg(sm).toFixed(3) + " (" + sm.length + ")   big bets " + avg(bg).toFixed(3) + " (" + bg.length + ")   gap " + d.toFixed(3));
});
check(worst < 0.10, "on any given street a big bet means no more than a small one (worst gap " + worst.toFixed(3) + ")");

/* ---- 5. learning --------------------------------------------------------- */
console.log("— With learning switched on, against two obvious opponents —");
const RABBIT = (g) => { const la = E.legalActions(g); return la && la.check ? { type: "check" } : { type: "fold" }; };
const STATION = (g) => { const la = E.legalActions(g); return la && la.check ? { type: "check" } : { type: "call" }; };
function vs(villain, learn) {
  let air = 0, n = 0;
  const r = match("hardcore", villain, 700, 4, 31337, { learn: learn, watch: (g, p, act) => {
    if (act.type === "raise" && (g.board || []).length) { n++; if (E.handStrength(g, p) < 0.45) air++; }
  } });
  return { bb: r.a, bluff: 100 * air / Math.max(1, n) };
}
const rOff = vs(RABBIT, false), rOn = vs(RABBIT, true);
const sOff = vs(STATION, false), sOn = vs(STATION, true);
console.log("   somebody who folds to every bet   — bluffs " + rOff.bluff.toFixed(0) + "% → " + rOn.bluff.toFixed(0) + "%,  " + rOff.bb.toFixed(1) + " → " + rOn.bb.toFixed(1) + " bb/100");
console.log("   somebody who calls with anything  — bluffs " + sOff.bluff.toFixed(0) + "% → " + sOn.bluff.toFixed(0) + "%,  " + sOff.bb.toFixed(1) + " → " + sOn.bb.toFixed(1) + " bb/100");
check(rOn.bluff > rOff.bluff, "it bluffs more once it has seen somebody fold to everything");
check(sOn.bluff < sOff.bluff, "it stops bluffing somebody who has shown it they'll call");
check(sOn.bb > sOff.bb, "and it wins more against the station for having noticed");

console.log(ok ? "\n✅ BOTS — the settings really are a ladder, position and bluffing are real, the size is not a tell, and learning pays"
               : "\n❌ bot skill check failed");
process.exit(ok ? 0 : 1);
