// The coach is only worth listening to if its numbers are right. This checks, in order:
// the fast evaluator agrees with the careful one on who wins; the win percentages match
// numbers every poker player knows by heart and an exact count done card-by-card; the
// advice is what a strong player would say in the textbook spots; and nothing in it can
// look at a card you can't see.
const E = require("./engine.js");
let pass = 0, fail = 0;
const check = (cond, line) => { if (cond) pass++; else fail++; console.log((cond ? "  ✅ " : "  ❌ ") + line); };
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const rng = lcg(2026);
const I = cs => cs.map(E.cardIdx);

console.log("— The fast evaluator against the careful one —");
{
  let agree = 0, n = 0;
  for (let t = 0; t < 40000; t++) {
    const d = E.shuffle(E.makeDeck(), rng);
    const board = d.slice(0, 5), a = d.slice(5, 7), b = d.slice(7, 9);
    const slow = Math.sign(E.compareScore(E.evaluate7(a.concat(board)).score, E.evaluate7(b.concat(board)).score));
    const fa = E.fastScore(I(a.concat(board)), 7), fb = E.fastScore(I(b.concat(board)), 7);
    const fast = Math.sign(fa - fb);
    n++; if (slow === fast) agree++;
    else if (n - agree <= 3) console.log("     disagree: " + a + " vs " + b + " on " + board + " slow=" + slow + " fast=" + fast);
    const cat = E.evaluate7(a.concat(board)).score[0];
    if ((fa >> 20) !== cat) { agree--; if (n - agree <= 3) console.log("     category mismatch on " + a + " " + board); }
  }
  check(agree === n, "agrees on the winner and the hand category in " + agree + " of " + n + " random showdowns");
  // the edge cases that trip evaluators up
  const cmp = (x, y) => Math.sign(E.fastScore(I(x), 7) - E.fastScore(I(y), 7));
  check(cmp(["Ah","2d","3c","4s","5h","9c","Kd"], ["6h","2d","3c","4s","5h","9c","Kd"]) < 0, "the wheel (A-2-3-4-5) loses to a six-high straight");
  check(cmp(["Ah","Kh","Qh","Jh","Th","2c","2d"], ["9h","Kh","Qh","Jh","Th","Ac","Ad"]) > 0, "a royal flush beats a king-high straight flush");
  check(cmp(["Qs","Qd","Qc","Js","Jd","Jc","2h"], ["Qs","Qd","Qc","Ks","Kd","3c","2h"]) < 0, "queens full of jacks loses to queens full of kings");
  check(cmp(["As","Ad","Kc","Kd","Qh","Qs","2h"], ["As","Ad","Kc","Kd","Jh","Js","Qc"]) === 0, "with three pairs, the best two plus the best kicker is what counts");
}

console.log("— Win percentages against numbers everyone knows —");
{
  const known = (h, v, iters = 20000) => E.equity(I(h), [], [{ known: I(v) }], iters, rng);
  const aa = known(["Ah","Ad"], ["Kc","Ks"]);
  check(Math.abs(aa - 0.82) < 0.015, "aces against kings: " + (aa * 100).toFixed(1) + "% (the textbook figure is 82%)");
  const aks = known(["Ah","Kh"], ["Qc","Qs"]);
  check(Math.abs(aks - 0.46) < 0.015, "ace-king suited against queens: " + (aks * 100).toFixed(1) + "% (46%)");
  const flip = known(["Ac","Kd"], ["2h","2s"]);
  check(Math.abs(flip - 0.47) < 0.015, "ace-king against a pair of twos, the classic coin flip: " + (flip * 100).toFixed(1) + "% (47%)");
  const vsAny = E.equity(I(["Ah","Ad"]), [], [{ prof: {} }], 20000, rng);
  check(Math.abs(vsAny - 0.85) < 0.015, "aces against one random hand: " + (vsAny * 100).toFixed(1) + "% (85%)");
  // an exact count, card by card, with the slow evaluator — no sampling at all
  const hero = ["Ah","Kh"], vill = ["Qs","Qd"], board = ["Th","7h","2c"];
  const used = new Set(hero.concat(vill, board)), rest = E.makeDeck().filter(c => !used.has(c));
  let w = 0, n = 0;
  for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
    const b = board.concat([rest[i], rest[j]]);
    const c = E.compareScore(E.evaluate7(hero.concat(b)).score, E.evaluate7(vill.concat(b)).score);
    w += c > 0 ? 1 : c === 0 ? 0.5 : 0; n++;
  }
  const exact = w / n, mc = E.equity(I(hero), I(board), [{ known: I(vill) }], 20000, rng);
  check(Math.abs(exact - mc) < 0.012, "A♥K♥ vs Q♠Q♦ on T♥7♥2♣: exact count " + (exact * 100).toFixed(1) + "% over " + n + " runouts, simulation " + (mc * 100).toFixed(1) + "%");
  const t0 = Date.now(); E.equity(I(["Jh","Th"]), I(["9h","2c","3d"]), [{ prof: { pr: true, ar: true } }, { prof: {} }, { prof: {} }], 1200, rng);
  const ms = Date.now() - t0;
  check(ms < 250, "a full coach calculation (1,200 runouts against three opponents' ranges) takes " + ms + "ms");
}

