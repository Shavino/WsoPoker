// The 🎨 style picker: three sets of looks (background / table / cards), each with
// at least five options, applied instantly and remembered on this device only.
const path = require("path");
const fs = require("fs");
const http = require("http");
const E = require("./engine.js");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const dir = __dirname, now = Date.now();

const players = [{ id: "cB", name: "apollo", stack: 1000, sittingOut: false },
                 { id: "bot_a", name: "Dealer 🤖", stack: 1000, sittingOut: false },
                 { id: "bot_b", name: "Bot 2 🤖", stack: 1000, sittingOut: false }];
let g = E.startHand(players, { button: 0, sb: 10, bb: 20 });
g.handNo = 3; g.seatOf = { cB: 0, bot_a: 1, bot_b: 2 };
let guard = 0;   // stop on the flop, on MY turn: nothing moves while the test looks at the table
while (!g.handOver && guard++ < 40 && !((g.board || []).length >= 3 && g.players[g.toAct].id === "cB")) {
  const la = E.legalActions(g);
  E.applyAction(g, g.players[g.toAct].id, la.check ? { type: "check" } : { type: "call" });
}
g.deadline = now + 600000;
const seat = (id, name) => ({ id, name, stack: 1000, sittingOut: false, isBot: id !== "cB", joinedAt: now });
const seed = {
  meta: { name: "style table", createdAt: now, hostId: "cB", bb: 20, sb: 10, startingStack: 1000, maxSeats: 8, turnMs: 600000, started: true, status: "playing", handNo: 3, lastButtonId: "cB", nextHandAt: 0 },
  seats: [seat("cB", "apollo"), seat("bot_a", "Dealer 🤖"), seat("bot_b", "Bot 2 🤖")],
  game: g, presence: { cB: { name: "apollo", ts: now } }, host: { id: "cB", ts: now }
};

const SHOTS = [["noir", "slate", "noir"], ["neon", "purple", "neon"], ["velvet", "red", "crimson"]];

function serve() {                 // a real origin, so localStorage behaves like it does live
  const page = fs.readFileSync(path.join(__dirname, "preview.html"));
  const server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(page); });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r({ server, url: "http://127.0.0.1:" + server.address().port + "/preview.html#TEST" })));
}

