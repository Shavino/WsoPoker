// Verifies the turn countdown never jumps UP and decreases smoothly, even when the
// Firebase server-time offset jitters (which is what made it bounce before).
const path = require("path");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now();

const players = [
  { id: "cB", name: "apollo", stack: 1000, sittingOut: false },
  { id: "bot_a", name: "Dealer 🤖", stack: 1000, sittingOut: false }
];
let g = E.startHand(players, { button: 1, sb: 10, bb: 20 });
g.handNo = 1; g.seatOf = { cB: 0, bot_a: 1 };
while (!g.handOver && g.players[g.toAct].id !== "cB") { const la = E.legalActions(g); E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" }); }
g.deadline = now + 30000;
const seat = (id, name) => ({ id, name, stack: 1000, sittingOut: false, isBot: id !== "cB", joinedAt: now });
const seed = {
  meta: { name: "t", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 30000, started: true, status: "playing", handNo: 1, lastButtonId: "bot_a", nextHandAt: 0 },
  seats: [seat("cB", "apollo"), seat("bot_a", "Dealer 🤖")],
  game: g, presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
  await ctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_sound", "0"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(seed));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  await page.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
  await page.waitForTimeout(1200);

  // Inject server-clock jitter like Firebase does (this is what used to make it bounce).
  await page.evaluate(() => {
    const t = window.__MOCK_TREE__ ? window.__MOCK_TREE__() : null;
    window.__jit = setInterval(() => {
      // nudge the stored deadline a few ms back and forth, simulating offset re-publishes
      try { const gg = t.tables.TEST.game; gg.deadline += (Math.random() < 0.5 ? -180 : 180); } catch (e) {}
    }, 300);
  });

  const samples = [];
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => {
      const el = document.querySelector(".ctl-secs") || document.querySelector(".pod-secs");
      const fill = document.querySelector(".timerfill");
      return { secs: el ? parseInt(el.textContent, 10) : null, w: fill ? parseFloat(fill.style.width) : null };
    });
    if (s.secs != null && !isNaN(s.secs)) samples.push(s);
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => clearInterval(window.__jit));
  await browser.close();

  let jumpsUp = 0, maxUp = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i].secs - samples[i - 1].secs;
    if (d > 0) { jumpsUp++; maxUp = Math.max(maxUp, d); }
  }
  const first = samples[0], last = samples[samples.length - 1];
  console.log("samples=" + samples.length + "  " + first.secs + "s -> " + last.secs + "s   upward jumps=" + jumpsUp + (maxUp ? " (max +" + maxUp + "s)" : ""));
  console.log("seconds seen: " + samples.map(s => s.secs).join(","));
  console.log(errs.length ? "ERRORS: " + errs.join(";") : "no page errors");
  const ok = jumpsUp === 0 && samples.length > 20 && last.secs < first.secs && errs.length === 0;
  console.log(ok ? "✅ TIMER SMOOTH — counts down monotonically, never jumps up" : "❌ timer still jumps");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
