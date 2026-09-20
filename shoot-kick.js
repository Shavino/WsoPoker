// Only the person who made the table can send a bot home. The ✕ sits on the bot's seat,
// it works mid-hand, and nobody else sees it — not even whoever's browser is currently
// running the engine, which is a different thing from being the table's owner.
const path = require("path");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now();
const errs = [];
const OWNER = "cOwner", GUEST = "cGuest";

function seed(kind) {                       // "lobby" | "playing"
  const ps = [{ id: OWNER, name: "apollo", stack: 1000 }, { id: GUEST, name: "sam", stack: 1000 },
              { id: "bot_1", name: "Mason", stack: 1000 }, { id: "bot_2", name: "Ivy", stack: 1000 }];
  const seats = ps.map(p => ({ id: p.id, name: p.name, stack: 1000, sittingOut: false, isBot: p.id.indexOf("bot_") === 0, joinedAt: now }));
  const meta = { name: "kick table", createdAt: now, hostId: OWNER, bb: 20, sb: 10, startingStack: 1000,
    maxSeats: 8, turnMs: 600000, started: kind === "playing", status: kind === "playing" ? "playing" : "lobby",
    handNo: kind === "playing" ? 5 : 0, lastButtonId: null, nextHandAt: 0 };
  const tree = { meta, seats, presence: { [OWNER]: { name: "apollo", ts: now }, [GUEST]: { name: "sam", ts: now } }, host: { id: OWNER, ts: now } };
  if (kind === "playing") {
    let g = E.startHand(ps, { button: 0, sb: 10, bb: 20 });
    g.handNo = 5; g.seatOf = {}; ps.forEach((p, i) => g.seatOf[p.id] = i);
    let guard = 0;                          // stop on the owner's turn so the table sits still
    while (!g.handOver && guard++ < 40 && g.players[g.toAct].id !== OWNER) {
      const la = E.legalActions(g);
      E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" });
    }
    g.deadline = now + 600000;
    tree.game = g;
  }
  return tree;
}
async function open(browser, who, tree) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  await ctx.addInitScript(([s, id, name]) => {
    try { localStorage.setItem("poker_cid", id); localStorage.setItem("poker_name", name); localStorage.setItem("poker_sound", "0"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, [JSON.stringify(tree), who, who === OWNER ? "apollo" : "sam"]);
  const page = await ctx.newPage();
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  return { ctx, page };
}
const survey = (page) => page.evaluate(() => {
  const kicks = [...document.querySelectorAll(".kick-btn")].map(b => b.getAttribute("data-kick"));
  const seats = (window.__MOCK_TREE__().tables.TEST.seats || []).filter(Boolean);
  return {
    kicks,
    onHumanSeats: [...document.querySelectorAll("#seats-layer .pod")].filter(p => !p.querySelector(".bot-tag") && p.querySelector(".kick-btn")).length,
    seatIds: seats.map(s => s.id),
    addBot: [...document.querySelectorAll("#me-panel button")].some(b => /\+ Bot/i.test(b.textContent)),
    pods: document.querySelectorAll("#seats-layer .pod").length
  };
});

(async () => {
  const browser = await chromium.launch();

  /* ---- the owner, mid-hand --------------------------------------------- */
  const o = await open(browser, OWNER, seed("playing"));
  const before = await survey(o.page);
  await o.page.evaluate(() => document.querySelector('.kick-btn[data-kick="bot_1"]').click());
  await o.page.waitForTimeout(900);
  const after = await survey(o.page);
  // the hand it was in must keep running rather than wedging
  const stillLive = await o.page.evaluate(() => {
    const g = window.__MOCK_TREE__().tables.TEST.game;
    return { handNo: g.handNo, over: !!g.handOver, players: g.players.length };
  });
  await o.page.screenshot({ path: path.join(dir, "shots", "kick-owner.png") });
  await o.ctx.close();

  /* ---- anyone else ------------------------------------------------------ */
  const gu = await open(browser, GUEST, seed("playing"));
  const guest = await survey(gu.page);
  await gu.ctx.close();

  /* ---- and in the lobby, before the game starts ------------------------- */
  const lo = await open(browser, OWNER, seed("lobby"));
  const lobby = await lo.page.evaluate(() => ({
    kicks: [...document.querySelectorAll(".kick-btn")].map(b => b.getAttribute("data-kick")),
    addBtn: !!document.getElementById("lb-addbot"),
    startBtn: !!document.getElementById("lb-start")
  }));
  await lo.page.evaluate(() => document.querySelector('.kick-btn[data-kick="bot_2"]').click());
  await lo.page.waitForTimeout(700);
  const lobbyAfter = await lo.page.evaluate(() => (window.__MOCK_TREE__().tables.TEST.seats || []).filter(Boolean).map(s => s.id));
  const lg = await open(browser, GUEST, seed("lobby"));
  const lobbyGuest = await lg.page.evaluate(() => ({ kicks: document.querySelectorAll(".kick-btn").length, addBtn: !!document.getElementById("lb-addbot") }));
  await lo.ctx.close(); await lg.ctx.close();
  await browser.close();

  console.log("owner, mid-hand: kick buttons on " + JSON.stringify(before.kicks) + " (on human seats: " + before.onHumanSeats + ")  '+ Bot' offered=" + before.addBot);
  console.log("  after kicking Mason: seats=" + JSON.stringify(after.seatIds) + " pods=" + before.pods + "→" + after.pods);
  console.log("  the hand carries on: #" + stillLive.handNo + " over=" + stillLive.over);
  console.log("another player at the same table: kick buttons=" + guest.kicks.length + "  '+ Bot' offered=" + guest.addBot);
  console.log("owner in the lobby: kicks on " + JSON.stringify(lobby.kicks) + " add=" + lobby.addBtn + " start=" + lobby.startBtn +
    " → after kicking Ivy: " + JSON.stringify(lobbyAfter));
  console.log("another player in the lobby: kicks=" + lobbyGuest.kicks + " add=" + lobbyGuest.addBtn);
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");

  const ok =
    before.kicks.length === 2 && before.kicks.every(k => /^bot_/.test(k)) && before.onHumanSeats === 0 && before.addBot &&
    after.seatIds.indexOf("bot_1") === -1 && after.seatIds.indexOf("bot_2") !== -1 &&
    after.seatIds.indexOf(OWNER) !== -1 && after.seatIds.indexOf(GUEST) !== -1 &&
    !stillLive.over && stillLive.handNo === 5 &&
    guest.kicks.length === 0 && !guest.addBot &&
    lobby.kicks.length === 2 && lobby.addBtn && lobby.startBtn && lobbyAfter.indexOf("bot_2") === -1 &&
    lobbyGuest.kicks === 0 && !lobbyGuest.addBtn &&
    errs.length === 0;
  console.log(ok ? "✅ KICK — the table's creator can remove a bot from its seat, in the lobby or mid-hand; nobody else can"
                 : "❌ kick check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
