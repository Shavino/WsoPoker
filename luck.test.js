// The second promo code: an all-in the holder is part of comes out their way, and it has to
// look like any other hand. So this checks that it wins, that the boards it deals look like
// ordinary boards (all different, cards that really were left in the deck, still exactly one
// deck), that it only ever touches an all-in runout — never a hand that's played out
// normally, never a hand the holder has folded — and that it leaves the flop and turn alone
// when the all-in comes later in the hand.
const E = require("./engine.js");
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const rng = lcg(777);
let pass = 0, fail = 0;
const check = (cond, line) => { if (cond) pass++; else fail++; console.log((cond ? "  ✅ " : "  ❌ ") + line); };

// a heads-up or multiway hand where each player holds the cards we give them
function table(hands, withCode) {
  const ps = hands.map((h, i) => ({ id: i === 0 ? "me" : "p" + i, name: i === 0 ? "me" : "p" + i, stack: 1000 }));
  const used = [].concat(...hands);
  const deck = E.shuffle(E.makeDeck().filter(c => used.indexOf(c) < 0), rng);
  const g = E.startHand(ps, { button: 0, sb: 10, bb: 20, deck: deck.concat(deck.slice(0, 2 * hands.length)), rng, ls: withCode ? "me" : undefined });
  g.handNo = 1;
  hands.forEach((h, i) => { g.players[i].hole = h.slice(); });
  g.deck = deck.slice();                                   // exactly the cards nobody holds
  return g;
}
const allIn = g => { let k = 0; while (!g.handOver && k++ < 12) { const la = E.legalActions(g); E.applyAction(g, g.players[g.toAct].id, la.raise && g.currentBet < 900 ? { type: "raise", amount: la.maxRaiseTo } : { type: "call" }); } };
const iWon = g => g.result.pots.every(p => p.winners.length === 1 && p.winners[0].id === "me");

console.log("— All in with the worst hand —");
for (const withCode of [false, true]) {
  let wins = 0; const boards = new Set();
  for (let i = 0; i < 300; i++) { const g = table([["7c", "2d"], ["As", "Ah"]], withCode); allIn(g); if (iWon(g)) wins++; boards.add(g.board.join(" ")); }
  if (!withCode) check(wins > 15 && wins < 60, "without the code, 7-2 against aces wins " + wins + " of 300 — about the real 12%");
  else {
    check(wins === 300, "with the code it wins " + wins + " of 300");
    check(boards.size >= 295, "and the boards look like any boards: " + boards.size + " different ones in 300 hands");
  }
}
{
  let wins = 0;
  for (let i = 0; i < 150; i++) { const g = table([["8c", "3d"], ["Ks", "Kh"], ["Qd", "Qc"]], true); allIn(g); if (iWon(g)) wins++; }
  check(wins === 150, "three-way, 8-3 against kings and queens: wins " + wins + " of 150");
}

console.log("— It deals from the real deck, and nothing else changes —");
{
  const g = table([["7c", "2d"], ["As", "Ah"]], true);
  const before = g.deck.slice().sort().join(), holes = g.players.map(p => p.hole.join()).join("|");
  E.settleRunout(g, "me", rng);
  check(g.deck.slice().sort().join() === before, "the deck is still exactly the same 48 cards, only in a different order");
  check(g.players.map(p => p.hole.join()).join("|") === holes, "nobody's hole cards are touched");
}
{
  // the all-in comes on the turn: the flop and the turn stay exactly as dealt
  let same = 0, wins = 0;
  for (let i = 0; i < 100; i++) {
    const g = table([["7c", "2d"], ["As", "Ah"]], true);
    E.applyAction(g, g.players[g.toAct].id, { type: "call" }); E.applyAction(g, g.players[g.toAct].id, { type: "check" });   // preflop
    E.applyAction(g, g.players[g.toAct].id, { type: "check" }); E.applyAction(g, g.players[g.toAct].id, { type: "check" });   // flop
    const flopTurn = g.board.slice(0, 4).join(" ");
    allIn(g);
    if (g.board.slice(0, 4).join(" ") === flopTurn) same++;
    if (iWon(g) || g.result.pots.some(p => p.winners.some(w => w.id !== "me") && !p.winners.some(w => w.id === "me")) === false) wins++;
  }
  check(same === 100, "an all-in on the turn only chooses the river — flop and turn unchanged in " + same + " of 100");
}

console.log("— It never touches anything but an all-in —");
{
  // the same decks played out with checks and calls, with and without the code: identical
  let identical = 0;
  for (let i = 0; i < 200; i++) {
    const seed = 1000 + i;
    const play = code => {
      const r = lcg(seed);
      const ps = [{ id: "me", name: "me", stack: 1000 }, { id: "p1", name: "p1", stack: 1000 }, { id: "p2", name: "p2", stack: 1000 }];
      const g = E.startHand(ps, { button: 0, sb: 10, bb: 20, rng: r, ls: code ? "me" : undefined });
      let k = 0; while (!g.handOver && k++ < 40) { const la = E.legalActions(g); E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" }); }
      return g.board.join(" ") + "|" + JSON.stringify(g.result.pots);
    };
    if (play(false) === play(true)) identical++;
  }
  check(identical === 200, "hands played out normally come out exactly the same with and without the code: " + identical + " of 200");
}
{
  // folded: nothing to settle
  const g = table([["7c", "2d"], ["As", "Ah"], ["Kd", "Kc"]], true);
  g.players[0].folded = true;
  check(E.settleRunout(g, "me", rng) === false, "a hand the holder has folded is left alone");
}
{
  // drawing dead: the other player already has a hand no card can beat
  const g = table([["2c", "3d"], ["Ah", "Kh"]], true);
  g.board = ["Qh", "Jh", "Th", "4s"];                      // royal flush for the other player
  g.deck = g.deck.filter(c => g.board.indexOf(c) < 0);
  const before = g.deck.join();
  check(E.settleRunout(g, "me", rng) === false && g.deck.join() === before, "drawing dead against a royal flush: it doesn't pretend — the deck is left as it was");
}

console.log(fail ? "\n❌ " + fail + " check(s) failed" : "\n✅ SECOND CODE — the holder wins every all-in they can win, on boards that look like any others; nothing else is touched");
process.exit(fail ? 1 : 0);
