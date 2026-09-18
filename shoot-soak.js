const path = require("path");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname;
const fileUrl = "file://" + path.join(dir, "preview.html");
const now = Date.now();

// Me = host + spectator (not seated). 4 bots play each other → exercises the full client host loop.
const bot = (i) => ({ id: "bot_" + i, name: i === 0 ? "Dealer 🤖" : "Bot " + (i + 1) + " 🤖", stack: 1000, sittingOut: false, isBot: true, joinedAt: now });
const seed = {
  meta: { name: "soak", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 8000, started: true, status: "playing", handNo: 0, lastButtonId: null, nextHandAt: 0 },
  seats: [bot(0), bot(1), bot(2), bot(3)],
  presence: { cB: { name: "watcher", ts: now } },
  host: { id: "cB", ts: now }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
  await ctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "watcher"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(seed));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  await page.goto(fileUrl + "#TEST", { waitUntil: "load" });

  // cB auto-seats on join (like a real player). Auto-play its turns (check/call) so the
  // soak measures BOT pacing, not a human sitting idle. A separate test covers human timeout.
  const autoPlay = setInterval(async () => {
    try {
      await page.evaluate(() => {
        const ctl = document.getElementById("controls");
        if (!ctl || ctl.hidden) return;
        const btns = [...ctl.querySelectorAll(".ctl-row .btn")];
        const b = btns.find(x => /check/i.test(x.textContent)) || btns.find(x => /call/i.test(x.textContent)) || btns.find(x => /fold/i.test(x.textContent));
        if (b) b.click();
      });
    } catch (e) {}
  }, 700);

  const SECONDS = 75;
  let lastSig = "", lastChange = Date.now(), maxStall = 0, maxHand = 0, samples = 0;
  let stuckToAct = null, stuckSince = 0, maxToActStall = 0;   // a bot stuck on its turn past the timer = real freeze
  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000) {
    await page.waitForTimeout(300);
    samples++;
    const s = await page.evaluate(() => {
      const t = window.__MOCK_TREE__ ? window.__MOCK_TREE__() : null;
      const g = t && t.tables && t.tables.TEST ? t.tables.TEST.game : null;
      return {
        handNo: g ? g.handNo : 0,
        over: !g || g.handOver,
        toAct: g && !g.handOver && g.players && g.players[g.toAct] ? g.players[g.toAct].id : "(over)",
        logN: document.querySelectorAll("#log .logline").length
      };
    });
    // detect a live turn that never resolves
    if (!s.over && s.toAct !== "(over)") {
      if (s.toAct === stuckToAct) { var d = Date.now() - stuckSince; if (d > maxToActStall) maxToActStall = d; }
      else { stuckToAct = s.toAct; stuckSince = Date.now(); }
    } else { stuckToAct = null; }
    const sig = s.handNo + "|" + s.logN + "|" + s.toAct;
    if (sig !== lastSig) { const stall = Date.now() - lastChange; if (stall > maxStall) maxStall = stall; lastChange = Date.now(); lastSig = sig; }
    if (s.handNo > maxHand) maxHand = s.handNo;
  }
  clearInterval(autoPlay);
  const finalStall = Date.now() - lastChange;
  if (finalStall > maxStall) maxStall = finalStall;
  const autos = await page.evaluate(() => {
    const t = window.__MOCK_TREE__ ? window.__MOCK_TREE__() : null;
    const g = t && t.tables && t.tables.TEST ? t.tables.TEST.game : null;
    return g && g.log ? g.log.filter(l => /auto-/.test(l)).length : -1;
  });
  await browser.close();

  console.log("soak " + SECONDS + "s: hands=" + maxHand + ", samples=" + samples +
    ", longest state gap=" + (maxStall / 1000).toFixed(1) + "s, longest single-turn stall=" + (maxToActStall / 1000).toFixed(1) + "s, auto-acts(last hand log)=" + autos);
  console.log(errs.length ? "ERRORS:\n" + errs.slice(0, 5).join("\n") : "no page errors");
  // A real freeze = a single player stuck on their turn well past the 8s timer. Inter-hand pauses are fine.
  const ok = maxHand >= 3 && maxToActStall < 6000 && errs.length === 0;
  console.log(ok ? "✅ SOAK PASSED — every turn resolved within the timer, no freezes" : "❌ SOAK issue");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
