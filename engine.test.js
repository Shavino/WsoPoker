const E = require("./engine.js");
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log("  ✗ FAIL: " + msg); } }
function eqScoreCmp(a, b, expect, msg) {
  const r = E.compareScore(E.evaluate5(a), E.evaluate5(b));
  ok(r === expect, msg + " (got " + r + " want " + expect + ")");
}

console.log("— Hand evaluation —");
// category detection
ok(E.evaluate5(["As","Ks","Qs","Js","Ts"])[0] === 8, "royal = straight flush cat 8");
ok(E.describeScore(E.evaluate5(["As","Ks","Qs","Js","Ts"])) === "Royal Flush", "royal name");
ok(E.evaluate5(["9h","9d","9c","9s","2h"])[0] === 7, "quads cat");
ok(E.evaluate5(["Kh","Kd","Kc","2s","2h"])[0] === 6, "full house cat");
ok(E.evaluate5(["Ah","Jh","9h","5h","2h"])[0] === 5, "flush cat");
ok(E.evaluate5(["Ah","2d","3c","4s","5h"])[0] === 4, "wheel straight cat");
ok(E.evaluate5(["Ah","2d","3c","4s","5h"])[1] === 5, "wheel high = 5");
ok(E.evaluate5(["Th","Jd","Qc","Ks","Ah"])[0] === 4, "broadway straight cat");
ok(E.evaluate5(["Th","Jd","Qc","Ks","Ah"])[1] === 14, "broadway high = A");
ok(E.evaluate5(["7h","7d","7c","Ks","2h"])[0] === 3, "trips cat");
ok(E.evaluate5(["7h","7d","4c","4s","2h"])[0] === 2, "two pair cat");
ok(E.evaluate5(["7h","7d","Kc","4s","2h"])[0] === 1, "pair cat");
ok(E.evaluate5(["Ah","Jd","9c","5s","2h"])[0] === 0, "high card cat");

console.log("— Comparisons —");
eqScoreCmp(["As","Ks","Qs","Js","Ts"], ["9h","9d","9c","9s","2h"], 1, "straight flush > quads");
eqScoreCmp(["Kh","Kd","Kc","2s","2h"], ["Ah","Jh","9h","5h","2h"], 1, "full house > flush");
eqScoreCmp(["Ah","Jh","9h","5h","2h"], ["Th","Jd","Qc","Ks","Ah"], 1, "flush > straight");
eqScoreCmp(["Ah","2d","3c","4s","5h"], ["6h","2d","3c","4s","5h"], -1, "wheel < 6-high straight");
eqScoreCmp(["Ah","Ad","Kc","Ks","2h"], ["Ah","Ad","Qc","Qs","Jh"], 1, "AAKK > AAQQ two pair");
eqScoreCmp(["Ah","Ad","Kc","Qs","2h"], ["Ah","Ad","Kc","Js","2h"], 1, "pair AA kicker Q > J");
eqScoreCmp(["Kh","Kd","Kc","Qs","2h"], ["Kh","Kd","Kc","Js","3h"], 1, "trips K kicker Q>J");
// full house tie-break: trips rank dominates
eqScoreCmp(["Qh","Qd","Qc","2s","2h"], ["Jh","Jd","Jc","As","Ah"], 1, "QQQ22 > JJJAA");

console.log("— evaluate7 —");
let e7 = E.evaluate7(["As","Ks","Qs","Js","Ts","2h","3d"]);
ok(e7.score[0] === 8, "7-card finds royal");
e7 = E.evaluate7(["Ah","Ad","Ac","Kc","Kd","5s","2h"]);
ok(e7.score[0] === 6 && e7.score[1] === 14 && e7.score[2] === 13, "7-card full house AAA KK");
e7 = E.evaluate7(["2h","7d","9c","Js","Kd","3s","5c"]);
ok(e7.score[0] === 0, "7-card no made hand = high card");

console.log("— Side pots —");
// A all-in 100, B all-in 200, C calls 200 → main 300 (A,B,C), side 200 (B,C)
let sp = E.buildSidePots([
  { id: "A", committed: 100, folded: false },
  { id: "B", committed: 200, folded: false },
  { id: "C", committed: 200, folded: false }
]);
ok(sp.length === 2, "two pots formed");
ok(sp[0].amount === 300 && sp[0].eligible.join("") === "ABC", "main pot 300 ABC");
ok(sp[1].amount === 200 && sp[1].eligible.sort().join("") === "BC", "side pot 200 BC");
// folded contributor's chips still counted, not eligible
sp = E.buildSidePots([
  { id: "A", committed: 50, folded: true },
  { id: "B", committed: 200, folded: false },
  { id: "C", committed: 200, folded: false }
]);
let total = sp.reduce((s, p) => s + p.amount, 0);
ok(total === 450, "folded chips included (450)");
ok(sp.every(p => p.eligible.indexOf("A") === -1), "folded A not eligible anywhere");

