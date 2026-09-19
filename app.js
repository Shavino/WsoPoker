/* ============================================================================
   FRIENDLY POKER — app layer.  Firebase Realtime Database multiplayer,
   host-authority game loop with automatic failover, presence, UI + teaching mode.
   Depends on globals: firebase (compat SDK), PokerEngine.
   ==========================================================================*/
(function () {
  "use strict";

  /* ----------------------------------------------------------------------
     CONFIG  — replaced during setup (see the SETUP banner in index.html).
     ---------------------------------------------------------------------- */
  var FIREBASE_CONFIG = window.FIREBASE_CONFIG || null;

  // Promo secret. The code is never in the page — only PBKDF2-SHA-256(code, salt, 250k)
  // and its salt, which are useless without the code. Each guess costs the attacker the
  // same 250k rounds it costs us, so brute force against an 80-bit code is hopeless.
  // (cyrb53 below is NOT used for this any more — it only picks avatars from a player id.)
  function cyrb53(str, seed) { seed = seed || 0; var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed; for (var i = 0, c; i < str.length; i++) { c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(); }
  var PROMO_KDF = window.PROMO_KDF || null;
  function b64ToBytes(b64) {
    var bin = atob(String(b64 || "")), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function sameSecret(a, b) {              // length-independent, no early exit
    a = String(a); b = String(b);
    var diff = a.length ^ b.length;
    for (var i = 0; i < a.length && i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
  function verifyPromo(code) {
    var subtle = window.crypto && (window.crypto.subtle || window.crypto.webkitSubtle);
    if (!PROMO_KDF || !PROMO_KDF.k || !subtle || !window.TextEncoder) return Promise.resolve(false);
    var bytes = new TextEncoder().encode(String(code == null ? "" : code).trim().toUpperCase());
    return subtle.importKey("raw", bytes, { name: "PBKDF2" }, false, ["deriveBits"])
      .then(function (key) {
        return subtle.deriveBits({ name: "PBKDF2", salt: b64ToBytes(PROMO_KDF.s), iterations: PROMO_KDF.i || 250000, hash: "SHA-256" }, key, 256);
      })
      .then(function (bits) { return sameSecret(bytesToB64(bits), PROMO_KDF.k); })
      .catch(function () { return false; });
  }

  var MAX_SEATS = 8;
  var TURN_MS = 40000;          // time to act before auto check/fold
  var HOST_TIMEOUT_MS = 9000;   // consider host dead after this
  var HOST_BEAT_MS = 3000;      // host heartbeat interval
  var NEXT_HAND_MS = 6000;      // pause between hands to show results
  var PRESENCE_BEAT_MS = 4000;
  var DISCONNECT_GRACE_MS = 13000;
  var SEAT_RECLAIM_MS = 120000; // free a seat after this long disconnected

  var E = window.PokerEngine;

  /* ---------------------------------------------------------------------- */
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- look & feel: each player picks their own room, table and deck ----
     Purely local: the choice is saved on this device and changes nothing for
     anyone else at the table. Applied as data-attributes on <html>, where the
     stylesheet turns them into colour variables. */
  var THEMES = {
    bg: [
      { id: "wood",    name: "Oak room",  sw: "linear-gradient(135deg,#7a5433,#4f3520 58%,#2a1c11)" },
      { id: "noir",    name: "Noir",      sw: "linear-gradient(135deg,#39404d,#151920 58%,#07090d)" },
      { id: "velvet",  name: "Velvet",    sw: "linear-gradient(135deg,#a82740,#63131f 58%,#1c060b)" },
      { id: "emerald", name: "Emerald",   sw: "linear-gradient(135deg,#25805e,#0e3b2c 58%,#04120e)" },
      { id: "neon",    name: "Neon city", sw: "linear-gradient(135deg,#8a2bff,#2a1a6e 50%,#00c8ff)" },
      { id: "sunset",  name: "Sunset",    sw: "linear-gradient(135deg,#ffb257,#d6424a 55%,#3a1220)" }
    ],
    table: [
      { id: "green",  name: "Casino green", sw: "linear-gradient(135deg,#2f9068,#15633f 60%,#2c2519)" },
      { id: "blue",   name: "Royal blue",   sw: "linear-gradient(135deg,#3f86dd,#1d4f96 60%,#1f2739)" },
      { id: "red",    name: "Ruby",         sw: "linear-gradient(135deg,#ac403e,#78191c 60%,#2b1815)" },
      { id: "purple", name: "Amethyst",     sw: "linear-gradient(135deg,#7a55c2,#4a2688 60%,#251a35)" },
      { id: "slate",  name: "Slate",        sw: "linear-gradient(135deg,#525b69,#2c333e 60%,#191d24)" },
      { id: "teal",   name: "Lagoon",       sw: "linear-gradient(135deg,#31a7a2,#11706d 60%,#13262a)" }
    ],
    cards: [
      { id: "classic", name: "Classic ivory", sw: "linear-gradient(135deg,#f8f4e9 50%,#3a3026 50%)" },
      { id: "royal",   name: "Royal blue",    sw: "linear-gradient(135deg,#ffffff 50%,#1f47a8 50%)" },
      { id: "crimson", name: "Crimson",       sw: "linear-gradient(135deg,#fdf1ee 50%,#b01c2b 50%)" },
      { id: "noir",    name: "Black deck",    sw: "linear-gradient(135deg,#333a47 50%,#101319 50%)" },
      { id: "emerald", name: "Emerald gold",  sw: "linear-gradient(135deg,#f4faf2 50%,#136b48 50%)" },
      { id: "neon",    name: "Holo",          sw: "linear-gradient(135deg,#f6f2ff 50%,#8a2bff 75%,#00cfe8 100%)" }
    ]
  };
  var MOTIONS = [{ id: "full", name: "Full" }, { id: "low", name: "Reduced" }];
  var THEME_KEY = { bg: "poker_bg", table: "poker_table", cards: "poker_cards", motion: "poker_motion" };
  var THEME_DEF = { bg: "wood", table: "green", cards: "classic", motion: "full" };
  THEMES.motion = MOTIONS;
  function themeGet(kind) {
    var v = lsGet(THEME_KEY[kind], THEME_DEF[kind]);
    var known = THEMES[kind].some(function (t) { return t.id === v; });
    return known ? v : THEME_DEF[kind];
  }
  function themeSet(kind, id) { lsSet(THEME_KEY[kind], id); applyThemes(); }
  function applyThemes() {
    var r = document.documentElement; if (!r) return;
    r.setAttribute("data-bg", themeGet("bg"));
    r.setAttribute("data-table", themeGet("table"));
    r.setAttribute("data-cards", themeGet("cards"));
    r.setAttribute("data-motion", themeGet("motion"));
  }
  applyThemes();

  /* ---------- identity --------------------------------------------------- */
  var clientId = lsGet("poker_cid", null);
  if (!clientId) { clientId = "c_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); lsSet("poker_cid", clientId); }
  var myName = lsGet("poker_name", "");
  var instructorOn = lsGet("poker_teach", "") === "1";

  /* ---------- firebase --------------------------------------------------- */
  var db = null, serverOffset = 0;
  function serverNow() { return Date.now() + serverOffset; }

  function initFirebase() {
    if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.databaseURL || /PASTE_YOUR/.test(FIREBASE_CONFIG.databaseURL || "") || /XXXX/.test(FIREBASE_CONFIG.apiKey || "")) {
      return false;
    }
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.database();
      db.ref(".info/serverTimeOffset").on("value", function (s) { serverOffset = s.val() || 0; });
      return true;
    } catch (e) { console.error("firebase init failed", e); return false; }
  }

  /* ---------- app state -------------------------------------------------- */
  var cur = {
    code: null, ref: null,
    meta: null, seats: [], game: null, requests: {}, host: null, presence: {}, chat: [], shown: {}
  };
  var amHost = false;
  var listeners = [];
  var processing = false, processingSince = 0, myReqAt = 0;
  var hostTimer = null, presenceTimer = null, uiTimer = null, lastBeat = 0;
  var lastCtlSig = null, lastLobbySig = null, lastBoardHand = -1, lastBoardN = 0, lastDealtHand = -1, dealAnim = false, lastBoardTeach = false;
  var revealAnimHand = -1, revealAt = 0, flipReveal = false, winMap = {}, lastBets = {}, dealAt = 0;
  var foldAt = {}, showAt = {}, foldHand = -1;   // when cards hit the table (drives the toss animation)
  var actSig = {}, actAt = {};                   // what each player last did, and when it appeared
  var DEAL_STEP = 0.09;                          // seconds between cards — a dealer's rhythm
  var SWEEP_MS = 700;                            // how long the dealer takes to clear the table
  var SHUFFLE_MS = 1100;                         // …and to riffle the deck afterwards
  var sweepHand = -1, sweptHand = -1, sweepTimer = null;
  var shuffleTimer = null, shuffleOffTimer = null, lastShuffleAt = 0;
  var sweepAt = 0, sweepMeasured = false;        // when the table started clearing
  var sndReady = false, sndLogN = 0, sndBoardN = 0, sndHandNo = -1, sndHandOver = true, sndMyTurn = false;
  function lock() { processing = true; processingSince = Date.now(); }

  /* ---------- sound effects (synthesized with Web Audio — no files, no bandwidth) -------- */
  /* ---------- audio: separate buses for sound effects and background music ---------- */
  var Snd = (function () {
    function clampVol(v) { v = parseInt(v, 10); if (isNaN(v)) v = 50; return Math.max(0, Math.min(100, v)); }
    var legacyMuted = lsGet("poker_sound", "1") === "0";          // honours the old single mute flag
    var ctx = null, sfxBus = null, musBus = null;
    var sfxVol = legacyMuted ? 0 : clampVol(lsGet("poker_sfx", "70"));
    var musVol = legacyMuted ? 0 : clampVol(lsGet("poker_music", "35"));
    function ensure() {
      if (ctx) return ctx;
      try {
        var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
        ctx = new AC();
        sfxBus = ctx.createGain(); sfxBus.gain.value = sfxVol / 100 * 0.6; sfxBus.connect(ctx.destination);
        musBus = ctx.createGain(); musBus.gain.value = musVol / 100 * 0.5; musBus.connect(ctx.destination);
      } catch (e) { ctx = null; }
      return ctx;
    }
    function T() { return ctx.currentTime; }
    function blip(freq, start, dur, type, vol) {
      if (!ctx) return; var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || "sine"; o.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(vol, start + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g).connect(sfxBus); o.start(start); o.stop(start + dur + 0.03);
    }
    function noise(start, dur, vol, ftype, freq, q) {
      if (!ctx) return; var n = Math.max(1, Math.floor(ctx.sampleRate * dur)), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      var s = ctx.createBufferSource(); s.buffer = buf;
      var f = ctx.createBiquadFilter(); f.type = ftype || "bandpass"; f.frequency.value = freq || 2000; if (q) f.Q.value = q;
      var g = ctx.createGain(); g.gain.setValueAtTime(vol, start); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      s.connect(f).connect(g).connect(sfxBus); s.start(start); s.stop(start + dur + 0.03);
    }
    return {
      resume: function () { ensure(); if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} } },
      ctx: function () { return ensure(); },
      musicBus: function () { ensure(); return musBus; },
      sfxVolume: function () { return sfxVol; },
      musicVolume: function () { return musVol; },
      setSfxVolume: function (v) { sfxVol = clampVol(v); lsSet("poker_sfx", String(sfxVol)); lsSet("poker_sound", "1"); if (sfxBus) sfxBus.gain.value = sfxVol / 100 * 0.6; },
      setMusicVolume: function (v) { musVol = clampVol(v); lsSet("poker_music", String(musVol)); lsSet("poker_sound", "1"); if (musBus) musBus.gain.value = musVol / 100 * 0.5; },
      deal: function () { if (!ensure()) return; noise(T(), 0.09, 0.35, "highpass", 1100); },
      check: function () { if (!ensure()) return; blip(190, T(), 0.13, "sine", 0.55); },
      chip: function () { if (!ensure()) return; var t = T(); noise(t, 0.045, 0.3, "bandpass", 2600, 3); noise(t + 0.05, 0.045, 0.24, "bandpass", 3100, 3); },
      bet: function () { if (!ensure()) return; var t = T(); noise(t, 0.05, 0.34, "bandpass", 2300, 3); noise(t + 0.055, 0.05, 0.3, "bandpass", 2800, 3); noise(t + 0.11, 0.055, 0.26, "bandpass", 3300, 3); },
      fold: function () { if (!ensure()) return; noise(T(), 0.22, 0.32, "lowpass", 1500); },
      turn: function () { if (!ensure()) return; var t = T(); blip(660, t, 0.14, "sine", 0.42); blip(880, t + 0.12, 0.2, "sine", 0.42); },
      win: function () { if (!ensure()) return; var t = T(); [523, 659, 784, 1047].forEach(function (f, i) { blip(f, t + i * 0.09, 0.3, "triangle", 0.42); }); },
      tick: function () { if (!ensure()) return; blip(1250, T(), 0.05, "square", 0.13); },
      allin: function () { if (!ensure()) return; var t = T(); noise(t, 0.3, 0.4, "bandpass", 2500, 2); [392, 523, 659].forEach(function (f, i) { blip(f, t + i * 0.07, 0.34, "sawtooth", 0.3); }); },
      click: function () { if (!ensure()) return; blip(900, T(), 0.035, "square", 0.16); },
      // a real riffle: two halves interleaving, the bridge cascade, then squaring the deck
      shuffle: function () {
        if (!ensure()) return; var t = T(), i;
        for (i = 0; i < 16; i++) noise(t + i * 0.022 + Math.random() * 0.007, 0.03, 0.17, "bandpass", 2300 + Math.random() * 1700, 2);
        noise(t + 0.43, 0.2, 0.2, "highpass", 1000);
        for (i = 0; i < 10; i++) noise(t + 0.62 + i * 0.021, 0.03, 0.13, "bandpass", 2000 + Math.random() * 1300, 2);
        noise(t + 0.9, 0.13, 0.22, "lowpass", 1500);
      },
      // one slide per card as the hand is dealt around the table
      dealRound: function (n, step) {
        if (!ensure()) return; var t = T();
        n = Math.max(2, Math.min(24, n || 4));
        for (var i = 0; i < n; i++) noise(t + i * (step || 0.09), 0.07, 0.3, "highpass", 1100 + (i % 2) * 300);
      },
      sweep: function () { if (!ensure()) return; var t = T(); noise(t, 0.3, 0.26, "lowpass", 1800); noise(t + 0.1, 0.22, 0.16, "highpass", 900); }
    };
  })();

  /* ---------- background music: an original chill loop, synthesized live (no audio files) ---------- */
  var Mus = (function () {
    var timer = null, nextBar = 0, barNo = 0, running = false;
    var BPM = 76, BEAT = 60 / BPM, BAR = BEAT * 4;
    // Am7 - Fmaj7 - Cmaj7 - G6
    var CHORDS = [[220.00, 261.63, 329.63, 392.00], [174.61, 220.00, 261.63, 349.23],
                  [261.63, 329.63, 392.00, 493.88], [196.00, 246.94, 293.66, 392.00]];
    function c() { return Snd.ctx(); }
    function pad(f, t, dur, vol) {
      var a = c(), bus = Snd.musicBus(); if (!a || !bus) return;
      var o1 = a.createOscillator(), o2 = a.createOscillator(), g = a.createGain(), lp = a.createBiquadFilter();
      o1.type = "sine"; o2.type = "triangle"; o1.frequency.value = f; o2.frequency.value = f * 1.004;
      lp.type = "lowpass"; lp.frequency.value = 1500;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o1.connect(g); o2.connect(g); g.connect(lp).connect(bus);
      o1.start(t); o2.start(t); o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
    }
    function pluck(f, t, vol) {
      var a = c(), bus = Snd.musicBus(); if (!a || !bus) return;
      var o = a.createOscillator(), g = a.createGain(), lp = a.createBiquadFilter();
      o.type = "triangle"; o.frequency.value = f; lp.type = "lowpass"; lp.frequency.value = 2600;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(g).connect(lp).connect(bus); o.start(t); o.stop(t + 0.6);
    }
    function kick(t) {
      var a = c(), bus = Snd.musicBus(); if (!a || !bus) return;
      var o = a.createOscillator(), g = a.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(bus); o.start(t); o.stop(t + 0.26);
    }
    function hat(t) {
      var a = c(), bus = Snd.musicBus(); if (!a || !bus) return;
      var n = Math.floor(a.sampleRate * 0.05), b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      var s = a.createBufferSource(); s.buffer = b;
      var hp = a.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
      var g = a.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      s.connect(hp).connect(g).connect(bus); s.start(t); s.stop(t + 0.06);
    }
    function scheduleBar(t, i) {
      var ch = CHORDS[i];
      ch.slice(0, 3).forEach(function (f) { pad(f, t, BAR * 0.98, 0.075); });
      for (var s = 0; s < 8; s++) {
        if (s === 3 || s === 6) continue;                       // leave the loop some air
        pluck(ch[(s + i) % ch.length] * (s > 4 ? 2 : 1), t + s * BEAT / 2, 0.05);
      }
      kick(t); kick(t + BEAT * 2);
      for (var h = 0; h < 4; h++) hat(t + BEAT * h + BEAT / 2);
    }
    function pump() {
      var a = c(); if (!a || !running) return;
      while (nextBar < a.currentTime + 1.5) { scheduleBar(nextBar, barNo % CHORDS.length); nextBar += BAR; barNo++; }
    }
    return {
      start: function () {
        var a = c(); if (!a || running || Snd.musicVolume() <= 0) return;
        running = true; nextBar = a.currentTime + 0.15; barNo = 0;
        timer = setInterval(pump, 240); pump();
      },
      stop: function () { running = false; if (timer) clearInterval(timer); timer = null; },
      isOn: function () { return running; },
      sync: function () { if (Snd.musicVolume() > 0) this.start(); else this.stop(); }
    };
  })();

  /* ======================================================================
     SCREENS
     ====================================================================== */
  function show(screen) {
    ["config", "home", "table"].forEach(function (s) {
      var e = $("screen-" + s); if (e) e.hidden = (s !== screen);
    });
  }

  /* ======================================================================
     HOME  (create / join)
     ====================================================================== */
  function initHome() {
    $("home-name").value = myName;
    $("btn-create").onclick = function () { if (!grabName()) return; createTable(); };
    $("btn-goto-join").onclick = function () {
      if (!grabName()) return;
      var code = ($("home-code").value || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{4,6}$/.test(code)) { flash($("home-code"), "Enter the code your friend shared"); return; }
      joinTable(code);
    };
    $("home-code").addEventListener("keydown", function (e) { if (e.key === "Enter") $("btn-goto-join").click(); });
  }

  function grabName() {
    var n = ($("home-name").value || "").trim().slice(0, 16);
    if (n.length < 1) { flash($("home-name"), "Enter your name first"); return false; }
    myName = n; lsSet("poker_name", n); return true;
  }
  function flash(input, msg) {
    input.classList.add("shake");
    setTimeout(function () { input.classList.remove("shake"); }, 500);
    var box = $("home-msg"); if (box) { box.textContent = msg; box.hidden = false; setTimeout(function () { box.hidden = true; }, 3500); }
  }

  function randCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars
    var s = ""; for (var i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function createTable() {
    // Sensible defaults — the host tweaks blinds / chips / timer on the table before starting.
    var name = myName + "'s table";
    var bb = 20, sb = 10, stack = 1000, timerSec = 30;
    $("btn-create").disabled = true;

    (function tryCode(attempt) {
      var code = randCode();
      var ref = db.ref("tables/" + code);
      ref.child("meta").transaction(function (existing) {
        if (existing) return; // taken → abort
        return {
          name: name, createdAt: serverNow(), hostId: clientId,
          bb: bb, sb: sb, startingStack: stack, maxSeats: MAX_SEATS,
          turnMs: timerSec * 1000, started: false,
          status: "lobby", handNo: 0, lastButtonId: null, nextHandAt: 0
        };
      }, function (err, committed) {
        if (err) { $("btn-create").disabled = false; var m = (err && (err.message || err.code)) || ""; alert(/permission|denied/i.test(m) ? "Couldn't create the table — your database is blocking writes. Set your Realtime Database Rules to allow access (see the setup steps), then try again." : ("Couldn't create the table, please try again." + (m ? " (" + m + ")" : ""))); return; }
        if (!committed) { if (attempt < 6) return tryCode(attempt + 1); $("btn-create").disabled = false; alert("Could not find a free table code, try again."); return; }
        $("btn-create").disabled = false;
        enterTable(code, /*autoSeat*/ true, stack);
      });
    })(0);
  }

  function joinTable(code) {
    db.ref("tables/" + code + "/meta").get().then(function (snap) {
      if (!snap.exists()) { flash($("home-code"), "No table with code " + code); return; }
      enterTable(code, /*autoSeat*/ true);
    }).catch(function () { flash($("home-code"), "Could not reach the table — check your connection"); });
  }

  /* ======================================================================
     ENTER TABLE  — subscribe to everything, take a seat, start loops
     ====================================================================== */
  function enterTable(code, autoSeat, knownStack) {
    detachTable();
    cur.code = code;
    cur.ref = db.ref("tables/" + code);
    lsSet("poker_last_table", code);

    // presence
    var presRef = cur.ref.child("presence/" + clientId);
    presRef.onDisconnect().remove();
    function beat() { presRef.set({ name: myName, ts: firebase.database.ServerValue.TIMESTAMP }); }
    beat();
    presenceTimer = setInterval(beat, PRESENCE_BEAT_MS);

    sub("meta", function (v) { cur.meta = v; onData(); });
    sub("seats", function (v) { cur.seats = normSeats(v); onData(); });
    sub("game", function (v) { cur.game = hydrateGame(v); onData(); });
    sub("host", function (v) { cur.host = v; onData(); });
    sub("presence", function (v) { cur.presence = v || {}; onData(); });
    sub("shown", function (v) {
      var before = shownCount(); cur.shown = v || {};
      if (shownCount() > before) revealAt = Date.now();   // animate the newly shown hand
      onData();
    });
    sub("requests", function (v) { cur.requests = v || {}; if (amHost) tryProcess(); });
    cur.ref.child("chat").limitToLast(40).on("value", function (s) {
      var arr = []; s.forEach(function (c) { arr.push(c.val()); }); cur.chat = arr; renderChat();
    });
    listeners.push({ ref: cur.ref.child("chat"), ev: "value" });

    hostTimer = setInterval(hostTick, 500);   // responsive loop; heartbeat itself is throttled
    uiTimer = setInterval(tickUI, 100);   // smooth countdown (anchored locally, so this is cheap)

    show("table");
    buildTableSkeleton();

    if (autoSeat) {
      // wait a beat for seats to load, then sit
      setTimeout(function () { takeSeat(knownStack); }, 500);
    }
  }

  function sub(path, cb) {
    var ref = cur.ref.child(path);
    ref.on("value", function (s) { cb(s.val()); });
    listeners.push({ ref: ref, ev: "value" });
  }

  function detachTable() {
    clearTimeout(sweepTimer); clearTimeout(shuffleTimer); clearTimeout(shuffleOffTimer);
    sweepTimer = shuffleTimer = shuffleOffTimer = null; sweepHand = -1; sweptHand = -1;
    listeners.forEach(function (l) { try { l.ref.off(l.ev); } catch (e) {} });
    listeners = [];
    if (hostTimer) clearInterval(hostTimer); hostTimer = null;
    if (presenceTimer) clearInterval(presenceTimer); presenceTimer = null;
    if (uiTimer) clearInterval(uiTimer); uiTimer = null;
    if (cur.ref) { try { cur.ref.child("presence/" + clientId).remove(); } catch (e) {} }
    cur = { code: null, ref: null, meta: null, seats: [], game: null, requests: {}, host: null, presence: {}, chat: [], shown: {} };
    amHost = false;
  }

  // Firebase RTDB drops empty arrays (an empty preflop board vanishes) and can turn sparse
  // arrays into objects. Rebuild the game so board/log/players/hole are always real arrays.
  function hydrateGame(v) {
    if (!v) return v;
    if (!v.board) v.board = [];
    else if (!Array.isArray(v.board)) v.board = objToArr(v.board);
    if (!v.log) v.log = [];
    else if (!Array.isArray(v.log)) v.log = objToArr(v.log);
    if (v.players && !Array.isArray(v.players)) v.players = objToArr(v.players);
    if (Array.isArray(v.players)) v.players.forEach(function (p) {
      if (p && p.hole && !Array.isArray(p.hole)) p.hole = objToArr(p.hole);
    });
    if (v.deck && !Array.isArray(v.deck)) v.deck = objToArr(v.deck);
    return v;
  }
  function objToArr(o) { var a = []; Object.keys(o).forEach(function (k) { var i = parseInt(k, 10); if (!isNaN(i)) a[i] = o[k]; }); for (var j = 0; j < a.length; j++) if (a[j] === undefined) a[j] = null; return a; }

  // Firebase RTDB turns sparse arrays into objects; always normalize to a fixed-length array.
  function normSeats(v) {
    var max = (cur.meta && cur.meta.maxSeats) || MAX_SEATS;
    var a = [];
    for (var i = 0; i < max; i++) a[i] = (v && v[i]) ? v[i] : null;
    return a;
  }
  function mySeatIndex() {
    for (var i = 0; i < cur.seats.length; i++) if (cur.seats[i] && cur.seats[i].id === clientId) return i;
    return -1;
  }

  function takeSeat(knownStack) {
    if (mySeatIndex() !== -1) return;
    var stack = knownStack || (cur.meta ? cur.meta.startingStack : 1000);
    cur.ref.child("seats").transaction(function (seats) {
      seats = normSeats(seats);
      // already seated?
      for (var i = 0; i < seats.length; i++) if (seats[i] && seats[i].id === clientId) return seats;
      for (var j = 0; j < seats.length; j++) {
        if (!seats[j]) {
          seats[j] = { id: clientId, name: myName, stack: stack, sittingOut: false, joinedAt: serverNow() };
          return seats;
        }
      }
      return seats; // full
    }, function (err, committed, snap) {
      if (mySeatIndex() === -1 && !err) {
        // table full
        toast("This table is full (" + MAX_SEATS + " seats).");
      }
    });
  }

  function leaveTable() {
    var idx = mySeatIndex();
    if (idx !== -1) {
      cur.ref.child("seats").transaction(function (seats) {
        seats = normSeats(seats);
        if (seats[idx] && seats[idx].id === clientId) seats[idx] = null;
        return seats;
      });
    }
    detachTable();
    show("home");
  }

  /* ======================================================================
     DATA CHANGE → render + host bookkeeping
     ====================================================================== */
  function onData() {
    amHost = !!(cur.host && cur.host.id === clientId);
    if (myReqAt && !isMyTurn()) myReqAt = 0;   // my action landed → clear the pending marker
    render();
    if (amHost) { tryProcess(); maybeBotAct(); }
  }

  /* ======================================================================
     HOST LOOP
     ====================================================================== */
  function isBotId(id) { return typeof id === "string" && id.indexOf("bot_") === 0; }
  function connected(seat) {
    if (!seat) return false;
    if (seat.isBot) return true;                 // the Dealer bot is always "present"
    var p = cur.presence && cur.presence[seat.id];
    if (!p) return false;
    return (serverNow() - (p.ts || 0)) < DISCONNECT_GRACE_MS;
  }

  function hostTick() {
    if (!cur.ref || !cur.meta) return;
    // Watchdog runs UNCONDITIONALLY so a hung lock can never freeze the table.
    if (processing && Date.now() - processingSince > 3500) processing = false;
    claimHostIfStale();

    var g = cur.game;
    // Rescue A: a hand stuck well past its deadline with nobody driving → any seated human grabs host.
    if (!amHost && g && !g.handOver && g.deadline && serverNow() > g.deadline + 2500 && mySeatIndex() >= 0) {
      forceClaimHost();
    }
    // Rescue B: my own action has been pending too long (host slow or gone) → take over and drive it.
    if (!amHost && myReqAt && Date.now() - myReqAt > 3500 && mySeatIndex() >= 0) {
      forceClaimHost();
    }
    if (!amHost) return;

    // heartbeat — throttled so the 500ms loop doesn't spam Firebase
    if (Date.now() - lastBeat >= HOST_BEAT_MS) { lastBeat = Date.now(); cur.ref.child("host").update({ id: clientId, ts: serverNow() }); }

    reclaimDeadSeats();

    if (g && !g.handOver) {
      tryProcess();          // safety net: apply any pending action even if an event was missed
      maybeBotAct();
      // turn timer → auto-act (and unstick anything that's overdue)
      if (g.deadline && serverNow() > g.deadline) autoAct();
    } else {
      // between hands → keep bots funded, then maybe start next
      rebuyBots();
      maybeStartHand();
    }
  }
  function forceClaimHost() {
    cur.ref.child("host").transaction(function () { return { id: clientId, ts: serverNow() }; });
  }

  function turnMs() { return (cur.meta && cur.meta.turnMs) || TURN_MS; }

  // Keep any Dealer bots topped up between hands so they keep playing.
  function rebuyBots() {
    if (cur.game && !cur.game.handOver) return;
    var seats = normSeats(cur.seats); var changed = false;
    for (var i = 0; i < seats.length; i++) { var s = seats[i]; if (s && s.isBot && s.stack <= 0) { s.stack = cur.meta.startingStack; changed = true; } }
    if (changed) cur.ref.child("seats").set(seats);
  }

  // ---- host lobby controls ----
  // Real names, not "Bot 3 🤖". A table full of labels is what made the history read like a
  // server log; the seat itself says who's a bot (the ring on the avatar and the BOT tag).
  var BOT_NAMES = ["Mason", "Ivy", "Duke", "Nadia", "Rex", "Pilar", "Sully", "Odette",
                   "Cash", "Vera", "Tito", "Greta", "Bishop", "Lola", "Rocco", "Hana"];
  function freeBotName(seats) {
    var taken = {};
    (seats || []).forEach(function (s) { if (s && s.name) taken[String(s.name).toLowerCase()] = 1; });
    for (var i = 0; i < BOT_NAMES.length; i++) if (!taken[BOT_NAMES[i].toLowerCase()]) return BOT_NAMES[i];
    return "Player " + (Math.floor(Math.random() * 90) + 10);
  }
  function hostAddBot() {
    var seats = normSeats(cur.seats);
    for (var i = 0; i < seats.length; i++) {
      if (!seats[i]) {
        seats[i] = { id: "bot_" + Date.now().toString(36) + "_" + i, name: freeBotName(seats), stack: cur.meta.startingStack, sittingOut: false, isBot: true, joinedAt: serverNow() };
        cur.ref.child("seats").set(seats);
        return;
      }
    }
    toast("Every seat is taken.");
  }
  function hostRemoveSeat(idx) {
    var seats = normSeats(cur.seats);
    if (seats[idx] && seats[idx].isBot) { seats[idx] = null; cur.ref.child("seats").set(seats); }
  }
  function hostStartGame() {
    if (eligibleSeatsCount() < 2) hostAddBot();          // never start you alone — add a Dealer
    cur.ref.child("meta").update({ started: true, status: "playing", nextHandAt: 0 });
  }

  // Timestamp-driven bot scheduling: re-evaluated every host tick, so it can never get
  // stuck in a half-scheduled state (the old setTimeout+flag approach occasionally did).
  var botTurnKey = null, botDueAt = 0;
  function maybeBotAct() {
    if (!amHost || processing) return;
    var g = cur.game;
    if (!g || g.handOver) { botTurnKey = null; return; }
    var p = g.players[g.toAct];
    if (!p || !isBotId(p.id)) { botTurnKey = null; return; }
    var key = g.handNo + ":" + g.toAct;
    var nowT = Date.now();
    if (botTurnKey !== key) {                       // fresh bot turn → arm a human-like think delay
      botTurnKey = key;
      var facingBet = (g.currentBet - p.bet) > 0;
      botDueAt = nowT + 700 + Math.random() * 1500 + (facingBet ? Math.random() * 700 : 0);
      return;
    }
    if (nowT >= botDueAt) botAct();                 // think time elapsed → act
  }
  function botAct() {
    if (!amHost || processing) return;
    var g = cur.game;
    if (!g || g.handOver) return;
    var p = g.players[g.toAct];
    if (!p || !isBotId(p.id)) return;
    lock();
    try {
      var g2 = clone(g);
      var action = E.botDecision(g2, p.id);
      var r = E.applyAction(g2, p.id, action);
      if (!r.ok) { var la = E.legalActions(g2); action = (la && la.check) ? { type: "check" } : { type: "fold" }; r = E.applyAction(g2, p.id, action); }
      if (r.ok) finishApply(g2); else processing = false;
    } catch (e) { processing = false; }
  }

  function claimHostIfStale() {
    var h = cur.host;
    var stale = !h || !h.id || (serverNow() - (h.ts || 0) > HOST_TIMEOUT_MS);
    var iAmHost = h && h.id === clientId;
    if (iAmHost || !stale) return;
    cur.ref.child("host").transaction(function (cure) {
      if (!cure || !cure.id || (serverNow() - (cure.ts || 0) > HOST_TIMEOUT_MS)) {
        return { id: clientId, ts: serverNow() };
      }
      return; // someone valid holds it
    });
  }

  function eligibleSeats() {
    // seated + has chips + connected + not manually sitting out
    var out = [];
    for (var i = 0; i < (cur.seats || []).length; i++) {
      var s = cur.seats[i];
      if (s && s.stack > 0 && connected(s) && !s.sittingOut) out.push({ seat: i, s: s });
    }
    return out;
  }

  function reclaimDeadSeats() {
    if (cur.game && !cur.game.handOver) return; // don't touch seats mid-hand
    var changed = false;
    var seats = cur.seats ? cur.seats.slice() : [];
    for (var i = 0; i < seats.length; i++) {
      var s = seats[i];
      if (s && !connected(s)) {
        var p = cur.presence && cur.presence[s.id];
        var lastTs = p ? (p.ts || 0) : (s.joinedAt || 0);
        if (serverNow() - lastTs > SEAT_RECLAIM_MS) { seats[i] = null; changed = true; }
      }
    }
    if (changed) cur.ref.child("seats").set(seats);
  }

  function maybeStartHand() {
    if (!cur.meta.started) return;               // wait for the host to press Start
    var elig = eligibleSeats();
    if (elig.length < 2) {
      if (cur.meta.status !== "lobby") cur.ref.child("meta").update({ status: "lobby" });
      return;
    }
    var now = serverNow();
    if (cur.game && cur.game.handOver) {
      var at = cur.meta.nextHandAt || 0;
      if (!at) { cur.ref.child("meta").update({ nextHandAt: now + NEXT_HAND_MS }); return; }
      if (now < at) return;
    }
    startHandNow();
  }

  function startHandNow() {
    var meta = cur.meta;
    // Build players list from ALL seated (so button rotation is stable), marking sitOut for those who can't play.
    var players = [];
    var seatOfPlayer = {};
    for (var i = 0; i < cur.seats.length; i++) {
      var s = cur.seats[i];
      if (!s) continue;
      var out = s.sittingOut || !connected(s) || s.stack <= 0;
      players.push({ id: s.id, name: s.name, stack: s.stack, sittingOut: out });
      seatOfPlayer[s.id] = i;
    }
    var playable = players.filter(function (p) { return !p.sittingOut; });
    if (playable.length < 2) { cur.ref.child("meta").update({ status: "lobby", nextHandAt: 0 }); return; }

    // previous button index within this players list
    var prevBtn = -1;
    if (meta.lastButtonId) { for (var k = 0; k < players.length; k++) if (players[k].id === meta.lastButtonId) prevBtn = k; }

    var g = E.startHand(players, { button: prevBtn, sb: meta.sb, bb: meta.bb });
    if (g.error) { cur.ref.child("meta").update({ status: "lobby", nextHandAt: 0 }); return; }

    g.handNo = (meta.handNo || 0) + 1;
    g.seatOf = seatOfPlayer;               // map player id → table seat index (for layout)
    g.deadline = serverNow() + turnMs();
    if (g.handOver) g.deadline = 0;        // rare: everyone all-in from blinds resolved instantly

    // clear old requests, write game + meta
    cur.ref.child("requests").remove();
    cur.ref.child("shown").remove();      // last hand's show/muck choices
    cur.ref.child("game").set(g);
    cur.ref.child("meta").update({
      status: "playing", handNo: g.handNo,
      lastButtonId: g.players[g.button].id, nextHandAt: 0
    });
    if (g.handOver) settleStacks(g);
  }

  function tryProcess() {
    if (!amHost || processing || !cur.game || cur.game.handOver) return;
    var g = cur.game;
    var actor = g.players[g.toAct];
    if (!actor) return;
    var req = cur.requests && cur.requests[actor.id];
    if (!req) return;
    if (req.handNo !== g.handNo || req.toAct !== g.toAct) { // stale request
      cur.ref.child("requests/" + actor.id).remove(); return;
    }
    lock();
    try {
      var g2 = clone(g);
      var action = { type: req.type };
      if (req.type === "raise") action.amount = req.amount;
      var r = E.applyAction(g2, actor.id, action);
      cur.ref.child("requests/" + actor.id).remove();
      if (!r.ok) { processing = false; return; }
      finishApply(g2);
    } catch (e) { processing = false; try { cur.ref.child("requests/" + actor.id).remove(); } catch (e2) {} }
  }

  function autoAct() {
    if (!amHost || processing || !cur.game || cur.game.handOver) return;
    var g = cur.game;
    var actor = g.players[g.toAct];
    if (!actor) return;
    lock();
    try {
      var g2 = clone(g);
      var la = E.legalActions(g2);
      var action = (la && la.check) ? { type: "check" } : { type: "fold" };
      var r = E.applyAction(g2, actor.id, action);
      if (r.ok) { g2.log.push(actor.name + " auto-" + action.type + " (timed out)"); finishApply(g2); }
      else { processing = false; }
    } catch (e) { processing = false; }
  }

  function finishApply(g2) {
    if (!g2.handOver) g2.deadline = serverNow() + turnMs();
    else g2.deadline = 0;
    cur.ref.child("game").set(g2).then(function () {
      processing = false;
      if (g2.handOver) { settleStacks(g2); cur.ref.child("meta").update({ nextHandAt: serverNow() + NEXT_HAND_MS }); }
      else tryProcess();
    }).catch(function () { processing = false; });
  }

  // Write updated stacks from a finished hand back into the seats (persistent bankroll).
  function settleStacks(g) {
    var seats = cur.seats ? cur.seats.slice() : [];
    g.players.forEach(function (p) {
      var idx = g.seatOf ? g.seatOf[p.id] : -1;
      if (idx == null || idx < 0 || !seats[idx] || seats[idx].id !== p.id) {
        // find by id fallback
        for (var i = 0; i < seats.length; i++) if (seats[i] && seats[i].id === p.id) { idx = i; break; }
      }
      if (idx != null && idx >= 0 && seats[idx] && seats[idx].id === p.id) seats[idx].stack = p.stack;
    });
    cur.ref.child("seats").set(seats);
  }

  /* ======================================================================
     PLAYER ACTIONS  (write a request; host applies)
     ====================================================================== */
  function myGamePlayer() {
    if (!cur.game || !cur.game.players) return null;
    return cur.game.players.find(function (p) { return p.id === clientId; }) || null;
  }
  function isMyTurn() {
    var g = cur.game;
    return !!(g && !g.handOver && g.players[g.toAct] && g.players[g.toAct].id === clientId);
  }
  function sendAction(type, amount) {
    if (!isMyTurn()) return;
    var g = cur.game;
    // FAST PATH: if I'm running the table (host), apply my own action immediately.
    // No Firebase round-trip → no stall, folds/checks/raises are instant and reliable.
    if (amHost && !processing) {
      lock();
      try {
        var g2 = clone(g);
        var act = { type: type };
        if (type === "raise") act.amount = amount;
        var r = E.applyAction(g2, clientId, act);
        if (r.ok) { myReqAt = 0; finishApply(g2); return; }
        processing = false;                    // engine rejected → fall through to request path
      } catch (e) { processing = false; }
    }
    // Otherwise: write a request for whoever is hosting to apply.
    var req = { type: type, handNo: g.handNo, toAct: g.toAct, ts: serverNow() };
    if (type === "raise") req.amount = amount;
    myReqAt = Date.now();
    cur.ref.child("requests/" + clientId).set(req);
  }

  /* ======================================================================
     RENDERING
     ====================================================================== */
  function buildTableSkeleton() {
    var t = $("screen-table");
    t.innerHTML =
      '<header class="tbar">' +
        '<button id="btn-leave" class="ghost" title="Leave table">‹ Leave</button>' +
        '<div class="tbar-mid"><span id="tbl-name">Table</span>' +
          '<button id="btn-code" class="code-chip" title="Copy invite link"><span id="tbl-code">----</span> <span class="cp">copy link</span></button>' +
        '</div>' +
        '<div class="tbar-tools">' +
          '<button id="btn-theme" class="ghost theme-btn" title="Table, card &amp; background styles">🎨</button>' +
          '<button id="btn-sound" class="ghost sound-btn" title="Music &amp; sound settings">🔊</button>' +
        '</div>' +
      '</header>' +
      '<div id="teach-banner" class="teach-banner" hidden><span>◉ Promo active</span> <button id="btn-teach-off" class="linkbtn">turn off</button></div>' +
      '<div id="sound-panel" class="sound-panel" hidden>' +
        '<div class="sp-title">Audio</div>' +
        '<label class="sp-row"><span>Music</span><input id="sp-music" type="range" min="0" max="100" step="5"><b id="sp-music-val"></b></label>' +
        '<label class="sp-row"><span>Sound effects</span><input id="sp-sfx" type="range" min="0" max="100" step="5"><b id="sp-sfx-val"></b></label>' +
      '</div>' +
      '<div id="theme-panel" class="theme-panel" hidden>' +
        '<div class="sp-title">Style</div>' +
        '<div class="tp-group"><div class="tp-lab">Background</div><div class="tp-swatches" id="tp-bg"></div></div>' +
        '<div class="tp-group"><div class="tp-lab">Table</div><div class="tp-swatches" id="tp-table"></div></div>' +
        '<div class="tp-group"><div class="tp-lab">Cards</div><div class="tp-swatches" id="tp-cards"></div></div>' +
        '<div class="tp-group"><div class="tp-lab">Animations</div><div class="tp-seg" id="tp-motion"></div></div>' +
        '<div class="tp-note" id="tp-note">Only changes what <b>you</b> see.</div>' +
      '</div>' +
      '<main class="felt">' +
        '<div class="table-oval">' +
          '<div class="rail"></div>' +
          '<div class="center">' +
            '<div id="pot" class="pot"></div>' +
            '<div id="board" class="board"></div>' +
            '<div id="deck" class="deck" hidden><i class="dk"></i><i class="dk"></i><i class="dk"></i><i class="dk"></i></div>' +
            '<div id="phase" class="phase"></div>' +
          '</div>' +
          '<div id="bets-layer" class="bets-layer"></div>' +
          '<div id="seats-layer" class="seats-layer"></div>' +
          '<div id="lobby-box" class="lobby-box" hidden></div>' +
        '</div>' +
      '</main>' +
      '<div class="sidecol">' +
      '<section id="me-panel" class="me-panel"></section>' +
      '<section id="controls" class="controls" hidden></section>' +
      '<div class="drawer" id="drawer">' +
        '<div class="drawer-tabs">' +
          '<button class="dtab active" data-tab="log">History</button>' +
          '<button class="dtab" data-tab="chat">Chat</button>' +
          '<button class="dtab-toggle" id="drawer-toggle" title="Show/hide">▲</button>' +
        '</div>' +
        '<div id="tab-log" class="tabpane"><div id="log" class="log"></div></div>' +
        '<div id="tab-chat" class="tabpane" hidden>' +
          '<div id="chat" class="chat"></div>' +
          '<form id="chat-form" class="chat-form"><input id="chat-input" maxlength="140" placeholder="Message the table…" autocomplete="off"><button class="gold sm">Send</button></form>' +
        '</div>' +
      '</div>' +
      '</div>';

    $("btn-leave").onclick = leaveTable;
    $("btn-code").onclick = copyInvite;
    (function () {
      var sb = $("btn-sound"), panel = $("sound-panel"); if (!sb || !panel) return;
      var mus = $("sp-music"), sfx = $("sp-sfx"), musV = $("sp-music-val"), sfxV = $("sp-sfx-val");
      function icon() {
        var off = Snd.musicVolume() <= 0 && Snd.sfxVolume() <= 0;
        sb.textContent = off ? "🔇" : "🔊"; sb.classList.toggle("muted", off);
      }
      function sync() {
        mus.value = Snd.musicVolume(); sfx.value = Snd.sfxVolume();
        musV.textContent = Snd.musicVolume() + "%"; sfxV.textContent = Snd.sfxVolume() + "%"; icon();
      }
      sync();
      sb.onclick = function (e) {
        e.stopPropagation(); Snd.resume();
        var tp = $("theme-panel"); if (tp) tp.hidden = true;        // one popover at a time
        panel.hidden = !panel.hidden; if (!panel.hidden) sync();
      };
      panel.onclick = function (e) { e.stopPropagation(); };
      document.addEventListener("click", function () { if (!panel.hidden) panel.hidden = true; });
      mus.oninput = function () { Snd.resume(); Snd.setMusicVolume(mus.value); musV.textContent = Snd.musicVolume() + "%"; Mus.sync(); icon(); };
      sfx.oninput = function () { Snd.resume(); Snd.setSfxVolume(sfx.value); sfxV.textContent = Snd.sfxVolume() + "%"; icon(); };
      sfx.onchange = function () { if (Snd.sfxVolume() > 0) Snd.chip(); };
    })();
    // Style picker: background / table / deck, each saved on this device only.
    (function () {
      var tb = $("btn-theme"), panel = $("theme-panel"); if (!tb || !panel) return;
      var note = $("tp-note");
      function fill(kind, host) {
        if (!host) return;
        host.innerHTML = "";
        var chosen = themeGet(kind);
        THEMES[kind].forEach(function (t) {
          var b = el("button", "sw-btn" + (t.id === chosen ? " on" : ""));
          b.type = "button"; b.style.background = t.sw; b.title = t.name;
          b.setAttribute("data-kind", kind); b.setAttribute("data-id", t.id); b.setAttribute("aria-label", t.name);
          b.onclick = function (e) {
            e.stopPropagation();
            themeSet(kind, t.id); fill(kind, host);
            if (note) note.innerHTML = esc(t.name) + " \u2014 only changes what <b>you</b> see.";
            Snd.chip();
          };
          host.appendChild(b);
        });
      }
      function fillMotion() {
        var host = $("tp-motion"); if (!host) return;
        host.innerHTML = "";
        var chosen = themeGet("motion");
        MOTIONS.forEach(function (m) {
          var b = el("button", "seg-btn" + (m.id === chosen ? " on" : ""), m.name);
          b.type = "button"; b.setAttribute("data-id", m.id);
          b.onclick = function (e) { e.stopPropagation(); themeSet("motion", m.id); fillMotion(); Snd.click(); };
          host.appendChild(b);
        });
      }
      function fillAll() { fill("bg", $("tp-bg")); fill("table", $("tp-table")); fill("cards", $("tp-cards")); fillMotion(); }
      fillAll();
      tb.onclick = function (e) {
        e.stopPropagation(); Snd.resume();
        var sp = $("sound-panel"); if (sp) sp.hidden = true;
        panel.hidden = !panel.hidden; if (!panel.hidden) fillAll();
      };
      panel.onclick = function (e) { e.stopPropagation(); };
      document.addEventListener("click", function () { if (!panel.hidden) panel.hidden = true; });
    })();
    // Discreet trigger: tap the table name 4x quickly to open the private code prompt.
    (function () {
      var n = 0, t = 0;
      $("tbl-name").addEventListener("click", function () {
        var now = Date.now(); if (now - t > 2500) n = 0; t = now; n++;
        if (n >= 4) { n = 0; teachPrompt(); }
      });
    })();
    $("btn-teach-off").onclick = function () { setTeach(false); };
    // Hand history / chat collapse so the table always fits one screen. Closed by default.
    (function () {
      var drawer = $("drawer"), tog = $("drawer-toggle");
      function setTab(name) {
        document.querySelectorAll(".dtab").forEach(function (x) { x.classList.toggle("active", x.dataset.tab === name); });
        $("tab-log").hidden = name !== "log";
        $("tab-chat").hidden = name !== "chat";
      }
      document.querySelectorAll(".dtab").forEach(function (b) {
        b.onclick = function () {
          var wasActive = b.classList.contains("active"), isOpen = drawer.classList.contains("open");
          setTab(b.dataset.tab);
          if (wasActive && isOpen) drawer.classList.remove("open");   // tap the open tab again to collapse
          else drawer.classList.add("open");
        };
      });
      function remember() { lsSet("poker_drawer", drawer.classList.contains("open") ? "1" : "0"); }
      document.querySelectorAll(".dtab").forEach(function (b) { b.addEventListener("click", remember); });
      if (tog) tog.onclick = function () { drawer.classList.toggle("open"); remember(); };
      setTab("log");
      var pref = lsGet("poker_drawer", "");
      if (pref === "1" || (pref === "" && window.innerWidth >= 900)) drawer.classList.add("open");
    })();
    $("chat-form").onsubmit = function (e) {
      e.preventDefault();
      var v = ($("chat-input").value || "").trim().slice(0, 140);
      if (!v) return;
      cur.ref.child("chat").push({ name: myName, text: v, ts: serverNow() });
      $("chat-input").value = "";
    };
    updateTeachUI();
  }

  var SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" };
  var ACT_CLASS = { "FOLD": "a-fold", "CHECK": "a-check", "CALL": "a-call", "BET": "a-raise", "RAISE": "a-raise", "ALL IN": "a-allin" };
  function cardEl(card, faceUp) {
    var d = el("div", "card" + (faceUp ? "" : " back"));
    if (faceUp && card) {
      var r = card[0] === "T" ? "10" : card[0];
      var s = card[1];
      d.classList.add(s === "h" || s === "d" ? "red" : "blk");
      d.innerHTML = '<span class="cr">' + r + '</span><span class="cs">' + SUIT[s] + '</span>';
    }
    return d;
  }

  /* ---------- avatars & table geometry (WSOP-style oval) ------------------ */
  var AV_GRADS = [["#ff8787", "#c92a2a"], ["#faa2c1", "#a61e4d"], ["#e599f7", "#862e9c"], ["#b197fc", "#5f3dc4"], ["#91a7ff", "#364fc7"], ["#74c0fc", "#1864ab"], ["#66d9e8", "#0b7285"], ["#63e6be", "#087f5b"], ["#8ce99a", "#2b8a3e"], ["#c0eb75", "#5c940d"], ["#ffd43b", "#e67700"], ["#ffc078", "#d9480f"]];
  var AV_EMO = ["🦊", "🐼", "🐵", "🦁", "🐯", "🐸", "🐙", "🦉", "🐺", "🐷", "🐮", "🐨", "🦄", "🐲", "🦈", "🐳", "🦖", "🐝", "🦅", "🦩", "🐴", "🐧", "🐢", "🦌", "🐰", "🐹"];
  function hnum(s) { var h = cyrb53(String(s || "x")); return parseInt(h.slice(-9), 10) || 0; }
  function avatarFor(id) {
    if (isBotId(id)) return { grad: ["#454b57", "#20232b"], emo: "🤖", bot: true };
    var n = hnum(id);
    return { grad: AV_GRADS[n % AV_GRADS.length], emo: AV_EMO[Math.floor(n / 7) % AV_EMO.length] };
  }
  // position of seat k of n around the oval (percent of the oval box). k=0 = bottom (me).
  function seatXY(k, n) {
    var cx = 50, cy = 46, rx = 38, ry = 34;
    var a = (90 + k * 360 / n) * Math.PI / 180;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a), a: a };
  }
  function betXY(k, n) {
    var cx = 50, cy = 46, rx = 20, ry = 15;
    var a = (90 + k * 360 / n) * Math.PI / 180;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  }
  // players ordered so I sit at the bottom, others fan out clockwise from me.
  function orderedFromMe(players) {
    var idx = -1;
    for (var i = 0; i < players.length; i++) if (players[i].id === clientId) { idx = i; break; }
    if (idx < 0) idx = 0;
    var out = [];
    for (var j = 0; j < players.length; j++) out.push({ p: players[(idx + j) % players.length], k: j });
    return out;
  }

  function render() {
    if (!cur.ref) return;
    if (cur.meta) { $("tbl-name").textContent = cur.meta.name || "Table"; $("tbl-code").textContent = cur.code; }
    // A fresh hand deals the hole cards in. Like the end-of-hand reveal, this is held on a
    // short time window rather than a single render: a new hand lands as a burst of updates
    // (game → seats → meta) and a one-shot flag gets wiped before the cards ever paint.
    if (cur.game && !cur.game.handOver) {
      if (cur.game.handNo !== lastDealtHand) { lastDealtHand = cur.game.handNo; dealAt = Date.now(); }
      dealAnim = (Date.now() - dealAt) < dealWindowMs();
    } else dealAnim = false;
    // End-of-hand reveal + winner celebration. Hold the flip/float classes on for a short
    // window so they survive the burst of re-renders that fire when a hand settles (game→seats→meta).
    flipReveal = false; winMap = {};
    if (cur.game && cur.game.handOver) {
      winMap = winnersMap(cur.game);
      if (cur.game.handNo !== revealAnimHand) { revealAnimHand = cur.game.handNo; revealAt = Date.now(); }
      flipReveal = (Date.now() - revealAt) < 1200;
      scheduleSweep();
    }
    renderSeats();
    renderCenter();
    applySweepClasses();
    applyCardOrigins();
    renderMe();
    renderControls();
    renderLog();
    updateTeachUI();
    soundTick();
  }

  /* ---------- the dealer's deck -------------------------------------------
     Cards are dealt OUT of the stack on the right of the table and swept back
     INTO it. Both are measured from the deck's real position on screen, so they
     stay right at any window size and on any table style. */
  function deckAnchor() {
    var d = $("deck");
    if (!d || d.hidden) return null;
    var r = d.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function setOrigin(el, a, xp, yp) {
    var r = el.getBoundingClientRect();
    el.style.setProperty(xp, Math.round(a.x - (r.left + r.width / 2)) + "px");
    el.style.setProperty(yp, Math.round(a.y - (r.top + r.height / 2)) + "px");
  }
  function applyCardOrigins() {
    var a = deckAnchor(); if (!a) return;
    var dealt = document.querySelectorAll("#seats-layer .card.deal, #board .card.deal");
    if (dealt.length) {
      // zero the offsets first: the card is already sitting on its 0% keyframe, and
      // measuring it there would fold the old offset into the new one. Rotation and
      // scale are about the centre, so they don't move the point we measure.
      dealt.forEach(function (c) { c.style.setProperty("--dx", "0px"); c.style.setProperty("--dy", "0px"); });
      dealt.forEach(function (c) { setOrigin(c, a, "--dx", "--dy"); });
    }
    var g = cur.game;
    if (g && g.handOver && g.handNo === sweptHand) {
      var elapsed = (Date.now() - sweepAt) / 1000;
      // The board keeps its elements across renders, so it's measured once — while the cards
      // are still at rest — and then left alone to run.
      if (!sweepMeasured) {
        document.querySelectorAll("#board .card").forEach(function (c) { setOrigin(c, a, "--sx", "--sy"); });
        sweepMeasured = true;
      }
      // The seats are rebuilt on EVERY render, and a brand-new element starts its animation
      // from the top — which is why the hands were flying back to the deck again and again
      // whenever anything else updated mid-sweep (a heartbeat, someone showing their cards).
      // Anchoring the delay to when the sweep began makes a fresh element pick the animation
      // up where it already was, and land finished once the sweep is over.
      document.querySelectorAll("#seats-layer .pod-cards .card").forEach(function (c) {
        setOrigin(c, a, "--sx", "--sy");
        c.style.animationDelay = (-elapsed).toFixed(2) + "s";
      });
    }
  }
  function startShuffle() {
    var d = $("deck"); if (!d || d.hidden) return;
    lastShuffleAt = Date.now();
    Snd.shuffle();
    d.classList.remove("shuffling"); void d.offsetWidth; d.classList.add("shuffling");
    clearTimeout(shuffleOffTimer);
    shuffleOffTimer = setTimeout(function () { d.classList.remove("shuffling"); }, SHUFFLE_MS + 60);
  }

  /* ---------- clearing the table ------------------------------------------
     Just before the next hand is dealt, the dealer sweeps the board and every
     hand still lying on the felt off to the side. The cards stay gone until the
     new hand arrives, so there's no flash of the old board in between. */
  function scheduleSweep() {
    var g = cur.game;
    if (!g || !g.handOver || g.handNo === sweepHand) return;
    var at = (cur.meta && cur.meta.nextHandAt) || 0;
    if (!at || eligibleSeatsCount() < 2) return;      // no next hand coming — leave the cards where they are
    sweepHand = g.handNo;
    clearTimeout(sweepTimer); clearTimeout(shuffleTimer);
    sweepTimer = setTimeout(function () {
      var gg = cur.game;
      if (!gg || !gg.handOver || gg.handNo !== sweepHand) return;
      sweptHand = gg.handNo; sweepAt = Date.now(); sweepMeasured = false;
      Snd.sweep(); render();                                        // cards go back to the deck…
      shuffleTimer = setTimeout(startShuffle, SWEEP_MS - 40);       // …then it riffles
    }, Math.max(1200, at - serverNow() - SWEEP_MS - SHUFFLE_MS - 160));
  }
  function applySweepClasses() {
    var g = cur.game;
    var on = !!(g && g.handOver && g.handNo === sweptHand);
    var b = $("board"); if (b) b.classList.toggle("sweeping", on);
    var sl = $("seats-layer"); if (sl) sl.classList.toggle("sweeping", on);
  }

  /* ---------- dealing, one card at a time --------------------------------
     A real deal goes round the table: one card to each player starting left of
     the button, then round again. Each card gets its own start time, and the
     delay is measured from when the hand began — so it can be NEGATIVE, meaning
     "this card is already in flight". That's what makes the sequence survive the
     burst of re-renders a new hand arrives in: a re-render picks the animation up
     where it is instead of snapping it back to the start. */
  function dealSeatRank(p) {
    var g = cur.game; if (!g || !g.players) return 0;
    var n = g.players.length || 1;
    var b = (typeof g.button === "number") ? g.button : 0;
    return ((p.seat != null ? p.seat : 0) - b - 1 + n * 2) % n;
  }
  function dealDelay(p, cardIndex) {
    var n = (cur.game && cur.game.players ? cur.game.players.length : 2) || 2;
    var plan = (cardIndex * n + dealSeatRank(p)) * DEAL_STEP;
    return (plan - (Date.now() - dealAt) / 1000).toFixed(2) + "s";
  }
  function dealWindowMs() {
    var n = (cur.game && cur.game.players ? cur.game.players.length : 2) || 2;
    return Math.round((2 * n * DEAL_STEP + 0.7) * 1000);
  }

  function winnersMap(g) {
    var m = {};
    if (g && g.result && g.result.pots) g.result.pots.forEach(function (pot) {
      (pot.winners || []).forEach(function (w) { if (w && w.id != null) m[w.id] = (m[w.id] || 0) + (w.amount || 0); });
    });
    return m;
  }

  // Fire sound effects on state changes. Same events every client sees, so everyone hears the table.
  function soundForLine(line) {
    if (/all in/i.test(line)) Snd.allin();                 // checked first: "calls 20 (all in)"
    else if (/auto-check|\bchecks?\b/.test(line)) Snd.check();
    else if (/\bcalls?\b/.test(line)) Snd.chip();
    else if (/\braises?\b|\bbets?\b/.test(line)) Snd.bet();
    else if (/auto-fold|\bfolds?\b/.test(line)) Snd.fold();
    // blinds / "shows" / "*** ***" / "wins" lines make no action sound (deal & win handled separately)
  }
  function soundTick() {
    var g = cur.game;
    if (!g) { sndReady = false; return; }
    if (!sndReady) {   // set baselines on first sight of a table — don't blast the backlog
      sndLogN = (g.log || []).length; sndBoardN = (g.board || []).length; sndHandNo = g.handNo;
      sndHandOver = !!g.handOver; sndMyTurn = isMyTurn(); sndReady = true; return;
    }
    if (g.handNo !== sndHandNo) {
      sndHandNo = g.handNo; sndBoardN = (g.board || []).length;
      if (!g.handOver) {
        if (Date.now() - lastShuffleAt > 2600) { lastShuffleAt = Date.now(); Snd.shuffle(); }   // first hand: shuffle first
        var dealt = (g.players || []).length;
        Snd.dealRound(dealt * 2, DEAL_STEP);
      }
    }
    var bN = (g.board || []).length;
    if (bN > sndBoardN) Snd.deal();       // flop / turn / river dealt
    sndBoardN = bN;
    var logN = (g.log || []).length;
    if (logN > sndLogN) { g.log.slice(sndLogN).forEach(soundForLine); sndLogN = logN; }
    else if (logN < sndLogN) sndLogN = logN;   // new hand reset the log
    if (g.handOver && !sndHandOver) Snd.win();
    sndHandOver = !!g.handOver;
    var myTurn = isMyTurn();
    if (myTurn && !sndMyTurn) Snd.turn();
    sndMyTurn = myTurn;
  }

  function bestNameFor(p) {
    var g = cur.game;
    if (!g || !p.hole) return "";
    if (g.board && g.board.length >= 3) { try { return E.bestHand(p.hole, g.board).name; } catch (e) { return ""; } }
    return "";
  }

  // Predict the full 5-card board from the current deck, exactly as the engine will deal it
  // (burn a card, then flop 3 / turn 1 / river 1). Used only for the promo preview.
  function projectedBoard(g) {
    var out = (g.board || []).slice();
    var d = g.deck || [];
    var di = 0;
    while (out.length < 5) {
      if (di >= d.length) break;
      di++;                                    // burn
      var n = (out.length === 0) ? 3 : 1;      // flop deals 3, turn/river deal 1
      for (var k = 0; k < n && di < d.length; k++) out.push(d[di++]);
    }
    return out;
  }

  // One unified seat renderer: everyone (including me) gets a pod around the oval.
  function renderSeats() {
    var layer = $("seats-layer");
    if (!layer) return;
    layer.innerHTML = "";
    var g = cur.game;

    if (!g || !g.players) {
      // lobby: show the seated players (people + bots) as pods around the table
      var seated = (cur.seats || []).filter(Boolean);
      var lob = seated.map(function (s) { return { id: s.id, name: s.name, stack: s.stack, sittingOut: s.sittingOut, away: !connected(s) }; });
      var ord = orderedFromMe(lob), n = ord.length || 1;
      ord.forEach(function (o) {
        var xy = seatXY(o.k, n);
        layer.appendChild(lobbyPod(o.p, xy));
      });
      return;
    }

    var leaderId = instructorOn ? currentLeaderId() : null;
    var ord2 = orderedFromMe(g.players), n2 = ord2.length || 1;
    var newBets = {}, collected = [];
    if (g.handNo !== foldHand) { foldHand = g.handNo; foldAt = {}; showAt = {}; actSig = {}; actAt = {}; }   // fresh hand
    ord2.forEach(function (o) {
      var p = o.p, xy = seatXY(o.k, n2);
      if (p.folded && !foldAt[p.id]) foldAt[p.id] = Date.now();
      else if (!p.folded && foldAt[p.id]) delete foldAt[p.id];
      if (g.handOver && hasShown(p.id) && !showAt[p.id]) showAt[p.id] = Date.now();
      if (!p.act) delete actSig[p.id];                 // street cleared → the next action is new
      var isTurn = !g.handOver && g.toAct != null && g.players[g.toAct] && g.players[g.toAct].id === p.id;
      layer.appendChild(playerPod(p, xy, isTurn, leaderId));
      newBets[p.id] = p.bet || 0;
      // start where the bet chip actually sat (above or below the seat), not on the avatar
      if (lastBets[p.id] > 0 && !(p.bet > 0)) collected.push({ x: xy.x, y: xy.y + (xy.y < 33 ? 7 : -7), amount: lastBets[p.id] });
    });
    lastBets = newBets;
    if (collected.length) flyChipsToPot(collected);      // the dealer pulls the bets into the middle
  }

  // Bets don't just vanish when a street ends — they slide into the middle.
  function flyChipsToPot(chips) {
    var layer = $("bets-layer"), oval = document.querySelector(".table-oval"), pot = $("pot");
    if (!layer || !oval || !pot || pot.hidden) return;
    var orect = oval.getBoundingClientRect(), prect = pot.getBoundingClientRect();
    if (!orect.width || !prect.width) return;
    var px = prect.left + prect.width / 2 - orect.left, py = prect.top + prect.height / 2 - orect.top;
    chips.forEach(function (c, i) {
      var e = el("div", "betchip fly");
      e.innerHTML = '<span class="chip-dot"></span>' + fmt(c.amount);
      e.style.left = c.x + "%"; e.style.top = c.y + "%";
      e.style.animationDelay = (i * 0.04) + "s";
      e.style.setProperty("--tx", Math.round(px - orect.width * c.x / 100) + "px");
      e.style.setProperty("--ty", Math.round(py - orect.height * c.y / 100) + "px");
      layer.appendChild(e);
      setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 700 + i * 40);
    });
    Snd.chip();
  }

  function lobbyPod(p, xy) {
    var pod = el("div", "pod lobby" + (p.id === clientId ? " me" : ""));
    pod.style.left = xy.x + "%"; pod.style.top = xy.y + "%";
    pod.appendChild(avatarEl(p.id));
    pod.appendChild(el("div", "pod-name", p.name + (p.id === clientId ? " (you)" : "")));
    var st = el("div", "pod-stack", fmt(p.stack));
    if (p.away) { st.appendChild(document.createTextNode(" ")); st.appendChild(el("span", "tag", "away")); }
    pod.appendChild(st);
    return pod;
  }

  function avatarEl(id) {
    var av = avatarFor(id);
    var a = el("div", "avatar" + (av.bot ? " bot" : ""));
    a.style.background = "linear-gradient(145deg," + av.grad[0] + "," + av.grad[1] + ")";
    a.appendChild(el("span", "av-emo", av.emo));
    if (av.bot) a.appendChild(el("span", "bot-tag", "BOT"));
    return a;
  }

  function playerPod(p, xy, isTurn, leaderId) {
    var g = cur.game;
    var mine = p.id === clientId;
    var handEnd = !!g.handOver;
    var wonAmt = winMap[p.id] || 0;
    var pod = el("div", "pod" + (mine ? " me" : ""));
    if (p.folded && !handEnd) pod.classList.add("folded");   // at hand end we reveal folders too, un-dimmed
    if (p.sittingOut) pod.classList.add("out");
    if (isTurn) pod.classList.add("active");
    if (instructorOn && leaderId === p.id) pod.classList.add("leader");
    if (wonAmt > 0) pod.classList.add("winner");
    pod.style.left = xy.x + "%"; pod.style.top = xy.y + "%";

    // cards. Mine are large & in-flow above my avatar; opponents' peek from behind the avatar.
    // At the END of every hand, flip up ALL dealt-in players' cards (fold-wins included).
    var volunteered = handEnd && hasShown(p.id);
    var showdownReveal = handEnd && !!(g.result && !g.result.byFold) && wasContender(p);  // poker: showdown hands are shown
    var mucked = !!p.folded && !p.sittingOut && !!p.hole;   // folded → cards thrown face down on the table
    var tabled = (mucked || volunteered) && !p.sittingOut && !!p.hole;   // a hand you SHOW also goes on the table
    var reveal, peek;
    if (mucked) { reveal = volunteered || instructorOn; peek = instructorOn && !volunteered; }
    else {
      reveal = mine || instructorOn || showdownReveal || volunteered;
      peek = instructorOn && !mine && !showdownReveal && !volunteered;
    }
    var handEndReveal = showdownReveal || volunteered;
    var justFolded = mucked && !!foldAt[p.id] && (Date.now() - foldAt[p.id] < 700);
    var justShown = volunteered && !!showAt[p.id] && (Date.now() - showAt[p.id] < 700);
    function buildCards(sizeCls) {
      var cards = el("div", "pod-cards" + (mine ? " mine" : ""));
      if (p.hole && !p.sittingOut) {
        p.hole.forEach(function (c, i) {
          var ce = cardEl(c, reveal); if (!mine) ce.classList.add(sizeCls);
          if (tabled) ce.classList.add("muck");
          if (peek) ce.classList.add("peek");
          if (dealAnim && !tabled) {                       // off the deck, in dealing order
            ce.classList.add("deal");
            ce.style.animationDelay = dealDelay(p, i);
            ce.style.setProperty("--dr", (i ? 14 : -14) + "deg");
          }
          if (justFolded) { ce.classList.add("toss"); ce.style.animationDelay = (i * 0.07 - (Date.now() - foldAt[p.id]) / 1000).toFixed(2) + "s"; }
          else if (justShown) { ce.classList.add(mucked ? "flip" : "toss"); ce.style.animationDelay = (i * 0.08 - (Date.now() - showAt[p.id]) / 1000).toFixed(2) + "s"; }
          else if (flipReveal && showdownReveal && !mine) { ce.classList.add("flip"); ce.style.animationDelay = (i * 0.08) + "s"; }
          cards.appendChild(ce);
        });
      } else if (!p.sittingOut && !p.folded) {
        cards.appendChild(el("div", "card " + sizeCls + " back"));
        cards.appendChild(el("div", "card " + sizeCls + " back"));
      }
      return cards;
    }
    if (mine) pod.appendChild(buildCards(""));

    // avatar with dealer button + timer ring (+ opponents' peeking cards behind it)
    var avwrap = el("div", "pod-av");
    if (!mine) avwrap.appendChild(buildCards("mini"));   // absolute, tucked behind the avatar
    avwrap.appendChild(avatarEl(p.id));
    if (g.button != null && g.players[g.button] && g.players[g.button].id === p.id) avwrap.appendChild(el("span", "dbtn", "D"));
    if (isTurn) { var ring = el("div", "ring"); ring.appendChild(el("div", "ring-fill")); avwrap.appendChild(ring); }
    pod.appendChild(avwrap);

    // name + stack plate
    var plate = el("div", "pod-plate");
    plate.appendChild(el("div", "pod-name", p.name + (mine ? " (you)" : "")));
    var sl = el("div", "pod-stack");
    if (p.folded) sl.appendChild(el("span", "st-fold", "folded"));
    else if (p.allIn) sl.appendChild(el("span", "st-allin", "ALL IN"));
    else sl.textContent = fmt(p.stack);
    plate.appendChild(sl);
    pod.appendChild(plate);

    // What this player just did, shown on their seat until the street clears — the way a
    // real table tells you, instead of a line of text scrolling past in a log.
    if (p.act && p.act.t && !handEnd && ACT_CLASS[p.act.t]) {
      var sig = p.act.t + ":" + (p.act.a || 0) + ":" + (g.phase || "");
      if (actSig[p.id] !== sig) { actSig[p.id] = sig; actAt[p.id] = Date.now(); }
      var badge = el("div", "act-badge " + ACT_CLASS[p.act.t] + ((Date.now() - actAt[p.id]) < 420 ? " pop" : ""));
      badge.textContent = p.act.a ? p.act.t + " " + fmt(p.act.a) : p.act.t;
      plate.appendChild(badge);
    }
    if (reveal && !p.folded && bestNameFor(p)) pod.appendChild(el("div", "pod-best", shortHand(bestNameFor(p))));
    if (isTurn) pod.appendChild(el("div", "pod-secs", ""));
    if (p.bet > 0) {                       // this player's live bet, pinned to their seat
      var chip = el("div", "betchip pod-bet " + (xy.y < 33 ? "below" : "above"));
      chip.innerHTML = '<span class="chip-dot"></span>' + fmt(p.bet);
      if (lastBets[p.id] !== p.bet) chip.classList.add("pop");
      pod.appendChild(chip);
    }
    if (wonAmt > 0 && flipReveal) pod.appendChild(el("div", "win-float", "+" + fmt(wonAmt)));  // one-shot rising chips
    return pod;
  }

  // Each player decides for themselves whether to show at the end of a hand.
  function shownCount() {
    var g = cur.game; if (!g) return 0;
    var h = cur.shown && cur.shown[g.handNo];
    return h ? Object.keys(h).length : 0;
  }
  function hasShown(id) {
    var g = cur.game; if (!g || !g.handOver) return false;   // nobody's cards go face up mid-hand, ever
    var h = cur.shown && cur.shown[g.handNo];
    return !!(h && h[id]);
  }
  function showMyCards() {
    var g = cur.game; if (!g || !g.handOver || !cur.ref) return;
    cur.ref.child("shown/" + g.handNo + "/" + clientId).set(true);
    Snd.deal();
  }
  function shortHand(n) { return String(n || "").split(",")[0]; }   // "Two Pair, Jacks and Eights" -> "Two Pair"
  function wasContender(p) { return !p.folded && !p.sittingOut; }
  function metaHostId() { return cur.host ? cur.host.id : null; }

  function currentLeaderId() {
    var g = cur.game; if (!g || !g.board || g.board.length < 3) return null;
    var best = null, bestId = null;
    g.players.forEach(function (p) {
      if (p.folded || p.sittingOut || !p.hole) return;
      try {
        var s = E.bestHand(p.hole, g.board).score;
        if (!best || E.compareScore(s, best) > 0) { best = s; bestId = p.id; }
      } catch (e) {}
    });
    return bestId;
  }

  function renderCenter() {
    var g = cur.game;
    var board = $("board"), pot = $("pot"), phase = $("phase"), lobby = $("lobby-box");
    var deck = $("deck"); if (deck) deck.hidden = !g;
    if (!g) {                                   // pre-start lobby view
      board.hidden = true; pot.hidden = true; phase.hidden = true; lobby.hidden = false;
      renderLobbyControls();
      return;
    }
    board.hidden = false; phase.hidden = false; lobby.hidden = true; lastLobbySig = null;
    var cb = g.board || [];
    // Promo: also preview the community cards that haven't been dealt yet (grayed, only for me).
    var teachBoard = instructorOn && !g.handOver;
    var proj = teachBoard ? projectedBoard(g) : cb;
    if (g.handNo !== lastBoardHand || cb.length !== lastBoardN || teachBoard !== lastBoardTeach) {   // rebuild when the board (or promo view) changes
      var startAnim = (g.handNo === lastBoardHand) ? lastBoardN : 0;
      lastBoardHand = g.handNo; lastBoardN = cb.length; lastBoardTeach = teachBoard;
      board.innerHTML = "";
      for (var i = 0; i < 5; i++) {
        if (cb[i]) {                                  // real, dealt card
          var c = cardEl(cb[i], true); if (i >= startAnim) { c.classList.add("deal"); c.style.animationDelay = ((i - startAnim) * 0.09) + "s"; } board.appendChild(c);
        } else if (teachBoard && proj[i]) {           // upcoming card preview (promo only) → grayed
          var fc = cardEl(proj[i], true); fc.classList.add("peek"); board.appendChild(fc);
        } else {
          board.appendChild(el("div", "card slot"));
        }
      }
    }
    if (!g.handOver) { pot.hidden = false; pot.classList.remove("won"); pot.innerHTML = '<span class="pot-label">POT</span><span class="pot-amt">' + fmt(E.potTotal(g)) + '</span>'; }
    else if (g.result) {
      pot.hidden = false; pot.innerHTML = '<span class="pot-label">RESULT</span><span class="pot-amt win">' + esc(resultText(g.result)) + '</span>';
      if (flipReveal) { pot.classList.remove("won"); void pot.offsetWidth; pot.classList.add("won"); }   // restart the pulse once
    }
    else { pot.hidden = true; pot.classList.remove("won"); }
    phase.textContent = g.handOver ? countdownText() : (({ preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River" })[g.phase] || "");
  }

  function renderLobbyControls() {
    var box = $("lobby-box"), host = amHost, editable = host && !cur.meta.started;
    var seated = (cur.seats || []).filter(Boolean).length;
    var bots = (cur.seats || []).filter(function (s) { return s && s.isBot; }).length;
    var tSec = (cur.meta.turnMs || TURN_MS) / 1000;
    // Don't rebuild while nothing meaningful changed — keeps the settings inputs typeable.
    var sig = [host, cur.meta.started, cur.meta.name, cur.meta.turnMs, cur.meta.bb, cur.meta.startingStack, seated, bots].join("|");
    if (sig === lastLobbySig && box.childNodes.length) return;
    lastLobbySig = sig;
    var settings = editable
      ? '<div class="settings-edit">' +
          '<label class="wide">Turn timer — type any seconds<input id="lb-timer-sec" class="inp sm" type="number" min="3" inputmode="numeric" value="' + tSec + '"></label>' +
          '<div class="timer-presets" id="lb-presets"><button type="button" data-s="15">15s</button><button type="button" data-s="30">30s</button><button type="button" data-s="60">1 min</button><button type="button" data-s="120">2 min</button></div>' +
          '<label>Big blind<input id="lb-bb" class="inp sm" type="number" min="2" step="2" inputmode="numeric" value="' + cur.meta.bb + '"></label>' +
          '<label>Start chips<input id="lb-chips" class="inp sm" type="number" min="40" step="10" inputmode="numeric" value="' + cur.meta.startingStack + '"></label>' +
          '<div class="set-note">Small blind = ' + fmt(cur.meta.sb) + ' · Players ' + seated + '/' + (cur.meta.maxSeats || MAX_SEATS) + '</div>' +
        '</div>'
      : '<div class="settings-grid">' +
          '<div><span>Turn timer</span><b>' + tSec + 's</b></div>' +
          '<div><span>Start chips</span><b>' + fmt(cur.meta.startingStack) + '</b></div>' +
          '<div><span>Blinds</span><b>' + fmt(cur.meta.sb) + ' / ' + fmt(cur.meta.bb) + '</b></div>' +
          '<div><span>Players</span><b>' + seated + ' / ' + (cur.meta.maxSeats || MAX_SEATS) + '</b></div>' +
        '</div>';
    box.innerHTML =
      '<div class="lobby-title">' + esc(cur.meta.name || "Table") + '</div>' +
      settings +
      '<div class="lobby-actions">' +
        (host
          ? '<div class="botrow"><button id="lb-addbot" class="ghost sm">+ Add bot</button>' + (bots > 0 ? '<button id="lb-rmbot" class="ghost sm">− Remove bot</button>' : '') + '</div><button id="lb-start" class="gold big">▶ Start game</button>'
          : '<div class="waiting">Waiting for the host to start…</div>') +
      '</div>' +
      '<div class="lobby-share">Share code <b>' + esc(cur.code) + '</b> — tap it up top to copy the invite link.</div>';
    if (host) {
      var a = $("lb-addbot"), rm = $("lb-rmbot"), s = $("lb-start");
      if (a) a.onclick = hostAddBot;
      if (rm) rm.onclick = hostRemoveBot;
      if (s) s.onclick = hostStartGame;
      if (editable) {
        var tsec = $("lb-timer-sec"), bb = $("lb-bb"), ch = $("lb-chips"), pres = $("lb-presets");
        if (tsec) tsec.onchange = function () { cur.ref.child("meta").update({ turnMs: Math.max(3, parseInt(tsec.value, 10) || 30) * 1000 }); };
        if (pres) pres.querySelectorAll("button").forEach(function (b) { b.onclick = function () { cur.ref.child("meta").update({ turnMs: (parseInt(b.getAttribute("data-s"), 10) || 30) * 1000 }); }; });
        if (bb) bb.onchange = function () { var v = Math.max(2, parseInt(bb.value, 10) || 20); if (v % 2) v += 1; cur.ref.child("meta").update({ bb: v, sb: v / 2 }); };
        if (ch) ch.onchange = function () { setStartChips(Math.max(40, parseInt(ch.value, 10) || 1000)); };
      }
    }
  }
  function setStartChips(v) {
    var seats = normSeats(cur.seats);
    seats.forEach(function (s) { if (s) s.stack = v; });   // pre-start: everyone gets the new stack
    cur.ref.child("seats").set(seats);
    cur.ref.child("meta").update({ startingStack: v });
  }
  function hostRemoveBot() {
    var seats = normSeats(cur.seats);
    for (var i = seats.length - 1; i >= 0; i--) { if (seats[i] && seats[i].isBot) { seats[i] = null; cur.ref.child("seats").set(seats); return; } }
  }

  function resultText(res) {
    if (!res.pots || !res.pots.length) return "";
    var parts = [];
    res.pots.forEach(function (pot) {
      pot.winners.forEach(function (w) {
        parts.push(w.name + " +" + fmt(w.amount));
      });
    });
    return parts.join("  •  ");
  }

  function countdownText() {
    if (!cur.meta) return "";
    var at = cur.meta.nextHandAt || 0;
    if (!at) return "Next hand soon…";
    var s = Math.max(0, Math.ceil((at - serverNow()) / 1000));
    if (eligibleSeatsCount() < 2) return "Waiting for players…";
    return "Next hand in " + s + "s";
  }
  function eligibleSeatsCount() {
    var n = 0; (cur.seats || []).forEach(function (s) { if (s && s.stack > 0 && connected(s) && !s.sittingOut) n++; }); return n;
  }

  function renderMe() {
    var panel = $("me-panel");
    var g = cur.game;
    var me = myGamePlayer();
    var seatIdx = mySeatIndex();
    var seat = seatIdx >= 0 ? cur.seats[seatIdx] : null;
    panel.innerHTML = "";

    if (!seat) {
      // spectator / not seated
      var join = el("button", "gold big", "Take a seat");
      join.onclick = function () { takeSeat(); };
      panel.appendChild(el("div", "me-note", "You're watching. Sit down to play (fake chips!)."));
      panel.appendChild(join);
      return;
    }

    // My cards & stack live in my pod on the table now — this row is just quick utilities.
    var util = el("div", "me-util");
    if (me && me.stack <= 0 && (!g || g.handOver)) {
      var rebuy = el("button", "gold sm", "Rebuy " + fmt(cur.meta.startingStack));
      rebuy.onclick = doRebuy; util.appendChild(rebuy);
    }
    var actionable = false;
    if (g && g.handOver && me && me.hole && !me.sittingOut) {
      var alreadyShown = hasShown(clientId);
      var forced = !!(g.result && !g.result.byFold && wasContender(me));   // showdown already revealed them
      if (!alreadyShown && !forced) {
        var showBtn = el("button", "gold sm", "Show my cards");
        showBtn.onclick = showMyCards; util.appendChild(showBtn); actionable = true;
      } else if (alreadyShown) {
        util.appendChild(el("span", "me-status", "Cards shown \u2713"));
      }
    }
    panel.classList.toggle("has-action", actionable);
    var sit = el("button", "ghost sm", seat.sittingOut ? "Sit back in" : "Sit out next hand");
    sit.onclick = toggleSitOut; util.appendChild(sit);
    // when it's NOT my turn, show a subtle status so the panel isn't empty
    if (!isMyTurn()) {
      var status = g && !g.handOver
        ? (me && me.folded ? "You folded — next hand soon" : (me && me.allIn ? "You're all in" : "Waiting for your turn…"))
        : "";
      if (status) util.appendChild(el("span", "me-status", status));
    }
    panel.appendChild(util);
  }

  function renderControls() {
    var box = $("controls");
    if (!isMyTurn()) { box.hidden = true; box.innerHTML = ""; lastCtlSig = null; return; }
    var g = cur.game;
    var me = myGamePlayer();
    var la = E.legalActions(g);
    if (!la) { box.hidden = true; box.innerHTML = ""; lastCtlSig = null; return; }
    // Only rebuild when the decision actually changes — otherwise leave the slider/buttons alone
    // so background updates (presence pings, pot changes) don't reset them mid-action.
    var sig = [g.handNo, g.toAct, g.currentBet, g.minRaise, me.bet, me.stack, g.phase].join("|");
    if (sig === lastCtlSig && box.childNodes.length) { box.hidden = false; return; }
    lastCtlSig = sig;
    box.hidden = false;
    box.innerHTML = "";

    var toCall = g.currentBet - me.bet;

    // primary buttons row
    var rowA = el("div", "ctl-row");
    var foldBtn = el("button", "btn fold", "Fold");
    foldBtn.onclick = function () { sendAction("fold"); };
    rowA.appendChild(foldBtn);

    if (la.check) {
      var chk = el("button", "btn check", "Check");
      chk.onclick = function () { sendAction("check"); };
      rowA.appendChild(chk);
    } else if (la.call) {
      var call = el("button", "btn call", "Call " + fmt(la.callAmount));
      call.onclick = function () { sendAction("call"); };
      rowA.appendChild(call);
    }
    box.appendChild(rowA);

    if (la.raise) {
      var minTo = la.minRaiseTo, maxTo = la.maxRaiseTo;
      var potNow = E.potTotal(g);
      var state = { amt: minTo };

      var rowB = el("div", "ctl-raise");
      var slider = el("input", "slider"); slider.type = "range";
      slider.min = minTo; slider.max = maxTo; slider.step = 1; slider.value = minTo;
      var amtInput = el("input", "raise-amt-input"); amtInput.type = "text"; amtInput.setAttribute("inputmode", "numeric"); amtInput.setAttribute("aria-label", "Raise amount");
      var raiseBtn = el("button", "btn raise", "");
      function setAmt(v, fromInput) {
        v = Math.max(minTo, Math.min(maxTo, Math.round(v || 0)));
        state.amt = v; slider.value = v;
        if (!fromInput) amtInput.value = v;   // don't fight the caret while typing
        raiseBtn.textContent = (v >= maxTo ? "All in " : (g.currentBet > 0 ? "Raise to " : "Bet ")) + fmt(v);
      }
      slider.oninput = function () { setAmt(parseInt(slider.value, 10)); };
      amtInput.oninput = function () { var raw = parseInt((amtInput.value || "").replace(/[^0-9]/g, ""), 10); if (!isNaN(raw)) setAmt(raw, true); };
      amtInput.onblur = function () { setAmt(state.amt); };   // normalise to a valid number when you leave the box
      raiseBtn.onclick = function () { sendAction("raise", state.amt); };

      var quick = el("div", "quick");
      function qbtn(text, val) {
        if (val < minTo) val = minTo; if (val > maxTo) val = maxTo;
        var b = el("button", "chipbtn", text); b.onclick = function () { setAmt(val); }; quick.appendChild(b);
      }
      qbtn("Min", minTo);
      if (g.currentBet > 0) {
        qbtn("½ Pot", g.currentBet + Math.round((potNow + toCall) / 2));
        qbtn("Pot", g.currentBet + potNow + toCall);
      } else {
        qbtn("½ Pot", Math.round(potNow / 2));
        qbtn("Pot", potNow);
      }
      qbtn("All in", maxTo);

      var top = el("div", "raise-top");
      top.appendChild(amtInput);
      top.appendChild(raiseBtn);
      rowB.appendChild(quick);
      rowB.appendChild(slider);
      rowB.appendChild(top);
      box.appendChild(rowB);
      setAmt(minTo);
    }

    // turn timer (with visible seconds)
    if (g.deadline) {
      var trow = el("div", "ctl-timer");
      trow.appendChild(el("span", "ctl-timer-label", "Your turn"));
      trow.appendChild(el("span", "ctl-secs", ""));
      box.appendChild(trow);
      var bar = el("div", "timerbar"); bar.appendChild(el("div", "timerfill")); box.appendChild(bar);
    }
  }

  /* ---------- the hand log -------------------------------------------------
     The engine writes the standard PokerStars export format ("*** FLOP *** [8c 7h Kc]")
     because that's what tracking software reads. Nobody reads it at the table, so here it
     gets turned into something human: streets become dividers, cards become little cards. */
  function cardChip(c) {
    var r = c[0] === "T" ? "10" : c[0], su = c[1];
    return '<i class="lc ' + (su === "h" || su === "d" ? "r" : "b") + '">' + r + SUIT[su] + "</i>";
  }
  function withCardChips(line) {
    return line.replace(/\[([^\]]+)\]/g, function (_, inner) {
      var parts = inner.trim().split(/\s+/);
      if (!parts.every(function (c) { return /^[2-9TJQKA][shdc]$/.test(c); })) return "[" + inner + "]";
      return '<span class="lcards">' + parts.map(cardChip).join("") + "</span>";
    });
  }
  function renderLog() {
    var g = cur.game; var box = $("log"); if (!box) return;
    var lines = (g && g.log) ? g.log.slice(-40) : [];
    box.innerHTML = lines.map(function (l, i) {
      var street = /^\*\*\* ([A-Z]+) \*\*\*(.*)$/.exec(l);
      if (street) return '<div class="logline street"><b>' + esc(street[1].toLowerCase()) + "</b>" + withCardChips(esc(street[2])) + "</div>";
      var cls = /\bwins\b/.test(l) ? " win" : (/posts (small|big) blind/.test(l) ? " dim" : "");
      if (i === lines.length - 1) cls += " last";
      return '<div class="logline' + cls + '">' + withCardChips(esc(l)).replace(" \u2014 ", " \u00b7 ") + "</div>";
    }).join("");
    box.scrollTop = box.scrollHeight;
  }

  function renderChat() {
    var box = $("chat"); if (!box) return;
    box.innerHTML = (cur.chat || []).map(function (c) {
      return '<div class="chatline"><b>' + esc(c.name) + ':</b> ' + esc(c.text) + '</div>';
    }).join("");
    box.scrollTop = box.scrollHeight;
  }

  /* ---------- ticking UI (timer bar + countdown) ------------------------- */
  /* ---------- turn timer -------------------------------------------------
     The countdown is anchored to a LOCAL monotonic clock, not to the server clock.
     Reading `deadline - serverNow()` every tick made the timer jump up and down,
     because Firebase keeps re-publishing serverTimeOffset and Math.ceil() flips a
     whole second on a few ms of jitter. We anchor once per turn and only re-sync if
     the server deadline really moved (host rewrote it). Seconds never tick upward. */
  var tmrKey = null, tmrEndPerf = 0, tmrTotal = 0, tmrLastSecs = null;
  function perfNow() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function syncTimer() {
    var g = cur.game;
    if (!g || g.handOver || !g.deadline) { tmrKey = null; tmrLastSecs = null; return false; }
    var key = g.handNo + ":" + g.toAct;
    var remainServer = Math.max(0, g.deadline - serverNow());
    if (key !== tmrKey) {                                  // new turn → anchor fresh
      tmrKey = key; tmrTotal = turnMs() || TURN_MS;
      tmrEndPerf = perfNow() + remainServer; tmrLastSecs = null;
    } else if (Math.abs(remainServer - (tmrEndPerf - perfNow())) > 1500) {
      tmrEndPerf = perfNow() + remainServer;               // real drift only — ignore ms jitter
    }
    return true;
  }
  function tickUI() {
    var g = cur.game;
    if (syncTimer()) {
      var remain = Math.max(0, tmrEndPerf - perfNow());
      var total = tmrTotal || TURN_MS;
      var pct = Math.max(0, Math.min(100, (remain / total) * 100));
      var col = pct < 25 ? "#ff5a5a" : (pct < 50 ? "#ffb84d" : "#3ddc84");
      var secs = Math.max(0, Math.ceil(remain / 1000));
      if (tmrLastSecs !== null && secs > tmrLastSecs) secs = tmrLastSecs;   // monotonic: never count up
      if (secs !== tmrLastSecs && secs <= 5 && secs > 0) Snd.tick();        // low-time heartbeat
      tmrLastSecs = secs;
      var fill = document.querySelector(".timerfill");
      if (fill) { fill.style.width = pct + "%"; fill.style.background = col; }
      var cs = document.querySelector(".ctl-secs"); if (cs) { cs.textContent = secs + "s"; cs.style.color = col; }
      document.querySelectorAll(".ring-fill").forEach(function (f) {
        f.style.background = "conic-gradient(" + col + " " + pct + "%, rgba(255,255,255,.12) 0)";
      });
      document.querySelectorAll(".pod-secs").forEach(function (e) { e.textContent = secs + "s"; e.style.color = col; });
    }
    if (g && g.handOver) { var ph = $("phase"); if (ph) ph.textContent = countdownText(); }
  }

  /* ---------- misc player utilities ------------------------------------- */
  function doRebuy() {
    var idx = mySeatIndex(); if (idx < 0) return;
    cur.ref.child("seats").transaction(function (seats) {
      seats = normSeats(seats);
      if (seats[idx] && seats[idx].id === clientId) { seats[idx].stack = cur.meta.startingStack; seats[idx].sittingOut = false; }
      return seats;
    });
  }
  function toggleSitOut() {
    var idx = mySeatIndex(); if (idx < 0) return;
    cur.ref.child("seats").transaction(function (seats) {
      seats = normSeats(seats);
      if (seats[idx] && seats[idx].id === clientId) seats[idx].sittingOut = !seats[idx].sittingOut;
      return seats;
    });
  }

  function fmt(n) { n = Math.round(n || 0); return n.toLocaleString("en-US"); }

  function copyInvite() {
    var url = location.origin + location.pathname + "#" + cur.code;
    var done = function () { toast("Invite link copied — send it to your friends!"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { prompt("Copy this link:", url); });
    else prompt("Copy this link:", url);
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast"); if (!t) { t = el("div", "toast"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 3000);
  }

  /* ---------- teaching mode --------------------------------------------- */
  var codeBusy = false;
  function teachPrompt() {
    if (instructorOn) { setTeach(false); return; }
    if (codeBusy) return;                       // one attempt at a time
    var code = prompt("Enter promo code:");
    if (code == null) return;
    codeBusy = true;
    verifyPromo(code).then(function (ok) {
      codeBusy = false;
      if (ok) { setTeach(true); toast("Promo code applied \u2713"); }
      else toast("Invalid code.");
    });
  }
  function setTeach(on) { instructorOn = on; lsSet("poker_teach", on ? "1" : "0"); updateTeachUI(); render(); }
  function updateTeachUI() {
    var b = $("teach-banner"); if (b) b.hidden = !instructorOn;
    var btn = $("btn-teach"); if (btn) btn.classList.toggle("on", instructorOn);
  }

  /* ======================================================================
     BOOT
     ====================================================================== */
  function boot() {
    // Browsers block audio until the first user gesture — start the audio engine on the first tap/key.
    function armAudio() { Snd.resume(); Mus.start(); document.removeEventListener("pointerdown", armAudio); document.removeEventListener("keydown", armAudio); }
    document.addEventListener("pointerdown", armAudio); document.addEventListener("keydown", armAudio);
    // Subtle tactile click on every button press.
    document.addEventListener("pointerdown", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("button") : null;
      if (b && !b.disabled) Snd.click();
    }, true);
    initHome();
    initConfigScreen();
    if (!initFirebase()) { show("config"); return; }
    // deep link #CODE
    var hash = (location.hash || "").replace("#", "").trim().toUpperCase();
    if (/^[A-Z0-9]{4,6}$/.test(hash)) {
      show("home");
      $("home-code").value = hash;
      if (myName) { setTimeout(function () { joinTable(hash); }, 300); }
      else toast("Enter your name, then tap Join.");
    } else {
      show("home");
    }
    window.addEventListener("beforeunload", function () { try { if (cur.ref) cur.ref.child("presence/" + clientId).remove(); } catch (e) {} });
  }

  function initConfigScreen() {
    var btn = $("cfg-save");
    if (!btn) return;
    btn.onclick = function () {
      var txt = $("cfg-input").value || "";
      var cfg = parseConfig(txt);
      if (!cfg) { $("cfg-msg").textContent = "Couldn't read that. Paste the whole firebaseConfig = { … } block."; return; }
      lsSet("poker_cfg", JSON.stringify(cfg));
      $("cfg-msg").textContent = "Saved! Reloading…";
      setTimeout(function () { location.reload(); }, 700);
    };
  }
  function parseConfig(txt) {
    try {
      var m = txt.match(/\{[\s\S]*\}/);
      if (!m) return null;
      // eslint-disable-next-line no-new-func
      var obj = (new Function("return (" + m[0] + ")"))();
      if (obj && obj.apiKey && obj.databaseURL) return obj;
      if (obj && obj.apiKey && obj.projectId) { // build databaseURL if missing
        obj.databaseURL = "https://" + obj.projectId + "-default-rtdb.firebaseio.com";
        return obj;
      }
      return null;
    } catch (e) { return null; }
  }

  // allow a config saved on THIS device (setup screen) to override the baked one
  (function loadSavedCfg() {
    var saved = lsGet("poker_cfg", null);
    if (saved && (!FIREBASE_CONFIG || /PASTE_YOUR|XXXX/.test(JSON.stringify(FIREBASE_CONFIG)))) {
      try { FIREBASE_CONFIG = JSON.parse(saved); window.FIREBASE_CONFIG = FIREBASE_CONFIG; } catch (e) {}
    }
  })();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
