// How the table tells you what happened: an action badge on the player's own seat, bets
// sliding into the pot when a street closes, and a hand log that reads like poker instead
// of like a server log.
//
// It also guards the bug that made every animation invisible: the app used to switch all
// motion off whenever the OS said "reduce animations", which silently broke dealing, the
// sweep and the flips for anyone with that system setting on. Motion is a setting in the
// app now, so a browser asking for reduced motion must NOT stop the cards moving — only
// the player's own Reduced choice does.
const path = require("path");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now();
const errs = [];

const names = ["apollo", "Mason", "Ivy"];
const players = () => [{ id: "cB", name: names[0], stack: 1000, sittingOut: false },
                       { id: "bot_a", name: names[1], stack: 1000, sittingOut: false },
                       { id: "bot_b", name: names[2], stack: 1000, sittingOut: false }];
// preflop, everyone has called, the big blind is left to act — one check closes the street
function preflopSeed() {
  const g = E.startHand(players(), { button: 0, sb: 10, bb: 20 });
  g.handNo = 11; g.seatOf = { cB: 0, bot_a: 1, bot_b: 2 };
  let guard = 0;
  while (!g.handOver && (g.board || []).length === 0 && guard++ < 10) {
    const p = g.players[g.toAct];
    if (p.id === "bot_b") break;                       // leave the BB to act
    const la = E.legalActions(g);
    E.applyAction(g, p.id, la.check ? { type: "check" } : { type: "call" });
  }
  return g;
}
function seedFor(g, turnMs) {
  g.deadline = now + (turnMs || 600000);
  return {
    meta: { name: "feel table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: turnMs || 600000, started: true, status: "playing", handNo: g.handNo, lastButtonId: "cB", nextHandAt: 0 },
    seats: players().map(p => ({ id: p.id, name: p.name, stack: 1000, sittingOut: false, isBot: p.id !== "cB", joinedAt: now })),
    game: g, presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
  };
}
async function open(browser, seed, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 860 } }, opts || {}));
  await ctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_sound", "0"); localStorage.removeItem("poker_motion"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(seed));
  const page = await ctx.newPage();
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();

  /* ---- 1. the seat says what the player did ----------------------------- */
  const a = await open(browser, seedFor(preflopSeed()));
  await a.page.waitForTimeout(1300);
  // let the bot behind me act, so more than one seat is carrying a badge
  await a.page.waitForFunction(() => document.querySelectorAll("#seats-layer .act-badge").length >= 2,
    null, { timeout: 15000, polling: 80 }).catch(() => {});
  const seats = await a.page.evaluate(() => {
    const badges = [...document.querySelectorAll("#seats-layer .act-badge")];
    return {
      count: badges.length,
      texts: badges.map(b => b.textContent),
      coloured: badges.every(b => /a-(fold|check|call|raise|allin)/.test(b.className)),
      onThePlate: badges.every(b => b.parentElement.classList.contains("pod-plate")),
      botTags: document.querySelectorAll("#seats-layer .bot-tag").length,
      names: [...document.querySelectorAll("#seats-layer .pod-name")].map(n => n.textContent)
    };
  });

  /* ---- 2. the bets slide into the pot when the street closes ------------- */
  let chips = { n: 0, anim: false, worstMiss: 1e9 }, flew = false;
  for (let t = 0; t < 70 && !flew; t++) {            // act when it's my turn, watch for the collection
    const got = await a.page.evaluate(() => {
      const f = [...document.querySelectorAll(".betchip.fly")];
      if (!f.length) {
        const ctl = document.getElementById("controls");
        if (ctl && !ctl.hidden) {
          const bs = [...ctl.querySelectorAll(".ctl-row .btn")];
          const b = bs.find(x => /check/i.test(x.textContent)) || bs.find(x => /call/i.test(x.textContent));
          if (b) b.click();
        }
        return null;
      }
      const pot = document.getElementById("pot").getBoundingClientRect();
      const miss = f.map(c => {
        const r = c.getBoundingClientRect();
        const tx = parseFloat(c.style.getPropertyValue("--tx")), ty = parseFloat(c.style.getPropertyValue("--ty"));
        const x = r.left + r.width / 2 + tx, y = r.top + r.height / 2 + ty;
        return Math.round(Math.hypot(x - (pot.left + pot.width / 2), y - (pot.top + pot.height / 2)));
      });
      return { n: f.length, anim: f.every(c => getComputedStyle(c).animationName === "chipToPot"),
        worstMiss: Math.max.apply(null, miss) };
    });
    if (got) { chips = got; flew = true; } else await a.page.waitForTimeout(150);
  }
  await a.page.screenshot({ path: path.join(dir, "shots", "feel-table.png") });

  /* ---- 3. the log reads like poker -------------------------------------- */
  await a.page.waitForTimeout(900);
  const log = await a.page.evaluate(() => {
    const box = document.getElementById("log");
    return {
      rawStars: /\*\*\*/.test(box.textContent),
      streets: box.querySelectorAll(".logline.street").length,
      cardChips: box.querySelectorAll(".lc").length,
      rawCards: /\b[2-9TJQKA][shdc]\b/.test(box.textContent.replace(/10/g, "")),
      tab: document.querySelector('.dtab[data-tab="log"]').textContent
    };
  });
  await a.ctx.close();

  /* ---- 4. an OS asking for less motion must not stop the game ----------- */
  const b = await open(browser, seedFor(preflopSeed()), { reducedMotion: "reduce" });
  await b.page.waitForTimeout(1200);
  const motion = await b.page.evaluate(() => {
    const osSaysReduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const anyCard = document.querySelector("#seats-layer .card, #board .card:not(.slot)");
    const before = { attr: document.documentElement.getAttribute("data-motion"), anim: getComputedStyle(anyCard).animationName };
    // now the player chooses Reduced in the style panel
    document.getElementById("btn-theme").click();
    document.querySelector('#tp-motion .seg-btn[data-id="low"]').click();
    return { osSaysReduce, before,
      after: { attr: document.documentElement.getAttribute("data-motion"),
               sweep: getComputedStyle(document.documentElement).getPropertyValue("--x") },
      options: document.querySelectorAll("#tp-motion .seg-btn").length,
      saved: localStorage.getItem("poker_motion") };
  });
  // with Reduced chosen, a freshly dealt card must not animate
  const lowAnim = await b.page.evaluate(() => {
    const c = document.createElement("div");
    c.className = "card deal"; document.getElementById("board").appendChild(c);
    const n = getComputedStyle(c).animationName; c.remove(); return n;
  });
  await b.ctx.close();
  await browser.close();

  console.log("seat badges: " + seats.count + " shown " + JSON.stringify(seats.texts) + " coloured=" + seats.coloured + " on the plate=" + seats.onThePlate);
  console.log("names: " + JSON.stringify(seats.names) + " bot tags=" + seats.botTags);
  console.log("chips to pot: fired=" + flew + " chips=" + chips.n + " animation=" + chips.anim + " worst miss=" + chips.worstMiss + "px");
  console.log("log: '***' markers=" + log.rawStars + " street dividers=" + log.streets + " card chips=" + log.cardChips + " raw card codes=" + log.rawCards + " tab='" + log.tab + "'");
  console.log("motion: OS asks for reduced=" + motion.osSaysReduce + " → app still animates ('" + motion.before.anim + "', data-motion=" + motion.before.attr + ")");
  console.log("        player picks Reduced → data-motion=" + motion.after.attr + ", a dealt card animates: " + lowAnim + " (saved as " + motion.saved + ")");
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");

  const ok = seats.count >= 2 && seats.coloured && seats.onThePlate &&
    seats.texts.some(t => /^(CALL|BET|RAISE|CHECK|FOLD|ALL IN)\b/.test(t)) &&
    seats.botTags === 2 && seats.names.every(n => !/🤖|^Bot \d/.test(n)) &&
    flew && chips.n >= 2 && chips.anim && chips.worstMiss <= 14 &&
    !log.rawStars && log.streets >= 1 && log.cardChips >= 3 && !log.rawCards && log.tab === "History" &&
    motion.osSaysReduce && motion.before.anim !== "none" && motion.before.attr === "full" &&
    motion.options === 2 && motion.after.attr === "low" && motion.saved === "low" && lowAnim === "none" &&
    errs.length === 0;
  console.log(ok ? "✅ TABLE FEEL — the seat shows the action, bets slide to the pot, the log reads like poker, motion is the player's call"
                 : "❌ table feel check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
