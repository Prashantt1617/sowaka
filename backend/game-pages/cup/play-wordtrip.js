/* One Word Trip Tournament match, inside the tournament page (cup/page.html): the normal Word Trip game itself
 * (game-pages/word-trip.html, as the Games tab plays it, fetched from the server once and kept on the phone), run in a
 * frame with the match's seed, so both players get the same stops in the same order and play by the game's own rules:
 * one clock from 1:00, seconds for long words, combos, every letter moves on to the next stop, Skip for 100. Nothing of
 * the game is copied here: a small bridge in the frame starts the run at the match's time and passes on each word the
 * game takes (and each skip) with its time on the run's clock; the server plays them again and decides on its score.
 * Above the game, a strip with the opponent: face, name, score, playing or finished.
 *
 *   const h = CupWordTrip.start({
 *     mount, startAt, serverNow, clockOffset, seed, attempt, me: { name, photoUrl }, opponent: { name, photoUrl } | null, solo,
 *     played,                                     // this player already has words in this run (the page was reopened mid-run)
 *     getGame() -> Promise<html>,                 // the normal game's page
 *     onWord(stop, word, t) -> Promise,  onSkip(stop, t) -> Promise,
 *     getOpponent() -> { score, words, endsAt } | null,   getMine() -> { score, words, endsAt } | null,
 *     online() -> boolean,
 *   });
 *   h.stop()   h.state()
 *
 * The game is never dimmed or covered without big plain words saying why: Loading the game…, Starts in 3, Time's up
 * (with the opponent still playing and their score so far), Reconnecting… */
