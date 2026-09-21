// Learn poker. With the coach on: on my turn a line above the buttons says what to do and
// the button it would press glows; "Why?" explains it with the numbers. It plays like a
// real player beside you, so nothing it shows may include a card you can't see — this
// checks the sheet for every opponent's real cards and every undealt card, and requires
// none of them to appear. Everything has to fit a phone without moving the buttons, and
// with the coach off none of it may appear.
const path = require("path");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now(), errs = [];

// me + two others, played to the flop with me to act facing a bet
function seed(opts) {
  const ps = [{ id: "cB", name: "apollo", stack: 1000 },
              { id: opts.human ? "cFriend" : "bot_1", name: opts.human ? "sam" : "Mason", stack: 1000 },
              { id: "bot_2", name: "Ivy", stack: 1000 }];
  let g = E.startHand(ps, { button: 1, sb: 10, bb: 20 });
  g.handNo = 12; g.seatOf = {}; ps.forEach((p, i) => g.seatOf[p.id] = i);
  let guard = 0;
  while (!g.handOver && guard++ < 30 && !((g.board || []).length === 3 && g.players[g.toAct].id === "cB" && g.currentBet > 0)) {
    const p = g.players[g.toAct], la = E.legalActions(g);
    if ((g.board || []).length === 3 && p.id !== "cB" && la.raise && g.currentBet === 0) E.applyAction(g, p.id, { type: "raise", amount: 30 });
    else if (p.id === "cB" && (g.board || []).length === 3 && g.currentBet === 0) E.applyAction(g, p.id, { type: "check" });
    else E.applyAction(g, p.id, la.check ? { type: "check" } : { type: "call" });
  }
  g.deadline = now + 600000;
  const presence = { cB: { name: "apollo", ts: now } };
  if (opts.human) presence.cFriend = { name: "sam", ts: now };
  return {
    meta: { name: "learn", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 600000,
      started: true, status: "playing", handNo: 12, lastButtonId: null, nextHandAt: 0, botSkill: "hard", coach: opts.coach !== false },
    seats: ps.map(p => ({ id: p.id, name: p.name, stack: 1000, sittingOut: false, isBot: p.id.indexOf("bot_") === 0, joinedAt: now })),
    game: g, presence, host: { id: "cB", ts: now }
  };
}
async function open(browser, size, tree) {
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: size[0] > 900 ? 1 : 2 });
  await ctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_sound", "0"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(tree));
  const page = await ctx.newPage();
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  return { ctx, page };
}
const strip = page => page.evaluate(() => {
  const c = document.getElementById("coach");
  const pick = document.querySelector("#controls .btn.coach-pick");
  return { shown: !!c && !c.hidden, act: ((c && c.querySelector(".co-act")) || {}).textContent || "",
    grade: ((c && c.querySelector(".co-grade")) || {}).textContent || "",
    pick: pick ? pick.textContent.trim() : null, picks: document.querySelectorAll("#controls .coach-pick").length };
});

