const fs = require("fs");
const path = require("path");
const dir = __dirname;
const FIREBASE_VER = "10.12.5";

/* ---------------------------------------------------------------------------
   The promo code is never written down anywhere in this repo. What's stored is
   PBKDF2-SHA-256(code, salt, 250k rounds) plus the salt — the same material the
   built page ships to every visitor, and useless without the code itself.
   Guessing it back out means running 250,000 SHA-256 rounds per attempt against
   an 80-bit code, which is not happening. Safe to push to a public repo.

   To set a new code:  POKER_CODE="NEW-CODE" node build.js
   That prints a fresh salt + key — paste them below so later builds keep it.
   --------------------------------------------------------------------------- */
const crypto = require("crypto");
const CODE_ITER = 250000;
let CODE_SALT = "lqj1FrWhCT+h6zkxuWAgkg==";
let CODE_KEY  = "QbtmneTIkX2s9HP1KXEB0vUJdv6Hk8CNDr9v6nrDU78=";
if (process.env.POKER_CODE) {
  const salt = crypto.randomBytes(16);
  CODE_SALT = salt.toString("base64");
  CODE_KEY = crypto.pbkdf2Sync(process.env.POKER_CODE.trim().toUpperCase(), salt, CODE_ITER, 32, "sha256").toString("base64");
  console.log("New promo code baked in. Paste these into build.js to keep it:");
  console.log('  let CODE_SALT = "' + CODE_SALT + '";');
  console.log('  let CODE_KEY  = "' + CODE_KEY + '";');
}

let html = fs.readFileSync(path.join(dir, "template.html"), "utf8");
const styles = fs.readFileSync(path.join(dir, "styles.css"), "utf8");
const engine = fs.readFileSync(path.join(dir, "engine.js"), "utf8");
const app = fs.readFileSync(path.join(dir, "app.js"), "utf8");

html = html.split("FIREBASE_VER").join(FIREBASE_VER);
html = html.split("__CODE_SALT__").join(CODE_SALT);
html = html.split("__CODE_KEY__").join(CODE_KEY);
html = html.split("__CODE_ITER__").join(String(CODE_ITER));
html = html.replace("/*STYLES*/", () => styles);
html = html.replace("/*ENGINE*/", () => engine);
html = html.replace("/*APP*/", () => app);

// sanity: no leftover placeholders, no stray closing script tags in JS
["/*STYLES*/", "/*ENGINE*/", "/*APP*/", "FIREBASE_VER", "__CODE_SALT__", "__CODE_KEY__", "__CODE_ITER__"].forEach(p => {
  if (html.indexOf(p) !== -1) { console.error("Leftover placeholder: " + p); process.exit(1); }
});
if (/<\/script>/i.test(engine) || /<\/script>/i.test(app) || /<\/style>/i.test(styles)) {
  console.error("A source file contains a closing tag that would break inlining!"); process.exit(1);
}

const out = path.join(dir, "index.html");
fs.writeFileSync(out, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log("Built index.html (" + kb + " KB), Firebase " + FIREBASE_VER);
