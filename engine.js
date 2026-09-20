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

    advanceAction(state);
    return { ok: true };
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
  function botDecision(g, botId, rng) {
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
    var r = rnd();

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

  return {
    RANKS: RANKS, SUITS: SUITS, CAT_NAME: CAT_NAME,
    rankVal: rankVal, makeDeck: makeDeck, shuffle: shuffle,
    evaluate5: evaluate5, evaluate7: evaluate7, compareScore: compareScore,
    describeScore: describeScore, bestHand: bestHand, buildSidePots: buildSidePots,
    startHand: startHand, legalActions: legalActions, applyAction: applyAction,
    potTotal: potTotal, activePlayers: activePlayers, bettingClosed: bettingClosed,
    botDecision: botDecision, handStrength: handStrength
  };
});