(async () => {
  const site = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  await ctx.addInitScript((s) => {
    try { localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_sound", "0"); } catch (e) {}
    window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
  }, JSON.stringify(seed));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(site.url, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  // the button sits next to the sound button, and opens a panel with three groups
  const open = await page.evaluate(() => {
    const btn = document.getElementById("btn-theme");
    const tools = btn && btn.parentElement;
    const nextToSound = !!(tools && tools.querySelector("#btn-sound"));
    btn.click();
    const panel = document.getElementById("theme-panel");
    const count = (id) => document.querySelectorAll("#" + id + " .sw-btn").length;
    return {
      hasBtn: !!btn, nextToSound, panelOpen: !panel.hidden,
      bg: count("tp-bg"), table: count("tp-table"), cards: count("tp-cards"),
      soundClosed: document.getElementById("sound-panel").hidden
    };
  });

  // every swatch in every group must actually change what the page renders
  const applied = await page.evaluate(async () => {
    const cs = () => getComputedStyle(document.documentElement);
    const probe = { bg: "--bd", table: "--felt-2", cards: "--back-bg" };
    const out = {};
    for (const kind of ["bg", "table", "cards"]) {
      const host = document.getElementById("tp-" + kind);
      const seen = new Set(), ids = [];
      for (const b of [...host.querySelectorAll(".sw-btn")]) {
        b.click();
        await new Promise(r => setTimeout(r, 30));
        ids.push(document.documentElement.getAttribute("data-" + kind));
        seen.add(cs().getPropertyValue(probe[kind]).trim());
      }
      const marked = [...host.querySelectorAll(".sw-btn.on")].length;
      out[kind] = { options: ids.length, distinctLooks: seen.size, attrMatches: ids[ids.length - 1] === host.querySelector(".sw-btn.on").getAttribute("data-id"), marked };
    }
    return out;
  });

  // pick one of each, then open the table fresh: the choice has to stick
  const chosen = await page.evaluate(() => {
    const pick = (kind, id) => document.querySelector('#tp-' + kind + ' .sw-btn[data-id="' + id + '"]').click();
    pick("bg", "velvet"); pick("table", "purple"); pick("cards", "noir");
    return { bg: localStorage.getItem("poker_bg"), table: localStorage.getItem("poker_table"), cards: localStorage.getItem("poker_cards") };
  });
  // A second page in the same browser context — i.e. the player opening the table again.
  // (Deliberately not page.reload(): headless Chromium batches localStorage commits for
  // several seconds after a burst of writes and can drop them when it tears the renderer
  // down, which is a harness quirk, not something a real player would ever hit.)
  const page2 = await ctx.newPage();
  await page2.goto(site.url, { waitUntil: "load" });
  await page2.waitForTimeout(900);
  const afterReload = await page2.evaluate(() => {
    const r = document.documentElement;
    return { bg: r.getAttribute("data-bg"), table: r.getAttribute("data-table"), cards: r.getAttribute("data-cards"),
      raw: JSON.stringify(Object.keys(localStorage).sort().map(k => k + "=" + localStorage.getItem(k))),
      // the felt and the card backs really are wearing the chosen theme
      felt: getComputedStyle(document.querySelector(".table-oval")).backgroundImage.indexOf("rgb(74, 38, 136)") >= 0,
      backDark: /rgb\(16, 19, 25\)|rgb\(27, 33, 43\)/.test(getComputedStyle(document.querySelector(".pod:not(.me) .card.back") || document.body).backgroundImage) };
  });

  // a look at three of the combinations, each in a fresh browser
  for (const [bg, table, cards] of SHOTS) {
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 860 } });
    await c2.addInitScript(([s, b, t, c]) => {
      try {
        localStorage.setItem("poker_cid", "cB"); localStorage.setItem("poker_name", "apollo"); localStorage.setItem("poker_sound", "0");
        localStorage.setItem("poker_bg", b); localStorage.setItem("poker_table", t); localStorage.setItem("poker_cards", c);
      } catch (e) {}
      window.__SEED_TREE__ = { tables: { TEST: JSON.parse(s) } };
    }, [JSON.stringify(seed), bg, table, cards]);
    const p2 = await c2.newPage();
    await p2.goto(site.url, { waitUntil: "load" });
    await p2.waitForTimeout(1100);
    await p2.screenshot({ path: path.join(dir, "shots", "style-" + bg + "-" + table + "-" + cards + ".png") });
    await c2.close();
  }
  await browser.close();
  site.server.close();

  console.log("picker: button=" + open.hasBtn + " beside sound=" + open.nextToSound + " opens=" + open.panelOpen + " (sound panel closed=" + open.soundClosed + ")");
  console.log("options: backgrounds=" + open.bg + " tables=" + open.table + " cards=" + open.cards);
  ["bg", "table", "cards"].forEach(k => console.log("  " + k + ": " + applied[k].options + " tried, " + applied[k].distinctLooks + " distinct looks, one marked=" + (applied[k].marked === 1)));
  console.log("saved: " + JSON.stringify(chosen) + "  after reload: " + JSON.stringify({ bg: afterReload.bg, table: afterReload.table, cards: afterReload.cards }));
  console.log("  storage after reload: " + afterReload.raw);
  console.log("felt is amethyst=" + afterReload.felt + "  card backs are the black deck=" + afterReload.backDark);
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page errors");

  const groupsOK = ["bg", "table", "cards"].every(k => open[k] >= 5 && applied[k].distinctLooks === open[k] && applied[k].attrMatches && applied[k].marked === 1);
  const ok = open.hasBtn && open.nextToSound && open.panelOpen && open.soundClosed && groupsOK &&
    chosen.bg === "velvet" && afterReload.bg === "velvet" && afterReload.table === "purple" && afterReload.cards === "noir" &&
    afterReload.felt && afterReload.backDark && errs.length === 0;
  console.log(ok ? "✅ STYLE PICKER — 5+ backgrounds, tables and decks, applied and remembered per player" : "❌ style picker check failed");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
