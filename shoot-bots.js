// The bot settings have to actually reach the bots. This opens the table as its creator,
// changes "Bots play" and ticks the learning box, and checks three things: the choice is
// saved on the table (so everyone's browser agrees), the bots are asked to play at that
// level, and with learning on the table starts keeping notes on how people answer a bet —
// notes that live on the table, not in one browser, so they survive the host leaving.
const path = require("path");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now(), errs = [];

function seed(started) {
  const ps = [{ id: "cB", name: "apollo", stack: 1000 }, { id: "bot_1", name: "Mason", stack: 1000 }, { id: "bot_2", name: "Ivy", stack: 1000 }];
  const tree = {
    meta: { name: "bot table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8,
      turnMs: 600000, started: started, status: started ? "playing" : "lobby", handNo: started ? 3 : 0,
      lastButtonId: null, nextHandAt: 0, botSkill: "hard", botLearn: started },
    seats: ps.map(p => ({ id: p.id, name: p.name, stack: 1000, sittingOut: false, isBot: p.id !== "cB", joinedAt: now })),
    presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
  };
  if (started) {
    let g = E.startHand(ps, { button: 0, sb: 10, bb: 20 });
    g.handNo = 3; g.seatOf = {}; ps.forEach((p, i) => g.seatOf[p.id] = i);
    let guard = 0;
    while (!g.handOver && guard++ < 40 && g.players[g.toAct].id !== "cB") {
      const la = E.legalActions(g);
      E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" });
    }
    g.deadline = now + 600000;
    tree.game = g;
  }
  return tree;
}
async function open(browser, tree) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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

(async () => {
  const browser = await chromium.launch();

  /* ---- the settings panel ------------------------------------------------ */
  const lob = await open(browser, seed(false));
  const choices = await lob.page.evaluate(() => {
    const sel = document.getElementById("lb-skill");
    return { options: [...sel.options].map(o => o.textContent), value: sel.value, learn: document.getElementById("lb-learn").checked };
  });
  await lob.page.selectOption("#lb-skill", "tricky");
  await lob.page.waitForTimeout(500);
  await lob.page.check("#lb-learn");
  await lob.page.waitForTimeout(600);
  const saved = await lob.page.evaluate(() => {
    const m = window.__MOCK_TREE__().tables.TEST.meta;
    return { skill: m.botSkill, learn: !!m.botLearn, note: (document.getElementById("lb-skill-note") || {}).textContent || "" };
  });
  await lob.page.screenshot({ path: path.join(dir, "shots", "bot-settings.png") });
  await lob.ctx.close();

  /* ---- and what the bots are actually handed ----------------------------- */
  const tbl = await open(browser, seed(true));
  const used = await tbl.page.evaluate(async () => {
    // listen in on what the page asks the engine for, then play the hand out: check or
    // call whenever it's my turn, until the hand finishes and the table writes its notes
    const seen = [];
    const eng = window.PokerEngine;
    const orig = eng.botDecision;
    eng.botDecision = function (g, id, rng, opts) { seen.push({ skill: opts && opts.skill, gotModelKey: !!opts && ("model" in opts) }); return orig.apply(this, arguments); };
    const until = Date.now() + 40000;
    while (Date.now() < until) {
      const t = window.__MOCK_TREE__().tables.TEST;
      if (t.game && t.game.handOver) break;
      const btn = [...document.querySelectorAll("#controls .btn")].find(b => /check|call/i.test(b.textContent));
      if (btn && !btn.disabled) btn.click();
      await new Promise(r => setTimeout(r, 400));
    }
    await new Promise(r => setTimeout(r, 2500));      // let the end-of-hand write land
    eng.botDecision = orig;
    return seen;
  });
  const model = await tbl.page.evaluate(() => {
    const t = window.__MOCK_TREE__().tables.TEST;
    const m = t.model || null;
    return { has: !!m, players: m ? Object.keys(m).length : 0,
      sample: m ? Object.keys(m).map(k => k + ":" + (m[k].pff || 0) + "pre/" + (m[k].faced || 0) + "post").slice(0, 3).join(" ") : "",
      handOver: !!(t.game && t.game.handOver) };
  });
  await tbl.ctx.close();
  await browser.close();

  console.log("settings panel: " + choices.options.join(" / ") + "  (starts on '" + choices.value + "', learning " + (choices.learn ? "on" : "off") + ")");
  console.log("after picking Tricksters and ticking learning: table says skill=" + saved.skill + " learning=" + saved.learn);
  console.log("  the note explains it: \"" + saved.note.slice(0, 64) + "…\"");
  const skills = used.map(u => u.skill);
  console.log("bots asked to play at: " + (skills.length ? skills.filter((v, i, a) => a.indexOf(v) === i).join(",") + " (" + skills.length + " decisions)" : "no bot acted"));
  console.log("table notes after the hand: " + (model.has ? model.players + " players — " + model.sample : "none") + "  (hand finished=" + model.handOver + ")");
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");

  const ok = choices.options.length === 5 && choices.value === "hard" && !choices.learn &&
    saved.skill === "tricky" && saved.learn === true && saved.note.length > 20 &&
    used.length > 0 && used.every(u => u.skill === "hard" && u.gotModelKey) &&
    model.has && model.players >= 2 && errs.length === 0;
  console.log(ok ? "✅ BOT SETTINGS — the table's choice reaches the bots, and learning keeps its notes on the table"
                 : "❌ bot settings check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
