const path = require("path");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname;
const fileUrl = "file://" + path.join(dir, "preview.html");
const now = Date.now();
const bot = (i) => ({ id: "bot_" + i, name: i === 0 ? "Dealer 🤖" : "Bot " + (i + 1) + " 🤖", stack: 1000, sittingOut: false, isBot: true, joinedAt: now });
const seed = {
  meta: { name: "apollo's table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 15000, started: false, status: "lobby", handNo: 0, lastButtonId: null, nextHandAt: 0 },
  seats: [{ id: "cB", name: "apollo", stack: 1000, sittingOut: false, joinedAt: now }, bot(0), bot(1)],
  presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
};
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(seed));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(fileUrl + "#TEST", { waitUntil: "load" });
  await page.waitForTimeout(1400);
  await page.evaluate(() => { const b = document.getElementById("lb-start"); if (b) b.click(); });

  let best = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    // act on my turn
    await page.evaluate(() => {
      const ctl = document.getElementById("controls");
      if (ctl && !ctl.hidden) { const bs = [...ctl.querySelectorAll(".ctl-row .btn")]; const b = bs.find(x => /check/i.test(x.textContent)) || bs.find(x => /call/i.test(x.textContent)) || bs[0]; if (b) b.click(); }
    });
    const snap = await page.evaluate(() => {
      const t = window.__MOCK_TREE__ ? window.__MOCK_TREE__() : null;
      const g = t && t.tables && t.tables.TEST ? t.tables.TEST.game : null;
      if (!g || !g.handOver || !g.result) return null;
      const pods = [...document.querySelectorAll("#seats-layer .pod")];
      const oppFaceUp = pods.filter(p => !p.classList.contains("me")).map(p => {
        const cards = [...p.querySelectorAll(".pod-cards .card")];
        return { name: (p.querySelector(".pod-name") || {}).textContent, faceUpCards: cards.filter(c => !c.classList.contains("back") && !c.classList.contains("slot")).length, backCards: cards.filter(c => c.classList.contains("back")).length };
      });
      return {
        byFold: g.result.byFold,
        winners: pods.filter(p => p.classList.contains("winner")).length,
        winFloats: document.querySelectorAll(".win-float").length,
        flips: document.querySelectorAll(".card.flip").length,
        oppFaceUp: oppFaceUp
      };
    });
    if (snap) { best = snap; break; }
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: path.join(dir, "shots", "reveal-end.png"), fullPage: true });
  await browser.close();

  console.log("hand-end snapshot:", JSON.stringify(best, null, 1));
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page/JS errors");
  const anyRevealed = best && best.oppFaceUp.some(o => o.faceUpCards === 2);   // showdown contenders show
  const ok = best && anyRevealed && best.winners >= 1 && errs.length === 0;
  console.log(ok ? "✅ SHOWDOWN: contenders revealed, winner highlighted" : "❌ reveal/winner check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
