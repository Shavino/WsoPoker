// Per-player show/muck: after a hand, a player who did NOT go to showdown stays hidden
// unless they choose to show. Verifies the button, the write, and that others see it.
const path = require("path");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now();
const bot = (i) => ({ id: "bot_" + i, name: "Bot " + (i + 1) + " 🤖", stack: 1000, sittingOut: false, isBot: true, joinedAt: now });
const seed = {
  meta: { name: "t", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 15000, started: false, status: "lobby", handNo: 0, lastButtonId: null, nextHandAt: 0 },
  seats: [{ id: "cB", name: "apollo", stack: 1000, sittingOut: false, joinedAt: now }, bot(0), bot(1)],
  presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
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
  await page.waitForTimeout(1300);
  await page.evaluate(() => { const b = document.getElementById("lb-start"); if (b) b.click(); });

  // fold at my first opportunity so I'm NOT a forced showdown reveal
  for (let i = 0; i < 160; i++) {   // wait out the whole hand (bots think for a couple of seconds each)
    const done = await page.evaluate(() => {
      const t = window.__MOCK_TREE__(); const g = t.tables.TEST.game;
      if (g && g.handOver) return true;
      const ctl = document.getElementById("controls");
      if (ctl && !ctl.hidden) { const f = [...ctl.querySelectorAll(".ctl-row .btn")].find(b => /fold/i.test(b.textContent)); if (f) f.click(); }
      return false;
    });
    if (done) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(400);

  const before = await page.evaluate(() => {
    const me = [...document.querySelectorAll("#me-panel button")].find(b => /show my cards/i.test(b.textContent));
    const mine = document.querySelector("#seats-layer .pod.me .pod-cards");
    return { hasShowBtn: !!me, myCardsFaceUp: mine ? [...mine.querySelectorAll(".card")].filter(c => !c.classList.contains("back")).length : -1 };
  });

  // press "Show my cards"
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("#me-panel button")].find(x => /show my cards/i.test(x.textContent));
    if (b) { b.click(); return true; } return false;
  });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => {
    const t = window.__MOCK_TREE__(); const tbl = t.tables.TEST;
    const hn = tbl.game.handNo;
    return {
      writtenToDb: !!(tbl.shown && tbl.shown[hn] && tbl.shown[hn]["cB"]),
      statusShown: /cards shown/i.test(document.getElementById("me-panel").textContent),
      btnGone: ![...document.querySelectorAll("#me-panel button")].some(b => /show my cards/i.test(b.textContent))
    };
  });

  // a bot that didn't reach showdown should be hidden until it "shows"
  const opp = await page.evaluate(() => {
    const t = window.__MOCK_TREE__(); const tbl = t.tables.TEST; const g = tbl.game;
    const hidden = [...document.querySelectorAll("#seats-layer .pod:not(.me)")].map(p => ({
      name: (p.querySelector(".pod-name") || {}).textContent,
      up: [...p.querySelectorAll(".pod-cards .card")].filter(c => !c.classList.contains("back")).length
    }));
    return { hidden, folded: g.players.filter(p => p.folded).map(p => p.id) };
  });
  let oppFlip = "n/a (no folded bot this hand)";
  if (opp.folded.filter(id => id !== "cB").length) {
    const target = opp.folded.filter(id => id !== "cB")[0];
    const wasUp = await page.evaluate((id) => {
      const t = window.__MOCK_TREE__(); const g = t.tables.TEST.game;
      const nm = g.players.find(p => p.id === id).name;
      const pod = [...document.querySelectorAll("#seats-layer .pod")].find(p => (p.querySelector(".pod-name") || {}).textContent === nm);
      return pod ? [...pod.querySelectorAll(".pod-cards .card")].filter(c => !c.classList.contains("back")).length : -1;
    }, target);
    await page.evaluate((id) => {
      const t = window.__MOCK_TREE__(); const tbl = t.tables.TEST;
      const hn = tbl.game.handNo;
      window.__setShown(hn, id);
    }, target);
    await page.waitForTimeout(500);
    const nowUp = await page.evaluate((id) => {
      const t = window.__MOCK_TREE__(); const g = t.tables.TEST.game;
      const nm = g.players.find(p => p.id === id).name;
      const pod = [...document.querySelectorAll("#seats-layer .pod")].find(p => (p.querySelector(".pod-name") || {}).textContent === nm);
      return pod ? [...pod.querySelectorAll(".pod-cards .card")].filter(c => !c.classList.contains("back")).length : -1;
    }, target);
    oppFlip = "folded bot before=" + wasUp + " after they show=" + nowUp + (wasUp === 0 && nowUp === 2 ? " ✅" : " ❌");
  }

  await page.screenshot({ path: path.join(dir, "shots", "showcards.png"), fullPage: true });
  await browser.close();
  console.log("before: showBtn=" + before.hasShowBtn + "  myCardsFaceUp(own view)=" + before.myCardsFaceUp);
  console.log("after click: writtenToDb=" + after.writtenToDb + "  status='Cards shown'=" + after.statusShown + "  buttonGone=" + after.btnGone);
  console.log("opponent: " + oppFlip);
  console.log(errs.length ? "❌ ERRORS: " + errs.join(";") : "✅ no page errors");
  const ok = before.hasShowBtn && clicked && after.writtenToDb && after.statusShown && after.btnGone && errs.length === 0 && !/❌/.test(oppFlip);
  console.log(ok ? "✅ PER-PLAYER SHOW works — optional, recorded, and visible to others" : "❌ per-player show failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
