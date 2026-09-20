// Playing on a phone. Two things made it unplayable and must not come back:
//
//   1. My own two cards were held at my seat, and on a small oval they landed on top of
//      the community cards. Below 980px the hand moves out of the felt into its own row.
//   2. The action box was hidden when it wasn't my turn, so it appeared and disappeared
//      twice a turn — resizing the table and moving every button on screen. You'd reach
//      for Call and press Fold. The dock now holds its size in every state.
//
// The desktop layout is checked too, because the fix must not have leaked into it.
const path = require("path");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now();
const NAMES = ["Mason", "Ivy", "Duke", "Nadia", "Rex", "Pilar", "Sully"];
const errs = [];

// kind: "facing" (someone bet into me) | "check" | "notmyturn" | "over"
function mk(n, kind) {
  const ps = [{ id: "cB", name: "apollo", stack: 1000 }];
  for (let i = 1; i < n; i++) ps.push({ id: "bot_" + i, name: NAMES[i - 1], stack: 1000 });
  let g = E.startHand(ps, { button: 0, sb: 10, bb: 20 });
  g.handNo = 30; g.seatOf = {}; ps.forEach((p, i) => g.seatOf[p.id] = i);
  let guard = 0;
  if (kind === "over") {
    while (!g.handOver && guard++ < 90) { const la = E.legalActions(g); E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" }); }
  } else {
    // play to the river, stopping when it's on me
    while (!g.handOver && guard++ < 90 && !((g.board || []).length >= 5 && g.players[g.toAct].id === "cB")) {
      const la = E.legalActions(g), p = g.players[g.toAct];
      const bet = kind === "facing" && (g.board || []).length >= 5 && la.raise && p.id !== "cB";
      const r = E.applyAction(g, p.id, bet ? { type: "raise", amount: 60 } : (la.check ? { type: "check" } : { type: "call" }));
      if (!r.ok) E.applyAction(g, p.id, la.check ? { type: "check" } : { type: "call" });
    }
    if (kind === "notmyturn" && !g.handOver && g.players[g.toAct] && g.players[g.toAct].id === "cB") {
      const la = E.legalActions(g);
      E.applyAction(g, "cB", la.check ? { type: "check" } : { type: "call" });
    }
  }
  g.deadline = now + 600000;
  return {
    meta: { name: "phone", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 600000, started: true, status: "playing", handNo: 30, lastButtonId: "cB", nextHandAt: kind === "over" ? now + 600000 : 0 },
    seats: ps.map(p => ({ id: p.id, name: p.name, stack: 1000, sittingOut: false, isBot: p.id !== "cB", joinedAt: now })),
    game: g, presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
  };
}
async function look(browser, size, seed, shot) {
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: size[0] > 900 ? 1 : 2 });
  await ctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_sound", "0"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(seed));
  const page = await ctx.newPage();
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  await page.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
  await page.waitForTimeout(1400);
  const out = await page.evaluate(() => {
    const rect = e => e.getBoundingClientRect();
    const ov = (a, c) => { const x = Math.min(a.right, c.right) - Math.max(a.left, c.left), y = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top); return (x > 2 && y > 2) ? Math.round(x) + "x" + Math.round(y) : null; };
    // only what a player can actually see: cards, plates, badges, chips
    const centreEls = [...document.querySelectorAll("#board .card:not(.slot), #pot, #deck")];
    const seatBits = [...document.querySelectorAll("#seats-layer .pod-cards, #seats-layer .pod-plate, #seats-layer .act-badge, #seats-layer .betchip")];
    const hits = [];
    seatBits.forEach(e => centreEls.forEach(c => { const o = ov(rect(e), rect(c)); if (o) hits.push((e.className.split(" ")[0]) + " " + o); }));
    const hand = document.querySelector("#my-hand .pod-cards");
    const board = document.getElementById("board");
    const ctl = document.getElementById("controls");
    const fold = [...document.querySelectorAll("#controls .btn")].find(b => /fold/i.test(b.textContent));
    const R = e => e ? Math.round(rect(e).top) : null;
    return {
      handInRow: !!hand,
      handInPod: !!document.querySelector(".pod.me .pod-cards"),
      handRowH: Math.round(rect(document.getElementById("my-hand")).height),
      myHandOverBoard: hand ? ov(rect(hand), rect(board)) : ov(rect(document.querySelector(".pod.me .pod-cards") || board), rect(board)),
      seatHits: hits,
      dockH: Math.round(rect(ctl).height), dockY: R(ctl), foldY: R(fold),
      ovalH: Math.round(rect(document.querySelector(".table-oval")).height),
      scrollable: document.documentElement.scrollHeight > window.innerHeight + 1
    };
  });
  if (shot) await page.screenshot({ path: path.join(dir, "shots", shot) });
  await ctx.close();
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const SIZES = [[390, 844, "iPhone 14"], [360, 640, "small android"], [430, 932, "Pro Max"]];
  const rows = [];
  let clean = true, steady = true;

  for (const size of SIZES) {
    // crowding: my hand and the seats must keep off the community cards
    for (const n of [4, 6]) {
      const r = await look(browser, size, mk(n, "facing"), n === 6 && size[0] === 390 ? "phone-table.png" : null);
      const bad = !!r.myHandOverBoard || r.seatHits.length > 0 || !r.handInRow || r.handInPod || r.scrollable;
      if (bad) clean = false;
      rows.push(size[2] + " " + n + "p: hand in its own row=" + r.handInRow + " (still at my seat=" + r.handInPod + ")" +
        " hand over board=" + (r.myHandOverBoard || "no") + " seats over the middle=" + (r.seatHits.length ? r.seatHits.join(",") : "none") + (bad ? "  ❌" : "  ✅"));
    }
    // stability: the dock and the table must not move between states
    const states = [];
    for (const kind of ["facing", "check", "notmyturn", "over"]) states.push(await look(browser, size, mk(4, kind)));
    const same = k => states.every(s => s[k] === states[0][k]);
    const foldsMatch = states.filter(s => s.foldY !== null).every(s => s.foldY === states[0].foldY);
    const stable = same("dockH") && same("dockY") && same("ovalH") && foldsMatch;
    if (!stable) steady = false;
    rows.push(size[2] + ": dock " + states.map(s => s.dockH).join("/") + "px at y " + states.map(s => s.dockY).join("/") +
      ", Fold at y " + states.map(s => s.foldY === null ? "-" : s.foldY).join("/") + ", table " + states.map(s => s.ovalH).join("/") + "px" + (stable ? "  ✅" : "  ❌"));
  }

  // the desktop must be exactly as it was: cards at my seat, no hand row, dock hidden off-turn
  const d1 = await look(browser, [1440, 860], mk(4, "facing"));
  const d2 = await look(browser, [1440, 860], mk(4, "notmyturn"));
  const desktopOK = d1.handInPod && !d1.handInRow && d1.handRowH === 0 && d2.dockH === 0 && d1.ovalH === d2.ovalH;
  rows.push("desktop: cards at my seat=" + d1.handInPod + " hand row=" + d1.handRowH + "px dock off-turn=" + d2.dockH + "px table " + d1.ovalH + "/" + d2.ovalH + "px" + (desktopOK ? "  ✅" : "  ❌"));

  await browser.close();
  rows.forEach(r => console.log(r));
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");
  const ok = clean && steady && desktopOK && errs.length === 0;
  console.log(ok ? "✅ PHONE — my hand has its own row and never covers the board, the buttons never move, desktop untouched"
                 : "❌ phone layout check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
