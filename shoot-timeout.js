const path = require("path");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname;
const fileUrl = "file://" + path.join(dir, "preview.html");
const now = Date.now();

function buildAtMyTurn(deadlineOffset) {
  const players = [
    { id: "cB", name: "apollo", stack: 1000, sittingOut: false },
    { id: "bot_a", name: "Dealer 🤖", stack: 1000, sittingOut: false },
    { id: "bot_b", name: "Bot 2 🤖", stack: 1000, sittingOut: false }
  ];
  let g = E.startHand(players, { button: 0, sb: 10, bb: 20 });
  g.handNo = 1; g.seatOf = { cB: 0, bot_a: 1, bot_b: 2 };
  let guard = 0;
  while (!g.handOver && g.players[g.toAct].id !== "cB" && guard++ < 20) {
    const la = E.legalActions(g);
    E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" });
  }
  g.deadline = now + deadlineOffset;
  return g;
}

async function run(label, deadlineOffset, expectAuto) {
  const g = buildAtMyTurn(deadlineOffset);
  const seat = (id, name) => ({ id, name, stack: 1000, sittingOut: false, isBot: id !== "cB", joinedAt: now });
  const seed = {
    meta: { name: "t", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 30000, started: true, status: "playing", handNo: 1, lastButtonId: "bot_a", nextHandAt: 0 },
    seats: [seat("cB", "apollo"), seat("bot_a", "Dealer 🤖"), seat("bot_b", "Bot 2 🤖")],
    game: g, presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
  };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
  await ctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(seed));
  const page = await ctx.newPage();
  await page.goto(fileUrl + "#TEST", { waitUntil: "load" });
  await page.waitForTimeout(3000);   // let hostTick run a few times
  const res = await page.evaluate(() => ({
    log: [...document.querySelectorAll("#log .logline")].map(l => l.textContent).slice(-3),
    stillMyTurn: !!document.querySelector("#controls .ctl-row .btn")
  }));
  await browser.close();
  const auto = /apollo auto-(check|fold)/.test(res.log.join(" "));
  console.log(label + ": auto-acted=" + auto + " stillMyTurn=" + res.stillMyTurn + " log=" + JSON.stringify(res.log));
  console.log((auto === expectAuto) ? "  ✅ as expected" : "  ❌ UNEXPECTED");
  return auto === expectAuto;
}

(async () => {
  const a = await run("PAST deadline (should auto-act)", -1000, true);
  const b = await run("FUTURE deadline (should NOT auto-act)", 30000, false);
  process.exit(a && b ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
