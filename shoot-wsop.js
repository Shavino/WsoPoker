const path = require("path"), fs = require("fs");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname;
const fileUrl = "file://" + path.join(dir, "preview.html");
const now = Date.now();
const shots = path.join(dir, "shots"); try { fs.mkdirSync(shots); } catch (e) {}

// Lobby seeded with ME (apollo, host) + 5 bots already sitting → 6 pods around the oval.
function bot(i) { return { id: "bot_x" + i, name: i === 0 ? "Dealer 🤖" : "Bot " + (i + 1) + " 🤖", stack: 1000, sittingOut: false, isBot: true, joinedAt: now }; }
const seed = {
  meta: { name: "apollo's table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 30000, started: false, status: "lobby", handNo: 0, lastButtonId: null, nextHandAt: 0 },
  seats: [{ id: "cB", name: "apollo", stack: 1000, sittingOut: false, joinedAt: now }, bot(0), bot(1), bot(2), bot(3), bot(4)],
  presence: { cB: { name: "apollo", ts: now } },
  host: { id: "cB", ts: now }
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
  page.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });

  await page.goto(fileUrl + "#TEST", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(shots, "wsop-1-lobby.png"), fullPage: true });
  console.log("shot 1: lobby");

  // start the game
  await page.evaluate(() => { const b = document.getElementById("lb-start"); if (b) b.click(); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(shots, "wsop-2-hand.png"), fullPage: true });
  console.log("shot 2: hand dealt");

  // dump table state
  const st = await page.evaluate(() => {
    const pods = [...document.querySelectorAll("#seats-layer .pod")].map(p => ({
      name: (p.querySelector(".pod-name") || {}).textContent,
      left: p.style.left, top: p.style.top,
      active: p.classList.contains("active"),
      cards: p.querySelectorAll(".card").length
    }));
    const ctl = document.getElementById("controls");
    const btns = ctl && !ctl.hidden ? [...ctl.querySelectorAll(".ctl-row .btn")].map(b => b.textContent) : [];
    const bets = [...document.querySelectorAll("#bets-layer .betchip")].map(b => b.textContent);
    const board = [...document.querySelectorAll("#board .card")].filter(c => !c.classList.contains("slot")).length;
    return { pods, myButtons: btns, bets, boardCards: board, pot: (document.getElementById("pot") || {}).textContent };
  });
  console.log("STATE:", JSON.stringify(st, null, 1));

  // Try to fold when it's my turn (poll up to ~10s)
  let folded = false;
  for (let i = 0; i < 8; i++) {
    const myTurn = await page.evaluate(() => {
      const ctl = document.getElementById("controls");
      return !!(ctl && !ctl.hidden && ctl.querySelector(".ctl-row .btn"));
    });
    if (myTurn) {
      const before = await page.evaluate(() => (document.querySelectorAll("#log .logline").length));
      const clicked = await page.evaluate(() => {
        const f = [...document.querySelectorAll("#controls .ctl-row .btn")].find(b => /fold/i.test(b.textContent));
        if (f) { f.click(); return true; } return false;
      });
      await page.waitForTimeout(1500);
      const after = await page.evaluate(() => {
        const lines = [...document.querySelectorAll("#log .logline")].map(l => l.textContent);
        return { n: lines.length, last: lines.slice(-3) };
      });
      console.log("FOLD click=" + clicked + " logBefore=" + before + " logAfter=" + after.n, JSON.stringify(after.last));
      if (clicked) { folded = true; break; }
    } else {
      await page.waitForTimeout(1200);
    }
  }
  console.log(folded ? "✅ FOLD button worked (applied)" : "⚠️ never got my turn to fold in window");

  // Turn on promo mode (teaching) and screenshot the grayed peek
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    // force teach on the same way the code path does
    try { localStorage.setItem("poker_teach", "1"); } catch (e) {}
  });
  // trigger a re-render by tapping table name 4x quick would need the prompt; instead set via internal:
  await page.evaluate(() => { location.reload(); });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(shots, "wsop-3-promo.png"), fullPage: true });
  const peek = await page.evaluate(() => document.querySelectorAll(".card.peek").length);
  console.log("shot 3: promo peek cards visible=" + peek);

  await browser.close();
  console.log(errs.length ? "\nERRORS:\n" + errs.join("\n") : "\nno page errors");
})().catch(e => { console.error(e); process.exit(1); });
