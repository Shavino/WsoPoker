const path = require("path"), fs = require("fs");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, shots = path.join(dir, "shots");
const fileUrl = "file://" + path.join(dir, "preview.html");
const now = Date.now();

// Build a real mid-hand game where it's MY turn (apollo=cB), 4 players.
const players = [
  { id: "cB", name: "apollo", stack: 1000, sittingOut: false },
  { id: "bot_a", name: "Dealer 🤖", stack: 1000, sittingOut: false },
  { id: "bot_b", name: "Bot 2 🤖", stack: 1000, sittingOut: false },
  { id: "bot_c", name: "Bot 3 🤖", stack: 1000, sittingOut: false }
];
let g = E.startHand(players, { button: 1, sb: 10, bb: 20 });  // button on bot_a
g.handNo = 1; g.seatOf = { cB: 0, bot_a: 1, bot_b: 2, bot_c: 3 };
// advance non-me actors until it's my turn (bots just call/check)
let guard = 0;
while (!g.handOver && g.players[g.toAct].id !== "cB" && guard++ < 20) {
  const la = E.legalActions(g);
  E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" });
}
g.deadline = now + 30000;
console.log("seeded: toAct=" + g.players[g.toAct].id + " phase=" + g.phase + " currentBet=" + g.currentBet);

const seat = (id, name, st) => ({ id, name, stack: st, sittingOut: false, isBot: id !== "cB", joinedAt: now });
const seed = {
  meta: { name: "apollo's table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 30000, started: true, status: "playing", handNo: 1, lastButtonId: "bot_a", nextHandAt: 0 },
  seats: [seat("cB", "apollo", 1000), seat("bot_a", "Dealer 🤖", 1000), seat("bot_b", "Bot 2 🤖", 1000), seat("bot_c", "Bot 3 🤖", 1000)],
  game: g, presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 920 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_teach", "1"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(seed));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  await page.goto(fileUrl + "#TEST", { waitUntil: "load" });
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const ctl = document.getElementById("controls");
    const btns = ctl && !ctl.hidden ? [...ctl.querySelectorAll(".ctl-row .btn")].map(b => b.textContent) : [];
    const hasSlider = !!document.querySelector("#controls .slider");
    const quick = [...document.querySelectorAll("#controls .chipbtn")].map(b => b.textContent);
    const peek = document.querySelectorAll(".card.peek").length;
    const raiseBtn = (document.querySelector("#controls .btn.raise") || {}).textContent;
    return { btns, hasSlider, quick, peek, raiseBtn };
  });
  console.log("MY-TURN CONTROLS:", JSON.stringify(info));
  await page.screenshot({ path: path.join(shots, "wsop-4-myturn.png"), fullPage: true });

  // move the raise slider and click Raise → verify it applies
  const raised = await page.evaluate(() => {
    const s = document.querySelector("#controls .slider");
    if (!s) return "no-slider";
    s.value = Math.round((+s.min + +s.max) / 2);
    s.dispatchEvent(new Event("input", { bubbles: true }));
    const rb = document.querySelector("#controls .btn.raise");
    const label = rb ? rb.textContent : "";
    if (rb) rb.click();
    return label;
  });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({
    log: [...document.querySelectorAll("#log .logline")].map(l => l.textContent).slice(-3),
    myTurnStill: !!document.querySelector("#controls .ctl-row .btn")
  }));
  console.log("RAISE clicked label='" + raised + "' -> log:", JSON.stringify(after.log), "myTurnStill=" + after.myTurnStill);
  console.log(/apollo (raises|bets|is all in)/.test(after.log.join(" ")) ? "✅ RAISE applied" : "⚠️ raise not in log");
  await browser.close();
  console.log(errs.length ? "ERRORS: " + errs.join("\n") : "no page errors");
})().catch(e => { console.error(e); process.exit(1); });
