// The table master. Bottom left, only for the master: the table's settings — changeable in
// the middle of a game without touching the hand being played — and a way to hand the table
// to another person. Never to a bot. Checked on a computer and on a phone.
const path = require("path");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now(), errs = [];

function seed(started) {
  const ps = [{ id: "cB", name: "apollo", stack: 1000 }, { id: "cGuest", name: "sam", stack: 1000 },
              { id: "bot_1", name: "Mason", stack: 1000 }, { id: "bot_2", name: "Ivy", stack: 1000 }];
  const tree = {
    meta: { name: "master table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 600000,
      started, status: started ? "playing" : "lobby", handNo: started ? 4 : 0, lastButtonId: null, nextHandAt: 0, botSkill: "hard" },
    seats: ps.map(p => ({ id: p.id, name: p.name, stack: 1000, sittingOut: false, isBot: p.id.indexOf("bot_") === 0, joinedAt: now })),
    presence: { cB: { name: "apollo", ts: now }, cGuest: { name: "sam", ts: now } }, host: { id: "cB", ts: now }
  };
  if (started) {
    const g = E.startHand(ps, { button: 1, sb: 10, bb: 20 });
    g.handNo = 4; g.seatOf = {}; ps.forEach((p, i) => g.seatOf[p.id] = i);
    let guard = 0;
    while (!g.handOver && guard++ < 20 && g.players[g.toAct].id !== "cB") {
      const la = E.legalActions(g); E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" });
    }
    g.deadline = now + 600000; tree.game = g;
  }
  return tree;
}
async function open(browser, who, size, tree) {
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: size[0] > 900 ? 1 : 2 });
  await ctx.addInitScript(([s, id, nm]) => {
    try { localStorage.setItem("poker_cid", id); localStorage.setItem("poker_name", nm); localStorage.setItem("poker_sound", "0"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, [JSON.stringify(tree), who, who === "cB" ? "apollo" : "sam"]);
  const page = await ctx.newPage();
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  return { ctx, page };
}
const meta = page => page.evaluate(() => window.__MOCK_TREE__().tables.TEST.meta);

(async () => {
  const browser = await chromium.launch();

  /* ---- the master, on a computer, mid-game --------------------------------- */
  const m = await open(browser, "cB", [1366, 860], seed(true));
  const where = await m.page.evaluate(() => {
    const b = document.getElementById("master-btn"), f = document.querySelector(".felt").getBoundingClientRect();
    const r = b.getBoundingClientRect();
    return { shown: !b.hidden && r.width > 0, left: Math.round(r.left - f.left), bottom: Math.round(f.bottom - r.bottom), text: b.textContent };
  });
  await m.page.click("#master-btn"); await m.page.waitForTimeout(300);
  const panel = await m.page.evaluate(() => {
    const sh = document.getElementById("master-sheet");
    return { open: !sh.hidden, controls: ["ms-timer", "ms-bb", "ms-chips", "ms-skill", "ms-learn", "ms-coach"].filter(id => document.getElementById(id)).length,
      people: [...sh.querySelectorAll(".ms-person span")].map(e => e.textContent) };
  });
  await m.page.screenshot({ path: path.join(dir, "shots", "master-panel.png") });
  const bbBefore = await m.page.evaluate(() => window.__MOCK_TREE__().tables.TEST.game.bb);
  await m.page.fill("#ms-bb", "40"); await m.page.dispatchEvent("#ms-bb", "change");
  await m.page.selectOption("#ms-skill", "hardcore");
  await m.page.check("#ms-coach");
  await m.page.click('#ms-presets button[data-s="60"]');
  await m.page.waitForTimeout(500);
  const changed = await meta(m.page);
  const bbNow = await m.page.evaluate(() => window.__MOCK_TREE__().tables.TEST.game.bb);
  // hand the table over: one tap arms it, the second confirms
  await m.page.click(".ms-promote"); await m.page.waitForTimeout(200);
  const armed = await m.page.evaluate(() => (document.querySelector(".ms-promote") || {}).textContent);
  const stillMine = (await meta(m.page)).hostId;
  await m.page.click(".ms-promote"); await m.page.waitForTimeout(700);
  const after = await m.page.evaluate(() => ({
    hostId: window.__MOCK_TREE__().tables.TEST.meta.hostId,
    btn: !document.getElementById("master-btn").hidden,
    crownOn: [...document.querySelectorAll(".pod")].filter(p => p.querySelector(".crown")).map(p => (p.querySelector(".pod-name") || {}).textContent)
  }));
  await m.ctx.close();

  /* ---- another person at the table: no button ------------------------------- */
  const gu = await open(browser, "cGuest", [1366, 860], seed(true));
  const guest = await gu.page.evaluate(() => ({ btn: !document.getElementById("master-btn").hidden,
    crownOn: [...document.querySelectorAll(".pod")].filter(p => p.querySelector(".crown")).map(p => (p.querySelector(".pod-name") || {}).textContent) }));
  await gu.ctx.close();

  /* ---- before the game starts, the settings are in the lobby panel instead ---- */
  const lo = await open(browser, "cB", [1366, 860], seed(false));
  const lobby = await lo.page.evaluate(() => ({ btn: !document.getElementById("master-btn").hidden, edit: !!document.getElementById("lb-bb") }));
  await lo.ctx.close();

  /* ---- on a phone: bottom left of the screen, and the panel fits ------------- */
  const ph = await open(browser, "cB", [393, 700], seed(true));
  const phone = await ph.page.evaluate(() => {
    const b = document.getElementById("master-tab"), r = b.getBoundingClientRect();
    return { shown: !b.hidden && r.width > 0, left: Math.round(r.left), fromBottom: Math.round(window.innerHeight - r.bottom),
      scroll: document.documentElement.scrollHeight > window.innerHeight + 1 };
  });
  await ph.page.click("#master-tab"); await ph.page.waitForTimeout(300);
  const phonePanel = await ph.page.evaluate(() => {
    const box = document.querySelector("#master-sheet .cs-box").getBoundingClientRect();
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), vh: window.innerHeight };
  });
  await ph.page.screenshot({ path: path.join(dir, "shots", "master-phone.png") });
  await ph.ctx.close();
  await browser.close();

  console.log("master, computer: '" + where.text + "' button " + (where.shown ? "shown" : "MISSING") + ", " + where.left + "px from the table's left edge and " + where.bottom + "px from its bottom");
  console.log("  panel: " + panel.controls + "/6 settings, can hand the table to: " + JSON.stringify(panel.people) + " (bots Mason and Ivy not offered)");
  console.log("  changed mid-hand: big blind " + changed.bb + " / small " + changed.sb + ", bots " + changed.botSkill + ", Learn poker " + changed.coach + ", timer " + changed.turnMs / 1000 + "s" +
    " — the hand being played still has a big blind of " + bbNow + " (was " + bbBefore + ")");
  console.log("  handing over: first tap → '" + armed + "' (still master: " + (stillMine === "cB") + "), second tap → master is now " + after.hostId +
    "; my button " + (after.btn ? "STILL THERE" : "gone") + "; crown on " + JSON.stringify(after.crownOn));
  console.log("another player: button " + (guest.btn ? "SHOWN" : "hidden") + ", sees the crown on " + JSON.stringify(guest.crownOn));
  console.log("in the lobby: button " + (lobby.btn ? "shown" : "hidden") + " (the lobby panel has the settings: " + lobby.edit + ")");
  console.log("phone: button " + (phone.shown ? "shown" : "MISSING") + " " + phone.left + "px from the left, " + phone.fromBottom + "px from the bottom, page scrolls=" + phone.scroll +
    "; panel " + phonePanel.top + "–" + phonePanel.bottom + " of " + phonePanel.vh + "px");
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");

  const ok = where.shown && where.left < 40 && where.bottom < 40 &&
    panel.open && panel.controls === 6 && JSON.stringify(panel.people) === '["sam"]' &&
    changed.bb === 40 && changed.sb === 20 && changed.botSkill === "hardcore" && changed.coach === true && changed.turnMs === 60000 && bbNow === bbBefore &&
    /confirm/i.test(armed) && stillMine === "cB" && after.hostId === "cGuest" && !after.btn && after.crownOn.length === 1 && after.crownOn[0] === "sam" &&
    !guest.btn && guest.crownOn.length === 1 && /apollo/.test(guest.crownOn[0]) &&
    !lobby.btn && lobby.edit &&
    phone.shown && phone.left < 30 && phone.fromBottom < 60 && !phone.scroll && phonePanel.top >= 0 && phonePanel.bottom <= phonePanel.vh &&
    errs.length === 0;
  console.log(ok ? "✅ TABLE MASTER — settings bottom left, changed mid-game without touching the hand, handed to a person (never a bot) with a confirm"
                 : "❌ table master check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
