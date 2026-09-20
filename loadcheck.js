const path = require("path");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 412, height: 900 } });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push("pageerror: " + e.message));
  p.on("console", m => { if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await p.goto("file://" + __dirname + "/preview.html", { waitUntil: "load" });
  await p.waitForTimeout(1500);
  const logoOk = await p.evaluate(() => !!document.querySelector(".logo-mark svg, svg.logo-mark"));
  await b.close();
  console.log("logo in DOM: " + logoOk);
  console.log(errs.length ? "❌ ERRORS:\n" + errs.join("\n") : "✅ no page/JS errors on load");
})().catch(e => { console.error(e); process.exit(1); });
