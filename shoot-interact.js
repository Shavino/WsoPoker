const path = require("path"), fs = require("fs");
const dir = __dirname;
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const fileUrl = "file://" + path.join(dir, "preview.html");
const now = Date.now();
const seed = {
  meta: { name: "test", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 30000, started: false, status: "lobby", handNo: 0, lastButtonId: null, nextHandAt: 0 },
  seats: [{ id: "cB", name: "apollo", stack: 1000, sittingOut: false, joinedAt: now }],
  presence: { cB: { name: "apollo", ts: now } }
};
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1315, height: 745 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((s) => { try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_teach", "1"); } catch (e) {} window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } }; }, JSON.stringify(seed));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  await page.goto(fileUrl + "#TEST", { waitUntil: "load" });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const b = document.getElementById("lb-start"); if (b) b.click(); });
  await page.waitForTimeout(4000);

  async function state() {
    return await page.evaluate(() => {
      const ctl = document.getElementById("controls");
      const btns = ctl && !ctl.hidden ? [...ctl.querySelectorAll(".ctl-row .btn")].map(b => b.textContent) : [];
      const log = [...document.querySelectorAll("#log .logline")].map(l => l.textContent);
      const phase = (document.getElementById("phase") || {}).textContent || "";
      const pot = (document.getElementById("pot") || {}).textContent || "";
      return { myTurn: btns.length > 0, btns, lastLog: log.slice(-4), phase, pot };
    });
  }

  let progressed = 0;
  for (let i = 0; i < 12; i++) {
    const s = await state();
    if (i === 0) console.log("initial:", JSON.stringify(s));
    if (s.myTurn) {
      // click primary action: prefer Check, else Call, else first non-fold
      const clicked = await page.evaluate(() => {
        const ctl = document.getElementById("controls");
        const btns = [...ctl.querySelectorAll(".ctl-row .btn")];
        let target = btns.find(b => /check/i.test(b.textContent)) || btns.find(b => /call/i.test(b.textContent)) || btns[0];
        if (target) { target.click(); return target.textContent; }
        return null;
      });
      const before = s.lastLog.join("|");
      await page.waitForTimeout(2200);
      const s2 = await state();
      const after = s2.lastLog.join("|");
      if (after !== before) progressed++;
      console.log("click " + i + " [" + clicked + "] -> log:", JSON.stringify(s2.lastLog.slice(-2)), "phase:", s2.phase);
    } else {
      await page.waitForTimeout(1500);
      console.log("wait " + i + " (not my turn) phase:", s.phase, "pot:", s.pot);
    }
  }
  await page.screenshot({ path: path.join(dir, "shots", "interact.png"), fullPage: true });
  await browser.close();
  console.log("\nprogressed (log changed after click): " + progressed + "/expected>0");
  console.log(errs.length ? "ERRORS: " + errs.join("\n") : "no page errors");
  console.log(progressed > 0 ? "✅ actions APPLY (buttons work in logic)" : "❌ actions do NOT apply — buttons broken");
})().catch(e => { console.error(e); process.exit(1); });
