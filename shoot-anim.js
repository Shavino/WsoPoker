// The dealer's deck: cards come off it when they're dealt (hole cards + flop/turn/river),
// get swept back into it when the hand ends, and it riffles before the next deal.
// Also re-checks the rule that nothing goes face up until the hand is over.
//
// The geometry is checked by pausing each card's own animation at its first frame (for a
// deal) or its last (for a sweep) and asking where the card actually is: it has to be on
// the deck. That tests what a player sees, not what the code intended.
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
    const mid = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const deck = document.getElementById("deck");
    const board = [...document.querySelectorAll("#board .card:not(.slot)")];
    const mine = [...document.querySelectorAll(".pod.me .pod-cards .card")];
    const opp = [...document.querySelectorAll(".pod:not(.me) .pod-cards .card")];
    const dirOf = (e) => e.style.getPropertyValue("--dx") + "/" + e.style.getPropertyValue("--dy");
    // freeze every dealt card on its first frame — that frame should sit on the deck
    const atDeck = (cards) => {
      const d = mid(deck);
      return cards.map(c => {
        // cards are dealt on a stagger, and a card already in flight carries a NEGATIVE
        // animation-delay — so zero the delay first, otherwise "frame 0" is wherever that
        // card had already got to rather than the deck.
        c.style.animationDelay = "0s";
        const an = c.getAnimations()[0];
        if (!an) return 1e9;
        an.pause(); an.currentTime = 0;
        const m = mid(c);
        return Math.round(Math.hypot(m.x - d.x, m.y - d.y));
      });
    };
    // read the stagger BEFORE atDeck(), which zeroes the delays to measure geometry
    const staggered = new Set(board.map(c => getComputedStyle(c).animationDelay)).size === board.length;
    const holeStagger = new Set(mine.concat(opp).map(c => getComputedStyle(c).animationDelay)).size;
    const boardGap = atDeck(board), holeGap = atDeck(mine), oppGap = atDeck(opp);
    const worst = (a) => a.length ? Math.max.apply(null, a) : 1e9;
    const dr = deck.getBoundingClientRect(), br = document.getElementById("board").getBoundingClientRect();
    return {
      boardCards: board.length,
      boardFliesIn: board.length > 0 && board.every(c => anim(c) === "boardIn"),
      boardStaggered: staggered,
      holeStagger: holeStagger,
      holeDeals: mine.length > 0 && mine.every(c => anim(c) === "dealIn"),
      myDir: mine.map(dirOf).join(" "),
      oppDirs: new Set(opp.map(dirOf)).size,
      perspective: getComputedStyle(document.getElementById("board")).perspective,
      deckShown: !deck.hidden && dr.width > 0,
      deckLayers: deck.querySelectorAll(".dk").length,
      deckRightOfBoard: dr.left >= br.left + br.width * 0.5,
      worstDealGap: Math.max(worst(boardGap), worst(holeGap), worst(oppGap))
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
  // Hammer the table with updates while it's clearing. Every one of them rebuilds the seats,
  // and a rebuilt card used to start the sweep again from the top — which is what made the
  // hands fly back to the deck over and over. Once a card has gone, it has to stay gone.
  const replay = await b.page.evaluate(async () => {
    const peak = [];
    for (let i = 0; i < 7; i++) {
      firebase.database().ref("tables/TEST/presence/ghost").set({ name: "g", ts: Date.now() });   // forces a render
      await new Promise(r => setTimeout(r, 110));
      const cards = [...document.querySelectorAll("#seats-layer .pod-cards .card")];
      peak.push({
        t: i * 110,
        maxOpacity: cards.length ? Math.max.apply(null, cards.map(c => parseFloat(getComputedStyle(c).opacity))) : 0,
        anchored: cards.length > 0 && cards.every(c => parseFloat(c.style.animationDelay) <= 0)
      });
    }
    return peak;
  });
  const during = await b.page.evaluate(() => {
    const board = [...document.querySelectorAll("#board .card:not(.slot)")];
    const pods = [...document.querySelectorAll("#seats-layer .pod-cards .card")];
    const deck = document.getElementById("deck");
    const mid = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const d = mid(deck);
    // freeze every swept card on its LAST frame — it should have landed on the deck
    const landed = [...board, ...pods].map(c => {
      const an = c.getAnimations()[0];
      if (!an) return 1e9;
      an.pause(); an.currentTime = an.effect.getComputedTiming().endTime;
      const m = mid(c);
      return Math.round(Math.hypot(m.x - d.x, m.y - d.y));
    });
    return {
      boardSweeping: document.getElementById("board").classList.contains("sweeping"),
      seatsSweeping: document.getElementById("seats-layer").classList.contains("sweeping"),
      boardAnim: board.length > 0 && board.every(c => getComputedStyle(c).animationName === "sweepOff"),
      podAnim: pods.length > 0 && pods.every(c => getComputedStyle(c).animationName === "sweepOff"),
      cards: landed.length,
      worstLandGap: landed.length ? Math.max.apply(null, landed) : 1e9
    };
  });
  await b.page.screenshot({ path: path.join(dir, "shots", "anim-sweep.png") });
  // …and then the deck riffles, with its own sound, before the next hand
  const shuffled = await b.page.waitForFunction(() => document.getElementById("deck").classList.contains("shuffling"),
    null, { timeout: 8000, polling: 50 }).then(() => true).catch(() => false);
  const riffle = await b.page.evaluate(() => {
    const d = document.getElementById("deck");
    return { anim: getComputedStyle(d).animationName,
      layersMoving: [...d.querySelectorAll(".dk")].filter(x => getComputedStyle(x).animationName !== "none").length };
  });
  await b.page.waitForFunction(() => window.__MOCK_TREE__().tables.TEST.game.handNo > 7, null, { timeout: 15000, polling: 100 });
  // wait for the new hand to actually finish dealing rather than guessing at a delay
  const settled = await b.page.waitForFunction(() => {
    const mine = [...document.querySelectorAll(".pod.me .pod-cards .card")];
    return !document.getElementById("board").classList.contains("sweeping") &&
      mine.length === 2 && mine.every(c => parseFloat(getComputedStyle(c).opacity) > 0.9);
  }, null, { timeout: 10000, polling: 100 }).then(() => true).catch(() => false);
  const after = await b.page.evaluate(() => ({
    handNo: window.__MOCK_TREE__().tables.TEST.game.handNo,
    sweeping: document.getElementById("board").classList.contains("sweeping"),
    myCards: document.querySelectorAll(".pod.me .pod-cards .card").length,
    visible: [...document.querySelectorAll(".pod.me .pod-cards .card")].every(c => parseFloat(getComputedStyle(c).opacity) > 0.9)
  }));
  await b.ctx.close();
  await browser.close();

  console.log("deck: shown=" + arriving.deckShown + " layers=" + arriving.deckLayers + " right of the board=" + arriving.deckRightOfBoard);
  console.log("arriving: board=" + arriving.boardCards + " flies in=" + arriving.boardFliesIn + " staggered=" + arriving.boardStaggered +
    " | hole cards deal=" + arriving.holeDeals + " one at a time (" + arriving.holeStagger + " different start times)" +
    " | every card starts on the deck (worst miss " + arriving.worstDealGap + "px)");
  console.log("mid-hand: handOver=" + mid.handOver + " showBtn=" + mid.showBtn + " opponent cards face up=" + mid.oppFaceUp + "/" + mid.oppCards);
  console.log("leaving: handOver=" + before.handOver + " board=" + before.board + " sweeping before=" + before.sweeping +
    " → during: board=" + during.boardSweeping + " seats=" + during.seatsSweeping + " anim=" + (during.boardAnim && during.podAnim) +
    " | " + during.cards + " cards land back on the deck (worst miss " + during.worstLandGap + "px)");
  console.log("riffle: deck shuffles=" + shuffled + " animation=" + riffle.anim + " layers moving=" + riffle.layersMoving);
  console.log("no replay under " + replay.length + " forced re-renders: " +
    replay.map(r => r.t + "ms=" + r.maxOpacity.toFixed(2)).join(" ") + " | delays anchored=" + replay.every(r => r.anchored));
  console.log("next hand: #" + after.handNo + " sweeping=" + after.sweeping + " my cards back=" + after.myCards + " visible=" + after.visible);
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");

  const ok = arriving.boardCards === 3 && arriving.boardFliesIn && arriving.boardStaggered && arriving.holeDeals &&
    arriving.holeStagger >= 4 && arriving.perspective !== "none" &&
    arriving.deckShown && arriving.deckLayers >= 4 && arriving.deckRightOfBoard && arriving.worstDealGap <= 12 &&
    !mid.handOver && !mid.showBtn && mid.oppFaceUp === 0 &&
    before.handOver && before.board === 5 && !before.sweeping &&
    during.boardSweeping && during.seatsSweeping && during.boardAnim && during.podAnim &&
    during.cards >= 7 && during.worstLandGap <= 12 &&
    replay.every(r => r.anchored) && replay.filter(r => r.t >= 440).every(r => r.maxOpacity < 0.35) && settled &&
    shuffled && riffle.anim === "deckSquash" && riffle.layersMoving >= 3 &&
    after.handNo > 7 && !after.sweeping && after.myCards === 2 && after.visible && errs.length === 0;
  console.log(ok ? "✅ DECK ANIMATIONS — cards dealt off the deck, swept back into it, riffled before the next hand"
                 : "❌ animation check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
