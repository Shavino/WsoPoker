/* ============================================================================
   POKER ENGINE  — pure, deterministic No-Limit Texas Hold'em logic.
   No DOM, no network. Safe to unit-test in Node and to inline in the browser.
   Card = 2-char string: rank + suit.  ranks "23456789TJQKA", suits "shdc".
   Exposed as global `PokerEngine` (browser) and module.exports (Node).
   ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PokerEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var RANKS = "23456789TJQKA";
  var SUITS = "shdc";
  var RANK_NAME = {
    2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven",
    8: "Eight", 9: "Nine", 10: "Ten", 11: "Jack", 12: "Queen", 13: "King", 14: "Ace"
  };
  var RANK_NAME_PL = {
    2: "Twos", 3: "Threes", 4: "Fours", 5: "Fives", 6: "Sixes", 7: "Sevens",
    8: "Eights", 9: "Nines", 10: "Tens", 11: "Jacks", 12: "Queens", 13: "Kings", 14: "Aces"
  };
  var CAT_NAME = [
    "High Card", "Pair", "Two Pair", "Three of a Kind", "Straight",
    "Flush", "Full House", "Four of a Kind", "Straight Flush"
  ];

  function rankVal(ch) { return RANKS.indexOf(ch) + 2; } // '2'->2 ... 'A'->14
  function suitOf(card) { return card[1]; }
  function rankOf(card) { return card[0]; }

  function makeDeck() {
    var d = [];
    for (var r = 0; r < RANKS.length; r++)
      for (var s = 0; s < SUITS.length; s++) d.push(RANKS[r] + SUITS[s]);
    return d;
  }

  // Fisher-Yates. rng() must return [0,1). Defaults to crypto/Math.
  function defaultRng() {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      var buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] / 4294967296;
    }
    return Math.random();
  }
  function shuffle(deck, rng) {
    rng = rng || defaultRng;
    var a = deck.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- 5-card evaluation → comparable score array -------------------
     Score = [category, tiebreak...]. Higher is better, lexicographic. */
  function evaluate5(cards) {
    var vals = cards.map(function (c) { return rankVal(rankOf(c)); }).sort(function (a, b) { return b - a; });
    var suits = cards.map(suitOf);
    var isFlush = suits.every(function (s) { return s === suits[0]; });

    // rank counts
    var counts = {};
    vals.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    // groups sorted by (count desc, value desc)
    var groups = Object.keys(counts).map(function (v) { return [parseInt(v, 10), counts[v]]; });
    groups.sort(function (a, b) { return b[1] - a[1] || b[0] - a[0]; });

    // straight detection (unique desc values)
    var uniq = [];
    vals.forEach(function (v) { if (uniq.indexOf(v) === -1) uniq.push(v); });
    var straightHigh = 0;
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
      else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // wheel A-2-3-4-5
    }

    if (isFlush && straightHigh) return [8, straightHigh];
    if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
    if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
    if (isFlush) return [5].concat(vals);
    if (straightHigh) return [4, straightHigh];
    if (groups[0][1] === 3) return [3, groups[0][0], groups[1][0], groups[2][0]];
    if (groups[0][1] === 2 && groups[1][1] === 2) {
      var hp = Math.max(groups[0][0], groups[1][0]);
      var lp = Math.min(groups[0][0], groups[1][0]);
      return [2, hp, lp, groups[2][0]];
    }
    if (groups[0][1] === 2) return [1, groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
    return [0].concat(vals);
  }

  function compareScore(a, b) {
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) {
      var x = a[i] || 0, y = b[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  // all 5-card combos from up to 7 cards
  function combos5(cards) {
    var res = [], n = cards.length;
    for (var a = 0; a < n - 4; a++)
      for (var b = a + 1; b < n - 3; b++)
        for (var c = b + 1; c < n - 2; c++)
          for (var d = c + 1; d < n - 1; d++)
            for (var e = d + 1; e < n; e++)
              res.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
    return res;
  }

  function evaluate7(cards) {
    var best = null, bestCards = null;
    var cs = combos5(cards);
    for (var i = 0; i < cs.length; i++) {
      var sc = evaluate5(cs[i]);
      if (!best || compareScore(sc, best) > 0) { best = sc; bestCards = cs[i]; }
    }
    return { score: best, cards: bestCards, name: describeScore(best) };
  }

  function describeScore(score) {
    var cat = score[0];
    switch (cat) {
      case 8: return score[1] === 14 ? "Royal Flush" : "Straight Flush, " + RANK_NAME[score[1]] + " high";
      case 7: return "Four of a Kind, " + RANK_NAME_PL[score[1]];
      case 6: return "Full House, " + RANK_NAME_PL[score[1]] + " full of " + RANK_NAME_PL[score[2]];
      case 5: return "Flush, " + RANK_NAME[score[1]] + " high";
      case 4: return "Straight, " + RANK_NAME[score[1]] + " high";
      case 3: return "Three of a Kind, " + RANK_NAME_PL[score[1]];
      case 2: return "Two Pair, " + RANK_NAME_PL[score[1]] + " and " + RANK_NAME_PL[score[2]];
      case 1: return "Pair of " + RANK_NAME_PL[score[1]];
      default: return RANK_NAME[score[1]] + " high";
    }
  }

  function bestHand(hole, board) {
    return evaluate7((hole || []).concat(board || []));
  }

  /* ---------- Side pots -------------------------------------------------------
     contribs: array of {id, committed, folded}. Returns [{amount, eligible:[id...]}]
     Merges adjacent layers with identical eligibility. */
  function buildSidePots(contribs) {
    var work = contribs.map(function (c) { return { id: c.id, left: c.committed, folded: !!c.folded }; })
      .filter(function (c) { return c.left > 0; });
    var pots = [];
    while (true) {
      var live = work.filter(function (c) { return c.left > 0; });
      if (live.length === 0) break;
      var min = Math.min.apply(null, live.map(function (c) { return c.left; }));
      var amount = min * live.length;
      var eligible = live.filter(function (c) { return !c.folded; }).map(function (c) { return c.id; });
      live.forEach(function (c) { c.left -= min; });
      // merge with previous pot if same eligibility set
      var key = eligible.slice().sort().join(",");
      if (pots.length && pots[pots.length - 1]._key === key) {
        pots[pots.length - 1].amount += amount;
      } else {
        pots.push({ amount: amount, eligible: eligible, _key: key });
      }
    }
    pots.forEach(function (p) { delete p._key; });
    return pots;
  }

  /* ---------- Seat helpers --------------------------------------------------- */
  // players: array in seat order. active predicate decides who is dealt in.
  function nextIndex(players, from, pred) {
    var n = players.length;
    for (var k = 1; k <= n; k++) {
      var idx = (from + k) % n;
      if (pred(players[idx], idx)) return idx;
    }
    return -1;
  }

  function inHand(p) { return p && !p.folded && !p.sittingOut; }
  function canAct(p) { return p && !p.folded && !p.allIn && !p.sittingOut && p.stack > 0; }

  /* ---------- Start a hand ---------------------------------------------------
     state.players: [{id,name,stack,sittingOut}] in seat order.
     opts: { button, sb, bb, deck? } . Returns fresh hand state (does NOT mutate). */
  function startHand(players, opts) {
    var sb = opts.sb, bb = opts.bb;
    var deck = opts.deck ? opts.deck.slice() : shuffle(makeDeck(), opts.rng);

    var P = players.map(function (p, i) {
      return {
        id: p.id, name: p.name, seat: i, stack: p.stack,
        sittingOut: !!p.sittingOut || p.stack <= 0,
        folded: false, allIn: false, bet: 0, committed: 0,
        hole: null, acted: false, act: null
      };
    });

    var eligibleCount = P.filter(function (p) { return !p.sittingOut; }).length;
    if (eligibleCount < 2) return { phase: "idle", players: P, error: "need 2+ players with chips" };

    // Button: advance from previous button to next eligible seat.
    var prevButton = (typeof opts.button === "number") ? opts.button : -1;
    var button = nextIndex(P, prevButton, function (p) { return !p.sittingOut; });

    var heads = eligibleCount === 2;
    var sbSeat, bbSeat;
    if (heads) {
      sbSeat = button; // button is small blind heads-up
      bbSeat = nextIndex(P, button, function (p) { return !p.sittingOut; });
    } else {
      sbSeat = nextIndex(P, button, function (p) { return !p.sittingOut; });
      bbSeat = nextIndex(P, sbSeat, function (p) { return !p.sittingOut; });
    }

    function postBlind(seat, amt) {
      var p = P[seat];
      var put = Math.min(amt, p.stack);
      p.stack -= put; p.bet = put; p.committed = put;
      if (p.stack === 0) p.allIn = true;
    }
    postBlind(sbSeat, sb);
    postBlind(bbSeat, bb);

    // Deal two cards each (to eligible players), one at a time, starting left of button.
    var order = [];
    var idx = button;
    for (var k = 0; k < P.length; k++) {
      idx = nextIndex(P, idx, function (p) { return !p.sittingOut; });
      order.push(idx);
      if (order.length === eligibleCount) break;
    }
    for (var round = 0; round < 2; round++)
      for (var o = 0; o < order.length; o++)
        (P[order[o]].hole = P[order[o]].hole || []).push(deck.shift());

    // First to act preflop = left of BB (heads-up: the SB/button acts first).
    // Point at the structural seat; normalizeTurn() below skips it if that player can't act.
    var firstAct = heads ? sbSeat : nextIndex(P, bbSeat, function (p) { return !p.sittingOut; });

    var state = {
      players: P,
      button: button, sbSeat: sbSeat, bbSeat: bbSeat,
      sb: sb, bb: bb,
      phase: "preflop",
      board: [],
      deck: deck,
      currentBet: bb,
      minRaise: bb,           // size of a legal raise
      lastFullRaise: bb,
      toAct: firstAct,
      aggressor: bbSeat,      // BB is the initial "aggressor" so BB gets an option
      log: [],
      result: null,
      handOver: false
    };
    log(state, P[sbSeat].name + " posts small blind " + P[sbSeat].committed);
    log(state, P[bbSeat].name + " posts big blind " + P[bbSeat].committed);
    if (opts.ls) state.ls = opts.ls;
    // Point toAct at a player who can actually act; handle the rare all-in-from-blinds case.
    normalizeTurn(state);
    return state;
  }

  function log(state, msg) { state.log.push(msg); if (state.log.length > 60) state.log.shift(); }

  function potTotal(state) {
    return state.players.reduce(function (s, p) { return s + p.committed; }, 0);
  }

  // Once a hand is settled, chips have moved from wagers into stacks — clear the wagers.
  function clearWagers(state) {
    state.players.forEach(function (p) { p.bet = 0; p.committed = 0; });
  }

  /* ---------- Legal actions for the player to act ---------------------------- */
  function legalActions(state) {
    if (state.handOver || state.phase === "showdown" || state.phase === "payout") return null;
    var p = state.players[state.toAct];
    if (!p || !canAct(p)) return null;
    var toCall = state.currentBet - p.bet;
    var acts = { fold: true, check: false, call: false, callAmount: 0, raise: false, minRaiseTo: 0, maxRaiseTo: 0, allInAmount: p.stack };
    if (toCall <= 0) {
      acts.check = true;
    } else {
      acts.call = true;
      acts.callAmount = Math.min(toCall, p.stack);
    }
    // Raise: only if the player has more chips than needed to call.
    if (p.stack > toCall) {
      acts.raise = true;
      var minTo = state.currentBet + state.minRaise;
      var maxTo = p.bet + p.stack; // all-in total this round
      acts.minRaiseTo = Math.min(minTo, maxTo);
      acts.maxRaiseTo = maxTo;
    }
    return acts;
  }

  /* ---------- Apply an action ------------------------------------------------
     action: {type:'fold'|'check'|'call'|'raise', amount?}  (amount = raise-TO total this round)
     Returns { ok, error? }. Mutates state. */
  function applyAction(state, playerId, action) {
    if (state.handOver) return { ok: false, error: "hand is over" };
    // Firebase RTDB drops empty arrays, so a state read back mid-hand can arrive with
    // board/log/deck missing. Restore them before any street deal touches them.
    if (!state.board) state.board = [];
    if (!state.log) state.log = [];
    if (!state.deck) state.deck = [];
    var p = state.players[state.toAct];
    if (!p || p.id !== playerId) return { ok: false, error: "not your turn" };
    if (!canAct(p)) return { ok: false, error: "cannot act" };
    var toCall = state.currentBet - p.bet;
    var facingBet = state.currentBet > 0;      // no bet yet this street → it's a BET, not a raise

    if (action.type === "fold") {
      p.folded = true; p.acted = true;
      p.act = { t: "FOLD" };                   // shown on the player's seat until the street clears
      log(state, p.name + " folds");
    } else if (action.type === "check") {
      if (toCall > 0) return { ok: false, error: "cannot check facing a bet" };
      p.acted = true;
      p.act = { t: "CHECK" };
      log(state, p.name + " checks");
    } else if (action.type === "call") {
      var put = Math.min(toCall, p.stack);
      p.stack -= put; p.bet += put; p.committed += put;
      if (p.stack === 0) p.allIn = true;
      p.acted = true;
      p.act = p.allIn ? { t: "ALL IN", a: p.committed } : { t: "CALL", a: put };
      log(state, p.name + (p.allIn ? " calls " + put + " (all in)" : " calls " + put));
    } else if (action.type === "raise" || action.type === "allin") {
      var target;
      if (action.type === "allin") target = p.bet + p.stack;
      else target = action.amount;
      var maxTo = p.bet + p.stack;
      if (typeof target !== "number" || isNaN(target)) return { ok: false, error: "bad amount" };
      if (target > maxTo) target = maxTo;
      var minTo = state.currentBet + state.minRaise;
      var isAllIn = target >= maxTo;
      if (target <= state.currentBet) return { ok: false, error: "raise must exceed current bet" };
      if (!isAllIn && target < minTo) return { ok: false, error: "raise too small (min " + minTo + ")" };

      var add = target - p.bet;
      p.stack -= add; p.committed += add;
      var raiseSize = target - state.currentBet;
      var wasFullRaise = raiseSize >= state.minRaise;
      p.bet = target;
      state.currentBet = target;
      if (wasFullRaise) { state.minRaise = raiseSize; state.lastFullRaise = raiseSize; }
      if (p.stack === 0) p.allIn = true;
      // Reopen action: everyone still able to act must respond again.
      state.players.forEach(function (q) { if (q !== p && canAct(q)) q.acted = false; });
      p.acted = true;
      state.aggressor = p.seat;
      p.act = p.allIn ? { t: "ALL IN", a: target } : { t: facingBet ? "RAISE" : "BET", a: target };
      log(state, p.name + (p.allIn ? " raises to " + target + " (all in)"
            : (facingBet ? " raises to " + target : " bets " + target)));
    } else {
      return { ok: false, error: "unknown action" };
    }

    // A running note of how each player answers a bet, carried along with the hand. The
    // table merges it into a longer-term picture when the hand ends, and the bots read
    // that picture only if the table has learning switched on. Nothing here looks at
    // anyone's cards — it's the same thing a person at the table would notice.
    if (!state.obs) state.obs = {};
    var ob = state.obs[p.id] || (state.obs[p.id] = { acts: 0, faced: 0, folded: 0, calls: 0, raises: 0, pff: 0, pfd: 0 });
    ob.acts++;
    // Kept apart on purpose: almost everyone folds most hands before the flop, so mixing
    // the two makes every opponent look like a folder. What decides whether bluffing pays
    // is what they do AFTER the flop, once they've already put money in.
    var pre = !state.board || state.board.length < 3;
    if (toCall > 0) {
      if (pre) { ob.pff++; if (action.type === "fold") ob.pfd++; }
      else {
        ob.faced++;
        if (action.type === "fold") ob.folded++;
        else if (action.type === "call") ob.calls++;
      }
    }
    if (action.type === "raise") { ob.raises++; if (pre) ob.pr = (ob.pr || 0) + 1; else ob.ar = (ob.ar || 0) + 1; }

    advanceAction(state);
    return { ok: true };
  }
  // Fold them into what we already knew, and let old evidence fade so somebody who
  // tightens up after losing a stack isn't judged on how they played an hour ago.
  var OBS_KEYS = ["acts", "faced", "folded", "calls", "raises", "pff", "pfd"];
  function mergeObservations(model, obs) {
    var out = {}, k, i;
    for (k in (model || {})) if (model[k]) { out[k] = {}; for (i = 0; i < OBS_KEYS.length; i++) out[k][OBS_KEYS[i]] = model[k][OBS_KEYS[i]] || 0; }
    for (k in (obs || {})) {
      var o = obs[k], m = out[k];
      if (!m) { m = out[k] = {}; for (i = 0; i < OBS_KEYS.length; i++) m[OBS_KEYS[i]] = 0; }
      for (i = 0; i < OBS_KEYS.length; i++) m[OBS_KEYS[i]] += o[OBS_KEYS[i]] || 0;
      // let old evidence fade, so somebody who tightens up after losing a stack isn't
      // judged for ever on how they played an hour ago
      if (m.faced > 240 || m.pff > 600) for (i = 0; i < OBS_KEYS.length; i++) m[OBS_KEYS[i]] = Math.round(m[OBS_KEYS[i]] / 2);
    }
    return out;
  }

  /* ---------- Round / street progression ------------------------------------ */
  function activePlayers(state) { return state.players.filter(function (p) { return !p.folded && !p.sittingOut; }); }

  function bettingClosed(state) {
    var actives = activePlayers(state);
    // Players who can still act (not all-in) must all have acted and matched currentBet.
    for (var i = 0; i < actives.length; i++) {
      var p = actives[i];
      if (p.allIn) continue;
      if (!p.acted) return false;
      if (p.bet !== state.currentBet) return false;
    }
    return true;
  }

  function playersWhoCanStillAct(state) {
    return state.players.filter(function (p) { return canAct(p); });
  }

  // Deal streets forward; runs the board out automatically when no more betting is possible.
  function advanceStreets(state) {
    // Nobody left who can bet, two or more still in, cards to come: the rest is dealt out in
    // one go. If a player at this table holds the second promo code, this is the one moment
    // it acts (see settleRunout).
    if (state.ls && activePlayers(state).length >= 2 && playersWhoCanStillAct(state).length < 2) settleRunout(state, state.ls);
    while (true) {
      if (state.phase === "preflop") dealFlop(state);
      else if (state.phase === "flop") dealTurn(state);
      else if (state.phase === "turn") dealRiver(state);
      else if (state.phase === "river") { showdown(state); return; }
      else return;

      var aliveNow = activePlayers(state);
      if (aliveNow.length === 1) { winByFold(state, aliveNow[0]); return; }
      // If two or more players can still act, stop and let betting happen.
      if (playersWhoCanStillAct(state).length >= 2) {
        state.toAct = firstToActPostflop(state);
        return;
      }
      // otherwise loop and deal the next street (all-in runout)
    }
  }

  // The second promo code: an all-in the holder is part of comes out their way. Nothing is
  // added or taken away — the cards still to come are chosen from the ones really left in
  // the deck, at random among the runouts where the holder has the best hand, and put where
  // the dealer will take them from (burn, three, burn, one, burn, one). So the board is an
  // ordinary-looking board, everyone's hole cards are what they were dealt, and the deck is
  // still exactly one deck. It only ever acts on an all-in runout — every other hand is dealt
  // straight — and if the holder is drawing dead (no card left can save them) it does nothing.
  function settleRunout(state, favId, rng) {
    rng = rng || defaultRng;
    var fav = null, i;
    for (i = 0; i < state.players.length; i++) {
      var q = state.players[i];
      if (q.id === favId && !q.folded && !q.sittingOut && q.hole) fav = q;
    }
    if (!fav || !state.deck) return false;
    var others = activePlayers(state).filter(function (q) { return q !== fav && q.hole; });
    var have = (state.board || []).length, need = 5 - have;
    if (!others.length || need <= 0) return false;
    var pos = [], p = 0, b = have;                     // where the remaining board cards come from
    if (b === 0) { p++; pos.push(p, p + 1, p + 2); p += 3; b = 3; }
    if (b === 3) { p++; pos.push(p); p++; b = 4; }
    if (b === 4) { p++; pos.push(p); p++; }
    var deck = state.deck, n = deck.length;
    if (n <= pos[pos.length - 1]) return false;
    var boardIdx = (state.board || []).map(cardIdx), favIdx = fav.hole.map(cardIdx);
    var oppIdx = others.map(function (o) { return o.hole.map(cardIdx); }), deckIdx = deck.map(cardIdx);
    var hand = new Array(7), win = null, split = null;
    for (var t = 0; t < 6000 && !win; t++) {
      var picks = [];
      while (picks.length < need) { var r = Math.floor(rng() * n); if (picks.indexOf(r) < 0) picks.push(r); }
      for (i = 0; i < have; i++) hand[i] = boardIdx[i];
      for (i = 0; i < need; i++) hand[have + i] = deckIdx[picks[i]];
      hand[5] = favIdx[0]; hand[6] = favIdx[1];
      var mine = fastScore(hand, 7), beaten = false, tied = false;
      for (var o = 0; o < oppIdx.length && !beaten; o++) {
        hand[5] = oppIdx[o][0]; hand[6] = oppIdx[o][1];
        var sc = fastScore(hand, 7);
        if (sc > mine) beaten = true; else if (sc === mine) tied = true;
      }
      if (!beaten && !tied) win = picks; else if (!beaten && !split) split = picks;
    }
    var chosen = win || split;
    if (!chosen) return false;                         // drawing dead: nothing can save it
    var vals = chosen.map(function (k) { return deck[k]; });
    for (i = 0; i < vals.length; i++) {                // swap each into its dealing position
      var at = deck.indexOf(vals[i]), tmp = deck[pos[i]];
      deck[pos[i]] = deck[at]; deck[at] = tmp;
    }
    return true;
  }

  // Called after a player acts: move to the next actor, or advance the street.
  function advanceAction(state) {
    var alive = activePlayers(state);
    if (alive.length === 1) { winByFold(state, alive[0]); return; }
    if (bettingClosed(state)) { advanceStreets(state); return; }
    var nxt = nextIndex(state.players, state.toAct, function (p) { return canAct(p); });
    if (nxt === -1) { advanceStreets(state); return; }
    state.toAct = nxt;
  }

  // Called at hand start / setup: keep toAct if valid, otherwise fix it (never skips a live actor).
  function normalizeTurn(state) {
    var alive = activePlayers(state);
    if (alive.length === 1) { winByFold(state, alive[0]); return; }
    if (bettingClosed(state)) { advanceStreets(state); return; }
    if (!canAct(state.players[state.toAct])) {
      var nxt = nextIndex(state.players, state.toAct, function (p) { return canAct(p); });
      if (nxt === -1) { advanceStreets(state); return; }
      state.toAct = nxt;
    }
  }

  function resetRound(state) {
    // a new street wipes the action badges, exactly like the dealer pulling the bets in
    state.players.forEach(function (p) { p.bet = 0; p.act = null; if (!p.allIn && !p.folded && !p.sittingOut) p.acted = false; });
    state.currentBet = 0;
    state.minRaise = state.bb;
  }

  function firstToActPostflop(state) {
    // first player left of button who can act
    var idx = nextIndex(state.players, state.button, function (p) { return canAct(p); });
    state.aggressor = idx; // reference point; option handled by acted flags
    return idx;
  }

  function dealFlop(state) {
    resetRound(state);
    state.deck.shift(); // burn
    state.board.push(state.deck.shift(), state.deck.shift(), state.deck.shift());
    state.phase = "flop";
    log(state, "*** FLOP *** [" + state.board.join(" ") + "]");
  }
  function dealTurn(state) {
    resetRound(state);
    state.deck.shift();
    state.board.push(state.deck.shift());
    state.phase = "turn";
    log(state, "*** TURN *** [" + state.board.join(" ") + "]");
  }
  function dealRiver(state) {
    resetRound(state);
    state.deck.shift();
    state.board.push(state.deck.shift());
    state.phase = "river";
    log(state, "*** RIVER *** [" + state.board.join(" ") + "]");
  }

  function winByFold(state, winner) {
    var pot = potTotal(state);
    winner.stack += pot;
    state.phase = "payout";
    state.handOver = true;
    state.result = {
      byFold: true,
      board: state.board.slice(),
      pots: [{ amount: pot, winners: [{ id: winner.id, name: winner.name, amount: pot }] }],
      reveals: [] // no showdown reveal on a fold
    };
    clearWagers(state);
    log(state, winner.name + " wins " + pot + " (everyone folded)");
  }

  function showdown(state) {
    state.phase = "showdown";
    var board = state.board;
    var contenders = state.players.filter(function (p) { return !p.folded && !p.sittingOut; });

    // Ensure board complete (should be 5 after river).
    var pots = buildSidePots(state.players.map(function (p) {
      return { id: p.id, committed: p.committed, folded: p.folded || p.sittingOut };
    }));

    // Evaluate each contender once.
    var evals = {};
    contenders.forEach(function (p) { evals[p.id] = bestHand(p.hole, board); });

    // Seat order starting left of button for odd-chip distribution.
    var order = [];
    var idx = state.button;
    for (var k = 0; k < state.players.length; k++) {
      idx = nextIndex(state.players, idx, function () { return true; });
      order.push(state.players[idx].id);
    }
    function orderRank(id) { return order.indexOf(id); }

    var potResults = [];
    var payout = {}; // id -> total won

    pots.forEach(function (pot) {
      var elig = pot.eligible.filter(function (id) { return evals[id]; });
      if (elig.length === 0) { // everyone eligible folded (shouldn't happen) → give to any contender
        elig = contenders.map(function (p) { return p.id; });
      }
      // find best score among eligible
      var best = null;
      elig.forEach(function (id) { if (!best || compareScore(evals[id].score, evals[best].score) > 0) best = id; });
      var winners = elig.filter(function (id) { return compareScore(evals[id].score, evals[best].score) === 0; });
      winners.sort(function (a, b) { return orderRank(a) - orderRank(b); });

      var share = Math.floor(pot.amount / winners.length);
      var remainder = pot.amount - share * winners.length;
      var wlist = winners.map(function (id, i) {
        var amt = share + (i < remainder ? 1 : 0); // odd chips to earliest seats
        payout[id] = (payout[id] || 0) + amt;
        var pl = state.players.find(function (x) { return x.id === id; });
        return { id: id, name: pl.name, amount: amt, hand: evals[id].name };
      });
      potResults.push({ amount: pot.amount, winners: wlist });
    });

    Object.keys(payout).forEach(function (id) {
      var pl = state.players.find(function (x) { return x.id === id; });
      pl.stack += payout[id];
    });
    clearWagers(state);

    var reveals = contenders.map(function (p) {
      return { id: p.id, name: p.name, hole: p.hole.slice(), hand: evals[p.id].name, best: evals[p.id].cards };
    });

    state.handOver = true;
    state.phase = "payout";
    state.result = { byFold: false, board: board.slice(), pots: potResults, reveals: reveals };

    log(state, "*** SHOWDOWN ***");
    reveals.forEach(function (r) { log(state, r.name + " shows [" + r.hole.join(" ") + "] — " + r.hand); });
    potResults.forEach(function (pr) {
      pr.winners.forEach(function (w) { log(state, w.name + " wins " + w.amount); });
    });
  }

  /* ---------- Opponent AI (the "Dealer" bot) ---------------------------------
     Plays a solid, human-ish "poker 101" game: value-bets strong hands, bets top
     pair for protection, semi-bluffs its draws, fires the occasional bluff, calls
     on pot odds, and folds junk — with randomness so it's not readable. It only
     ever sees ITS OWN cards + the board; never the opponents'. Pure & testable. */
  function preflopStrength(hole) {
    var r1 = rankVal(hole[0][0]), r2 = rankVal(hole[1][0]);
    var hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    var suited = hole[0][1] === hole[1][1];
    var s;
    if (r1 === r2) { s = 0.5 + (hi - 2) / 12 * 0.5; }           // pair: 22≈.5 → AA≈1
    else {
      s = (hi - 2) / 12 * 0.42 + (lo - 2) / 12 * 0.2;
      if (suited) s += 0.08;
      var gap = hi - lo;
      if (gap === 1) s += 0.07; else if (gap === 2) s += 0.03;
      if (hi >= 13) s += 0.05;                                   // A/K high bonus
    }
    return Math.max(0, Math.min(1, s));
  }
  function suitCount(cards, s) { var n = 0; for (var i = 0; i < cards.length; i++) if (cards[i][1] === s) n++; return n; }
  function hasFlushDraw(hole, board) {
    var all = hole.concat(board);
    return suitCount(all, "s") === 4 || suitCount(all, "h") === 4 || suitCount(all, "d") === 4 || suitCount(all, "c") === 4;
  }
  function straightDraw(hole, board) {           // 'oesd' | 'gut' | 'none'
    var v = {}; hole.concat(board).forEach(function (c) { var x = rankVal(c[0]); v[x] = 1; if (x === 14) v[1] = 1; });
    var oesd = false, gut = false;
    for (var lo = 1; lo <= 10; lo++) {
      var cnt = 0, missing = null;
      for (var r = lo; r < lo + 5; r++) { if (v[r]) cnt++; else missing = r; }
      if (cnt === 4) { if (missing === lo || missing === lo + 4) oesd = true; else gut = true; }
    }
    return oesd ? "oesd" : (gut ? "gut" : "none");
  }
  function drawEquity(hole, board) {
    if (!board || board.length < 3 || board.length >= 5) return 0;   // only flop/turn
    var onFlop = board.length === 3, eq = 0;
    if (hasFlushDraw(hole, board)) eq += onFlop ? 0.34 : 0.19;
    var sd = straightDraw(hole, board);
    if (sd === "oesd") eq += onFlop ? 0.31 : 0.17;
    else if (sd === "gut") eq += onFlop ? 0.16 : 0.09;
    return Math.min(eq, 0.55);
  }
  function handStrength(g, me) {                  // 0..1 made-hand strength
    if (!me.hole) return 0;
    if (!g.board || g.board.length < 3) return preflopStrength(me.hole);
    var ev = bestHand(me.hole, g.board), cat = ev.score[0];
    var base = [0.30, 0.50, 0.70, 0.82, 0.88, 0.92, 0.96, 0.99, 1][cat] || 0.3;
    var maxB = 0; g.board.forEach(function (c) { var x = rankVal(c[0]); if (x > maxB) maxB = x; });
    if (cat === 1) {                              // one pair — top/over vs weak matters a lot
      var pr = ev.score[1];
      base = pr > maxB ? 0.72 : (pr === maxB ? 0.60 : 0.44);
    } else if (cat === 0) {                       // high card — count overcards
      var over = 0; me.hole.forEach(function (c) { if (rankVal(c[0]) > maxB) over++; });
      base = 0.20 + over * 0.055;
    }
    return base;
  }
  // The original bot, kept as the Easy setting: loose, passive, limps a lot — a
  // beginner should be able to beat something.
  function easyDecision(g, botId, rng) {
    var rnd = rng || Math.random;
    var me = null;
    for (var i = 0; i < g.players.length; i++) if (g.players[i].id === botId) me = g.players[i];
    var la = legalActions(g);
    if (!me || !la) return { type: "check" };
    var toCall = g.currentBet - me.bet;
    var pot = potTotal(g);
    var preflop = !g.board || g.board.length < 3;
    var made = handStrength(g, me);
    var draw = preflop ? 0 : drawEquity(me.hole, g.board);
    var potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
    // The same spot always gets the same answer from Easy. It still looks random across
    // hands, but a replay of one hand can't come out differently — which is what lets the
    // bot tests measure one strategy against another without card luck drowning the result.
    var r = seedRoll(g, botId, "easy|" + (g.phase || "") + "|" + g.currentBet + "|" + me.bet + "|" + pot);

    function betTo(frac) {                        // size a bet/raise to ~frac of the pot; always legal
      var target = g.currentBet > 0
        ? g.currentBet + Math.max(g.minRaise, Math.round((pot + toCall) * frac))
        : Math.max(g.bb, Math.round(pot * frac));
      return Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, target));
    }
    function aggro(frac) {
      if (la.raise) return { type: "raise", amount: betTo(frac) };
      return la.check ? { type: "check" } : (la.call ? { type: "call" } : { type: "fold" });
    }

    if (preflop) {
      if (toCall <= 0) {                          // option / limped pot
        if (made > 0.72 && la.raise && r < 0.72) return aggro(1.0);
        if (made > 0.55 && la.raise && r < 0.35) return aggro(0.8);
        return { type: "check" };
      }
      if (made > 0.80 && la.raise && r < 0.75) return aggro(1.0);              // premium 3-bet
      if (made > 0.62) { if (la.raise && r < 0.22) return aggro(0.9); return { type: "call" }; }
      if (made > 0.47 && toCall <= g.bb * 1.5 && la.call && r < 0.85) return { type: "call" }; // cheap speculative
      if (la.raise && r < 0.05) return aggro(0.9);                              // rare light 3-bet bluff
      return la.check ? { type: "check" } : { type: "fold" };
    }

    // ---- postflop ----
    if (toCall <= 0) {                            // checked to the bot
      if (made > 0.82) return r < 0.15 ? { type: "check" } : aggro(0.66);      // value, sometimes trap
      if (made > 0.55) return r < 0.55 ? aggro(0.55) : { type: "check" };      // top pair: bet ~half the time
      if (draw > 0.20 && la.raise && r < 0.55) return aggro(0.6);              // semi-bluff draw
      if (la.raise && r < 0.26) return aggro(0.55);                            // c-bet bluff with air
      return { type: "check" };
    }
    // facing a bet
    if (made > 0.86) return (la.raise && r < 0.6) ? aggro(0.9) : { type: "call" };  // strong: raise/call
    if (made > 0.62) return (la.raise && r < 0.20) ? aggro(0.8) : { type: "call" }; // good: mostly call
    if (draw > 0.15) {
      if (la.raise && r < 0.25) return aggro(0.85);                            // semi-bluff raise
      if (la.call && draw + 0.06 >= potOdds) return { type: "call" };          // price-correct draw call
      if (la.call && toCall <= pot * 0.4 && r < 0.6) return { type: "call" };
    }
    if (made > 0.42 && la.call && (made >= potOdds || toCall <= pot * 0.3) && r < 0.72) return { type: "call" };
    if (la.raise && r < 0.06) return aggro(0.9);                               // occasional pure bluff-raise
    if (la.call && toCall <= g.bb && r < 0.30) return { type: "call" };        // rare bluff-catch of min bet
    return la.check ? { type: "check" } : { type: "fold" };
  }

  /* ---------- Opponent AI ---------------------------------------------------
     Five settings, from a beginner who limps to a player who fires three
     barrels with the right blockers. Every one of them sees only its OWN two
     cards and the board — never anybody else's — so no bot can ever cheat.

     The hard part of a believable bluff isn't the occasional bet with nothing.
     It's that the same hand keeps telling the same story street after street.
     Roll a die on each street and you get a bot that bets the flop, gives up on
     the turn, then raises the river with that same busted hand — which is a
     line no human being has ever taken. So "am I bluffing this hand" is decided
     once, as a hash of the hand number and the seat, and simply re-read on
     every street: a bluff that starts gets continued or abandoned coherently.
     The same seed picks the bet size, and value bets and bluffs draw from the
     one distribution, so the number in front of a bot tells you nothing.       */
  var BOT_LEVELS = {
    easy:     { legacy: true },
    medium:   { pos: true, texture: false, bluff: 0.80, thin: 0.85, threeBet: 0.85, blockers: false, overbet: false, exploit: 0.45 },
    hard:     { pos: true, texture: true,  bluff: 1.00, thin: 1.00, threeBet: 1.00, blockers: true,  overbet: false, exploit: 1.00 },
    hardcore: { pos: true, texture: true,  bluff: 1.25, thin: 1.30, threeBet: 1.50, blockers: true,  overbet: true, exploit: 1.75 },
    tricky:   { pos: true, texture: true,  bluff: 1.05, thin: 1.00, threeBet: 1.10, blockers: true,  overbet: true, styles: true, exploit: 1.20 }
  };
  // Tricksters: a seat keeps one temperament for as long as it sits there, so you
  // can work out that Ivy never bluffs and Rex never stops.
  var BOT_STYLES = [
    { id: "rock",    open:  2.0, bluff: 0.45, trap: 0.22, thin: 0.75, call: 0.80 },
    { id: "solid",   open:  0.0, bluff: 1.00, trap: 0.12, thin: 1.00, call: 1.00 },
    { id: "shark",   open: -0.5, bluff: 1.30, trap: 0.18, thin: 1.15, call: 1.05 },
    { id: "trapper", open:  0.5, bluff: 0.95, trap: 0.45, thin: 0.95, call: 1.15 },
    { id: "maniac",  open: -2.5, bluff: 1.90, trap: 0.05, thin: 1.30, call: 0.85 }
  ];
  // How good a hand has to be to open an unopened pot, by how many players are still to
  // act behind you — which, before the flop, IS your seat: one behind is the small blind,
  // two is the button (only the blinds left), three the cutoff, five under the gun at a
  // six-handed table. In Chen points that's roughly the top 15% of hands under the gun
  // widening to half of them on the button — what a good regular actually plays.
  // (Index 0 is the big blind raising its own option.)
  var OPEN_NEED = [7, 5, 4, 6, 7, 7.5, 8, 8.5];
  // The bots open a touch tighter than the textbook ranges the coach teaches: at a table of
  // loose callers — which is what most home games are — the marginal opens stop paying,
  // and bot-skill.test.js measured the tighter ladder winning more against every setting.
  var BOT_OPEN_NEED = [7, 5.5, 5, 6.5, 7.5, 8, 8.5, 9];
  function hash32(s) { var h = 2166136261, i; for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return h >>> 0; }
  function seededRng(seed) { var x = (seed >>> 0) || 1; return function () { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
  function seedRoll(g, id, salt) { return hash32((g.handNo || 0) + "|" + id + "|" + salt) / 4294967296; }
  function styleFor(id) { return BOT_STYLES[hash32("style|" + id) % BOT_STYLES.length]; }

  // Bill Chen's starting-hand formula: -1 for 72o up to 20 for a pair of aces.
  // It's a rule of thumb rather than an equity calculation, but it ranks the 169
  // starting hands about as well as a chart does and costs nothing to work out.
  function chenScore(hole) {
    var a = rankVal(hole[0][0]), b = rankVal(hole[1][0]);
    var hi = Math.max(a, b), lo = Math.min(a, b);
    var pts = hi === 14 ? 10 : hi === 13 ? 8 : hi === 12 ? 7 : hi === 11 ? 6 : hi / 2;
    var s;
    if (a === b) s = Math.max(5, pts * 2);
    else {
      s = pts;
      if (hole[0][1] === hole[1][1]) s += 2;
      var gap = hi - lo - 1;
      s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
      if (gap <= 1 && hi < 12) s += 1;                  // connectors that make straights
    }
    return Math.round(s * 2) / 2;
  }
  // How many live players still act behind me this street. Nought means I'm last
  // to speak — the single biggest thing the old bot didn't know.
  function seatsAfterMe(g, me) {
    var n = g.players.length, myIdx = -1, j;
    for (j = 0; j < n; j++) if (g.players[j] === me) myIdx = j;
    if (myIdx < 0 || n < 2) return 0;
    var preflop = !g.board || g.board.length < 3;
    var last = preflop ? (g.button + (n === 2 ? 1 : 2)) % n : g.button;   // big blind closes preflop, button after
    if (myIdx === last) return 0;
    var c = 0, i = (myIdx + 1) % n, guard = 0;
    while (guard++ < n) {
      var p = g.players[i];
      if (p && !p.folded && !p.sittingOut && !p.allIn) c++;
      if (i === last) break;
      i = (i + 1) % n;
    }
    return c;
  }
  // How many times the pot has been raised before the flop. This used to be guessed from
  // the size of the bet — "more than 3.4 big blinds means a re-raise" — and the bots' own
  // standard open is 3.5 big blinds, so every ordinary opening raise was read as a 3-bet
  // and nearly everything folded to it, the coach's advice included. The actions say
  // exactly how many raises there have been, so count those.
  function preflopRaises(g) {
    if (g.obs) { var n = 0, k; for (k in g.obs) n += (g.obs[k] && g.obs[k].pr) || 0; return n; }
    return g.currentBet > g.bb ? (g.currentBet > g.bb * 6 ? 2 : 1) : 0;   // an old state with no record
  }
  // Order of play after the flop: small blind first, button last.
  function postflopOrder(g, idx) { var n = g.players.length; return ((idx - g.button - 1) % n + n) % n; }
  // For a call before the flop, "position" means acting after the raiser on every later
  // street — not how many people are still to act right now. (By that measure the big
  // blind, last to speak preflop, looked "in position", and the button facing a raise didn't.)
  function ipVsRaiser(g, me) {
    var myIdx = g.players.indexOf(me), agg = g.aggressor;
    if (myIdx < 0 || agg == null || agg < 0 || agg >= g.players.length) return false;
    return postflopOrder(g, myIdx) > postflopOrder(g, agg);
  }
  // Put money in before the flop by choice (a raise, a call, a limp) — not just posted a blind.
  function voluntary(g, p) {
    var o = (g.obs || {})[p.id] || {};
    return (o.pr || 0) > 0 || (o.pff || 0) - (o.pfd || 0) > 0;
  }
  function effStack(g, me) {                            // the most that can actually be won
    var best = 0;
    g.players.forEach(function (p) { if (p !== me && !p.folded && !p.sittingOut) best = Math.max(best, p.stack + p.bet); });
    return Math.min(me.stack + me.bet, best) || (me.stack + me.bet);
  }
  // How dangerous the board is. Top pair on 9♦7♦6♠ is a different hand from top
  // pair on K♠7♦2♣, and the old bot scored them the same.
  function texture(board) {
    var suits = {}, vals = [], seen = {}, paired = false;
    board.forEach(function (c) {
      suits[c[1]] = (suits[c[1]] || 0) + 1;
      var v = rankVal(c[0]); if (seen[v]) paired = true; seen[v] = 1; vals.push(v);
    });
    var maxSuit = 0, s; for (s in suits) if (suits[s] > maxSuit) maxSuit = suits[s];
    vals.sort(function (x, y) { return x - y; });
    var near = 0, i;
    for (i = 1; i < vals.length; i++) if (vals[i] - vals[i - 1] <= 2) near++;
    var wet = Math.min(1,
      (maxSuit >= 3 ? 0.5 : maxSuit === 2 ? 0.22 : 0) +
      (near >= 2 ? 0.4 : near === 1 ? 0.2 : 0) +
      (vals.length >= 3 && vals[vals.length - 1] - vals[0] <= 4 ? 0.15 : 0));
    return { wet: wet, paired: paired, maxSuit: maxSuit, hi: vals.length ? vals[vals.length - 1] : 0 };
  }
  function relStrength(g, me, lvl) {                    // made-hand strength, board-aware
    var s = handStrength(g, me);
    if (!lvl.texture || !g.board || g.board.length < 3) return s;
    var t = texture(g.board);
    if (s < 0.86) s += (0.5 - t.wet) * 0.16;            // one pair is worth less on a drawy board
    if (t.paired && s < 0.80) s -= 0.05;                // somebody may have tripped up
    return Math.max(0, Math.min(1, s));
  }
  function blockerBonus(me, board) {                    // holding a card they need
    if (!board || board.length < 3 || !me.hole) return 0;
    var t = {}; board.forEach(function (c) { t[c[1]] = (t[c[1]] || 0) + 1; });
    var b = 0;
    me.hole.forEach(function (c) {
      if ((t[c[1]] || 0) >= 2 && rankVal(c[0]) === 14) b += 0.11;   // the nut flush can't be out there
      else if (rankVal(c[0]) >= 13) b += 0.03;
    });
    return Math.min(0.16, b);
  }
  // What the table has taught these bots about the people still in the hand — only
  // when the table has learning switched on. Nought-point-four-five is "an ordinary
  // player" and is what they assume until they've seen enough of you to know better.
  function foldRead(g, model, meId) {
    if (!model) return 0.45;
    var tot = 0, n = 0;
    g.players.forEach(function (p) {
      if (p.id === meId || p.folded || p.sittingOut) return;
      var m = model[p.id];
      if (m && m.faced >= 6) { tot += Math.max(0, Math.min(1, m.folded / m.faced)); n++; }
    });
    return n ? tot / n : 0.45;
  }

  function botDecision(g, botId, rng, opts) {
    var rnd = rng || Math.random;
    opts = opts || {};
    var lvl = BOT_LEVELS[opts.skill] || BOT_LEVELS.hard;
    if (lvl.legacy) return easyDecision(g, botId, rnd);

    var me = null, i;
    for (i = 0; i < g.players.length; i++) if (g.players[i].id === botId) me = g.players[i];
    var la = legalActions(g);
    if (!me || !la || !me.hole) return { type: "check" };

    var style = lvl.styles ? styleFor(botId) : BOT_STYLES[1];
    var toCall = g.currentBet - me.bet;
    var pot = potTotal(g);
    var live = activePlayers(g).length;
    var preflop = !g.board || g.board.length < 3;
    var street = preflop ? "pre" : g.board.length === 3 ? "flop" : g.board.length === 4 ? "turn" : "river";
    var after = lvl.pos ? seatsAfterMe(g, me) : 1;
    var inPos = after === 0;
    var potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
    var eff = effStack(g, me);
    var pass = la.check ? { type: "check" } : { type: "fold" };

    function betTo(frac) {
      var target = g.currentBet > 0
        ? g.currentBet + Math.max(g.minRaise, Math.round((pot + toCall) * frac))
        : Math.max(g.bb, Math.round(pot * frac));
      return Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, target));
    }
    function aggro(frac) {
      if (la.raise) return { type: "raise", amount: betTo(frac) };
      return la.check ? { type: "check" } : (la.call ? { type: "call" } : { type: "fold" });
    }

    /* ---- before the flop: a real opening range, and it moves with the seat ---- */
    if (preflop) {
      var c = chenScore(me.hole);
      // Careful: before the flop there is ALWAYS a bet in front of you — the big blind.
      // "Nobody has acted yet" is currentBet === bb, not toCall === 0, and getting that
      // wrong turns every seat into a caller and the whole table into limpers.
      var raises = preflopRaises(g);
      var opened = raises >= 1, reraised = raises >= 2;
      var need = BOT_OPEN_NEED[Math.min(after, 7)] + style.open;

      if (!opened) {                                   // the pot is unopened: raise it or leave
        if (c >= 17 && seedRoll(g, botId, "slow") < style.trap) return la.check ? { type: "check" } : { type: "call" };
        if (c >= need && la.raise) return aggro(live > 3 ? 1.0 : 0.85);
        if (la.check) return { type: "check" };        // the big blind's option
        if (c >= need - 2 && la.call && toCall <= g.bb && seedRoll(g, botId, "limp") < 0.22) return { type: "call" };
        return { type: "fold" };
      }

      var priceOK = toCall <= Math.max(g.bb * 4, eff * 0.09);
      var ip = ipVsRaiser(g, me);
      // All in, or nearly: there's no betting after this, so only the price matters — and
      // the price is a question about the hands that raise, worked out from what's public
      // (the same range picture the coach uses; never anybody's real cards).
      var committedB = toCall >= me.stack * 0.6 || (me.stack - toCall) <= (pot + toCall) * 0.6;
      if (committedB && la.call) {
        var callAmt = Math.min(toCall, me.stack);
        var eqB = equity(me.hole.map(cardIdx), [], coachProfiles(g, botId), 400, seededRng(hash32(g.handNo + "|" + botId + "|allin")));
        if (eqB >= callAmt / (pot + callAmt)) return (la.raise && c >= 12) ? { type: "raise", amount: la.maxRaiseTo } : { type: "call" };
        return pass;
      }
      if (!reraised) {                                 // somebody opened
        if (c >= 14 && la.raise) return aggro(1.05);                                    // QQ+ : 3-bet for value
        if (c >= 11 && la.raise && seedRoll(g, botId, "3bet") < 0.40 * lvl.threeBet) return aggro(1.0);
        if (c >= 7 && ip && la.raise && seedRoll(g, botId, "3bl") < 0.12 * lvl.bluff * style.bluff) return aggro(1.0);
        // calling a raise needs a better hand than opening does — about the top tenth
        // with position on the raiser, a bit tighter without it
        if (c >= (ip ? 8 : 9.5) + style.open * 0.5 && la.call && priceOK) return { type: "call" };
        // the big blind already has a blind in: it defends on a price nobody else is getting
        if (after === 0 && c >= 6.5 + style.open * 0.5 && la.call && toCall <= g.bb * 3) return { type: "call" };
        return pass;
      }
      if (c >= 16 && la.raise) return aggro(1.0);                                        // KK+ : 4-bet
      if (c >= 13 && la.call && toCall <= eff * 0.18) return { type: "call" };
      if (c >= 10 && la.call && toCall <= eff * 0.10) return { type: "call" };
      return pass;
    }

    /* ---- after the flop ---------------------------------------------------- */
    var t = lvl.texture ? texture(g.board) : { wet: 0.4, paired: false, maxSuit: 0, hi: 0 };
    var made = relStrength(g, me, lvl);
    var draw = drawEquity(me.hole, g.board);
    var blk = lvl.blockers ? blockerBonus(me, g.board) : 0;
    var read = foldRead(g, opts.model, botId);
    var multi = live <= 2 ? 1 : live === 3 ? 0.66 : live === 4 ? 0.45 : 0.30;  // bluffing five people is just giving chips away
    var spr = eff / Math.max(1, pot);

    // decided once per hand, read again every street — this is what makes the bluff a story
    // The read is the whole point of the learning switch: against somebody who folds to
    // every bet you bluff far more, and against somebody who calls with anything you stop
    // bluffing and start value-betting hands you'd normally check. With learning off,
    // foldRead() always returns 0.45 and these two lines do nothing at all.
    var exploit = lvl.exploit || 1;
    var readMul = Math.max(0.3, 1 + (read - 0.45) * 1.8 * exploit);
    var bluffFreq = Math.min(0.75, 0.30 * lvl.bluff * style.bluff * multi * (inPos ? 1.25 : 0.75) * readMul + blk);
    var bluffing = seedRoll(g, botId, "bluff") < bluffFreq;
    var keepFiring = seedRoll(g, botId, "barrel" + street) < (street === "flop" ? 1 : street === "turn" ? 0.62 : 0.44);
    // they never fold → value bet thinner; but never below a real pair, or "value" turns
    // into betting ace-high and hoping
    var thin = Math.max(0.44, 0.58 - (lvl.thin - 1) * 0.10 - Math.max(0, 0.45 - read) * 0.30 * exploit);
    // one size for value and for air on the same board
    function sizeNow() {
      var roll = seedRoll(g, botId, "size" + street);
      var base = street === "flop" ? (t.wet > 0.45 ? 0.62 : 0.36)
               : street === "turn" ? (t.wet > 0.45 ? 0.78 : 0.62) : 0.72;
      if (lvl.overbet && street === "river" && roll < 0.16) return 1.25;
      return roll < 0.3 ? base * 0.85 : roll > 0.8 ? base * 1.15 : base;
    }

    if (spr < 1.2 && made > 0.62 && la.raise) return { type: "raise", amount: la.maxRaiseTo };  // short: get it in

    if (toCall <= 0) {
      if (made > 0.90 && street !== "river" && seedRoll(g, botId, "trap" + street) < style.trap) return { type: "check" };
      if (made > 0.82) return aggro(sizeNow());                                   // value
      if (made > thin && (inPos || live <= 2) && la.raise) return aggro(sizeNow() * 0.9);  // thin value
      if (draw > 0.18 && la.raise && seedRoll(g, botId, "semi" + street) < 0.62) return aggro(sizeNow());
      if (bluffing && keepFiring && made < 0.50 && la.raise) return aggro(sizeNow());       // the story continues
      return { type: "check" };
    }

    if (made > 0.90) return (la.raise && seedRoll(g, botId, "rr" + street) < 0.70) ? aggro(sizeNow()) : { type: "call" };
    if (made > 0.78) return (la.raise && seedRoll(g, botId, "rr" + street) < 0.30) ? aggro(sizeNow()) : { type: "call" };
    if (made > 0.60) return (toCall <= pot * 0.75 || potOdds < made - 0.20) ? { type: "call" } : pass;
    if (draw > 0.12) {
      if (la.raise && seedRoll(g, botId, "sr" + street) < 0.22 * lvl.bluff) return aggro(sizeNow());
      if (la.call && draw + blk * 0.5 + (inPos ? 0.05 : 0.02) >= potOdds) return { type: "call" };
    }
    if (made > 0.42 && la.call && toCall <= pot * 0.35 * style.call) return { type: "call" };   // cheap bluff-catch
    if (bluffing && keepFiring && made < 0.40 && live <= 2 && la.raise &&
        seedRoll(g, botId, "braise" + street) < 0.25 * lvl.bluff) return aggro(sizeNow());
    return pass;
  }

  /* ---------- Odds -------------------------------------------------------------
     The coach has to answer "how often do I win from here?" a thousand times a
     decision, so it doesn't use evaluate7 — that builds and sorts every five-card
     subset, which is right for settling a showdown and far too slow for this. Here
     a seven-card hand is packed into one integer whose numeric order IS the hand
     order: the category in the top bits, then the ranks that break ties, four bits
     each. coach.test.js plays it against evaluate7 on random hands to prove the
     two always agree on who wins.                                                  */
  var CARD_IDX = {};
  (function () { for (var r = 0; r < 13; r++) for (var s = 0; s < 4; s++) CARD_IDX[RANKS[r] + SUITS[s]] = r * 4 + s; })();
  function cardIdx(c) { return CARD_IDX[c]; }
  function idxCard(i) { return RANKS[i >> 2] + SUITS[i & 3]; }
  var _cnt = new Int8Array(16);
  function straightTop(mask) {                      // highest straight in a rank mask, 0 if none
    if (mask & (1 << 14)) mask |= 2;                // the ace plays low as well
    for (var h = 14; h >= 5; h--) if (((mask >> (h - 4)) & 31) === 31) return h;
    return 0;
  }
  function topRanks(mask, n) {                      // the n highest ranks in a mask, 4 bits each
    var out = 0, got = 0;
    for (var r = 14; r >= 2 && got < n; r--) if (mask & (1 << r)) { out = (out << 4) | r; got++; }
    while (got < n) { out <<= 4; got++; }
    return out;
  }
  function fastScore(idx, n) {
    var i, r, s, all = 0, m0 = 0, m1 = 0, m2 = 0, m3 = 0, c0 = 0, c1 = 0, c2 = 0, c3 = 0;
    for (r = 2; r <= 14; r++) _cnt[r] = 0;
    for (i = 0; i < n; i++) {
      var c = idx[i]; r = (c >> 2) + 2; s = c & 3;
      _cnt[r]++; all |= 1 << r;
      if (s === 0) { m0 |= 1 << r; c0++; } else if (s === 1) { m1 |= 1 << r; c1++; }
      else if (s === 2) { m2 |= 1 << r; c2++; } else { m3 |= 1 << r; c3++; }
    }
    var fm = c0 >= 5 ? m0 : c1 >= 5 ? m1 : c2 >= 5 ? m2 : c3 >= 5 ? m3 : 0;
    if (fm) { var sf = straightTop(fm); if (sf) return (8 << 20) | (sf << 16); }
    var quad = 0, trip = 0, trip2 = 0, p1 = 0, p2 = 0;
    for (r = 14; r >= 2; r--) {
      var k = _cnt[r];
      if (k === 4) quad = r;
      else if (k === 3) { if (!trip) trip = r; else if (!trip2) trip2 = r; }
      else if (k === 2) { if (!p1) p1 = r; else if (!p2) p2 = r; }
    }
    if (quad) return (7 << 20) | (quad << 16) | (topRanks(all & ~(1 << quad), 1) << 12);
    if (trip && (trip2 || p1)) return (6 << 20) | (trip << 16) | (Math.max(trip2, p1) << 12);
    if (fm) return (5 << 20) | topRanks(fm, 5);
    var st = straightTop(all);
    if (st) return (4 << 20) | (st << 16);
    if (trip) return (3 << 20) | (trip << 16) | (topRanks(all & ~(1 << trip), 2) << 8);
    if (p1 && p2) return (2 << 20) | (p1 << 16) | (p2 << 12) | (topRanks(all & ~(1 << p1) & ~(1 << p2), 1) << 8);
    if (p1) return (1 << 20) | (p1 << 16) | (topRanks(all & ~(1 << p1), 3) << 4);
    return topRanks(all, 5);
  }
  function chenIdx(a, b) { return chenScore([idxCard(a), idxCard(b)]); }

  // What share of all 1,326 starting hands score at least this much on Chen's scale —
  // "the top 12% of hands" teaches more than "a 10".
  var CHEN_TOP = (function () {
    var all = [], i, j;
    for (i = 0; i < 52; i++) for (j = i + 1; j < 52; j++) all.push(chenIdx(i, j));
    var out = {};
    all.forEach(function (sc) { if (out[sc] == null) out[sc] = all.filter(function (x) { return x >= sc; }).length / all.length; });
    return out;
  })();
  function chenTop(sc) {
    if (CHEN_TOP[sc] != null) return CHEN_TOP[sc];
    var best = 1, k; for (k in CHEN_TOP) if (Number(k) <= sc && CHEN_TOP[k] < best) best = CHEN_TOP[k];
    return best;
  }

  // The hands an opponent is LIKELY to hold, given how they've played this hand. A random
  // hand is drawn and kept with a probability that depends on its starting strength and
  // on what they've done: a preflop raiser mostly holds good starting hands, a caller a
  // wider spread, and somebody who has bet after the flop usually has something that hit.
  function rangeKeep(a, b, boardIdx, prof) {
    var c = chenIdx(a, b), k = 1;
    if (prof.pr) k = c >= 9 ? 1 : c >= 7 ? 0.6 : c >= 5 ? 0.22 : 0.06;
    else if (prof.inPre) k = c >= 7 ? 1 : c >= 5 ? 0.7 : c >= 3 ? 0.35 : 0.12;
    if (prof.ar && boardIdx.length >= 3) {
      var h = boardIdx.concat([a, b]), cat = fastScore(h, h.length) >> 20;
      // The bigger the bet, the more of the weak end of their range drops away: people bet
      // small with all sorts, but a pot-sized bet from an ordinary player is usually real.
      var big = prof.size || 0.5;                    // their bet as a share of the pot
      var weak = big >= 1.5 ? 0.06 : big >= 1 ? 0.12 : big >= 0.6 ? 0.22 : 0.35;
      var mid = big >= 1.5 ? 0.30 : big >= 1 ? 0.55 : big >= 0.6 ? 0.85 : 1;
      if (cat < 1) k *= weak; else if (cat === 1) k *= mid;
    }
    return k;
  }
  // Monte Carlo: deal out the rest many times and count. Known opponents (the coach's
  // "truth" view) use their real cards. For unknown ones, every possible two-card hand is
  // weighted by rangeKeep() up front and each run draws from that weighting — proper
  // weighted sampling, so a range that keeps only 5% of hands really is that narrow.
  function equity(heroIdx, boardIdx, opps, iters, rng) {
    rng = rng || defaultRng;
    var dead = {}, i, j;
    heroIdx.concat(boardIdx).forEach(function (c) { dead[c] = 1; });
    opps.forEach(function (o) { if (o.known) o.known.forEach(function (c) { dead[c] = 1; }); });
    var live = []; for (i = 0; i < 52; i++) if (!dead[i]) live.push(i);
    var ranges = opps.map(function (o) {
      if (o.known) return null;
      var ca = [], cb = [], cum = [], tot = 0;
      for (i = 0; i < live.length; i++) for (j = i + 1; j < live.length; j++) {
        var w = rangeKeep(live[i], live[j], boardIdx, o.prof || {});
        if (w > 0) { tot += w; ca.push(live[i]); cb.push(live[j]); cum.push(tot); }
      }
      return { a: ca, b: cb, cum: cum, tot: tot };
    });
    var stamp = new Int32Array(52), win = 0, tie = 0, n = live.length;
    var board = new Array(5), hand = new Array(7), oh = [];
    function pick(t) { for (;;) { var c = live[Math.floor(rng() * n)]; if (stamp[c] !== t) { stamp[c] = t; return c; } } }
    function fromRange(R, t) {
      for (var tries = 0; tries < 60; tries++) {
        var x = rng() * R.tot, lo = 0, hi = R.cum.length - 1;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (R.cum[mid] < x) lo = mid + 1; else hi = mid; }
        var a = R.a[lo], b = R.b[lo];
        if (stamp[a] !== t && stamp[b] !== t) { stamp[a] = t; stamp[b] = t; return [a, b]; }
      }
      return [pick(t), pick(t)];                      // only if the range is all but used up
    }
    for (var t = 1; t <= iters; t++) {
      for (j = 0; j < opps.length; j++) oh[j] = opps[j].known || fromRange(ranges[j], t);
      for (j = 0; j < boardIdx.length; j++) board[j] = boardIdx[j];
      for (j = boardIdx.length; j < 5; j++) board[j] = pick(t);
      for (j = 0; j < 5; j++) hand[j] = board[j];
      hand[5] = heroIdx[0]; hand[6] = heroIdx[1];
      var mine = fastScore(hand, 7), best = mine, ties = 1;
      for (j = 0; j < opps.length; j++) {
        hand[5] = oh[j][0]; hand[6] = oh[j][1];
        var sc = fastScore(hand, 7);
        if (sc > best) { best = sc; ties = 0; } else if (sc === best && best === mine) ties++;
        if (best > mine) break;
      }
      if (best === mine) { if (ties === 1) win++; else tie += 1 / ties; }
    }
    return (win + tie) / iters;
  }
  function outsFor(hole, board) {
    if (!board || board.length < 3 || board.length >= 5) return { outs: 0, name: "" };
    var fd = hasFlushDraw(hole, board), sd = straightDraw(hole, board);
    if (fd && sd === "oesd") return { outs: 15, name: "Flush draw + open-ended straight draw" };
    if (fd && sd === "gut") return { outs: 12, name: "Flush draw + gutshot" };
    if (fd) return { outs: 9, name: "Flush draw" };
    if (sd === "oesd") return { outs: 8, name: "Open-ended straight draw" };
    if (sd === "gut") return { outs: 4, name: "Gutshot straight draw" };
    return { outs: 0, name: "" };
  }

  /* ---------- The coach ---------------------------------------------------------
     What a strong player does in your seat, and why — worked out ONLY from what you
     could know at a real table: your cards, the board, the pot, your position, and
     how the others have played. It has no way to look at anybody's cards or at the
     deck: it plays like a real player sitting beside you, and fairness.test.js
     reshuffles every hidden card to prove its advice never changes.               */
  function coachProfiles(g, heroId) {
    var obs = g.obs || {};
    var pre = !g.board || g.board.length < 3;
    // Before the flop, the players who have only posted a blind and not yet acted usually
    // fold — counting them as if they'll all see a showdown made a great hand look like a
    // 30% hand. So preflop the win chance is against whoever has put money in by choice;
    // if nobody has, against one random hand.
    var live = g.players.filter(function (p) { return p.id !== heroId && !p.folded && !p.sittingOut; });
    if (pre) {
      var vol = live.filter(function (p) { return voluntary(g, p); });
      if (!vol.length) return [{ id: "any", name: "a random hand", prof: {} }];
      live = vol;
    }
    return live
      .map(function (p) {
        var o = obs[p.id] || {};
        var potBefore = Math.max(1, potTotal(g) - (p.bet || 0));
        return { id: p.id, name: p.name, prof: { pr: (o.pr || 0) > 0, ar: (o.ar || 0) > 0, inPre: true,
          size: (g.board && g.board.length >= 3) ? (p.bet || 0) / potBefore : 0 } };
      });
  }
  function pctStr(x) { return Math.round(x * 100) + "%"; }
  function coachAdvice(g, heroId, opts) {
    opts = opts || {};
    var hero = null, i;
    for (i = 0; i < g.players.length; i++) if (g.players[i].id === heroId) hero = g.players[i];
    var la = legalActions(g);
    if (!hero || !hero.hole || !la || g.players[g.toAct] !== hero) return null;
    var rng = opts.rng || defaultRng;
    var board = g.board || [], pre = board.length < 3;
    var toCall = Math.min(g.currentBet - hero.bet, hero.stack), pot = potTotal(g);
    var need = toCall > 0 ? toCall / (pot + toCall) : 0;
    var after = seatsAfterMe(g, hero), inPos = after === 0;
    var opps = coachProfiles(g, heroId);
    var heroIdx = hero.hole.map(cardIdx), boardIdx = board.map(cardIdx);
    var eq = equity(heroIdx, boardIdx, opps, opts.iters || (pre ? 700 : 1200), rng);
    var eff = effStack(g, hero);
    var posLine = inPos ? "You're last to act, so you'll see what everyone does before you decide — on every street."
      : after === 1 ? "One player still acts after you." : after + " players still act after you.";
    var lines = [], act, raiseTo = 0, want = need;   // want: the win chance it actually asks for
    var cardsTxt = hero.hole.join(" ");
    function raiseSize(frac) {
      var target = g.currentBet > 0 ? g.currentBet + Math.max(g.minRaise, Math.round((pot + toCall) * frac)) : Math.max(g.bb, Math.round(pot * frac));
      return Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, target));
    }
    var handName = "", draw = { outs: 0, name: "" };

    if (pre) {
      var c = chenScore(hero.hole), top = chenTop(c);
      var needC = OPEN_NEED[Math.min(after, 7)];
      var raises = preflopRaises(g), opened = raises >= 1, reraised = raises >= 2;
      var ip = ipVsRaiser(g, hero);
      var raiser = (g.aggressor != null && g.players[g.aggressor]) ? g.players[g.aggressor].name : "Someone";
      handName = cardsTxt;
      lines.push(top <= 0.5 ? cardsTxt + " is in the top " + pctStr(top) + " of starting hands (" + c + " on Chen's scale)."
        : top >= 0.9 ? cardsTxt + " is one of the very worst starting hands there is."
        : cardsTxt + " is a below-average starting hand — about " + pctStr(top) + " of hands are as good or better.");
      var seatName = after === 0 ? "in the big blind" : after === 1 ? "in the small blind" : after === 2 ? "on the button" :
        after === 3 ? "in the cutoff" : after >= 5 ? "in early position" : "in middle position";
      if (!opened) {
        lines.push("You're " + seatName + ". From here a good player opens about the top " + pctStr(chenTop(needC)) + " of hands (" + needC + "+ on Chen's scale).");
        if (c >= needC && la.raise) {
          act = "raise"; raiseTo = raiseSize(1.0);
          lines.push("Raise. Nobody has come in yet, so a raise often wins the blinds on the spot — and when it's called you're usually holding the better hand.");
        } else if (la.check) {
          act = "check"; lines.push("Check. You're the big blind and it costs nothing to see the flop.");
        } else {
          act = "fold"; lines.push("Fold. Limping in with a hand this weak from here loses money over time — it isn't worth the " + toCall + ".");
        }
      } else {
        // Facing a raise, the decision follows the numbers it shows you: how often you win
        // against the hands that raise, against what the call costs. (It used to fall back on
        // a rule of thumb here — "calling a raise out of position needs a top-7% hand" — and
        // could say FOLD next to "win 61%, need 35%", even for a call that was all your chips.)
        var committed = toCall >= hero.stack * 0.6 || (hero.stack - toCall) <= (pot + toCall) * 0.6;
        var margin = committed ? 0 : (ip ? 0.05 : 0.10) + (reraised ? 0.04 : 0);
        var evCall = eq * (pot + toCall) - toCall;
        want = need + margin;
        lines.push(reraised ? "There's been a re-raise (a 3-bet) — that's a strong range: big pairs and big aces, mostly."
                            : raiser + " has opened with a raise, so they usually hold a good hand.");
        lines.push("Against the hands " + (reraised ? "that re-raise" : raiser + " raises with") + ", you win about " + pctStr(eq) +
          ". Calling costs " + toCall + " to win " + pot + ", so the price alone needs " + pctStr(need) + ".");
        if (committed) {
          lines.push("Calling puts " + (toCall >= hero.stack ? "all" : "nearly all") + " your chips in, so there's no betting left after this — where you sit doesn't matter, only the price does.");
        } else {
          lines.push((ip ? "You'll act after " + raiser + " on every street after the flop — that's position, and it's worth a lot. "
                         : "You'll have to act before " + raiser + " after the flop. ") +
            "With more betting still to come, a good player wants room above that — about " + pctStr(want) + " here" +
            (ip ? "." : ", more than with position."));
        }
        if (!committed && la.raise && ((!reraised && c >= 12) || (reraised && c >= 16))) {
          act = "raise"; raiseTo = raiseSize(1.05);
          lines.push((reraised ? "Raise again (4-bet). " : "Re-raise (3-bet). ") + "A hand this strong wants more money in now, while they can still call with worse.");
        } else if (committed && eq >= need && la.raise && c >= 10) {
          act = "raise"; raiseTo = la.maxRaiseTo;
          lines.push("All in. You're ahead of the hands that raise, and pushing makes the others pay to find out.");
        } else if (eq >= want && la.call) {
          act = "call";
          lines.push("Call. " + pctStr(eq) + " against the " + pctStr(want) + " you need — worth about " + (evCall >= 0 ? "+" : "") + Math.round(evCall) + " chips every time you make this call.");
        } else {
          act = la.check ? "check" : "fold";
          lines.push("Fold. " + pctStr(eq) + " isn't enough when you need " + pctStr(want) +
            (evCall < 0 ? " — calling loses about " + Math.abs(Math.round(evCall)) + " chips each time." : " — the betting still to come would cost you more than the price shows."));
        }
      }
    } else {
      handName = describeScore(bestHand(hero.hole, board).score);
      draw = outsFor(hero.hole, board);
      lines.push("You have " + handName + (draw.outs ? ", plus a " + draw.name.toLowerCase() + " (" + draw.outs + " outs)" : "") + ".");
      lines.push("Against the hands they're likely to hold, you win about " + pctStr(eq) + " of the time.");
      if (toCall > 0) {
        var ev = eq * (pot + toCall) - toCall;
        lines.push("Calling costs " + toCall + " to win " + pot + ", so you need to win " + pctStr(need) + " of the time to break even.");
        var implied = draw.outs >= 8 && board.length === 3 && eff > toCall * 6 ? 0.06 : 0;
        want = Math.max(0, need + 0.02 - implied);
        if (implied) lines.push("With a draw this good and deep stacks, you'll usually win more on later streets when you hit (implied odds), so " + pctStr(want) + " is enough.");
        if (eq >= 0.7 && la.raise) {
          act = "raise"; raiseTo = raiseSize(0.75);
          lines.push("Raise. You're a big favourite — make them pay now, while they might still call.");
        } else if (eq >= want && la.call) {
          act = "call";
          lines.push("Call. " + pctStr(eq) + " beats the " + pctStr(want) + " you need" +
            (ev >= 0 ? ", which is worth about +" + Math.round(ev) + " chips every time you make this call." : "."));
        } else {
          act = la.check ? "check" : "fold";
          lines.push("Fold. " + pctStr(eq) + " isn't enough when you need " + pctStr(want) + " — calling here loses about " + Math.abs(Math.round(ev)) + " chips each time.");
        }
      } else {
        if (eq >= 0.62 && la.raise) {
          act = "raise"; raiseTo = raiseSize(0.66);
          lines.push("Bet about two-thirds of the pot. You're usually ahead, and weaker hands will pay you off.");
        } else if (draw.outs >= 8 && la.raise && opps.length <= 2) {
          act = "raise"; raiseTo = raiseSize(0.6);
          lines.push("Bet (semi-bluff). They might fold right now — and when they call, you still have " + draw.outs + " cards that make you the best hand.");
        } else if (eq < 0.3 && inPos && opps.length === 1 && la.raise && board.length < 5) {
          act = "raise"; raiseTo = raiseSize(0.5);
          lines.push("Small bluff. They checked to you, and against one player a half-pot bet only has to work one time in three.");
        } else {
          act = "check";
          lines.push(eq >= 0.45 ? "Check. Good enough to win at showdown, but a bet mostly gets called by better hands."
                                : "Check. Nothing worth betting — take the free card.");
        }
      }
      lines.splice(1, 0, posLine);
    }
    // opening an unopened pot isn't a question of price — nobody has bet, the big blind is
    // just a blind — so there's no "need" to show; what decides it is the hand and the seat
    var opening = pre && preflopRaises(g) === 0;
    return {
      opening: opening, top: pre ? chenTop(chenScore(hero.hole)) : null,
      action: act, raiseTo: raiseTo, eq: eq, need: opening || toCall <= 0 ? 0 : want, price: need, toCall: toCall, pot: pot,
      hand: handName, draw: draw.name, outs: draw.outs, inPos: inPos, after: after, lines: lines,
      label: act === "raise" ? ((g.currentBet > 0 ? "Raise to " : "Bet ") + raiseTo) : act === "call" ? "Call " + toCall : act === "check" ? "Check" : "Fold"
    };
  }
  // Grading a decision after the fact: same idea as the coach, or not, and roughly what
  // the difference is worth — so a session report can point at the leak that costs most.
  function coachGrade(advice, action) {
    if (!advice || !action) return null;
    var t = action.type === "raise" ? "raise" : action.type;
    if (t === advice.action) return { ok: true, text: "Same as the coach." };
    var ev = advice.eq * (advice.pot + advice.toCall) - advice.toCall;
    if ((t === "call" || t === "check") && advice.action === "raise")
      return { ok: false, leak: "playing strong hands too passively", cost: 0,
        text: advice.opening ? "The coach would have raised — coming in with a raise wins the blinds more often than just calling."
                             : "The coach would have bet or raised — at " + pctStr(advice.eq) + " you want more money in the pot." };
    if (t === "call" && advice.action !== "call" && advice.toCall > 0)
      return { ok: false, leak: "calling without the odds", cost: Math.max(0, -ev),
        text: "You called needing " + pctStr(advice.need) + " with about " + pctStr(advice.eq) + "." };
    if (t === "fold" && advice.action === "call")
      return { ok: false, leak: "folding with the right price", cost: Math.max(0, ev),
        text: "You folded a hand that was winning often enough to call (" + pctStr(advice.eq) + " vs " + pctStr(advice.need) + " needed)." };
    if (t === "fold" && advice.action === "raise")
      return { ok: false, leak: "folding a strong hand", cost: Math.max(0, ev),
        text: "You folded when you were the favourite (" + pctStr(advice.eq) + ")." };
    if ((t === "call" || t === "check") && advice.action === "raise")
      return { ok: false, leak: "playing strong hands too passively", cost: 0,
        text: "The coach would have bet or raised — at " + pctStr(advice.eq) + " you want more money in the pot." };
    if (t === "raise" && (advice.action === "fold" || advice.action === "check"))
      return { ok: false, leak: "betting with too little", cost: 0,
        text: "The coach wouldn't put more in here with about " + pctStr(advice.eq) + "." };
    if (t === "fold" && advice.action === "check")
      return { ok: false, leak: "folding when you could check", cost: 0, text: "Checking was free — never fold when you can check." };
    return { ok: false, leak: "other", cost: 0, text: "The coach would have played it differently." };
  }

  return {
    RANKS: RANKS, SUITS: SUITS, CAT_NAME: CAT_NAME,
    rankVal: rankVal, makeDeck: makeDeck, shuffle: shuffle,
    evaluate5: evaluate5, evaluate7: evaluate7, compareScore: compareScore,
    describeScore: describeScore, bestHand: bestHand, buildSidePots: buildSidePots,
    startHand: startHand, legalActions: legalActions, applyAction: applyAction,
    potTotal: potTotal, activePlayers: activePlayers, bettingClosed: bettingClosed,
    botDecision: botDecision, handStrength: handStrength,
    chenScore: chenScore, seatsAfterMe: seatsAfterMe, texture: texture, mergeObservations: mergeObservations,
    preflopRaises: preflopRaises, ipVsRaiser: ipVsRaiser, settleRunout: settleRunout,
    BOT_LEVELS: BOT_LEVELS, BOT_STYLES: BOT_STYLES,
    fastScore: fastScore, cardIdx: cardIdx, equity: equity,
    coachAdvice: coachAdvice, coachGrade: coachGrade, chenTop: chenTop
  };
});
