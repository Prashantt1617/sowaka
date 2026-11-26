/* The Word Trip Tournament's own screens around the matches (the approved mock, 26 Nov 2026: Join, In the lobby, Your
 * match, Waiting for your opponent, Who will win?, the result). Kept apart from cup/page.html so the lobby can be swapped
 * whole: the page hands in its helpers (H) and draws whatever string a screen returns; every button is a data-act the page
 * already handles (lobby, join, tab, pick, lock) or wtstake. Word Trip's colours and type; plain short words.
 *
 *   var V = CupWtScreens(H);   V.join()  V.lobby()  V.match(m)  V.waiting(m)  V.bet(m)  V.result(m)
 *
 * Faces are each person's small thumbnail (state photoUrl), keyed per person so a poll never rebuilds the <img>;
 * initials when there is no photo. */
(function () {
  'use strict';
  if (window.CupWtScreens) return;
  var CSS = '.wt{display:flex;flex-direction:column;gap:20px;color:#F6F1FF;font-family:Figtree,system-ui,sans-serif;padding:4px 2px 8px}' +
    '.wt h1{margin:0;font:800 38px/1.05 "Baloo 2",system-ui}.wt h1.xl{font-size:44px;line-height:1}' +
    '.wt-k{font-size:13px;font-weight:800;letter-spacing:.14em;color:#A9A3CC;text-transform:uppercase}' +
    '.wt-row{display:flex;align-items:center;justify-content:space-between;gap:10px}' +
    '.wt-a{font-size:14px;font-weight:700;color:#FFD23F;background:none;border:0;padding:0;cursor:pointer}' +
    '.wt-mu{margin:0;font-size:17px;color:#A9A3CC}.wt-s{font-size:14px;color:#A9A3CC;text-align:center}' +
    '.wt-tiles{display:flex;gap:8px;justify-content:center;padding:6px 0}.wt-tiles span{width:52px;height:58px;border-radius:12px;background:#FFF6DE;box-shadow:inset 0 -4px 0 #D2BC7E;color:#2A2140;font:800 30px/58px "Baloo 2",system-ui;text-align:center}.wt-tiles span.g{background:#FFD23F;box-shadow:inset 0 -4px 0 #C99E12}' +
    '.wt-tiles.sm span{width:38px;height:42px;border-radius:9px;font-size:22px;line-height:42px}' +
    '.wt-card{background:#211D42;border:1px solid #3B3668;border-radius:20px;padding:20px;display:flex;flex-direction:column;align-items:center;gap:8px}' +
    '.wt-box{background:#211D42;border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}.wt-box b{font-size:15px}.wt-box span{font-size:14px;color:#A9A3CC}' +
    '.wt-big{font:800 56px/1 "Baloo 2",system-ui;color:#FFD23F;font-variant-numeric:tabular-nums}.wt-big.wt-l{font-size:64px}.wt-big.wt-xl{font-size:72px}' +
    '.wt-btn{display:flex;align-items:center;justify-content:center;width:100%;height:60px;border-radius:18px;border:0;background:#FFD23F;color:#15122B;font:800 24px/1 "Baloo 2",system-ui;cursor:pointer}.wt-btn:disabled{background:#3B3668;color:#A9A3CC}' +
    '.wt-in{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 14px;border-radius:999px;background:rgba(75,227,154,.14);color:#4BE39A;font-size:15px;font-weight:800}' +
    '.wt-f{position:relative;flex:none;display:inline-grid;place-items:center;border-radius:50%;overflow:hidden;color:#15122B;font-weight:800}.wt-f img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
    '.wt-faces{display:flex;align-items:center;gap:12px}.wt-faces .fs{display:flex}.wt-faces .wt-f{width:36px;height:36px;margin-right:-10px;border:2px solid #15122B;font-size:13px}.wt-faces b{margin-left:10px;font-size:16px}' +
    '.wt-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px 6px}.wt-grid div{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}.wt-grid .wt-f{width:48px;height:48px;font-size:15px}.wt-grid span{font-size:12px;color:#A9A3CC;max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.wt-vs{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#211D42;border:1px solid #3B3668;border-radius:22px;padding:22px 16px}.wt-vs>i{font:800 26px/1 "Baloo 2",system-ui;font-style:normal;color:#A9A3CC}' +
    '.wt-pl{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:8px}.wt-pl .wt-f{width:76px;height:76px;font-size:26px}.wt-pl .wt-f.me{box-shadow:0 0 0 4px rgba(255,210,63,.25)}.wt-pl .wt-f.away{background:#2B2650!important;border:2px dashed #5A5490;color:#A9A3CC}.wt-pl .wt-f.away img{filter:grayscale(1) brightness(.55)}' +
    '.wt-pl b{font-size:17px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wt-pl b.dim{color:#A9A3CC}.wt-st{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#4BE39A}.wt-st i{width:8px;height:8px;border-radius:50%;background:#4BE39A}.wt-st.no{color:#A9A3CC}.wt-st.no i{display:none}' +
    '.wt-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.wt-facts div{background:#211D42;border-radius:16px;padding:14px 8px;display:flex;flex-direction:column;align-items:center;gap:4px}.wt-facts b{font:800 26px/1 "Baloo 2",system-ui}.wt-facts span{font-size:13px;color:#A9A3CC;text-align:center}' +
    '.wt-ring{position:relative;width:168px;height:168px;border-radius:50%;display:grid;place-items:center;margin:0 auto}.wt-ring>div{width:140px;height:140px;border-radius:50%;background:#15122B;display:flex;flex-direction:column;align-items:center;justify-content:center}.wt-ring span{font-size:13px;color:#A9A3CC}.wt-ring .wt-big{font-size:56px;color:#FFD23F}' +
    '.wt-pick{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.wt-pick button{font:inherit;color:inherit;cursor:pointer;background:#211D42;border:3px solid #3B3668;border-radius:20px;padding:18px 10px;display:flex;flex-direction:column;align-items:center;gap:8px;min-width:0}.wt-pick button.on{border-color:#FFD23F}.wt-pick button:disabled{cursor:default}.wt-pick .wt-f{width:64px;height:64px;font-size:22px}.wt-pick b{font-size:17px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wt-pick span{font-size:13px;color:#A9A3CC}' +
    '.wt-stk{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.wt-stk button{font:inherit;cursor:pointer;height:48px;border-radius:14px;border:2px solid #3B3668;background:#211D42;color:#F6F1FF;font-size:16px;font-weight:800}.wt-stk button.on{border-color:#FFD23F;background:#FFD23F;color:#15122B}.wt-stk button:disabled{color:#5A5490}' +
    '.wt-pts{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:999px;background:#211D42;font-size:15px;font-weight:800;color:#FFD23F}' +
    '.wt-res{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.wt-res div{background:#211D42;border:3px solid #3B3668;border-radius:20px;padding:18px 10px;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0}.wt-res div.w{border-color:#4BE39A}.wt-res .wt-f{width:44px;height:44px;font-size:15px}.wt-res b{font:800 48px/1 "Baloo 2",system-ui}.wt-res strong{font-size:15px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wt-res span{font-size:13px;color:#A9A3CC}' +
    '.wt-why{margin:0;padding:12px 14px;border-radius:14px;background:rgba(255,107,87,.14);color:#FF8A7A;font-weight:700;text-align:center}';

  window.CupWtScreens = function (H) {
    if (!document.getElementById('cupwts-css')) { var s = document.createElement('style'); s.id = 'cupwts-css'; s.textContent = CSS; (document.head || document.documentElement).appendChild(s); }
    var esc = H.esc, num = H.num, first = H.first;
    var COLS = ['#FFD23F', '#4C9BFF', '#FF6FB5', '#4BE39A', '#B6F36A'];
    function col(id) { var h = 0; id = String(id || ''); for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return COLS[Math.abs(h) % COLS.length]; }
    /* One face: the small thumbnail over the initials. Keyed (data-k) so the page's patching keeps the same <img>. */
    function face(p, cls, key) {
      if (!p) return '<span class="wt-f ' + (cls || '') + '" style="background:#2B2650;color:#A9A3CC">?</span>';
      var u = H.photoOf(p);
      return '<span class="wt-f ' + (cls || '') + '" data-k="' + esc((key || 'f') + p.userId) + '" style="background:' + col(p.userId) + '">' + esc(H.initials(p.name)) +
        (u ? '<img src="' + esc(u) + '" alt="" decoding="async" referrerpolicy="no-referrer" draggable="false">' : '') + '</span>';
    }
    function tiles(word, gold, sm) { return '<div class="wt-tiles' + (sm ? ' sm' : '') + '" aria-label="' + esc(word) + '">' + String(word).toUpperCase().split('').map(function (c, i) { return '<span' + (gold && i === word.length - 1 ? ' class="g"' : '') + '>' + esc(c) + '</span>'; }).join('') + '</div>'; }
    function e() { return H.ev(); }
    function lettersOf(round) { var t = (e().rounds || []).length; return round === t || round === t - 1 ? 7 : round === 1 ? 5 : 6; }
    function stopsOf(round) { return round === (e().rounds || []).length ? 5 : 3; }
    function roundKick(m) { var t = (e().rounds || []).length, r = H.roundOf(m.round); return r && r.kind === 'sequential' ? String(r.label).toUpperCase() : 'ROUND ' + m.round + ' OF ' + t; }
    function how() { return '<button type="button" class="wt-a" data-act="tab" data-v="how">How to play</button>'; }
    function wallet() { var w = e().wallet; return w ? num(w) : ''; }
    function people() { return (e().lobbyPeople || []); }

    function join() {
      var ev = e(), me = H.me(), n = ev.entrantCount || 0, open = !!ev.lobbyOpen, err = H.ui.err;
      var faces = people().slice(0, 5);
      return '<section class="wt" aria-label="Join the tournament">' +
        '<div class="wt-row"><span class="wt-k">' + esc(H.dayLabel(ev.startAt)) + '</span>' + how() + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px"><h1 class="xl">Word Trip<br>Tournament</h1><p class="wt-mu">Make words. Beat your opponent.</p></div>' +
        tiles('words', true) +
        '<div class="wt-card"><span style="font-size:14px;font-weight:600;color:#A9A3CC">' + (open ? 'Matches start in' : 'The lobby opens in') + '</span><span class="wt-big">' + H.cd(H.ms(open ? ev.startAt : ev.lobbyAt)) + '</span></div>' +
        (open && n ? '<div class="wt-faces"><span class="fs">' + faces.map(function (p) { return face(p, '', 'j'); }).join('') + '</span><b>' + num(n) + (n === 1 ? ' person is in' : ' people are in') + '</b></div>' : '') +
        '<div style="flex-grow:1"></div>' +
        (me.entered
          ? '<div style="display:flex;flex-direction:column;gap:10px">' + (err ? '<p class="wt-why" role="alert">' + esc(err) + '</p>' : '') +
            '<button type="button" class="wt-btn" data-act="lobby"' + (!open || H.ui.busy === 'lobby' ? ' disabled' : '') + '>' + (!open ? 'Opens at ' + esc(H.clock(ev.lobbyAt)) : H.ui.busy === 'lobby' ? 'Joining…' : 'Join') + '</button>' +
            '<span class="wt-s">Free to play.' + (wallet() ? ' You get ' + wallet() + ' points to bet.' : '') + '</span></div>'
          : '<p class="wt-s">You’re not in this tournament, but you can watch every match.</p>') +
        '</section>';
    }

    function lobby() {
      var ev = e(), n = ev.entrantCount || 0, ppl = people(), shown = ppl.slice(0, 15);
      return '<section class="wt" aria-label="In the lobby">' +
        '<div class="wt-row"><span style="font:800 22px/1.1 \'Baloo 2\',system-ui">Word Trip Tournament</span>' + how() + '</div>' +
        '<div class="wt-card" style="padding:22px 20px;gap:10px"><span class="wt-in"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>You’re in</span>' +
        '<span style="font-size:15px;color:#A9A3CC">Your match starts in</span><span class="wt-big wt-l">' + H.cd(H.ms(ev.startAt)) + '</span><span style="font-size:15px">Stay on this screen.</span></div>' +
        '<div style="display:flex;flex-direction:column;gap:10px"><div class="wt-row" style="align-items:baseline"><span style="font-size:17px;font-weight:800">Who’s playing</span><span style="font-size:15px;font-weight:700;color:#FFD23F">' + num(n) + ' in</span></div>' +
        '<div class="wt-grid">' + shown.map(function (p) { return '<div data-k="g' + esc(p.userId) + '">' + face(p, '', 'l') + '<span>' + esc(p.userId === H.meId() ? 'You' : first(p.name)) + '</span></div>'; }).join('') + '</div>' +
        (n > shown.length ? '<span class="wt-s">+' + num(n - shown.length) + ' more</span>' : '') + '</div>' +
        '<div style="flex-grow:1"></div>' +
        '<div class="wt-box"><b>How it works</b><span>1. We pick your opponent.</span><span>2. Same letters for both. 1 minute each.</span><span>3. More points wins. Winner goes on.</span></div>' +
        '</section>';
    }

    function vs(m, oppHere, meHere) {
      var me = H.me(), opp = m.opponent;
      var mp = { userId: me.userId, name: me.name, photoUrl: me.photoUrl };
      return '<div class="wt-vs"><div class="wt-pl">' + face(mp, 'me', 'v') + '<b>You</b>' + (meHere ? '<span class="wt-st"><i></i>Ready</span>' : '<span class="wt-st no">Joining…</span>') + '</div><i>vs</i>' +
        '<div class="wt-pl">' + face(opp, oppHere ? '' : 'away', 'v') + '<b' + (oppHere ? '' : ' class="dim"') + '>' + esc(opp ? first(opp.name) : 'To be decided') + '</b>' + (oppHere ? '<span class="wt-st"><i></i>Ready</span>' : '<span class="wt-st no">Not here yet</span>') + '</div></div>';
    }
    function facts(m) {
      var st = stopsOf(m.round), sec = (e().roundSec || 60);
      return '<div class="wt-facts"><div><b>' + st + '</b><span>sets of letters</span></div><div><b>' + (sec % 60 ? sec + ' s' : sec / 60 + ' min') + '</b><span>for each set</span></div><div><b>Top</b><span>points wins</span></div></div>';
    }
    /* Your match: drawn, opening, starting, or on (the match itself is the overlay). */
    function match(m) {
      var opp = m.opponent, on = opp ? first(opp.name) : 'your opponent';
      var start = H.ms(m.startAt), live = m.status === 'live' || m.status === 'solo', counting = live && start > H.now();
      var head, tail = '', err = H.ui.err;
      if (m.status === 'scheduled' || m.status === 'betting') {
        var at = H.ms(m.bettingEndsAt);
        head = '<div style="display:flex;flex-direction:column;align-items:center;gap:4px"><span style="font-size:15px;color:#A9A3CC">' + (isFinite(at) ? 'Your match opens in' : 'Your match is next') + '</span>' + (isFinite(at) ? '<span class="wt-big wt-xl">' + H.cd(at) + '</span>' : '') + '</div>';
        tail = '<span class="wt-s" style="font-size:15px">' + (isFinite(at) ? 'Everyone is betting on this one. Stay on this screen.' : 'Stay on this screen. It starts here.') + '</span>';
      } else if (m.status === 'open') {
        head = '<div style="display:flex;flex-direction:column;align-items:center;gap:10px">' + (err ? '<p class="wt-why" role="alert">' + esc(err) + '</p>' : '') +
          '<button type="button" class="wt-btn" data-act="join"' + (H.ui.busy === 'join' ? ' disabled' : '') + '>' + (H.ui.busy === 'join' ? 'Joining…' : 'I’m ready') + '</button>' +
          '<span class="wt-s">Join within <b data-cd="' + H.ms(m.deadlineAt) + '">' + H.left(H.ms(m.deadlineAt)) + '</b>.</span></div>';
      } else if (counting) {
        head = '<div style="display:flex;flex-direction:column;align-items:center;gap:4px"><span style="font-size:15px;color:#A9A3CC">Starts in</span><span class="wt-big wt-xl">' + H.cd(start) + '</span></div>';
      } else if (live) {
        head = '<div style="display:flex;flex-direction:column;align-items:center;gap:10px"><span style="font-size:17px;font-weight:800">Your match is on.</span><button type="button" class="wt-btn" data-act="reopen">Back to my match</button></div>';
      } else head = '<div style="display:flex;flex-direction:column;align-items:center;gap:4px"><span style="font-size:15px;color:#A9A3CC">Starts in</span><span class="wt-big wt-xl">' + H.cd(H.ms(e().startAt)) + '</span></div>';
      var solo = m.status === 'solo';
      return '<section class="wt" aria-label="Your match"><div class="wt-row"><span class="wt-k">' + roundKick(m) + '</span><span class="wt-k">' + lettersOf(m.round) + ' LETTERS</span></div>' +
        '<h1>' + (m.attempt ? 'Tie! Replay' : 'Your match') + '</h1>' + vs(m, !solo && (live || m.opponentJoined), live || !!m.joined) +
        (solo ? '<div class="wt-box" style="text-align:center"><b>' + esc(on) + ' didn’t come</b><span>You play alone and go to the next round.</span></div>' : '') +
        (m.attempt ? '<div class="wt-box" style="text-align:center"><b>It was a tie</b><span>New letters, same rules.</span></div>' : '') +
        head + facts(m) + '<div style="flex-grow:1"></div>' + (tail || '<span class="wt-s" style="font-size:15px">Same letters for both of you.</span>') + '</section>';
    }

    function waiting(m) {
      var opp = m.opponent, on = opp ? first(opp.name) : 'your opponent', dl = H.ms(m.deadlineAt);
      var total = (e().startWindowSec || 40) * 1000, leftMs = Math.max(0, dl - H.now()), secs = Math.ceil(leftMs / 1000), deg = Math.round(Math.min(1, leftMs / total) * 360);
      return '<section class="wt" aria-label="Waiting for your opponent"><span class="wt-k">' + roundKick(m) + '</span>' +
        '<h1>Waiting for ' + esc(on) + '</h1>' + vs(m, false, true) +
        '<div class="wt-ring" data-ring="' + dl + '" data-total="' + total + '" style="background:conic-gradient(#FFD23F 0 ' + deg + 'deg,#2B2650 ' + deg + 'deg 360deg)"><div><span class="wt-big" data-cs="' + dl + '">' + secs + '</span><span>seconds</span></div></div>' +
        '<div class="wt-box" style="text-align:center"><b style="font-size:16px">If ' + esc(on) + ' doesn’t come</b><span style="font-size:15px">You play alone and go to the next round.</span></div>' +
        '<div style="flex-grow:1"></div><span class="wt-s" style="font-size:15px">Don’t leave this screen.</span></section>';
    }

    function bet(m) {
      var me = H.me(), os = H.onStage(m.id), mine = H.myBet(m.id), bal = me.balance || 0;
      var closes = H.ms(m.bettingEndsAt || (os && os.closesAt)), open = isFinite(closes) ? closes > H.now() : true;
      var player = H.isMine(m);
      if (H.ui.pickFor !== m.id) { H.ui.pickFor = m.id; H.ui.pick = null; H.ui.betErr = ''; H.ui.stake = 0; }
      var a = os ? os.a : { count: 0 }, b = os ? os.b : { count: 0 }, cnt = (a.count || 0) + (b.count || 0);
      var share = function (x) { return cnt ? Math.round(((x.count || 0) / cnt) * 100) + '%' : '0%'; };
      var pick = mine ? mine.pick : H.ui.pick, dis = !!(mine || player || !open);
      var card = function (p, x) {
        return '<button type="button" class="' + (pick === p.userId ? 'on' : '') + '" data-act="pick" data-v="' + esc(p.userId) + '" aria-pressed="' + (pick === p.userId) + '"' + (dis ? ' disabled' : '') + '>' + face(p, '', 'b') + '<b>' + esc(p.userId === me.userId ? 'You' : first(p.name)) + '</b><span>' + share(x) + ' picked</span></button>';
      };
      var stakes = [100, 250, 500, 'all'];
      var stake = Math.min(H.ui.stake || 0, bal), pickP = pick ? (m.a.userId === pick ? m.a : m.b) : null;
      var foot;
      if (mine) {
        var mp = m.a.userId === mine.pick ? m.a : m.b;
        foot = '<div class="wt-box" style="text-align:center"><b>Your bet: ' + num(mine.stake) + ' on ' + esc(first(mp.name)) + '</b><span>If ' + esc(first(mp.name)) + ' wins, you get ' + num(mine.stake * 2) + ' back.</span></div>';
      } else if (player || !open || !bal) {
        foot = '<p class="wt-why">' + (player ? 'This is your match, so you can’t bet on it.' : !open ? 'Bets on this match are closed.' : 'You have no points left to bet.') + '</p>';
      } else {
        foot = '<div style="display:flex;flex-direction:column;gap:10px"><span style="font-size:16px;font-weight:800">Your bet</span><div class="wt-stk">' +
          stakes.map(function (v) { var val = v === 'all' ? bal : Math.min(v, bal), on = stake > 0 && stake === val && (v === 'all' ? stake === bal : true); return '<button type="button" class="' + (on ? 'on' : '') + '" data-act="wtstake" data-v="' + v + '"' + (v !== 'all' && v > bal ? ' disabled' : '') + '>' + (v === 'all' ? 'All' : num(v)) + '</button>'; }).join('') + '</div></div>' +
          '<div style="flex-grow:1"></div><div style="display:flex;flex-direction:column;gap:10px">' + (H.ui.betErr ? '<p class="wt-why" role="alert">' + esc(H.ui.betErr) + '</p>' : '') +
          '<button type="button" class="wt-btn" data-act="lock"' + (!pickP || !stake || H.ui.betBusy ? ' disabled' : '') + '>' + (H.ui.betBusy ? 'Betting…' : !pickP ? 'Pick who will win' : !stake ? 'Pick your bet' : 'Bet ' + num(stake) + ' on ' + esc(first(pickP.name))) + '</button>' +
          '<span class="wt-s">' + (pickP && stake ? 'If ' + esc(first(pickP.name)) + ' wins, you get ' + num(stake * 2) + ' back.' : 'A right pick gets you double your bet back.') + '</span></div>';
      }
      return '<section class="wt" aria-label="Bet on a match"><div class="wt-row"><span class="wt-k">' + esc(String(m.label)) + '</span><span class="wt-pts">' + num(bal) + ' pts</span></div>' +
        '<h1>Who will win?</h1><span style="font-size:15px;color:#A9A3CC">' + (open ? 'Bets close in <b style="color:#FFD23F">' + H.cd(closes) + '</b>' : 'Bets are closed.') + '</span>' +
        '<div class="wt-pick">' + card(m.a, a) + card(m.b, b) + '</div>' + foot + '</section>';
    }

    /* After my match: won (on to the next round) or out (watch and bet). `words` from the match, `best` my longest word. */
    function result(m, opts) {
      opts = opts || {};
      var u = H.meId(), opp = m.a && m.a.userId === u ? m.b : m.a, won = m.winnerId === u;
      var r = m.result || {}, mine = Number(r[u]) || 0, theirs = Number(opp && r[opp.userId]) || 0;
      var ww = m.wtWords || {}, best = opts.best || '';
      var rounds = (e().rounds || []).length, nextR = H.roundOf(m.round + 1);
      var sub = won
        ? (m.decidedBy === 'solo' ? esc(first(opp && opp.name)) + ' didn’t come. ' : m.decidedBy === 'absent' ? 'Neither of you came, so you went through by the draw. ' : m.decidedBy === 'replays' ? 'Still level after the replays: you went through by the draw. ' : '') + (m.round >= rounds ? 'You’re the champion!' : 'On to ' + (nextR ? nextR.label.toLowerCase().replace(/^round /, 'round ') : 'the next round') + '.')
        : (m.decidedBy === 'absent' ? 'Neither of you came. ' : m.decidedBy === 'replays' ? 'Still level after the replays. ' : '') + 'Good game. ' + esc(first(opp && opp.name)) + ' goes on.';
      var nextAt = won && m.round < rounds ? opts.nextAt : NaN;
      return '<section class="wt" aria-label="Match result"><span class="wt-k">' + roundKick(m) + '</span>' +
        '<div style="display:flex;flex-direction:column;gap:6px"><h1 class="xl" style="font-size:48px;color:' + (won ? '#4BE39A' : '#F6F1FF') + '">' + (won ? 'You won!' : 'You’re out') + '</h1><span style="font-size:17px;color:#A9A3CC">' + sub + '</span></div>' +
        '<div class="wt-res"><div class="' + (won ? 'w' : '') + '">' + face({ userId: u, name: H.me().name, photoUrl: H.me().photoUrl }, '', 'r') + '<strong>You</strong><b>' + num(mine) + '</b><span>' + num(ww[u] || 0) + ' words</span></div>' +
        '<div class="' + (won ? '' : 'w') + '">' + face(opp, '', 'r') + '<strong>' + esc(opp ? first(opp.name) : '') + '</strong><b>' + num(theirs) + '</b><span>' + num(opp ? ww[opp.userId] || 0 : 0) + ' words</span></div></div>' +
        (best ? '<div class="wt-box"><b>Your best word</b>' + tiles(best, false, true).replace('wt-tiles sm', 'wt-tiles sm" style="justify-content:flex-start') + '</div>' : '') +
        (won && m.round < rounds ? '<div style="display:flex;flex-direction:column;align-items:center;gap:4px"><span style="font-size:15px;color:#A9A3CC">' + (isFinite(nextAt) ? 'Next round in' : 'Next round starts when the last match ends') + '</span>' + (isFinite(nextAt) ? '<span class="wt-big">' + H.cd(nextAt) + '</span>' : '') + '</div>' : '') +
        '<div style="flex-grow:1"></div>' +
        (won ? (m.round < rounds ? '<span class="wt-s" style="font-size:15px">Stay here. We’ll start your next match.</span>' : '')
          : '<div style="display:flex;flex-direction:column;gap:10px"><button type="button" class="wt-btn" data-act="tab" data-v="watch">Watch and bet</button>' + (H.me().balance ? '<span class="wt-s">You still have ' + num(H.me().balance) + ' points to bet.</span>' : '') + '</div>') +
        '</section>';
    }

    return { join: join, lobby: lobby, match: match, waiting: waiting, bet: bet, result: result, face: face, tiles: tiles };
  };
})();