(function () {
  'use strict';
  if (window.CupWordTrip) return;
  var BLOCKED = ['anal', 'anus', 'arse', 'arses', 'ass', 'asses', 'balls', 'bastard', 'bitch', 'bitches', 'boner', 'boob', 'boobs', 'bugger', 'bum', 'bums', 'butt', 'clit', 'cock', 'cocks', 'coon', 'crap', 'cum', 'cunt', 'damn', 'dick', 'dicks',
    'dildo', 'dyke', 'fag', 'fags', 'fart', 'farts', 'fuck', 'gook', 'homo', 'honky', 'hooker', 'horny', 'hump', 'jizz', 'kike', 'kinky', 'milf', 'nazi', 'negro', 'nigger', 'nipple', 'nude', 'nudes', 'orgasm', 'orgy', 'paki',
    'pee', 'penis', 'perv', 'pimp', 'piss', 'poo', 'poop', 'porn', 'porno', 'prick', 'pube', 'pubes', 'pubic', 'queer', 'rape', 'raped', 'rapes', 'rapist', 'retard', 'scrotum', 'semen', 'sex', 'sexy', 'shag', 'shit', 'slut', 'smut',
    'spic', 'sperm', 'spunk', 'tit', 'tits', 'titty', 'turd', 'twat', 'vagina', 'wank', 'whore', 'wop'];
  /* The bridge, put into the game's page: it runs after the game's own script, so it can wrap the game's functions. */
  var BRIDGE = '<script>(function(){' +
    'function post(m){m.cupwt=1;try{parent.postMessage(m,"*");}catch(e){}}' +
    'var BL=new Set(' + JSON.stringify(BLOCKED) + ');' +
    'try{LISTS[WORDS]=WORDS.split(" ").filter(function(w){return !BL.has(w);});LISTS[RARE]=RARE.split(" ").filter(function(w){return !BL.has(w);});}catch(e){}' +
    'try{save.seenHowTo=true;}catch(e){}' +
    'var t0=null;' +
    'var B=begin;window.begin=function(){B();t0=now();post({type:"begin"});};' +
    'var W=submitWord;window.submitWord=function(){var g=gi,n=total,w=tray.map(function(t){return t.ch;}).join("");W();if(total>n&&t0!=null)post({type:"word",g:g,w:w,t:now()-t0});};' +
    'var K=skip;window.skip=function(){var g=gi,k=skips;K();if(skips>k&&t0!=null)post({type:"skip",g:g,t:now()-t0});};' +
    'var E=endRound;window.endRound=function(){E();post({type:"end",score:score});};' +
    'window.results=function(title,stars){if(mode!=="over")return;var st=starsEl(0),big=el("div","bigscore","0");openSheet(title,[st,big,sumLine()],[]);animateScore(st,big,score,stars,true);};' +
    'window.sheetOutside=function(){};window.sheetX=function(){};' +
    'var cs=document.createElement("style");cs.textContent="#sx{display:none!important}";document.head.appendChild(cs);' +
    'addEventListener("message",function(e){var d=e.data;if(!d||d.cupwt!==2)return;if(d.type==="start"){try{start(null,d.seed);}catch(x){post({type:"error",message:String(x)});}}});' +
    'post({type:"ready"});' +
    '})();<\/script>';
  var CSS = '.cwt{position:absolute;inset:0;background:#15122B;color:#F6F1FF;font-family:Figtree,system-ui,sans-serif;overflow:hidden}' +
    '.cwt *{box-sizing:border-box}' +
    '.cwt-strip{position:absolute;left:0;right:0;top:0;height:calc(52px + env(safe-area-inset-top));padding:env(safe-area-inset-top) 12px 0;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px;background:#211D42;border-bottom:1px solid #3B3668}' +
    '.cwt-strip .vs{font:800 14px/1 "Baloo 2",system-ui;color:#A9A3CC}' +
    '.cwt-side{display:flex;align-items:center;gap:8px;min-width:0}.cwt-side.r{flex-direction:row-reverse;text-align:right}' +
    '.cwt-side .tx{min-width:0;display:flex;flex-direction:column}' +
    '.cwt-side .nm{font-weight:800;font-size:13px;color:#A9A3CC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.cwt-side .sc{font:800 21px/1 "Baloo 2",system-ui;font-variant-numeric:tabular-nums}' +
    '.cwt-side .st{font-style:normal;font-weight:800;color:#4BE39A}.cwt-side .st.done{color:#A9A3CC}' +
    '.cwt-av{position:relative;flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:12px;color:#15122B;overflow:hidden}.cwt-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
    '.cwt-game{position:absolute;left:0;right:0;bottom:0;top:calc(52px + env(safe-area-inset-top));width:100%;height:calc(100% - 52px - env(safe-area-inset-top));border:0;display:block;background:#15122B}' +
    '.cwt-end{position:absolute;left:0;right:0;top:calc(52px + env(safe-area-inset-top));z-index:4;padding:10px 14px;background:#FFD23F;color:#15122B;font-weight:700;font-size:15px;text-align:center}.cwt-end b{font-weight:800}.cwt-end[hidden]{display:none}.cwt-end .cwt-dots i{background:#15122B}' +
    '.cwt-net{position:absolute;left:12px;right:12px;top:calc(58px + env(safe-area-inset-top));z-index:6;padding:9px 12px;border-radius:12px;background:#FF6B57;color:#15122B;font-weight:800;font-size:14px;text-align:center}.cwt-net[hidden]{display:none}' +
    '.cwt-cov{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;background:#15122B}.cwt-cov[hidden]{display:none}' +
    '.cwt-cov small{font-size:13px;font-weight:800;letter-spacing:.14em;color:#A9A3CC}.cwt-cov h2{margin:0;font:800 38px/1.08 "Baloo 2",system-ui;color:#F6F1FF}.cwt-cov p{margin:0;max-width:330px;font-size:17px;line-height:1.4;color:#A9A3CC}.cwt-cov p b{color:#F6F1FF}' +
    '.cwt-big{font:800 96px/1 "Baloo 2",system-ui;color:#FFD23F;font-variant-numeric:tabular-nums}' +
    '.cwt-vs{display:flex;align-items:center;gap:18px}.cwt-vs .cwt-av{width:64px;height:64px;font-size:22px}.cwt-vs i{font:800 22px/1 "Baloo 2",system-ui;color:#A9A3CC;font-style:normal}' +
    '.cwt-sc2{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:min(320px,100%)}.cwt-sc2 div{background:#211D42;border-radius:16px;padding:12px 8px}.cwt-sc2 b{display:block;font:800 36px/1 "Baloo 2",system-ui}.cwt-sc2 span{font-size:13px;color:#A9A3CC}' +
    '.cwt-dots{display:inline-flex;gap:4px;margin-left:6px}.cwt-dots i{width:6px;height:6px;border-radius:50%;background:#FFD23F;animation:cwt-b 1s infinite}.cwt-dots i:nth-child(2){animation-delay:.15s}.cwt-dots i:nth-child(3){animation-delay:.3s}@keyframes cwt-b{50%{opacity:.25}}';
  function css() {
    if (document.getElementById('cupwt-css')) return;
    var s = document.createElement('style'); s.id = 'cupwt-css'; s.textContent = CSS; (document.head || document.documentElement).appendChild(s);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function first(s) { return String(s || '').trim().split(/\s+/)[0] || 'Your opponent'; }
  function num(n) { return (Math.round(Number(n) || 0)).toLocaleString('en-IN'); }
  function initials(n) { var p = String(n || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
  function face(p, col) {
    var u = p && p.photoUrl && /^(https:|\/)/.test(p.photoUrl) ? p.photoUrl : '';
    return '<span class="cwt-av" style="background:' + col + '">' + esc(initials(p && p.name)) + (u ? '<img alt="" src="' + esc(u) + '" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '</span>';
  }
  /* Before the game's own script: no app bridge in the frame (an app that puts window.Sowaka into every frame would
     otherwise post tournament runs to Word Trip's leaderboard and open its challenges), and its ready event stopped. */
  var GUARD = '<script>(function(){try{Object.defineProperty(window,"Sowaka",{get:function(){return undefined;},set:function(){},configurable:false});}catch(e){try{window.Sowaka=undefined;}catch(x){}}' +
    'addEventListener("sowaka-ready",function(e){e.stopImmediatePropagation();},true);})();<\/script>';
  /* The game's page with the guard first and the bridge after its own script. */
  function withBridge(html) {
    var h = html.search(/<head[^>]*>/i);
    if (h >= 0) { var e = html.indexOf('>', h) + 1; html = html.slice(0, e) + GUARD + html.slice(e); } else html = GUARD + html;
    var i = html.lastIndexOf('</body>');
    return i < 0 ? html + BRIDGE : html.slice(0, i) + BRIDGE + html.slice(i);
  }

  function start(o) {
    css();
    var off = Number(o.clockOffset) || ((Number(o.serverNow) || Date.now()) - Date.now());
    var now = function () { return Date.now() + off; };
    var startAt = typeof o.startAt === 'number' ? o.startAt : Date.parse(o.startAt);
    var opp = o.solo ? null : o.opponent || null, oppName = first((o.opponent || {}).name);
    var alive = true, phase = 'load', frame = null, ready = false, started = false, ended = false, myScore = 0;
    var queue = [], sending = false, failSince = 0, rejected = 0, sent = 0;
    var root = document.createElement('div'); root.className = 'cwt';
    root.innerHTML = '<div class="cwt-strip" data-strip></div><div class="cwt-end" data-end hidden role="status"></div><div class="cwt-net" data-net hidden role="status">Reconnecting… your words are kept and sent when it’s back.</div><div class="cwt-cov" data-cov role="status"></div>';
    o.mount.appendChild(root);
    var $ = function (k) { return root.querySelector('[data-' + k + ']'); };
    var $cov = $('cov'), $strip = $('strip'), $net = $('net'), $end = $('end');
    function cover(h) { if ($cov.getAttribute('data-h') !== h) { $cov.setAttribute('data-h', h); $cov.innerHTML = h; } $cov.hidden = false; }
    function uncover() { $cov.hidden = true; }
    function oppNow() { try { return (o.getOpponent && o.getOpponent()) || null; } catch (e) { return null; } }
    /* Both players at the very top: faces, names, live scores (as the server has them), and who is still playing. */
    function strip() {
      var mine = (o.getMine && o.getMine()) || {}, mySc = Math.max(myScore, mine.score || 0);
      var h = '<div class="cwt-side">' + face(o.me, '#FFD23F') + '<span class="tx"><span class="nm">You</span><b class="sc">' + num(mySc) + '</b></span></div><span class="vs">vs</span>';
      if (!opp) h += '<div class="cwt-side r"><span class="tx"><span class="nm">' + esc(oppName) + '</span><span class="nm"><i class="st done">didn’t come</i></span></span></div>';
      else {
        var x = oppNow() || {}, done = x.endsAt && now() >= x.endsAt;
        h += '<div class="cwt-side r">' + face(opp, '#4C9BFF') + '<span class="tx"><span class="nm">' + esc(first(opp.name)) + ' · <i class="st' + (done ? ' done' : '') + '">' + (done ? 'finished' : ended ? 'still playing…' : 'playing') + '</i></span><b class="sc">' + num(x.score) + '</b></span></div>';
      }
      if ($strip.getAttribute('data-h') !== h) { $strip.setAttribute('data-h', h); $strip.innerHTML = h; }
    }

    /* ---------- words to the server, one at a time and in order (the server plays them back in that order) ---------- */
    function pump() {
      if (sending || !queue.length || !alive) return;
      var m = queue[0]; sending = true;
      var done = false, timer = setTimeout(function () { if (!done) { done = true; sending = false; if (!failSince) failSince = Date.now(); setTimeout(pump, 800); } }, 6000);
      Promise.resolve().then(function () { return m.type === 'skip' ? o.onSkip(m.g, m.t) : o.onWord(m.g, m.w, m.t); }).then(function (j) {
        if (done) return; done = true; clearTimeout(timer);
        queue.shift(); sending = false; failSince = 0; sent++;
        if (j && ((j.verdict && j.verdict.ok === false) || (j.skip && j.skip.ok === false))) rejected++;
        if (j && typeof j.score === 'number') myScore = j.score;
        pump();
      }).catch(function (e) {
        if (done) return; done = true; clearTimeout(timer); sending = false;
        /* The server said no for good (the match is over, not your match): dropped, not retried. */
        if (e && e.status >= 400 && e.status < 500) { queue.shift(); rejected++; pump(); return; }
        if (!failSince) failSince = Date.now();
        setTimeout(pump, 1000);
      });
    }
    function onMsg(e) {
      if (!frame || e.source !== frame.contentWindow) return;
      var d = e.data; if (!d || d.cupwt !== 1) return;
      if (d.type === 'ready') { ready = true; tick(); }
      else if (d.type === 'begin') { phase = 'play'; uncover(); }
      else if (d.type === 'word' && typeof d.w === 'string') { queue.push({ type: 'word', g: d.g, w: d.w, t: Math.round(d.t * 1000) / 1000 }); pump(); }
      else if (d.type === 'skip') { queue.push({ type: 'skip', g: d.g, t: Math.round(d.t * 1000) / 1000 }); pump(); }
      else if (d.type === 'end') { myScore = d.score; ended = true; phase = 'end'; tick(); }
      else if (d.type === 'error') { console.error('Word Trip in the tournament:', d.message); }
    }
    window.addEventListener('message', onMsg);

    function load() {
      Promise.resolve().then(function () { return o.getGame(); }).then(function (html) {
        if (!alive) return;
        frame = document.createElement('iframe');
        frame.className = 'cwt-game'; frame.title = 'Word Trip'; frame.setAttribute('allow', 'autoplay');
        frame.srcdoc = withBridge(html);
        root.insertBefore(frame, $net);
      }).catch(function () {
        if (!alive) return;
        cover('<h2>Can’t load the game</h2><p>Check your connection. Trying again…</p>');
        setTimeout(load, 2000);
      });
    }

    function tick() {
      if (!alive) return;
      strip();
      $net.hidden = !((failSince && Date.now() - failSince > 1000) || (o.online && o.online() === false));
      var t = now();
      if (o.played && !started) {
        /* Reopened mid-run: the run can't be picked up again; what the server has stands, the clock runs on. */
        var me = (o.getMine && o.getMine()) || {};
        cover('<small>YOUR RUN</small><h2>You left your match</h2><p>Your score stands: <b>' + num(me.score) + '</b>. The clock kept running, so the run can’t start again.</p><p>' + endLine().replace('Time’s up. ', '') + '</p>');
        return;
      }
      if (phase === 'end' || ended) {
        /* The game's own end sheet stays up; under the strip, in plain words, what happens now. */
        var line = endLine() + (queue.length ? ' Sending your last words…' : '');
        if ($end.getAttribute('data-h') !== line) { $end.setAttribute('data-h', line); $end.innerHTML = line; }
        $end.hidden = false;
        return;
      }
      if (!frame || !ready) { cover('<h2>Loading the game…</h2><p>' + (t < startAt ? 'Your match starts in <b>' + Math.max(0, Math.ceil((startAt - t) / 1000)) + '</b> seconds.' : 'One moment.') + '</p>'); return; }
      if (!started) {
        /* The game's own 3-2-1 takes 1.8 s: started then, its clock begins with the match's. */
        if (t >= startAt - 1900) {
          started = true;
          try { frame.contentWindow.postMessage({ cupwt: 2, type: 'start', seed: o.seed }, '*'); } catch (e) {}
          uncover(); phase = 'count';
          try { frame.focus(); } catch (e) {}
          return;
        }
        cover('<small>' + (o.attempt ? 'REPLAY · NEW LETTERS' : 'YOUR MATCH') + '</small><div class="cwt-vs">' + face(o.me, '#FFD23F') + '<i>vs</i>' + (opp ? face(opp, '#4C9BFF') : '<i>' + esc(oppName) + '</i>') + '</div>' +
          '<div class="cwt-big">' + Math.max(1, Math.ceil((startAt - t) / 1000)) + '</div>' +
          '<p>' + (opp ? 'Same letters for you and ' + esc(first(opp.name)) + '. More points wins.' : esc(oppName) + ' didn’t come. You play alone and go to the next round.') + '</p>');
      }
    }
    /* Under "Time's up": the other player still playing (and their score so far), or the result on its way. */
    function endLine() {
      if (!opp) return 'Time’s up. You go to the next round. Waiting for the others to finish…';
      var x = oppNow() || {};
      if (x.endsAt && now() < x.endsAt) return 'Time’s up. <b>' + esc(first(opp.name)) + ' is still playing…</b> ' + num(x.score) + ' so far.';
      return 'Time’s up. Waiting for the result <span class="cwt-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
    }
    if (!o.played) load();
    var iv = setInterval(tick, 250);
    tick();
    return {
      stop: function () { alive = false; clearInterval(iv); window.removeEventListener('message', onMsg); root.remove(); },
      state: function () { return { phase: phase, started: started, ended: ended, queue: queue.length, sent: sent, rejected: rejected, score: myScore }; }
    };
  }
  /* The game's own sounds start on the first touch inside it; nothing to unlock out here. */
  window.CupWordTrip = { start: start, unlockAudio: function () { return true; } };
})();