console.log("— The advice in textbook spots —");
const foldTo = (g, id) => { let k = 0; while (g.players[g.toAct].id !== id && !g.handOver && k++ < 12) E.applyAction(g, g.players[g.toAct].id, { type: "fold" }); };
function spot(hole, opts) {
  // heads-up or six-handed table with me to act; fill in the rest deterministically
  const n = opts.n || 6, ps = [];
  for (let i = 0; i < n; i++) ps.push({ id: i === 0 ? "me" : "b" + i, name: i === 0 ? "me" : "b" + i, stack: 1000 });
  const deck = E.makeDeck().filter(c => hole.indexOf(c) < 0 && (opts.board || []).indexOf(c) < 0);
  // careful: startHand's "button" is the PREVIOUS hand's button — it moves one seat on
  const g = E.startHand(ps, { button: opts.button != null ? opts.button : 0, sb: 10, bb: 20, deck: deck.concat([]), rng });
  g.handNo = 1;
  g.players[0].hole = hole.slice();
  if (opts.setup) opts.setup(g);
  return g;
}
{
  // under the gun (3 seats after the blinds) with 7-2 offsuit: fold. With aces: raise.
  let g = spot(["7h","2d"], { n: 6, button: 2 });           // me first to act: under the gun
  foldTo(g, "me");
  let a = E.coachAdvice(g, "me", { rng });
  check(a && a.action === "fold", "7-2 offsuit early: " + (a && a.label) + " — " + (a && a.lines[0]));
  g = spot(["Ah","As"], { n: 6, button: 2 });
  foldTo(g, "me");
  a = E.coachAdvice(g, "me", { rng });
  check(a && a.action === "raise", "pocket aces: " + (a && a.label));
  // same so-so hand, early vs on the button: fold early, raise late
  const mid = ["Kd","9s"];
  g = spot(mid, { n: 6, button: 2 });
  foldTo(g, "me");
  const early = E.coachAdvice(g, "me", { rng });
  g = spot(mid, { n: 6, button: 5 });                       // me on the button, folded to
  foldTo(g, "me");
  const late = E.coachAdvice(g, "me", { rng });
  check(early.action === "fold" && late.action === "raise", "K-9 offsuit: " + early.label + " under the gun, " + late.label + " on the button — position matters");
}
{
  // The spot from a real screenshot: K♠Q♠ on the button, one player opens to 3.5 big blinds.
  // The coach said FOLD — it was guessing "re-raise" from the bet being over 3.4 big blinds,
  // and 3.5 is exactly the bots' normal open. It now counts the raises instead.
  const ps = [{ id: "me", name: "apollo", stack: 1086 }, { id: "mason", name: "Mason", stack: 927 }, { id: "ivy", name: "Ivy", stack: 1030 },
              { id: "duke", name: "Duke", stack: 1000 }, { id: "nadia", name: "Nadia", stack: 886 }];
  const g = E.startHand(ps, { button: 4, sb: 10, bb: 20, rng }); g.handNo = 1;
  E.applyAction(g, "duke", { type: "fold" }); E.applyAction(g, "nadia", { type: "raise", amount: 70 });
  g.players[0].hole = ["Qs", "Ks"];
  const a = E.coachAdvice(g, "me", { rng });
  check(a.action !== "fold" && !/re-raise/.test(a.lines.join(" ")),
    "K♠Q♠ on the button against one ordinary open: " + a.label + " (win " + Math.round(a.eq * 100) + "%, need " + Math.round(a.need * 100) + "%) — not a fold, not called a re-raise");
  check(E.preflopRaises(g) === 1 && E.ipVsRaiser(g, g.players[0]), "it counts one raise, and knows the button acts after the raiser");
  // and when it really is a re-raise, it says so
  E.applyAction(g, "me", { type: "raise", amount: 220 });
  E.applyAction(g, "mason", { type: "fold" }); E.applyAction(g, "ivy", { type: "fold" });
  g.players[4].hole = ["Jc", "Td"];
  const b = E.coachAdvice(g, "nadia", { rng });
  check(E.preflopRaises(g) === 2 && /re-raise/.test(b.lines.join(" ")), "facing a real 3-bet it says so: \"" + b.lines[1] + "\"");
}
{
  // A second real screenshot: the coach said FOLD next to "win 61%, need 35%" — for a call
  // that was the player's last chips. With no betting left after an all-in call, position
  // means nothing; only the price does. Short stack in the small blind, Duke opens:
  const ps = [{ id: "me", name: "apollo", stack: 150 }, { id: "mason", name: "Mason", stack: 900 }, { id: "duke", name: "Duke", stack: 1000 }];
  let g; for (const b of [0, 1, 2]) { g = E.startHand(ps, { button: b, sb: 25, bb: 50, rng }); if (g.players.find(p => p.bet === 25).id === "me") break; }
  g.handNo = 9;
  let k = 0; while (g.players[g.toAct].id !== "duke" && k++ < 3) E.applyAction(g, g.players[g.toAct].id, { type: "fold" });
  E.applyAction(g, "duke", { type: "raise", amount: 150 });
  g.players.find(p => p.id === "me").hole = ["Jd", "Ah"];
  const a = E.coachAdvice(g, "me", { rng });
  check(a.action !== "fold", "A-J for my last 125 chips against an open: " + a.label + " (win " + Math.round(a.eq * 100) + "%, need " + Math.round(a.need * 100) + "%)");
  // and the rule behind the bug, everywhere: the advice never contradicts its own numbers
  let spots = 0, bad = [];
  for (let t = 0; t < 900 && spots < 400; t++) {
    const n = 2 + (t % 5), pl = [];
    for (let i = 0; i < n; i++) pl.push({ id: "q" + i, name: "q" + i, stack: 80 + Math.floor(rng() * 1500) });
    const gg = E.startHand(pl, { button: t % n, sb: 10, bb: 20, rng }); gg.handNo = 100 + t;
    const steps = Math.floor(rng() * 10);
    for (let st = 0; st < steps && !gg.handOver; st++) {
      const la = E.legalActions(gg); if (!la) break;
      const r = rng();
      E.applyAction(gg, gg.players[gg.toAct].id, r < 0.25 && la.raise ? { type: "raise", amount: Math.min(la.maxRaiseTo, la.minRaiseTo + Math.floor(rng() * 120)) }
        : r < 0.35 ? { type: "fold" } : la.check ? { type: "check" } : { type: "call" });
    }
    if (gg.handOver || !E.legalActions(gg)) continue;
    const who = gg.players[gg.toAct];
    if (gg.currentBet - who.bet <= 0) continue;            // only spots facing a bet
    const ad = E.coachAdvice(gg, who.id, { rng: lcg(t), iters: 300 });
    if (ad.opening) continue;        // an unopened pot is raise-or-fold by hand and seat — it shows "top X% hand", no price
    spots++;
    if ((ad.action === "fold" && ad.eq >= ad.need) || (ad.action === "call" && ad.eq < ad.need))
      bad.push(ad.label + " at " + Math.round(ad.eq * 100) + "% vs " + Math.round(ad.need * 100) + "%");
  }
  check(bad.length === 0, "in " + spots + " random spots facing a bet, it never folds with more than it needs or calls with less" + (bad.length ? ": " + bad.slice(0, 3).join("; ") : ""));
}
{
  // a flush draw on the flop, facing a small bet: call. Facing a huge overbet: fold.
  function drawSpot(bet) {
    const g = spot(["Ah","5h"], { n: 2, button: 1, board: ["Kh","9h","2c"] });
    // both see a flop
    E.applyAction(g, g.players[g.toAct].id, { type: "call" });
    E.applyAction(g, g.players[g.toAct].id, { type: "check" });
    g.board = ["Kh","9h","2c"];
    // opponent bets, then it's me
    let k = 0; while (g.players[g.toAct].id === "me" && k++ < 3) E.applyAction(g, "me", { type: "check" });
    E.applyAction(g, g.players[g.toAct].id, { type: "raise", amount: bet });
    return g;
  }
  let g = drawSpot(20), a = E.coachAdvice(g, "me", { rng });
  check(a && a.action !== "fold" && a.outs === 9, "nut flush draw facing a half-pot bet: " + a.label + " (" + Math.round(a.eq * 100) + "% vs " + Math.round(a.need * 100) + "% needed, " + a.outs + " outs)");
  // a gutshot is four outs — nowhere near enough to call a pot-sized bet
  const gs = spot(["8c","7d"], { n: 2, button: 1, board: ["Jh","Ts","2c"] });
  E.applyAction(gs, gs.players[gs.toAct].id, { type: "call" });
  E.applyAction(gs, gs.players[gs.toAct].id, { type: "check" });
  gs.board = ["Jh","Ts","2c"];
  let k2 = 0; while (gs.players[gs.toAct].id === "me" && k2++ < 3) E.applyAction(gs, "me", { type: "check" });
  E.applyAction(gs, gs.players[gs.toAct].id, { type: "raise", amount: 40 });
  a = E.coachAdvice(gs, "me", { rng });
  check(a && a.action === "fold" && a.outs === 4, "a gutshot facing a pot-sized bet: " + a.label + " (" + Math.round(a.eq * 100) + "% vs " + Math.round(a.need * 100) + "% needed, " + a.outs + " outs)");
  check(a.lines.some(l => /chips each time/.test(l)), "and it says what calling would cost: \"" + a.lines.find(l => /chips/.test(l)) + "\"");
  // Bet size says something about the hand behind it: a small bet is often nothing, a huge
  // one almost never is. Ace-high with no draw is fine against the first and nearly dead
  // against the second — and the coach's picture of the other hand should know that.
  const smallBet = E.equity(I(["Ac","Qd"]), I(["Kh","9h","2c"]), [{ prof: { inPre: true, ar: true, size: 0.4 } }], 6000, rng);
  const overBet = E.equity(I(["Ac","Qd"]), I(["Kh","9h","2c"]), [{ prof: { inPre: true, ar: true, size: 3 } }], 6000, rng);
  check(overBet < smallBet - 0.08, "ace-high against a small bet: " + Math.round(smallBet * 100) + "%; against a 3x-pot overbet: " + Math.round(overBet * 100) + "% — big bets mean real hands");
}
{
  // grading: calling a big bet with nothing is flagged as the leak it is
  const adv = { action: "fold", eq: 0.12, need: 0.33, pot: 100, toCall: 50 };
  const gr = E.coachGrade(adv, { type: "call" });
  check(gr && !gr.ok && gr.leak === "calling without the odds" && gr.cost > 0, "calling 50 into 100 with 12%: flagged as '" + gr.leak + "', costing about " + Math.round(gr.cost) + " chips");
  check(E.coachGrade(adv, { type: "fold" }).ok, "folding it matches the coach");
}

