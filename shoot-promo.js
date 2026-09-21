// The promo code. The page never contains the code — only PBKDF2-SHA-256(code, salt, 250k)
// and the salt — so this test bakes its OWN throwaway code in and checks the whole flow:
// a wrong code is refused, the right one reveals the table, and nothing in the page source
// can be read back as the code.
const path = require("path");
const crypto = require("crypto");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now();

const TEST_CODE = "TEST-ONLY-CODE-" + crypto.randomBytes(4).toString("hex").toUpperCase();
const ITER = 250000;
const salt = crypto.randomBytes(16);
const KDF = { s: salt.toString("base64"), i: ITER, k: crypto.pbkdf2Sync(TEST_CODE, salt, ITER, 32, "sha256").toString("base64") };

const players = [{ id: "cB", name: "apollo", stack: 1000, sittingOut: false },
                 { id: "bot_a", name: "Dealer 🤖", stack: 1000, sittingOut: false },
                 { id: "bot_b", name: "Bot 2 🤖", stack: 1000, sittingOut: false }];
let g = E.startHand(players, { button: 0, sb: 10, bb: 20 });
g.handNo = 4; g.seatOf = { cB: 0, bot_a: 1, bot_b: 2 };
let guard = 0;
while (!g.handOver && guard++ < 40 && !((g.board || []).length >= 3 && g.players[g.toAct].id === "cB")) {
  const la = E.legalActions(g);
  E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" });
}
g.deadline = now + 600000;
const seat = (id, name) => ({ id, name, stack: 1000, sittingOut: false, isBot: id !== "cB", joinedAt: now });
const seed = {
  meta: { name: "promo table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 600000, started: true, status: "playing", handNo: 4, lastButtonId: "cB", nextHandAt: 0 },
  seats: [seat("cB", "apollo"), seat("bot_a", "Dealer 🤖"), seat("bot_b", "Bot 2 🤖")],
  game: g, presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
};

const tap4 = async (page, answer) => {
  await page.evaluate((a) => { window.prompt = () => a; }, answer);
  for (let i = 0; i < 4; i++) await page.evaluate(() => document.getElementById("tbl-name").click());
  await page.waitForTimeout(1400);                    // PBKDF2 is deliberately slow
  return page.evaluate(() => ({
    on: !document.getElementById("teach-banner").hidden,
    toast: (document.getElementById("toast") || {}).textContent || "",
    oppVisible: [...document.querySelectorAll(".pod:not(.me) .pod-cards .card")].filter(c => !c.classList.contains("back")).length,
    peeked: document.querySelectorAll(".pod:not(.me) .pod-cards .card.peek").length,
    // a peeked hand tucked behind the avatar is no use: it has to sit in front of it
    inFront: (() => {
      const pod = document.querySelector(".pod.peeking");
      if (!pod) return false;
      const cards = pod.querySelector(".pod-av .pod-cards"), av = pod.querySelector(".avatar");
      if (!cards || !av) return false;
      const z = e => Number(getComputedStyle(e).zIndex) || 0;
      const r = e => e.getBoundingClientRect();
      const overlaps = Math.min(r(cards).bottom, r(av).bottom) - Math.max(r(cards).top, r(av).top) > 8;
      return z(cards) > z(av) && overlaps && parseFloat(getComputedStyle(pod.querySelector(".card.peek")).opacity) > 0.7;
    })()
  }));
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(([s, kdf]) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_sound", "0"); localStorage.removeItem("poker_teach"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
    // pin a throwaway key in place of the real one (the page's own assignment is ignored)
    const v = JSON.parse(kdf);
    Object.defineProperty(window, "PROMO_KDF", { get: () => v, set: () => {}, configurable: true });
  }, [JSON.stringify(seed), JSON.stringify(KDF)]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
  await page.waitForTimeout(1300);

  const hidden = await page.evaluate(() => ({
    anyButton: [...document.querySelectorAll("button")].some(b => /promo|code|teach|reveal|cheat/i.test(b.textContent)),
    bannerHidden: document.getElementById("teach-banner").hidden
  }));
  const wrong = await tap4(page, "NOT-THE-CODE-0000");
  await page.waitForTimeout(400);
  const right = await tap4(page, TEST_CODE.toLowerCase());     // case shouldn't matter
  await page.screenshot({ path: path.join(dir, "shots", "promo-on.png") });

  // ...and on a phone, where the seats sit on a rail above the table. A revealed hand has
  // to stay full size there: everything else at a seat is shrunk, this one is the point.
  const pctx = await browser.newContext({ viewport: { width: 393, height: 700 }, deviceScaleFactor: 2 });
  await pctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo");
          localStorage.setItem("poker_sound", "0"); localStorage.setItem("poker_teach", "1"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(seed));
  const pp = await pctx.newPage();
  pp.on("pageerror", e => errs.push("pageerror(phone): " + e.message));
  await pp.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
  await pp.waitForTimeout(1400);
  const onPhone = await pp.evaluate(() => {
    const pod = document.querySelector("#rail .pod.peeking");
    if (!pod) return { ok: false, why: "no peeking seat on the rail" };
    const cards = pod.querySelector(".pod-av .pod-cards"), av = pod.querySelector(".avatar");
    const r = e => e.getBoundingClientRect();
    const z = e => Number(getComputedStyle(e).zIndex) || 0;
    const overlap = Math.min(r(cards).bottom, r(av).bottom) - Math.max(r(cards).top, r(av).top);
    const board = document.querySelector("#board .card:not(.slot)");
    const hitsBoard = board && Math.min(r(cards).bottom, r(board).bottom) - Math.max(r(cards).top, r(board).top) > 2 &&
      Math.min(r(cards).right, r(board).right) - Math.max(r(cards).left, r(board).left) > 2;
    // the ✕ that sends a bot home must not sit on the hand it just revealed
    const x = pod.querySelector(".kick-btn");
    const onCards = x && Math.min(r(x).bottom, r(cards).bottom) - Math.max(r(x).top, r(cards).top) > 3 &&
      Math.min(r(x).right, r(cards).right) - Math.max(r(x).left, r(cards).left) > 3;
    const tall = document.documentElement;
    return { ok: z(cards) > z(av) && overlap > 6 && r(cards).width > 34 && !hitsBoard && !onCards &&
        tall.scrollHeight <= window.innerHeight + 1,
      kickOnCards: !!onCards, fits: tall.scrollHeight <= window.innerHeight + 1,
      w: Math.round(r(cards).width), overlap: Math.round(overlap), inFront: z(cards) > z(av), overBoard: !!hitsBoard,
      seen: document.querySelectorAll("#rail .card.peek").length };
  });
  await pp.screenshot({ path: path.join(dir, "shots", "promo-phone.png") });
  await pctx.close();

  // the built page must not carry the code — in any obvious form
  const src = require("fs").readFileSync(path.join(dir, "index.html"), "utf8");
  const leaks = [TEST_CODE, "KING-OF-SPADES"].filter(c => src.indexOf(c) !== -1);
  const kdfInPage = /PROMO_KDF\s*=\s*\{\s*s:\s*"[A-Za-z0-9+/=]{20,}"/.test(src) && /i:\s*250000/.test(src);
  await browser.close();

  console.log("no visible way in: promo button=" + hidden.anyButton + " banner hidden=" + hidden.bannerHidden);
  console.log("wrong code: unlocked=" + wrong.on + " toast='" + wrong.toast + "' opponent cards visible=" + wrong.oppVisible);
  console.log("right code: unlocked=" + right.on + " toast='" + right.toast + "' opponent cards visible=" + right.oppVisible +
    " (grayed: " + right.peeked + ", shown in front of the picture: " + right.inFront + ")");
  console.log("on a phone: " + onPhone.seen + " cards on the rail, " + onPhone.w + "px wide, over the picture by " +
    onPhone.overlap + "px, in front=" + onPhone.inFront + ", on the board=" + onPhone.overBoard +
    ", ✕ on the cards=" + onPhone.kickOnCards + ", page fits=" + onPhone.fits);
  console.log("page source: plaintext codes found=" + (leaks.length ? leaks.join(",") : "none") + "  PBKDF2 salt+250k rounds shipped=" + kdfInPage);
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");

  const ok = !hidden.anyButton && hidden.bannerHidden &&
    !wrong.on && /invalid/i.test(wrong.toast) && wrong.oppVisible === 0 &&
    right.on && right.oppVisible === 4 && right.peeked === 4 && right.inFront && onPhone.ok && onPhone.seen === 4 &&
    leaks.length === 0 && kdfInPage && errs.length === 0;
  console.log(ok ? "✅ TABLE CODE — hidden, slow to test, wrong codes refused, right code reveals the table"
                 : "❌ promo code check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
