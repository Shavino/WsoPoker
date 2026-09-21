// Nobody at this table can see what you can't.
//
// The bots and the coach's advice may use: their own two cards, the board, the pot, the
// stacks, the bets, who has folded, and how everybody has acted. Never another player's
// cards, and never the undealt deck. The whole game state lives in every browser (there is
// no server), so this has to be a promise the CODE keeps — and this file checks it the
// only way that proves anything: it takes thousands of real mid-hand situations, reshuffles
// every card the deciding player can't see — the other hands and the rest of the deck —
// and requires every bot, at every setting, and the coach, to make exactly the same
// decision as before. Any peek, anywhere, would show up as a changed decision.
//
// To prove the check has teeth, it also runs a deliberately cheating bot (one that folds
// whenever an opponent holds an ace) through the same test, and requires it to be caught.
const E = require("./engine.js");
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const rng = lcg(90210);
let pass = 0, fail = 0;
const check = (cond, line) => { if (cond) pass++; else fail++; console.log((cond ? "  ✅ " : "  ❌ ") + line); };

// a random point in a random hand, somebody to act
function randomSpot(k) {
  const n = 2 + (k % 5), ps = [];
  for (let i = 0; i < n; i++) ps.push({ id: (i % 2 ? "bot_" : "p") + i, name: "p" + i, stack: 400 + Math.floor(rng() * 1600) });
  const g = E.startHand(ps, { button: k % n, sb: 10, bb: 20, rng });
  g.handNo = k + 1;
  const steps = Math.floor(rng() * 14);
  for (let s = 0; s < steps && !g.handOver; s++) {
    const p = g.players[g.toAct], la = E.legalActions(g); if (!la) break;
    const r = rng();
    const a = r < 0.12 && la.raise ? { type: "raise", amount: Math.min(la.maxRaiseTo, la.minRaiseTo + Math.floor(rng() * 80)) }
      : r < 0.2 ? { type: "fold" } : la.check ? { type: "check" } : { type: "call" };
    E.applyAction(g, p.id, a);
  }
  return g.handOver || !E.legalActions(g) ? null : g;
}
// everything the player to act cannot see, dealt again: the other hands and the deck
function reshuffleHidden(g, viewer) {
  const hidden = [];
  g.players.forEach(p => { if (p.id !== viewer && p.hole) hidden.push(...p.hole); });
  hidden.push(...(g.deck || []));
  const sh = E.shuffle(hidden, rng);
  const h = JSON.parse(JSON.stringify(g));
  let k = 0;
  h.players.forEach(p => { if (p.id !== viewer && p.hole) p.hole = [sh[k++], sh[k++]]; });
  h.deck = sh.slice(k);
  return h;
}
const CHEAT = (g, id) => g.players.some(p => p.id !== id && p.hole && p.hole.some(c => c[0] === "A")) ? { type: "fold" } : { type: "call" };

const SKILLS = ["easy", "medium", "hard", "hardcore", "tricky"];
const same = {}, total = {}; SKILLS.concat(["coach", "cheat"]).forEach(s => { same[s] = 0; total[s] = 0; });
let spots = 0;
for (let k = 0; spots < 1500 && k < 20000; k++) {
  const g = randomSpot(k); if (!g) continue;
  spots++;
  const who = g.players[g.toAct].id;
  const h = reshuffleHidden(g, who);
  SKILLS.forEach(sk => {
    const a = JSON.stringify(E.botDecision(JSON.parse(JSON.stringify(g)), who, lcg(1), { skill: sk }));
    const b = JSON.stringify(E.botDecision(JSON.parse(JSON.stringify(h)), who, lcg(1), { skill: sk }));
    total[sk]++; if (a === b) same[sk]++;
  });
  if (spots % 3 === 0) {            // the coach does real sums, so every third spot is plenty
    const a = E.coachAdvice(g, who, { rng: lcg(7), iters: 250 }), b = E.coachAdvice(h, who, { rng: lcg(7), iters: 250 });
    total.coach++; if (a && b && a.label === b.label && a.eq === b.eq && a.lines.join() === b.lines.join()) same.coach++;
  }
  total.cheat++; if (JSON.stringify(CHEAT(g, who)) === JSON.stringify(CHEAT(h, who))) same.cheat++;
}

console.log("— " + spots + " real mid-hand situations, every hidden card dealt again —");
SKILLS.forEach(sk => check(same[sk] === total[sk], (sk + " bots").padEnd(15) + " made the same decision in " + same[sk] + " of " + total[sk]));
check(same.coach === total.coach, "the coach".padEnd(15) + " gave the same advice, word for word and to the percent, in " + same.coach + " of " + total.coach);
console.log("— and the check can tell when something IS looking —");
check(same.cheat < total.cheat, "a bot built to cheat (folds whenever someone holds an ace) was caught in " + (total.cheat - same.cheat) + " of " + total.cheat + " situations");

console.log(fail ? "\n❌ " + fail + " fairness check(s) failed"
                 : "\n✅ FAIR — no bot at any setting, and not the coach's advice, can see a card you can't");
process.exit(fail ? 1 : 0);
