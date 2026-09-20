/* Minimal in-memory stand-in for the Firebase compat SDK — PREVIEW/TEST ONLY.
   Lets the real app render against seeded data in a headless browser. */
(function () {
  // Replicate Firebase RTDB serialization: null/undefined dropped, EMPTY ARRAYS and empty
  // objects dropped, primitives (incl 0/false/"") kept. This is what makes an empty `board:[]`
  // come back undefined on read — exactly the real-world gotcha we must test against.
  function fbSerialize(v) {
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) {
      var arr = v.map(fbSerialize);
      var anyReal = arr.some(function (x) { return x !== undefined; });
      if (!anyReal) return undefined;                 // [] or all-holes → dropped
      return arr.map(function (x) { return x === undefined ? null : x; });
    }
    if (typeof v === "object") {
      var o = {}, has = false;
      Object.keys(v).forEach(function (k) { var s = fbSerialize(v[k]); if (s !== undefined) { o[k] = s; has = true; } });
      return has ? o : undefined;                       // {} → dropped
    }
    return v;
  }
  var seedRaw = (window.__SEED_TREE__) ? JSON.parse(JSON.stringify(window.__SEED_TREE__)) : {};
  var tree = fbSerialize(seedRaw) || {};
  var listeners = [];
  function parse(p) { p = String(p || "").replace(/^\/+|\/+$/g, ""); return p === "" ? [] : p.split("/"); }
  function getAt(parts) { var o = tree; for (var i = 0; i < parts.length; i++) { if (o == null) return null; o = o[parts[i]]; } return o === undefined ? null : o; }
  function setAt(parts, val) {
    if (parts.length === 0) { tree = val || {}; return; }
    var o = tree, i;
    for (i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== "object" || o[parts[i]] === null) o[parts[i]] = {}; o = o[parts[i]]; }
    if (val === null || val === undefined) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = val;
  }
  function snap(v) {
    return {
      val: function () { return v === undefined ? null : v; },
      exists: function () { return v != null; },
      forEach: function (cb) { if (v && typeof v === "object") Object.keys(v).forEach(function (k) { cb(snap(v[k])); }); }
    };
  }
  function limited(v, n) { if (!v || typeof v !== "object" || !n) return v; var ks = Object.keys(v).slice(-n); var nv = {}; ks.forEach(function (k) { nv[k] = v[k]; }); return nv; }
  function emit() { listeners.forEach(function (l) { l.cb(snap(limited(getAt(l.parts), l.limit))); }); }

  function Ref(parts, limit) { this.parts = parts; this.limit = limit || null; }
  Ref.prototype.child = function (p) { return new Ref(this.parts.concat(parse(p)), null); };
  Ref.prototype.limitToLast = function (n) { return new Ref(this.parts, n); };
  Ref.prototype.on = function (ev, cb) { var l = { parts: this.parts, cb: cb, limit: this.limit }; listeners.push(l); var self = this; setTimeout(function () { cb(snap(limited(getAt(self.parts), self.limit))); }, 0); return cb; };
  Ref.prototype.off = function () { var key = this.parts.join("/"); listeners = listeners.filter(function (l) { return l.parts.join("/") !== key; }); };
  Ref.prototype.get = function () { return Promise.resolve(snap(getAt(this.parts))); };
  Ref.prototype.set = function (v) { setAt(this.parts, fbSerialize(v) === undefined ? null : fbSerialize(v)); emit(); return Promise.resolve(); };
  Ref.prototype.update = function (v) { var cur = getAt(this.parts); if (typeof cur !== "object" || cur === null) cur = {}; Object.keys(v).forEach(function (k) { var s = fbSerialize(v[k]); if (s === undefined) delete cur[k]; else cur[k] = s; }); setAt(this.parts, cur); emit(); return Promise.resolve(); };
  Ref.prototype.remove = function () { setAt(this.parts, null); emit(); return Promise.resolve(); };
  Ref.prototype.push = function (v) { var k = "k" + Date.now() + Math.floor(Math.random() * 1e6); var s = fbSerialize(v); setAt(this.parts.concat(k), s === undefined ? null : s); emit(); return Promise.resolve(); };
  Ref.prototype.transaction = function (fn, cb) { var v = getAt(this.parts); var r = fn(v); if (r !== undefined) { var s = fbSerialize(r); setAt(this.parts, s === undefined ? null : s); emit(); } if (cb) setTimeout(function () { cb(null, r !== undefined, snap(getAt([]))); }, 0); return Promise.resolve(); };
  Ref.prototype.onDisconnect = function () { return { remove: function () { return Promise.resolve(); }, set: function () { return Promise.resolve(); } }; };

  window.firebase = {
    initializeApp: function () { return {}; },
    database: function () { return { ref: function (p) { return new Ref(parse(p)); } }; }
  };
  window.firebase.database.ServerValue = {};
  Object.defineProperty(window.firebase.database.ServerValue, "TIMESTAMP", { get: function () { return Date.now(); } });
  window.__MOCK_TREE__ = function () { return tree; };
  window.__setShown = function (handNo, id) { setAt(["tables","TEST","shown",String(handNo),id], true); emit(); };   // TEST ONLY: inspect current DB state
})();
