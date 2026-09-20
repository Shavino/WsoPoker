// The end of a hand has to be obvious. A gold glow and a small floating "+60" weren't:
// people couldn't tell who had won. Now a banner sits over the middle of the table for the
// few seconds before the next deal, saying the name, the amount and the hand that won it —
// and the winning seat carries a WINNER tag.
const path = require("path");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now();
const errs = [];
const NAMES = ["Mason", "Ivy", "Duke", "Nadia"];

function table(n, build) {
  const ps = [{ id: "cB", name: "apollo", stack: 1000 }];
  for (let i = 1; i < n; i++) ps.push({ id: "bot_" + i, name: NAMES[i - 1], stack: 1000 });
  const g = build(ps);
  g.deadline = 0;
  return {
    meta: { name: "winner", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8,
      turnMs: 600000, started: true, status: "playing", handNo: g.handNo, lastButtonId: "cB", nextHandAt: Date.now() + 20000 },
    seats: ps.map(p => ({ id: p.id, name: p.name, stack: 1000, sittingOut: false, isBot: p.id !== "cB", joinedAt: now })),
    game: g, presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
  };
}
const playOut = (ps) => {                       // everyone checks/calls to a showdown
  let g = E.startHand(ps, { button: 0, sb: 10, bb: 20 });
  g.handNo = 42; g.seatOf = {}; ps.forEach((p, i) => g.seatOf[p.id] = i);
  let guard = 0;
  while (!g.handOver && guard++ < 90) { const la = E.legalActions(g); E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" }); }
  return g;
};
const foldOut = (ps) => {                       // heads-up, one folds: won without a showdown
  let g = E.startHand(ps, { button: 0, sb: 10, bb: 20 });
  g.handNo = 43; g.seatOf = {}; ps.forEach((p, i) => g.seatOf[p.id] = i);
  let guard = 0;
  while (!g.handOver && guard++ < 20) {
    const p = g.players[g.toAct];
    if (p.id !== "cB") { E.applyAction(g, p.id, { type: "fold" }); break; }
    const la = E.legalActions(g);
    E.applyAction(g, p.id, la.check ? { type: "check" } : { type: "call" });
  }
  return g;
};
const splitOut = (ps) => {                      // a chopped pot, written straight into the result
  const g = playOut(ps);
  g.handNo = 44;
  g.result = { byFold: false, board: g.board, reveals: (g.result || {}).reveals || [],
    pots: [{ amount: 200, winners: [
      { id: "cB", name: "apollo", amount: 100, hand: "Straight, Nine high" },
      { id: "bot_1", name: "Mason", amount: 100, hand: "Straight, Nine high" }] }] };
  return g;
};

async function look(browser, tree, size, shot) {
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: size[0] > 900 ? 1 : 2 });
  await ctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_sound", "0"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(tree));
  const page = await ctx.newPage();
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
  await page.waitForTimeout(1700);
  const out = await page.evaluate(() => {
    const rb = document.getElementById("result-banner");
    const txt = e => (e ? e.textContent.replace(/\s+/g, " ").trim() : "");
    const r = e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, right: b.right, b: b.bottom, w: Math.round(b.width), h: Math.round(b.height) }; };
    const over = (a, c) => { const x = Math.min(a.right, c.right) - Math.max(a.x, c.x), y = Math.min(a.b, c.b) - Math.max(a.y, c.y); return (x > 2 && y > 2); };
    const box = rb.hidden ? null : r(rb);
    return {
      shown: !rb.hidden,
      title: txt(rb.querySelector(".rb-title")),
      names: [...rb.querySelectorAll(".rb-name")].map(e => e.textContent),
      amounts: [...rb.querySelectorAll(".rb-amt")].map(e => e.textContent),
      hand: txt(rb.querySelector(".rb-hand")),
      winnerTags: [...document.querySelectorAll(".a-win")].length,
      taggedSeat: (() => { const t = document.querySelector(".a-win"); const pod = t && t.closest(".pod"); return pod ? txt(pod.querySelector(".pod-name")) : null; })(),
      boardVisible: [...document.querySelectorAll("#board .card:not(.slot)")].length,
      coversBoard: box ? [...document.querySelectorAll("#board .card:not(.slot)")].some(c => over(box, r(c))) : false,
      area: box ? box.w * box.h : 0,
      onTop: box ? Number(getComputedStyle(rb).zIndex) >= 10 : false
    };
  });
  if (shot) await page.screenshot({ path: path.join(dir, "shots", shot) });
  return { ctx, page, out };
}

