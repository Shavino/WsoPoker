const fs = require("fs");
const path = require("path");
const dir = __dirname;

let html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const mock = fs.readFileSync(path.join(dir, "mockfb.js"), "utf8");

// 1) remove the two gstatic firebase <script src> tags
html = html.replace(/<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"><\/script>\s*/g, "");

// 2) inject the mock firebase right where the config <script> begins (so it runs before engine/app)
html = html.replace('<script>\n/* ==========', '<script>\n' + mock + '\n</script>\n<script>\n/* ==========');

// 3) make the baked config look valid so initFirebase() proceeds against the mock
html = html.replace(/apiKey: "PASTE_YOUR_API_KEY"/, 'apiKey: "demo-key"');
html = html.replace(/databaseURL: "https:\/\/PASTE_YOUR_PROJECT-default-rtdb\.firebaseio\.com"/, 'databaseURL: "https://demo-default-rtdb.firebaseio.com"');
html = html.replace(/projectId: "PASTE_YOUR_PROJECT"/, 'projectId: "demo"');

fs.writeFileSync(path.join(dir, "preview.html"), html);
console.log("preview.html written");
