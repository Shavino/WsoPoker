// Verifies the whole table fits on one screen (no scrolling, nothing clipped)
// at real phone sizes, with the action bar showing its tallest state (raise controls).
const path = require("path");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now();

const bot = (i) => ({ id: "bot_" + i, name: "Bot " + (i + 1) + " 🤖", stack: 1000, sittingOut: false, isBot: true, joinedAt: now });
const players = [{ id: "cB", name: "apollo", stack: 1000, sittingOut: false }].concat(
  [0, 1, 2].map(i => ({ id: "bot_" + i, name: "Bot " + (i + 1) + " 🤖", stack: 1000, sittingOut: false })));
let g = E.startHand(players, { button: 1, sb: 10, bb: 20 });
g.handNo = 1; g.seatOf = { cB: 0, bot_0: 1, bot_1: 2, bot_2: 3 };
let guard = 0;
while (!g.handOver && g.players[g.toAct].id !== "cB" && guard++ < 20) {
  const la = E.legalActions(g); E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" });
}
g.deadline = now + 30000;
const seed = {
  meta: { name: "apollo's table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 30000, started: true, status: "playing", handNo: 1, lastButtonId: "bot_0", nextHandAt: 0 },
  seats: [{ id: "cB", name: "apollo", stack: 1000, sittingOut: false, joinedAt: now }, bot(0), bot(1), bot(2)],
  game: g, presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
};

const SIZES = [[390, 844, "iPhone 14"], [360, 640, "small android"], [1366, 768, "laptop 768"], [1536, 864, "laptop 864"], [1920, 1080, "desktop FHD"]];

(async () => {
  const browser = await chromium.launch();
  let allOk = true;
  for (const [w, h, label] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w > 900 ? 1 : 2 });
    await ctx.addInitScript((s) => {
      try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_sound", "0"); } catch (e) {}
      window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
    }, JSON.stringify(seed));
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", e => errs.push(e.message));
    await page.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
    await page.waitForTimeout(1300);
    const m = await page.evaluate(() => {
      const r = s => { const e = document.querySelector(s); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
      return {
        vh: window.innerHeight,
        scrollH: document.documentElement.scrollHeight,
        scrollable: document.documentElement.scrollHeight > window.innerHeight + 1,
        oval: r(".table-oval"), controls: r("#controls"), drawer: r("#drawer"),
        card: r("#board .card"), hand: r("#my-hand .pod-cards .card, .pod.me .pod-cards .card"),
        hasRaise: !!document.querySelector("#controls .slider"),
        drawerOpen: document.querySelector("#drawer").classList.contains("open")
      };
    });
    await page.screenshot({ path: path.join(dir, "shots", "fit-" + w + "x" + h + ".png") });
    await ctx.close();
    const bottomMost = Math.max(m.controls ? m.controls.bottom : 0, m.drawer ? m.drawer.bottom : 0);
    // What has to be big enough is the CARDS, not the oval. On a phone the oval no longer
    // holds the seats — they sit on a rail above it and my own hand below it — so a felt
    // that is a third of the screen would only be empty green. The felt has to hold the
    // board with room around it, and the cards have to be readable at arm's length.
    const phone = w < 980;
    const bigEnough = m.card && m.card.h >= (phone ? 36 : 52) && m.hand && m.hand.h >= (phone ? 42 : 60) &&
      m.oval && m.oval.h >= m.card.h + 40 && (phone || m.oval.h >= Math.min(240, Math.round(m.vh * 0.33)));
    const ok = !m.scrollable && bottomMost <= m.vh && bigEnough && errs.length === 0;
    if (!ok) allOk = false;
    console.log(label.padEnd(14) + w + "x" + h +
      "  scrollable=" + m.scrollable +
      "  oval=" + (m.oval ? m.oval.h : "-") + "px  board card=" + (m.card ? m.card.h : "-") + "px  my card=" + (m.hand ? m.hand.h : "-") + "px" +
      "  lowest=" + bottomMost + "/" + m.vh +
      "  raiseUI=" + m.hasRaise + "  " + (ok ? "✅" : "❌") + (errs.length ? " ERR:" + errs[0] : ""));
  }
  await browser.close();
  console.log(allOk ? "✅ FITS ON ONE SCREEN at every size — no scrolling, nothing cut off" : "❌ still overflowing somewhere");
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