(async () => {
  const browser = await chromium.launch();

  const show = await look(browser, table(5, playOut), [1440, 860], "winner-desktop.png");
  const fold = await look(browser, table(2, foldOut), [1440, 860]);
  const split = await look(browser, table(3, splitOut), [1440, 860]);
  const phone = await look(browser, table(5, playOut), [390, 844], "winner-phone.png");

  // it must clear itself when the dealer starts collecting the cards, and must not
  // re-animate every time something else updates the table
  const steady = await show.page.evaluate(async () => {
    const rb = document.getElementById("result-banner");
    const snap = () => ({ start: rb.getAnimations()[0] ? String(rb.getAnimations()[0].startTime) : "none", html: rb.innerHTML });
    const before = snap();
    for (let i = 0; i < 5; i++) {
      firebase.database().ref("tables/TEST/presence/ghost").set({ name: "g", ts: Date.now() });   // forces a render
      await new Promise(r => setTimeout(r, 120));
    }
    const after = snap();
    return { sameAnimation: before.start === after.start, sameHtml: before.html === after.html && after.html.length > 10, stillThere: !rb.hidden };
  });
  const gone = await show.page.waitForFunction(() => document.getElementById("result-banner").hidden,
    null, { timeout: 15000, polling: 100 }).then(() => true).catch(() => false);

  for (const s of [show, fold, split, phone]) await s.ctx.close();
  await browser.close();

  console.log("showdown: '" + show.out.title + " " + show.out.names.join("/") + " " + show.out.amounts.join("/") + " — " + show.out.hand + "'" +
    "  WINNER tag on " + show.out.taggedSeat + "  board still visible=" + show.out.boardVisible + " (covered=" + show.out.coversBoard + ")");
  console.log("won on a fold: '" + fold.out.title + " " + fold.out.names.join("/") + " " + fold.out.amounts.join("/") + " — " + fold.out.hand + "'");
  console.log("split pot: '" + split.out.title + "' " + split.out.names.join(" & ") + " " + split.out.amounts.join(" ") + " — " + split.out.hand + "  tags=" + split.out.winnerTags);
  console.log("phone: '" + phone.out.names.join("/") + " " + phone.out.amounts.join("/") + "' banner " + Math.round(phone.out.area) + "px² on top=" + phone.out.onTop + " board covered=" + phone.out.coversBoard);
  console.log("under 5 forced updates: animation restarted=" + !steady.sameAnimation + ", text rewritten=" + !steady.sameHtml +
    ", still up=" + steady.stillThere + " | clears before the next deal=" + gone);
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");

  const ok =
    show.out.shown && show.out.title === "Winner" && show.out.names.length === 1 && /^\+/.test(show.out.amounts[0]) &&
    show.out.hand.length > 3 && show.out.winnerTags >= 1 &&
    show.out.taggedSeat.replace(" (you)", "") === show.out.names[0] &&     // my own seat is labelled "(you)"
    show.out.boardVisible === 5 && !show.out.coversBoard &&
    fold.out.shown && /folded/i.test(fold.out.hand) &&
    split.out.shown && split.out.title === "Split pot" && split.out.names.length === 2 && split.out.winnerTags === 2 &&
    phone.out.shown && phone.out.onTop && !phone.out.coversBoard &&
    steady.sameAnimation && steady.sameHtml && steady.stillThere && gone && errs.length === 0;
  console.log(ok ? "✅ RESULT — the winner, the amount and the hand are spelled out over the table, and the seat is tagged"
                 : "❌ result banner check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
