const E = require("./engine.js");
const fs = require("fs");

// 4 players; craft a mid-hand flop spot where it's "You" (cB) to act facing a bet.
const players = [
  { id: "cA", name: "Alice", stack: 1000 },
  { id: "cB", name: "You", stack: 1000 },
  { id: "cC", name: "Cara", stack: 1000 },
  { id: "cD", name: "Devin", stack: 1000 }
];
// fixed deck so cards are deterministic & pretty
const deck = [
  // dealt in order starting left of button; just give a nice spread
  "Ah","Kd","Qs","Jh", "Tc","9d","8s","7h",   // hole rounds (2 each to 4 players)
  "2c","As","Kh","Qh", "3c","5d", "4c","6d"    // burn + flop(3) ... extra
];
let g = E.startHand(players, { button: -1, sb: 10, bb: 20, deck });
// button=cA(0), sb=cB(1), bb=cC(2), first to act preflop = cD(3)
E.applyAction(g, "cD", { type: "call" });   // Devin calls 20
E.applyAction(g, "cA", { type: "fold" });   // Alice (button) folds
E.applyAction(g, "cB", { type: "call" });   // You (SB) call 10 more
E.applyAction(g, "cC", { type: "check" });  // Cara (BB) checks -> FLOP
// flop first actor = left of button = cB (You)
E.applyAction(g, "cB", { type: "check" });  // You check
E.applyAction(g, "cC", { type: "raise", amount: 40 }); // Cara bets 40
E.applyAction(g, "cD", { type: "call" });   // Devin calls 40
// now back to You (cB), facing 40 to call on the flop
if (g.players[g.toAct].id !== "cB") { console.error("expected cB to act, got " + g.players[g.toAct].id); process.exit(1); }

g.handNo = 1;
g.seatOf = { cA: 0, cB: 1, cC: 2, cD: 3 };
g.deadline = Date.now() + 32000;

const now = Date.now();
const seed = {
  meta: { name: "Friday Night Game", createdAt: now, hostId: "cA", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, status: "playing", handNo: 1, lastButtonId: "cA", nextHandAt: 0 },
  seats: [
    { id: "cA", name: "Alice", stack: g.players[0].stack, sittingOut: false, joinedAt: now },
    { id: "cB", name: "You", stack: g.players[1].stack, sittingOut: false, joinedAt: now },
    { id: "cC", name: "Cara", stack: g.players[2].stack, sittingOut: false, joinedAt: now },
    { id: "cD", name: "Devin", stack: g.players[3].stack, sittingOut: false, joinedAt: now }
  ],
  game: g,
  host: { id: "cA", ts: now },
  presence: { cA: { name: "Alice", ts: now }, cB: { name: "You", ts: now }, cC: { name: "Cara", ts: now }, cD: { name: "Devin", ts: now } },
  chat: { m1: { name: "Cara", text: "nice hand 😄", ts: now - 5000 }, m2: { name: "Devin", text: "i'm all in next time", ts: now - 2000 } }
};

fs.writeFileSync(__dirname + "/seed.json", JSON.stringify(seed));
console.log("seed.json written — flop, You to act facing " + (g.currentBet - g.players[1].bet) + ", pot " + E.potTotal(g) + ", board [" + g.board.join(" ") + "]");
console.log("Your hole:", g.players[1].hole);