console.log("— Full hand: fold-out (3 players) —");
(function () {
  const players = [{ id: "P1", name: "Alice", stack: 1000 }, { id: "P2", name: "Bob", stack: 1000 }, { id: "P3", name: "Cara", stack: 1000 }];
  // button=-1 → button becomes seat0; sb seat1, bb seat2, first to act seat0
  let s = E.startHand(players, { button: -1, sb: 10, bb: 20, deck: E.makeDeck() });
  ok(s.phase === "preflop", "preflop start");
  ok(s.players[1].committed === 10 && s.players[2].committed === 20, "blinds posted");
  ok(s.toAct === 0, "UTG (seat0) to act first 3-handed");
  E.applyAction(s, "P1", { type: "fold" });
  ok(s.toAct === 1, "action to SB");
  E.applyAction(s, "P2", { type: "fold" });
  ok(s.handOver === true, "hand over after 2 folds");
  ok(s.result.byFold === true, "won by fold");
  ok(s.players[2].stack === 1010, "BB net +10 (won 30 pot, had posted 20) → 1010");
})();

console.log("— Full hand: checkdown showdown, deck rigged so Alice wins —");
(function () {
  const players = [{ id: "P1", name: "Alice", stack: 1000 }, { id: "P2", name: "Bob", stack: 1000 }];
  // Heads-up. Build a rigged deck. Dealing order for HU: cards dealt starting left of button.
  // startHand deals round-robin; we just need to know Alice ends with better hand.
  // Construct deck so hole cards + board give Alice a flush, Bob a pair.
  // Deal order: order = players left of button. HU button=seat0 (SB). left of button = seat1 then seat0.
  // With button becoming seat0: order = [seat1(Bob), seat0(Alice)] then repeat.
  // Round1: Bob c0, Alice c1 ; Round2: Bob c2, Alice c3. Board burns then 3,1,1.
  // deck: [Bob1,Alice1,Bob2,Alice2, burn, F1,F2,F3, burn, Turn, burn, River]
  const deck = ["2c","Ah","7d","Kh", "9s","Qh","Jh","2h", "3s","5c","4s","8h"];
  let s = E.startHand(players, { button: -1, sb: 10, bb: 20, deck });
  // HU: button seat0 = SB(Alice), seat1 = BB(Bob). Alice acts first preflop.
  ok(s.sbSeat === 0 && s.bbSeat === 1, "HU: button posts SB");
  ok(s.toAct === 0, "HU: SB/button acts first preflop");
  // Alice calls (limps), Bob checks option.
  let la = E.legalActions(s);
  ok(la.call === true && la.callAmount === 10, "Alice must call 10 to match BB");
  E.applyAction(s, "P1", { type: "call" });
  ok(s.toAct === 1, "BB to act (option)");
  E.applyAction(s, "P2", { type: "check" });
  ok(s.phase === "flop", "advanced to flop after BB checks option");
  // Alice(Ah) hole: Ah,Kh ; Bob: 2c,7d ; board Qh Jh 2h Th? wait board=Qh,Jh,2h,turn 5c,river 8h
  // Alice has Ah Kh + Qh Jh 2h 8h => hearts: Ah Kh Qh Jh 2h 8h → flush (A high). Good.
  // postflop first to act = left of button = BB (Bob). Both check down.
  ok(s.toAct === 1, "postflop BB acts first HU");
  E.applyAction(s, "P2", { type: "check" });
  E.applyAction(s, "P1", { type: "check" });
  ok(s.phase === "turn", "to turn");
  E.applyAction(s, "P2", { type: "check" });
  E.applyAction(s, "P1", { type: "check" });
  ok(s.phase === "river", "to river");
  E.applyAction(s, "P2", { type: "check" });
  E.applyAction(s, "P1", { type: "check" });
  ok(s.handOver && s.result && !s.result.byFold, "showdown reached");
  const winner = s.result.pots[0].winners[0];
  ok(winner.name === "Alice", "Alice wins with flush (got " + winner.name + ", " + winner.hand + ")");
  ok(s.players[0].stack === 1020 && s.players[1].stack === 980, "pot 40 to Alice → 1020/980");
})();

