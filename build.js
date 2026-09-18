const fs = require("fs");
const path = require("path");
const dir = __dirname;
const FIREBASE_VER = "10.12.5";

// Xavier's private teaching code — stored only as a one-way hash in the built file.
const INSTRUCTOR_CODE = process.env.POKER_CODE || "KING-OF-SPADES-4417";
function cyrb53(str, seed) { seed = seed || 0; let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed; for (let i = 0, c; i < str.length; i++) { c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(); }
const CODE_HASH = cyrb53(INSTRUCTOR_CODE.trim().toUpperCase());

let html = fs.readFileSync(path.join(dir, "template.html"), "utf8");
const styles = fs.readFileSync(path.join(dir, "styles.css"), "utf8");
const engine = fs.readFileSync(path.join(dir, "engine.js"), "utf8");
const app = fs.readFileSync(path.join(dir, "app.js"), "utf8");

html = html.split("FIREBASE_VER").join(FIREBASE_VER);
html = html.split("__CODE_HASH__").join(CODE_HASH);
html = html.replace("/*STYLES*/", () => styles);
html = html.replace("/*ENGINE*/", () => engine);
html = html.replace("/*APP*/", () => app);

// sanity: no leftover placeholders, no stray closing script tags in JS
["/*STYLES*/", "/*ENGINE*/", "/*APP*/", "FIREBASE_VER", "__CODE_HASH__"].forEach(p => {
  if (html.indexOf(p) !== -1) { console.error("Leftover placeholder: " + p); process.exit(1); }
});
if (/<\/script>/i.test(engine) || /<\/script>/i.test(app) || /<\/style>/i.test(styles)) {
  console.error("A source file contains a closing tag that would break inlining!"); process.exit(1);
}

const out = path.join(dir, "index.html");
fs.writeFileSync(out, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log("Built index.html (" + kb + " KB), Firebase " + FIREBASE_VER);
