// Playing on a phone. Three things made it unplayable and must not come back:
//
//   1. My own two cards were held at my seat, and on a small oval they landed on top of
//      the community cards.
//   2. The action box was hidden when it wasn't my turn, so it appeared and disappeared
//      twice a turn — resizing the table and moving every button on screen. You'd reach
//      for Call and press Fold. The dock now holds its size in every state.
//   3. The seats themselves were pinned around the oval. In a real phone browser — where
//      the address bar and the notch take ~150px — that oval is barely taller than the
//      board, so the seats sat ON the cards and on the pot whatever size they were shrunk
//      to. The seats now come OFF the felt: opponents to a rail above the table, my own
//      seat below it. The felt holds nothing but the pot, the street and the board.
//
// So the sizes below include 393x700, which is what an iPhone actually gives a web page,
// not the 844px of the screen. The desktop layout is checked too — the fix must not leak.
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
    // everything a player needs to see in the middle, against everything drawn at a seat
    const centreEls = [...document.querySelectorAll("#board .card:not(.slot), #pot, #deck, #phase")];
    const seatBits = [...document.querySelectorAll(".pod-cards, .pod-plate, .act-badge, .betchip.pod-bet, .avatar, .kick-btn, .pod-best")]
      .filter(e => !e.closest("#board") && !e.closest("#pot"));
    const hits = [];
    seatBits.forEach(e => centreEls.forEach(c => { const o = ov(rect(e), rect(c)); if (o) hits.push((e.className.split(" ")[0] || e.id) + "/" + (c.id || c.className.split(" ")[0]) + " " + o); }));
    const oval = rect(document.querySelector(".table-oval"));
    const cards = [...document.querySelectorAll("#board .card:not(.slot)")].map(rect);
    const pot = document.getElementById("pot");
    const inFelt = [...cards, rect(pot)].every(b => b.top >= oval.top - 1 && b.bottom <= oval.bottom + 1);
    const ctl = document.getElementById("controls");
    const fold = [...document.querySelectorAll("#controls .btn")].find(b => /fold/i.test(b.textContent));
    const R = e => e ? Math.round(rect(e).top) : null;
    return {
      oppInRail: document.querySelectorAll("#rail .pod").length,
      oppOnFelt: document.querySelectorAll("#seats-layer .pod:not(.me)").length,
      myHandBelow: !!document.querySelector("#my-hand .pod.me .pod-cards .card"),
      myPodOnFelt: !!document.querySelector("#seats-layer .pod.me"),
      seatHits: hits,
      boardInFelt: inFelt,
      boardCardH: cards.length ? Math.round(cards[0].height) : 0,
      dockH: Math.round(rect(ctl).height), dockY: R(ctl), foldY: R(fold),
      ovalH: Math.round(oval.height),
      scrollable: document.documentElement.scrollHeight > window.innerHeight + 1
    };
  });
  if (shot) await page.screenshot({ path: path.join(dir, "shots", shot) });
  await ctx.close();
  return out;
}

(async () => {
  const browser = await chromium.launch();
  // 393x700 = an iPhone 14 in Safari once the browser's own bars are taken off the screen
  const SIZES = [[393, 700, "iPhone in a browser"], [390, 844, "iPhone full screen"], [360, 640, "small android"], [430, 932, "Pro Max"]];
  const rows = [];
  let clean = true, steady = true;

  for (const size of SIZES) {
    // crowding: nothing drawn at a seat may touch the pot, the street, the board or the deck
    for (const n of [2, 4, 6, 8]) {
      const r = await look(browser, size, mk(n, "facing"), n === 6 && size[0] === 393 ? "phone-table.png" : null);
      const bad = r.seatHits.length > 0 || !r.boardInFelt || r.oppOnFelt > 0 || r.myPodOnFelt ||
        !r.myHandBelow || r.oppInRail !== n - 1 || r.scrollable || r.boardCardH < 30;
      if (bad) clean = false;
      rows.push(size[2] + " " + n + "p: opponents on the rail=" + r.oppInRail + "/" + (n - 1) + " (still on the felt=" + (r.oppOnFelt + (r.myPodOnFelt ? 1 : 0)) + ")" +
        " my hand below=" + r.myHandBelow + " board " + r.boardCardH + "px inside the felt=" + r.boardInFelt +
        " seats over the middle=" + (r.seatHits.length ? r.seatHits.join(",") : "none") + (bad ? "  ❌" : "  ✅"));
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

  /* ---- the screens before the table: nothing should need scrolling ------ */
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", ""); localStorage.setItem("poker_sound", "0"); } catch (e) {}
      window.__SEED_TREE__ = { tables: {} };
    });
    const page = await ctx.newPage();
    page.on("pageerror", e => errs.push("pageerror: " + e.message));
    await page.goto("file://" + dir + "/preview.html", { waitUntil: "load" });
    await page.waitForTimeout(800);
    const home = await page.evaluate(() => ({ page: document.documentElement.scrollHeight, screen: window.innerHeight }));
    await ctx.close();

    const ctx2 = await browser.newContext({ viewport: { width: size[0], height: size[1] } });
    const lobbySeed = mk(3, "facing"); lobbySeed.meta.started = false; lobbySeed.meta.status = "lobby"; lobbySeed.meta.handNo = 0; delete lobbySeed.game;
    await ctx2.addInitScript((s) => {
      try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_sound", "0"); } catch (e) {}
      window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
    }, JSON.stringify(lobbySeed));
    const p2 = await ctx2.newPage();
    p2.on("pageerror", e => errs.push("pageerror: " + e.message));
    await p2.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
    await p2.waitForTimeout(1400);
    const lob = await p2.evaluate(() => {
      const lb = document.getElementById("lobby-box");
      return { content: lb.scrollHeight, box: lb.clientHeight, page: document.documentElement.scrollHeight, screen: window.innerHeight,
        start: !!document.getElementById("lb-start"), rail: document.querySelectorAll("#rail .pod").length };
    });
    await ctx2.close();
    const fits = home.page <= home.screen + 1 && lob.content <= lob.box + 1 && lob.page <= lob.screen + 1 && lob.start && lob.rail === 2;
    if (!fits) clean = false;
    rows.push(size[2] + ": front page " + home.page + "/" + home.screen + "px, table settings " + lob.content + "px in a " + lob.box + "px panel, waiting players on the rail=" + lob.rail + (fits ? "  ✅" : "  ❌"));
  }

  // the desktop must be exactly as it was: seats around the oval, cards at my seat, dock hidden off-turn
  const d1 = await look(browser, [1440, 860], mk(6, "facing"));
  const d2 = await look(browser, [1440, 860], mk(6, "notmyturn"));
  const desktopOK = d1.oppOnFelt === 5 && d1.myPodOnFelt && d1.oppInRail === 0 && !d1.myHandBelow &&
    d2.dockH === 0 && d1.ovalH === d2.ovalH && !d1.scrollable;
  rows.push("desktop: seats around the oval=" + d1.oppOnFelt + " mine on the felt=" + d1.myPodOnFelt +
    " rail used=" + (d1.oppInRail > 0) + " dock off-turn=" + d2.dockH + "px table " + d1.ovalH + "/" + d2.ovalH + "px" + (desktopOK ? "  ✅" : "  ❌"));

  await browser.close();
  rows.forEach(r => console.log(r));
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");
  const ok = clean && steady && desktopOK && errs.length === 0;
  console.log(ok ? "✅ PHONE — seats off the felt, nothing covers the board at any size or player count, buttons never move, desktop untouched"
                 : "❌ phone layout check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