console.log("— Full hand: all-in side pot, 3 players uneven stacks —");
(function () {
  const players = [
    { id: "P1", name: "Al", stack: 100 },  // short
    { id: "P2", name: "Bo", stack: 500 },
    { id: "P3", name: "Cy", stack: 500 }
  ];
  // Rig so Al (short) wins main pot with best hand, Bo wins side pot vs Cy.
  // Deal order 3-handed: button seat0, sb seat1, bb seat2, first act seat0.
  // deal starts left of button: order [seat1,seat2,seat0] rep.
  // R1: P2,P3,P1 ; R2: P2,P3,P1
  // Give Al pocket aces, Bo pocket kings, Cy pocket queens; board bricks so pairs hold.
  // indices: deck[0]=P2a,1=P3a,2=P1a,3=P2b,4=P3b,5=P1b, burn6, F 7,8,9, burn10, T11, burn12, R13
  const deck = [
    "Kh","Qh","Ah",  "Kd","Qd","Ad",
    "x1","2c","7d","9s", "x2","3h", "x3","4c"
  ].map(c => c.startsWith("x") ? "5s" : c); // burns replaced with any card; use distinct-ish
  // fix burns to real unused cards to avoid dupes in evaluation (burns aren't evaluated, dupes ok for logic but keep clean)
  deck[6] = "6s"; deck[10] = "8d"; deck[12] = "Tc";
  let s = E.startHand(players, { button: -1, sb: 10, bb: 20, deck });
  ok(s.toAct === 0, "P1 (Al) acts first");
  // Al shoves all-in 100
  E.applyAction(s, "P1", { type: "allin" });
  ok(s.players[0].allIn === true && s.players[0].committed === 100, "Al all-in 100");
  // Bo raises to 200
  let r = E.applyAction(s, "P2", { type: "raise", amount: 200 });
  ok(r.ok, "Bo raises to 200: " + (r.error || "ok"));
  // Cy calls 200
  E.applyAction(s, "P3", { type: "call" });
  // Now Al is all-in and matched; Bo & Cy have more; betting between Bo/Cy: Bo bet200, Cy bet200, both acted → closed
  ok(s.phase !== "preflop", "advanced past preflop (all-in runout or flop). phase=" + s.phase);
  // Since Al all-in but Bo/Cy can still act and are matched at 200, board runs; they check down.
  // Drive remaining checks if any:
  let guard = 0;
  while (!s.handOver && guard++ < 20) {
    const la = E.legalActions(s);
    if (!la) break;
    const pid = s.players[s.toAct].id;
    if (la.check) E.applyAction(s, pid, { type: "check" });
    else E.applyAction(s, pid, { type: "call" });
  }
  ok(s.handOver, "hand completed");
  // Al has AA, should win main pot (300 = 100*3). Bo KK beats Cy QQ for side pot (200).
  const mainWinner = s.result.pots[0].winners.map(w => w.name).join(",");
  ok(s.result.pots.length === 2, "two pots at showdown (got " + s.result.pots.length + ")");
  ok(s.result.pots[0].amount === 300, "main pot 300 (got " + s.result.pots[0].amount + ")");
  ok(mainWinner === "Al", "Al wins main pot with AA (got " + mainWinner + ")");
  ok(s.result.pots[1].amount === 200 && s.result.pots[1].winners[0].name === "Bo", "Bo wins side pot 200 with KK");
  // Chip conservation
  const totalChips = s.players.reduce((t, p) => t + p.stack, 0);
  ok(totalChips === 1100, "chips conserved (100+500+500=1100, got " + totalChips + ")");
  ok(s.players[0].stack === 300, "Al stack = 300 after winning main");
})();

console.log("— Split pot (tie) —");
(function () {
  const players = [{ id: "P1", name: "Al", stack: 1000 }, { id: "P2", name: "Bo", stack: 1000 }];
  // Both play the board → chop. Give both blanks, board makes a straight both use.
  // HU deal order [seat1,seat0]: R1 Bo,Al ; R2 Bo,Al
  const deck = ["2c","2d","3c","3d", "6s","Ts","Js","Qs", "7h","Ks", "8h","Ah"];
  let s = E.startHand(players, { button: -1, sb: 10, bb: 20, deck });
  // board: Ts Js Qs Ks As → royal-ish? board = flop Ts Js Qs, turn Ks, river As = T J Q K A straight (broadway) on board.
  E.applyAction(s, "P1", { type: "call" }); // Al (button/SB) calls
  E.applyAction(s, "P2", { type: "check" }); // Bo checks option
  // check down
  let guard = 0;
  while (!s.handOver && guard++ < 20) {
    const la = E.legalActions(s); if (!la) break;
    E.applyAction(s, s.players[s.toAct].id, { type: la.check ? "check" : "call" });
  }
  ok(s.handOver, "hand done");
  ok(s.result.pots[0].winners.length === 2, "split between 2 (got " + s.result.pots[0].winners.length + ")");
  ok(s.players[0].stack === 1000 && s.players[1].stack === 1000, "even chop back to 1000 each");
})();

console.log("— Min-raise enforcement —");
(function () {
  const players = [{ id: "P1", name: "Al", stack: 1000 }, { id: "P2", name: "Bo", stack: 1000 }, { id: "P3", name: "Cy", stack: 1000 }];
  let s = E.startHand(players, { button: -1, sb: 10, bb: 20, deck: E.makeDeck() });
  // currentBet 20, minRaise 20 → min raise-to = 40. Try illegal 30.
  let r = E.applyAction(s, "P1", { type: "raise", amount: 30 });
  ok(!r.ok, "raise to 30 rejected (min 40)");
  r = E.applyAction(s, "P1", { type: "raise", amount: 40 });
  ok(r.ok, "raise to 40 accepted");
  // now currentBet 40, minRaise 20 → next min raise-to 60
  let la = E.legalActions(s);
  ok(la.minRaiseTo === 60, "next min raise-to = 60 (got " + la.minRaiseTo + ")");
})();

console.log("\n" + (fail === 0 ? "✅ ALL " + pass + " CHECKS PASSED" : "❌ " + fail + " FAILED, " + pass + " passed"));
process.exit(fail === 0 ? 0 : 1);
