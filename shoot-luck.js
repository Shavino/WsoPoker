// The second promo code, in the page: typed in the same hidden place as the first, it leaves
// no mark on the screen — no banner, no badge — just a tick. It's noted in its own small
// list at the table (never on your seat — see shoot-seat.js) so that whichever browser is
// dealing knows whose all-ins to settle, and the next hand dealt carries it. Entered again,
// it switches off. As with the first code, only a salt and a PBKDF2 key are
// in the page, so this test bakes in its own throwaway code rather than the real one.
const path = require("path");
const crypto = require("crypto");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now(), errs = [];

const TEST_CODE = "TEST-TWO-" + crypto.randomBytes(4).toString("hex").toUpperCase();
const salt = crypto.randomBytes(16);
const KDF2 = { s: salt.toString("base64"), i: 250000, k: crypto.pbkdf2Sync(TEST_CODE, salt, 250000, 32, "sha256").toString("base64") };

const ps = [{ id: "cB", name: "apollo", stack: 1000 }, { id: "bot_1", name: "Mason", stack: 1000 }, { id: "bot_2", name: "Ivy", stack: 1000 }];
const g = E.startHand(ps, { button: 0, sb: 10, bb: 20 });
g.handNo = 6; g.seatOf = { cB: 0, bot_1: 1, bot_2: 2 };
let guard = 0; while (!g.handOver && guard++ < 40) { const la = E.legalActions(g); E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" }); }
g.deadline = 0;
const seed = {
  meta: { name: "luck table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 600000,
    started: true, status: "playing", handNo: 6, lastButtonId: "cB", nextHandAt: now + 7000 },
  seats: ps.map(p => ({ id: p.id, name: p.name, stack: 1000, sittingOut: false, isBot: p.id !== "cB", joinedAt: now })),
  game: g, presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(([s, kdf]) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_sound", "0");
          localStorage.removeItem("poker_lk"); localStorage.removeItem("poker_teach"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
    const v = JSON.parse(kdf);
    Object.defineProperty(window, "PROMO_KDF2", { get: () => v, set: () => {}, configurable: true });
  }, [JSON.stringify(seed), JSON.stringify(KDF2)]);
  const page = await ctx.newPage();
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const tap4 = async (answer) => {
    await page.evaluate((a) => { window.prompt = () => a; }, answer);
    for (let i = 0; i < 4; i++) await page.evaluate(() => document.getElementById("tbl-name").click());
    await page.waitForTimeout(1600);
  };
  const look = () => page.evaluate(() => {
    const t = window.__MOCK_TREE__().tables.TEST;
    return { lk: !!(t.lk && t.lk.cB), seatLk: !!(t.seats[0] && t.seats[0].lk), toast: ((document.getElementById("toast") || {}).textContent || ""),
      banner: !document.getElementById("teach-banner").hidden,
      text: document.getElementById("screen-table").innerText.replace(/\s+/g, " ").replace(/Next hand in \d+s/, "").slice(0, 4000) };
  });
  const before = await look();
  await tap4(TEST_CODE.toLowerCase());
  const on = await look();
  // wait for the next hand to be dealt, and see whether it carries the setting
  await page.waitForFunction(() => { const t = window.__MOCK_TREE__().tables.TEST; return t.game && t.game.handNo === 7; }, null, { timeout: 15000 }).catch(() => {});
  const dealt = await page.evaluate(() => { const gg = window.__MOCK_TREE__().tables.TEST.game; return { hand: gg.handNo, ls: gg.ls || null }; });
  await tap4(TEST_CODE);
  const off = await look();
  await page.reload({ waitUntil: "load" }); await page.waitForTimeout(1200);
  const afterReload = await look();
  await tap4("NOT-THE-CODE");
  const wrong = await look();
  await browser.close();

  const sameScreen = (a, b) => a.text.replace(/\d/g, "") === b.text.replace(/\d/g, "");
  console.log("code entered: toast '" + on.toast + "', noted for me=" + on.lk + " (written into my seat=" + on.seatLk + ")" + ", promo banner shown=" + on.banner + ", anything else on screen changed=" + !sameScreen(before, on));
  console.log("next hand #" + dealt.hand + " dealt with it: " + (dealt.ls === "cB"));
  console.log("entered again: toast '" + off.toast + "', noted for me=" + off.lk + "  |  after a reload: noted for me=" + afterReload.lk);
  console.log("a wrong code: '" + wrong.toast + "'");
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");
  const ok = on.lk && !on.seatLk && on.toast === "✓" && !on.banner && sameScreen(before, on) && dealt.hand === 7 && dealt.ls === "cB" &&
    !off.lk && /off/.test(off.toast) && !afterReload.lk && /invalid/i.test(wrong.toast) && errs.length === 0;
  console.log(ok ? "✅ SECOND CODE IN THE PAGE — nothing on screen but a tick, the dealer carries it, and it switches off again"
                 : "❌ second code check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
