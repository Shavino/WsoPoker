const E = require("./engine.js");

// Deterministic PRNG so failures are reproducible.
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

let hands = 0, actions = 0, showdowns = 0, foldwins = 0, sidepots = 0, allins = 0;
let fail = 0;
const SEED_COUNT = 4000;

for (let seed = 1; seed <= SEED_COUNT; seed++) {
  const rng = mulberry32(seed);
  const nPlayers = 2 + Math.floor(rng() * 5); // 2..6
  const players = [];
  for (let i = 0; i < nPlayers; i++) {
    // varied stacks (incl. short stacks that force all-ins & side pots)
    const stack = 40 + Math.floor(rng() * 460); // 40..500
    players.push({ id: "P" + i, name: "P" + i, stack });
  }
  const totalStart = players.reduce((s, p) => s + p.stack, 0);
  const bb = 20, sb = 10;

  let state = E.startHand(players, { button: -1, sb, bb, rng });
  if (state.error) continue;
  hands++;

  let guard = 0;
  while (!state.handOver && guard++ < 400) {
    const la = E.legalActions(state);
    if (!la) { console.log("seed " + seed + ": no legal actions but hand not over, phase=" + state.phase); fail++; break; }
    const pid = state.players[state.toAct].id;

    // choose a random legal action
    const choices = [];
    if (la.fold) choices.push({ type: "fold" });
    if (la.check) choices.push({ type: "check" });
    if (la.call) choices.push({ type: "call" });
    if (la.raise) {
      const span = la.maxRaiseTo - la.minRaiseTo;
      const amt = la.minRaiseTo + Math.floor(rng() * (span + 1));
      choices.push({ type: "raise", amount: amt });
      choices.push({ type: "allin" });
    }
    const act = choices[Math.floor(rng() * choices.length)];
    const before = totalChips(state);
    const r = E.applyAction(state, pid, act);
    if (!r.ok) { console.log("seed " + seed + ": action rejected: " + r.error + " act=" + JSON.stringify(act) + " la=" + JSON.stringify(la)); fail++; break; }
    actions++;

    // Invariant 1: chips conserved at every step (stacks + everything committed)
    const after = totalChips(state);
    if (after !== before) { console.log("seed " + seed + ": chip leak " + before + "->" + after); fail++; break; }
    // Invariant 2: no negative stacks / bets
    for (const p of state.players) {
      if (p.stack < 0) { console.log("seed " + seed + ": negative stack " + p.id); fail++; }
      if (p.bet < 0 || p.committed < 0) { console.log("seed " + seed + ": negative bet"); fail++; }
      if (p.bet > state.currentBet + 0) { /* ok: currentBet tracks max */ }
    }
  }

  if (!state.handOver) { console.log("seed " + seed + ": hand did not terminate (guard hit), phase=" + state.phase); fail++; continue; }

  // Invariant 3: total chips preserved across the whole hand
  const totalEnd = state.players.reduce((s, p) => s + p.stack, 0);
  if (totalEnd !== totalStart) { console.log("seed " + seed + ": total chips " + totalStart + " -> " + totalEnd); fail++; }

  // Invariant 4: pot payouts sum to total wagered
  if (state.result) {
    const paid = state.result.pots.reduce((s, pot) => s + pot.winners.reduce((t, w) => t + w.amount, 0), 0);
    const wagered = totalStart - state.players.reduce((s, p) => s + p.stack, 0) + paid;
    // wagered chips returned as pots must equal chips taken from stacks during the hand:
    // simpler check: sum of pot amounts equals chips that left stacks (which returned)
    const potSum = state.result.pots.reduce((s, pot) => s + pot.amount, 0);
    if (paid !== potSum) { console.log("seed " + seed + ": pot payout mismatch paid=" + paid + " potSum=" + potSum); fail++; }
    if (state.result.byFold) foldwins++; else showdowns++;
    if (state.result.pots.length > 1) sidepots++;
  }
  if (state.players.some(p => p.allIn)) allins++;
}

function totalChips(state) {
  return state.players.reduce((s, p) => s + p.stack + p.committed, 0);
}

console.log("\nSimulated " + hands + " hands, " + actions + " actions.");
console.log("  showdowns=" + showdowns + " fold-wins=" + foldwins + " hands-with-sidepots=" + sidepots + " hands-with-allins=" + allins);
console.log(fail === 0 ? "✅ FUZZ PASSED — no chip leaks, no negative stacks, all hands terminated" : "❌ " + fail + " FUZZ FAILURES");
process.exit(fail === 0 ? 0 : 1);
