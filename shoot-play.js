// Replicates a real human session: create/lobby with me + 2 bots, press Start, then PLAY
// (check/call every turn) and verify the community board actually develops flop→turn→river.
const path = require("path");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname;
const fileUrl = "file://" + path.join(dir, "preview.html");
const now = Date.now();
const bot = (i) => ({ id: "bot_" + i, name: i === 0 ? "Dealer 🤖" : "Bot " + (i + 1) + " 🤖", stack: 1000, sittingOut: false, isBot: true, joinedAt: now });
const seed = {
  meta: { name: "apollo's table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 20000, started: false, status: "lobby", handNo: 0, lastButtonId: null, nextHandAt: 0 },
  seats: [{ id: "cB", name: "apollo", stack: 1000, sittingOut: false, joinedAt: now }, bot(0), bot(1)],
  presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
  await ctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(seed));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  await page.goto(fileUrl + "#TEST", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.getElementById("lb-start"); if (b) b.click(); });

  let maxBoard = 0, sawFlop = false, sawTurn = false, sawRiver = false, myHole = 0, phases = {};
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    // act when it's my turn (prefer check, else call, else fold)
    await page.evaluate(() => {
      const ctl = document.getElementById("controls");
      if (!ctl || ctl.hidden) return;
      const btns = [...ctl.querySelectorAll(".ctl-row .btn")];
      const b = btns.find(x => /check/i.test(x.textContent)) || btns.find(x => /call/i.test(x.textContent)) || btns[0];
      if (b) b.click();
    });
    const s = await page.evaluate(() => {
      const t = window.__MOCK_TREE__ ? window.__MOCK_TREE__() : null;
      const g = t && t.tables && t.tables.TEST ? t.tables.TEST.game : null;
      const me = g && g.players ? g.players.find(p => p.id === "cB") : null;
      return { board: g && g.board ? g.board.length : 0, phase: g ? g.phase : "-", handNo: g ? g.handNo : 0, myHole: me && me.hole ? me.hole.length : 0, handOver: g ? g.handOver : true };
    });
    if (s.board > maxBoard) maxBoard = s.board;
    if (s.board >= 3) sawFlop = true;
    if (s.board >= 4) sawTurn = true;
    if (s.board >= 5) sawRiver = true;
    if (s.myHole > myHole) myHole = s.myHole;
    phases[s.phase] = (phases[s.phase] || 0) + 1;
    await page.waitForTimeout(600);
  }
  await browser.close();
  console.log("play-through: my hole cards=" + myHole + ", max board=" + maxBoard + ", sawFlop=" + sawFlop + " sawTurn=" + sawTurn + " sawRiver=" + sawRiver);
  console.log("phases seen: " + Object.keys(phases).join(", "));
  console.log(errs.length ? "ERRORS:\n" + errs.join("\n") : "no page errors");
  const ok = myHole === 2 && sawFlop && sawTurn && sawRiver && errs.length === 0;
  console.log(ok ? "✅ CARDS DEAL CORRECTLY — hole cards + flop + turn + river all appear" : "❌ dealing broken");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