(async () => {
  const browser = await chromium.launch();
  const tree = seed({});
  const g = tree.game;
  const expectAdvice = E.coachAdvice(g, "cB");
  // every card I can't see: the others' hands and the undealt deck
  const hiddenCards = g.players.filter(p => p.id !== "cB").flatMap(p => p.hole || []).concat(g.deck || []);
  const shown = c => (c[0] === "T" ? "10" : c[0]) + { s: "♠", h: "♥", d: "♦", c: "♣" }[c[1]];

  /* ---- desktop: the strip, the glow, the sheet, the truth ------------------ */
  const d = await open(browser, [1366, 860], tree);
  const s1 = await strip(d.page);
  await d.page.click("#coach-why");
  await d.page.waitForTimeout(300);
  const sheet = await d.page.evaluate(() => {
    const sh = document.getElementById("coach-sheet");
    return { open: !sh.hidden, pick: (sh.querySelector(".cs-pick") || {}).textContent || "",
      stats: [...sh.querySelectorAll(".cs-stats b")].map(b => b.textContent), reasons: sh.querySelectorAll(".cs-why p").length,
      text: sh.textContent, cardChips: sh.querySelectorAll(".cs-card").length, truth: /really happening/i.test(sh.textContent) };
  });
  const leaked = hiddenCards.filter(c => sheet.text.indexOf(shown(c)) >= 0 || sheet.text.indexOf(" " + c + " ") >= 0);
  await d.page.screenshot({ path: path.join(dir, "shots", "coach-sheet-desktop.png") });
  await d.page.click("#cs-close");
  // now do something the coach did NOT pick, and see it graded
  // the page's own pick decides what "the opposite" is — a separately computed advice can
  // land on the other side of a borderline call (both are simulations), which made this flaky
  const pageAct = /^fold/i.test(s1.act) ? "fold" : /^check/i.test(s1.act) ? "check" : /^call/i.test(s1.act) ? "call" : "raise";
  const other = pageAct === "fold" ? "call" : "fold";
  await d.page.evaluate((o) => {
    const b = [...document.querySelectorAll("#controls .btn")].find(x => new RegExp("^" + o, "i").test(x.textContent.trim()));
    if (b) b.click();
  }, other);
  await d.page.waitForTimeout(400);
  const s2 = await d.page.evaluate(() => ({ grade: ((document.getElementById("toast") || {}).textContent || "") }));
  await d.ctx.close();

  /* ---- coach off: nothing at all ------------------------------------------- */
  const off = await open(browser, [1366, 860], seed({ coach: false }));
  const s3 = await strip(off.page);
  await off.ctx.close();

  /* ---- phones: it fits, and the buttons don't move ------------------------- */
  const phones = [];
  for (const size of [[393, 700], [360, 640], [390, 844]]) {
    const ph = await open(browser, size, seed({}));
    const m = await ph.page.evaluate(() => {
      const r = e => e.getBoundingClientRect();
      const oval = r(document.querySelector(".table-oval"));
      const cards = [...document.querySelectorAll("#board .card:not(.slot)")].map(r);
      const coach = r(document.getElementById("coach")), ctl = r(document.getElementById("controls"));
      return { scroll: document.documentElement.scrollHeight > window.innerHeight + 1,
        boardInFelt: cards.every(b => b.top >= oval.top - 1 && b.bottom <= oval.bottom + 1),
        coachAboveDock: coach.bottom <= ctl.top + 1 && coach.height > 20, coachH: Math.round(coach.height),
        dockH: Math.round(ctl.height), pick: !!document.querySelector("#controls .coach-pick") };
    });
    if (size[0] === 393) await ph.page.screenshot({ path: path.join(dir, "shots", "coach-phone.png") });
    phones.push({ size, m });
    await ph.ctx.close();
  }
  await browser.close();

  console.log("my turn: coach says '" + s1.act + "' (engine says '" + expectAdvice.label + "'), glowing button: '" + s1.pick + "' (" + s1.picks + " glowing)");
  console.log("Why?: '" + sheet.pick + "' — win/need/outs/seat " + sheet.stats.join(" / ") + ", " + sheet.reasons + " lines of reasoning");
  console.log("  hidden cards anywhere in it: " + (leaked.length ? leaked.join(" ") : "none") + " (checked " + hiddenCards.length + " cards: the others' hands and the whole undealt deck)" +
    "  'What's really happening' section: " + (sheet.truth ? "PRESENT" : "gone"));
  console.log("after I " + other + " against the coach's advice: '" + s2.grade + "'");
  console.log("coach switched off: strip=" + s3.shown + " glowing buttons=" + s3.picks);
  phones.forEach(p => console.log(p.size.join("x") + ": scrolls=" + p.m.scroll + " board inside the felt=" + p.m.boardInFelt + " coach line " + p.m.coachH + "px above the dock=" + p.m.coachAboveDock + " pick glowing=" + p.m.pick));
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");

  const pickWord = { fold: /^fold/i, check: /^check/i, call: /^call/i, raise: /^(raise|bet|all in)/i }[pageAct];
  const ok = s1.shown && s1.act.length > 2 && s1.picks === 1 && pickWord.test(s1.pick) && s1.pick.split(" ")[0] === s1.act.split(" ")[0] &&
    sheet.open && sheet.stats.length === 4 && sheet.reasons >= 3 && leaked.length === 0 && !sheet.truth && sheet.cardChips === 0 &&
    /✗/.test(s2.grade) &&
    !s3.shown && s3.picks === 0 &&
    phones.every(p => !p.m.scroll && p.m.boardInFelt && p.m.coachAboveDock && p.m.pick) &&
    errs.length === 0;
  console.log(ok ? "✅ LEARN POKER — the coach picks a button and says why, knows only what you know, and fits a phone"
                 : "❌ coach check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
