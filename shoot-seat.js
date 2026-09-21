// "Why can't I take a seat?" Taking a seat is a Firebase transaction, and any other write this
// browser makes on the same data before the server confirms it cancels the transaction. The
// all-in table code used to write its flag onto your seat the instant the seat appeared —
// cancelling the very transaction that was seating you, every time, and leaving a broken seat
// behind. The mock database now behaves like the real one, so this would be caught again.
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now(), errs = [];
function seed(extra) {
  const ps = [{ id: "bot_1", name: "Ivy", stack: 1000 }, { id: "bot_2", name: "Mason", stack: 1000 }];
  const g = E.startHand(ps, { button: 0, sb: 10, bb: 20 }); g.handNo = 3; g.seatOf = { bot_1: 0, bot_2: 1 };
  let k = 0; while (!g.handOver && k++ < 20) { const la = E.legalActions(g); E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "fold" }); }
  const seats = ps.map(p => ({ id: p.id, name: p.name, stack: 1000, sittingOut: false, isBot: true, joinedAt: now })).concat(extra || []);
  return { meta: { name: "apollo's table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 30000,
      started: true, status: "playing", handNo: 3, lastButtonId: "bot_1", nextHandAt: now + 60000 },
    seats, game: g, presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now } };
}
async function trySit(browser, luck, tree) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  await ctx.addInitScript(([s, l]) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_sound", "0"); localStorage.setItem("poker_lk", l ? "1" : "0"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, [JSON.stringify(tree), luck]);
  const page = await ctx.newPage();
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  await page.goto("file://" + dir + "/preview.html#TEST", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const b = [...document.querySelectorAll("#me-panel button")].find(x => /take a seat/i.test(x.textContent)); if (b) b.click(); });
  await page.waitForTimeout(1600);
  const r = await page.evaluate(() => {
    const t = window.__MOCK_TREE__().tables.TEST, seats = Object.values(t.seats || {}).filter(Boolean);
    return { seated: seats.some(s => s.id === "cB"), broken: seats.filter(s => !s.id).length, watching: /watching/i.test(document.getElementById("me-panel").textContent) };
  });
  await ctx.close();
  return r;
}
(async () => {
  const browser = await chromium.launch();
  const off = await trySit(browser, false, seed()), on = await trySit(browser, true, seed()), junk = await trySit(browser, true, seed([{ lk: 1 }]));
  await browser.close();
  [["all-in code off:", off], ["all-in code ON:", on], ["table with a broken seat:", junk]].forEach(([l, r]) =>
    console.log(l.padEnd(26) + "seated=" + r.seated + " watching=" + r.watching + " broken seats=" + r.broken));
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");
  const ok = [off, on, junk].every(r => r.seated && !r.watching && r.broken === 0) && errs.length === 0;
  console.log(ok ? "✅ TAKE A SEAT — works first time with or without the all-in code, and cleans up broken seats" : "❌ take-a-seat check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
