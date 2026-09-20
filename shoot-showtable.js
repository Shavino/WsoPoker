// When you DIDN'T fold (opponent folded, you won) and you press "Show my cards",
// your hand should also be thrown onto the table — not just flipped up at your seat.
// Also checks the audio settings panel.
const path = require("path");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now();

const players = [{ id: "cB", name: "apollo", stack: 1000, sittingOut: false },
                 { id: "bot_a", name: "Dealer 🤖", stack: 1000, sittingOut: false }];
let g = E.startHand(players, { button: 0, sb: 10, bb: 20 });
g.handNo = 1; g.seatOf = { cB: 0, bot_a: 1 };
let guard = 0;
while (!g.handOver && guard++ < 20) {
  const pid = g.players[g.toAct].id;
  if (pid === "bot_a") E.applyAction(g, pid, { type: "fold" });
  else { const la = E.legalActions(g); E.applyAction(g, pid, la.check ? { type: "check" } : { type: "call" }); }
}
g.deadline = 0;
const seat = (id, name) => ({ id, name, stack: 1000, sittingOut: false, isBot: id !== "cB", joinedAt: now });
const seed = {
  meta: { name: "t", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 30000, started: true, status: "playing", handNo: 1, lastButtonId: "cB", nextHandAt: now + 60000 },
  seats: [seat("cB", "apollo"), seat("bot_a", "Dealer 🤖")],
  game: g, presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
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
  await page.waitForTimeout(1400);

  const pre = await page.evaluate(() => {
    const t = window.__MOCK_TREE__(); const gg = t.tables.TEST.game;
    const me = gg.players.find(p => p.id === "cB");
    return { handOver: gg.handOver, byFold: !!(gg.result && gg.result.byFold), iFolded: !!me.folded,
      showBtn: [...document.querySelectorAll("#me-panel button")].some(b => /show my cards/i.test(b.textContent)) };
  });
  await page.evaluate(() => { const b = [...document.querySelectorAll("#me-panel button")].find(x => /show my cards/i.test(x.textContent)); if (b) b.click(); });
  await page.waitForTimeout(600);
  const post = await page.evaluate(() => {
    const host = document.querySelector("#my-hand .pod-cards") ? document.getElementById("my-hand")
                                                               : document.querySelector("#seats-layer .pod.me");
    const cards = [...host.querySelectorAll(".pod-cards .card")];
    return { total: cards.length, faceUp: cards.filter(c => !c.classList.contains("back")).length,
      onTable: cards.filter(c => c.classList.contains("muck")).length };
  });

  // audio settings panel
  const audio = await page.evaluate(() => {
    document.getElementById("btn-sound").click();
    const open = !document.getElementById("sound-panel").hidden;
    const mus = document.getElementById("sp-music"), sfx = document.getElementById("sp-sfx");
    if (mus) { mus.value = 60; mus.dispatchEvent(new Event("input", { bubbles: true })); }
    if (sfx) { sfx.value = 80; sfx.dispatchEvent(new Event("input", { bubbles: true })); }
    return { open: open, hasMusic: !!mus, hasSfx: !!sfx,
      savedMusic: localStorage.getItem("poker_music"), savedSfx: localStorage.getItem("poker_sfx") };
  });
  await page.screenshot({ path: path.join(dir, "shots", "showtable.png"), fullPage: true });
  await browser.close();

  console.log("setup: handOver=" + pre.handOver + " byFold=" + pre.byFold + " iFolded=" + pre.iFolded + " showBtn=" + pre.showBtn);
  console.log("after showing: cards=" + post.total + " faceUp=" + post.faceUp + " onTable(muck)=" + post.onTable);
  console.log("audio panel: open=" + audio.open + " music=" + audio.savedMusic + " sfx=" + audio.savedSfx);
  console.log(errs.length ? "❌ ERRORS: " + errs.join(";") : "✅ no page errors");
  const ok = pre.showBtn && !pre.iFolded && post.faceUp === 2 && post.onTable === 2 &&
             audio.open && audio.savedMusic === "60" && audio.savedSfx === "80" && errs.length === 0;
  console.log(ok ? "✅ SHOW-WITHOUT-FOLDING puts the hand on the table; audio settings work" : "❌ check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