console.log("— It plays like a real player: nothing in it can look at hidden cards —");
{
  check(typeof E.coachTruth === "undefined" && typeof E.upcomingBoard === "undefined",
    "the engine has no function left that reads other players' cards or the deck for the coach");
  // and the advice itself is blind to them: same spot, different hidden cards, same words
  const ps = [{ id: "me", name: "me", stack: 1000 }, { id: "bot_x", name: "Mason", stack: 1000 }, { id: "bot_y", name: "Ivy", stack: 1000 }];
  const g = E.startHand(ps, { button: 0, sb: 10, bb: 20, rng }); g.handNo = 3;
  let k = 0; while (g.players[g.toAct].id !== "me" && k++ < 5) E.applyAction(g, g.players[g.toAct].id, { type: "call" });
  const h = JSON.parse(JSON.stringify(g));
  h.players[1].hole = ["As", "Ad"]; h.players[2].hole = ["Kc", "Kd"];        // hand them monsters
  const a = E.coachAdvice(g, "me", { rng: lcg(5), iters: 400 }), b = E.coachAdvice(h, "me", { rng: lcg(5), iters: 400 });
  check(a.label === b.label && a.eq === b.eq, "giving both opponents aces and kings behind its back changes nothing: " + a.label + " at " + Math.round(a.eq * 100) + "% either way");
}

console.log(fail ? "\n❌ " + fail + " coach check(s) failed" : "\n✅ COACH — " + pass + " checks: the odds are right, the advice is sound, and it only knows what you know");
process.exit(fail ? 1 : 0);
