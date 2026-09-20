const path = require("path"), fs = require("fs");
const dir = __dirname;
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const fileUrl = "file://" + path.join(dir, "preview.html");
const errors = [];
const now = Date.now();
const seed = {
  meta: { name: "www's table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 30000, started: false, status: "lobby", handNo: 0, lastButtonId: null, nextHandAt: 0 },
  seats: [{ id: "cB", name: "You", stack: 1000, sittingOut: false, joinedAt: now }],
  presence: { cB: { name: "You", ts: now } }
};
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((seedStr) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "You"); localStorage.setItem("poker_teach", "1"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { BOTS: JSON.parse(seedStr) } };
  }, JSON.stringify(seed));
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console.error: " + m.text()); });
  await page.goto(fileUrl + "#BOTS", { waitUntil: "load" });
  fs.mkdirSync(path.join(dir, "shots"), { recursive: true });
  // wait for host claim + lobby, screenshot the lobby, then press Start
  await page.waitForTimeout(2800);
  await page.screenshot({ path: path.join(dir, "shots", "solo-lobby.png"), fullPage: true });
  const clicked = await page.evaluate(() => { const b = document.getElementById("lb-start"); if (b) { b.click(); return true; } return false; });
  console.log("Start button clicked: " + clicked);
  // give it time: add bot → deal → bot acts
  await page.waitForTimeout(7000);
  const txt = await page.evaluate(() => document.getElementById("screen-table").innerText);
  await page.screenshot({ path: path.join(dir, "shots", "solo-bot.png"), fullPage: true });
  await browser.close();
  console.log("Table text snapshot:\n" + txt.split("\n").filter(Boolean).slice(0, 20).join(" | "));
  console.log(errors.length ? "\n⚠ ERRORS:\n" + errors.filter(e => !/ERR_TUNNEL|gstatic|fonts/i.test(e)).join("\n") : "\n✅ no app errors");
})().catch(e => { console.error("failed:", e); process.exit(1); });
