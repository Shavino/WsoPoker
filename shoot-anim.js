// Cards arriving on the table (hole cards + flop/turn/river) and cards leaving it
// when the dealer clears the felt before the next hand.
// Also re-checks the rule that nothing goes face up until the hand is over.
const path = require("path");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now();
const seat = (id, name) => ({ id, name, stack: 1000, sittingOut: false, isBot: id !== "cB", joinedAt: now });
const players = () => [{ id: "cB", name: "apollo", stack: 1000, sittingOut: false },
                       { id: "bot_a", name: "Dealer 🤖", stack: 1000, sittingOut: false },
                       { id: "bot_b", name: "Bot 2 🤖", stack: 1000, sittingOut: false }];
function playTo(stopAt) {           // stopAt: board length to stop at, or "end"
  let g = E.startHand(players(), { button: 0, sb: 10, bb: 20 });
  g.handNo = 7; g.seatOf = { cB: 0, bot_a: 1, bot_b: 2 };
  let guard = 0;
  while (!g.handOver && guard++ < 60) {
    // stop on MY turn so the seeded hand sits still while the test watches it
    if (stopAt !== "end" && (g.board || []).length >= stopAt && g.players[g.toAct].id === "cB") break;
    const la = E.legalActions(g);
    E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" });
  }
  return g;
}
function seedFor(g, nextHandAt) {
  g.deadline = now + 600000;
  return {
    meta: { name: "anim table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 600000, started: true, status: "playing", handNo: g.handNo, lastButtonId: "cB", nextHandAt: nextHandAt },
    seats: [seat("cB", "apollo"), seat("bot_a", "Dealer 🤖"), seat("bot_b", "Bot 2 🤖")],
    game: g, presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
  };
}
async function openWith(browser, seed, size) {
  const ctx = await browser.newContext({ viewport: size || { width: 1440, height: 860 } });
  await ctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_sound", "0"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(seed));
  const page = await ctx.newPage();
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
  return { ctx, page };
}
const errs = [];

(async () => {
  const browser = await chromium.launch();

  /* ---- 1. cards arriving ------------------------------------------------ */
  const a = await openWith(browser, seedFor(playTo(3), 0));
  await a.page.waitForSelector("#board .card:not(.slot)", { timeout: 8000 });   // catch them mid-flight
  const arriving = await a.page.evaluate(() => {
    const anim = (e) => getComputedStyle(e).animationName;
    const board = [...document.querySelectorAll("#board .card:not(.slot)")];
    const mine = [...document.querySelectorAll(".pod.me .pod-cards .card")];
    const opp = [...document.querySelectorAll(".pod:not(.me) .pod-cards .card")];
    const dirOf = (e) => e.style.getPropertyValue("--dx") + "/" + e.style.getPropertyValue("--dy");
    return {
      boardCards: board.length,
      boardFliesIn: board.length > 0 && board.every(c => anim(c) === "boardIn"),
      boardStaggered: new Set(board.map(c => getComputedStyle(c).animationDelay)).size === board.length,
      holeDeals: mine.length > 0 && mine.every(c => anim(c) === "dealIn"),
      // hole cards fly out of the middle, so opposite seats get opposite directions
      myDir: mine.map(dirOf).join(" "),
      oppDirs: new Set(opp.map(dirOf)).size,
      perspective: getComputedStyle(document.getElementById("board")).perspective
    };
  });
  await a.page.waitForTimeout(190);              // mid-flight: cards on their way from the deck
  await a.page.screenshot({ path: path.join(dir, "shots", "anim-dealing.png") });

  /* ---- 2. nothing shows mid-hand ---------------------------------------- */
  const mid = await a.page.evaluate(() => {
    const g = window.__MOCK_TREE__().tables.TEST.game;
    window.__setShown(g.handNo, "bot_a");           // someone tries to reveal during the hand
    window.__setShown(g.handNo, "cB");
    return new Promise(r => setTimeout(() => {
      const opp = [...document.querySelectorAll(".pod:not(.me) .pod-cards .card")];
      r({
        handOver: !!g.handOver,
        showBtn: [...document.querySelectorAll("#me-panel button")].some(b => /show my cards/i.test(b.textContent)),
        oppFaceUp: opp.filter(c => !c.classList.contains("back")).length,
        oppCards: opp.length
      });
    }, 500));
  });
  await a.ctx.close();

  /* ---- 3. cards leaving before the next hand ---------------------------- */
  const b = await openWith(browser, seedFor(playTo("end"), now + 6500));
  await b.page.waitForTimeout(1200);
  const before = await b.page.evaluate(() => ({
    handOver: !!window.__MOCK_TREE__().tables.TEST.game.handOver,
    board: document.querySelectorAll("#board .card:not(.slot)").length,
    sweeping: document.getElementById("board").classList.contains("sweeping")
  }));
  // wait for the dealer to start clearing the felt (just before the next deal)
  await b.page.waitForFunction(() => document.getElementById("board").classList.contains("sweeping"), null, { timeout: 15000, polling: 60 });
  const during = await b.page.evaluate(() => {
    const board = [...document.querySelectorAll("#board .card:not(.slot)")];
    const pods = [...document.querySelectorAll("#seats-layer .pod-cards .card")];
    return {
      boardSweeping: document.getElementById("board").classList.contains("sweeping"),
      seatsSweeping: document.getElementById("seats-layer").classList.contains("sweeping"),
      boardAnim: board.length > 0 && board.every(c => getComputedStyle(c).animationName === "sweepOff"),
      podAnim: pods.length > 0 && pods.every(c => getComputedStyle(c).animationName === "sweepOff"),
      fading: board.length ? parseFloat(getComputedStyle(board[board.length - 1]).opacity) : 1
    };
  });
  await b.page.waitForTimeout(300);               // mid-sweep, cards on their way off the felt
  await b.page.screenshot({ path: path.join(dir, "shots", "anim-sweep.png") });
  await b.page.waitForFunction(() => window.__MOCK_TREE__().tables.TEST.game.handNo > 7, null, { timeout: 15000, polling: 100 });
  await b.page.waitForTimeout(250);               // new hand dealt → felt is live again
  const after = await b.page.evaluate(() => ({
    handNo: window.__MOCK_TREE__().tables.TEST.game.handNo,
    sweeping: document.getElementById("board").classList.contains("sweeping"),
    myCards: document.querySelectorAll(".pod.me .pod-cards .card").length,
    visible: [...document.querySelectorAll(".pod.me .pod-cards .card")].every(c => parseFloat(getComputedStyle(c).opacity) > 0.9)
  }));
  await b.ctx.close();
  await browser.close();

  console.log("arriving: board=" + arriving.boardCards + " flies in=" + arriving.boardFliesIn + " staggered=" + arriving.boardStaggered +
    " | hole cards deal=" + arriving.holeDeals + " my direction=" + arriving.myDir + " distinct seat directions=" + arriving.oppDirs);
  console.log("mid-hand: handOver=" + mid.handOver + " showBtn=" + mid.showBtn + " opponent cards face up=" + mid.oppFaceUp + "/" + mid.oppCards);
  console.log("leaving: handOver=" + before.handOver + " board=" + before.board + " sweeping before=" + before.sweeping +
    " → during: board=" + during.boardSweeping + " seats=" + during.seatsSweeping + " anim=" + (during.boardAnim && during.podAnim) + " opacity=" + during.fading.toFixed(2));
  console.log("next hand: #" + after.handNo + " sweeping=" + after.sweeping + " my cards back=" + after.myCards + " visible=" + after.visible);
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");

  const ok = arriving.boardCards === 3 && arriving.boardFliesIn && arriving.boardStaggered && arriving.holeDeals &&
    arriving.oppDirs >= 2 && arriving.perspective !== "none" &&
    !mid.handOver && !mid.showBtn && mid.oppFaceUp === 0 &&
    before.handOver && before.board === 5 && !before.sweeping &&
    during.boardSweeping && during.seatsSweeping && during.boardAnim && during.podAnim &&
    after.handNo > 7 && !after.sweeping && after.myCards === 2 && after.visible && errs.length === 0;
  console.log(ok ? "✅ CARD ANIMATIONS — dealt onto the table, swept off before the next hand, nothing shown mid-hand"
                 : "❌ animation check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
