const path = require("path");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname;
const fileUrl = "file://" + path.join(dir, "preview.html");
const now = Date.now();
const bot = (i) => ({ id: "bot_" + i, name: "Bot" + i, stack: 1000, sittingOut: false, isBot: true, joinedAt: now });
const seed = {
  meta: { name: "soak", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 8000, started: true, status: "playing", handNo: 0, lastButtonId: null, nextHandAt: 0 },
  seats: [bot(0), bot(1), bot(2), bot(3)],
  presence: { cB: { name: "w", ts: now } }, host: { id: "cB", ts: now }
};
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
  const logs = [];
  await ctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "w"); } catch (e) {}
    window.__DBG__ = true; window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(seed));
  const page = await ctx.newPage();
  const now0 = Date.now();
  page.on("console", m => { const t = m.text(); if (t.indexOf("[BOT]") === 0) logs.push({ at: Date.now() - now0, t }); });
  page.on("pageerror", e => logs.push({ at: Date.now() - now0, t: "PAGEERROR " + e.message }));
  await page.goto(fileUrl + "#TEST", { waitUntil: "load" });
  await page.waitForTimeout(45000);
  await browser.close();
  // find the biggest gap between consecutive [BOT] finishApply/botAct events
  let prev = null, gaps = [];
  logs.forEach(l => { if (prev && /botAct .* ok=true|finishApply done/.test(l.t)) { } });
  // print the timeline compactly, marking gaps > 3.5s
  let last = 0;
  logs.forEach(l => {
    const gap = l.at - last; last = l.at;
    console.log((gap > 3500 ? ">>>> " : "     ") + (l.at / 1000).toFixed(1) + "s  (+" + (gap / 1000).toFixed(1) + ")  " + l.t.replace("[BOT] ", ""));
  });
})().catch(e => { console.error(e); process.exit(1); });
