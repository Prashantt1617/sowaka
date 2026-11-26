/* One Word Trip Tournament match, played inside the tournament page (cup/page.html), with the contract of the other
 * match modules (start/stop). Word Trip's look (game-pages/word-trip.html, never changed): night purple, cream letter tiles,
 * Baloo 2 and Figtree. A match is 3 stops (the final 5): each stop is one set of letters for 60 s, the same for both
 * players, in the same order. Make words of 3 letters or more by swiping or tapping the letters; the server checks every
 * word (dictionary, letters, once per stop) and scores it, so the score here is always the server's.
 *
 *   const h = CupWordTrip.start({
 *     mount, startAt, serverNow, clockOffset, attempt,
 *     wt: () => ({ stops, len, stopSec, gapSec, letters: [..], counts: [..] }),   // the latest the state gave
 *     me: { name, photoUrl }, opponent: { name, photoUrl } | null, solo,
 *     resume: [[[word, pts], ..], ..],                 // the words the server already has from me, per stop
 *     onWord(stop, word, t) -> Promise<{ verdict, score, stopScore, words }>,
 *     getOpponent() -> { score, words } | null,
 *     online() -> boolean,                              // the page's own polls are getting through
 *   });
 *   h.stop()   h.score()   CupWordTrip.unlockAudio()
 *
 * Nothing on this screen is ever dimmed without a plain message saying why: a cover with big words (Starts in 3,
 * Stop 2 of 3, Time's up: waiting for the result, Loading the letters…), and a banner for a lost connection. */
(function () {
  'use strict';
  if (window.CupWordTrip) return;
  var CSS = '.cw{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;background:#15122B;color:#F6F1FF;font-family:Figtree,system-ui,sans-serif;padding:calc(10px + env(safe-area-inset-top)) 14px calc(12px + env(safe-area-inset-bottom));box-sizing:border-box;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:none}' +
    '.cw *{box-sizing:border-box}.cw button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}' +
    '.cw-top{width:100%;max-width:520px;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:6px}' +
    '.cw-p{display:flex;align-items:center;gap:8px;min-width:0}.cw-p.r{flex-direction:row-reverse;text-align:right}' +
    '.cw-p .nm{display:block;font-size:13px;font-weight:700;color:#A9A3CC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.cw-p .sc{display:block;font:800 26px/1 "Baloo 2",system-ui;color:#F6F1FF;font-variant-numeric:tabular-nums}.cw-p.r .sc{color:#A9A3CC}' +
    '.cw-p .tx{min-width:0}' +
    '.cw-av{position:relative;flex:none;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:13px;color:#15122B;overflow:hidden}.cw-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
    '.cw-ck{text-align:center}.cw-ck b{display:block;font:800 34px/1 "Baloo 2",system-ui;color:#FFD23F;font-variant-numeric:tabular-nums}.cw-ck b.low{color:#FF6B57}.cw-ck small{display:block;font-size:11px;font-weight:800;letter-spacing:.12em;color:#A9A3CC;margin-top:2px}' +
    '.cw-dots{display:flex;gap:6px;justify-content:center;margin:8px 0 2px}.cw-dots i{width:22px;height:6px;border-radius:3px;background:#3B3668}.cw-dots i.on{background:#FFD23F}.cw-dots i.done{background:#4BE39A}' +
    '.cw-net{width:100%;max-width:520px;margin-top:6px;padding:8px 12px;border-radius:12px;background:#FF6B57;color:#15122B;font-weight:800;font-size:14px;text-align:center}.cw-net[hidden]{display:none}' +
    '.cw-wall{width:100%;max-width:520px;flex:1 1 auto;min-height:60px;margin:8px 0;padding:10px;border-radius:16px;background:#211D42;border:1px solid #3B3668;display:flex;flex-direction:column;gap:6px;overflow:hidden}' +
    '.cw-wh{display:flex;justify-content:space-between;font-size:13px;font-weight:800;color:#A9A3CC}.cw-wh b{color:#F6F1FF}' +
    '.cw-ws{flex:1 1 auto;min-height:0;display:flex;flex-wrap:wrap;gap:6px;align-content:flex-start;overflow:auto}' +
    '.cw-w{display:inline-flex;align-items:center;gap:5px;height:30px;white-space:nowrap;flex:none;padding:0 10px;border-radius:10px;background:#2B2650;font-weight:800;font-size:15px;letter-spacing:.04em;text-transform:uppercase}.cw-w i{font-style:normal;font-size:12px;color:#FFD23F}.cw-w.p{color:#A9A3CC}.cw-w.p i{color:#A9A3CC}.cw-w.full{background:#FFD23F;color:#15122B}.cw-w.full i{color:#15122B}' +
    '.cw-tray{height:54px;display:flex;gap:5px;align-items:center;justify-content:center;margin:2px 0}' +
    '.cw-tray span{width:40px;height:46px;border-radius:10px;background:#FFF6DE;box-shadow:inset 0 -4px 0 #D2BC7E;color:#2A2140;font:800 26px/46px "Baloo 2",system-ui;text-align:center;text-transform:uppercase}' +
    '.cw-tray.bad span{background:#FF6B57;box-shadow:inset 0 -4px 0 #B8432F;animation:cw-sh .3s}.cw-tray.ok span{background:#4BE39A;box-shadow:inset 0 -4px 0 #2A9E66}' +
    '@keyframes cw-sh{25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}' +
    '.cw-msg{min-height:22px;font-size:15px;font-weight:700;color:#A9A3CC;text-align:center}.cw-msg.g{color:#4BE39A}.cw-msg.b{color:#FF8A7A}' +
    '.cw-wheel{position:relative;flex:none;border-radius:50%;background:#211D42;border:2px solid #3B3668;margin:4px 0;touch-action:none}' +
    '.cw-t{position:absolute;display:grid;place-items:center;border-radius:14px;background:#FFF6DE;box-shadow:inset 0 -5px 0 #D2BC7E;color:#2A2140;font:800 30px/1 "Baloo 2",system-ui;text-transform:uppercase;touch-action:none}' +
    '.cw-t.u{background:#FFD23F;box-shadow:inset 0 -5px 0 #C99E12}' +
    '.cw-svg{position:absolute;inset:0;pointer-events:none}' +
    '.cw-keys{width:100%;max-width:520px;display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:8px;margin-top:6px}' +
    '.cw-k{height:50px;border-radius:14px!important;background:#211D42!important;border:1px solid #3B3668!important;font-weight:800!important;font-size:16px!important}.cw-k.go{background:#FFD23F!important;color:#15122B!important;border-color:#FFD23F!important}.cw-k:disabled{color:#5A5490!important}.cw-k.go:disabled{background:#3B3668!important;border-color:#3B3668!important;color:#A9A3CC!important}' +
    '.cw-cov{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;background:#15122B}.cw-cov[hidden]{display:none}' +
    '.cw-cov small{font-size:13px;font-weight:800;letter-spacing:.14em;color:#A9A3CC}.cw-cov h2{margin:0;font:800 40px/1.05 "Baloo 2",system-ui;color:#F6F1FF}.cw-cov p{margin:0;max-width:320px;font-size:17px;color:#A9A3CC;line-height:1.4}' +
    '.cw-big{font:800 96px/1 "Baloo 2",system-ui;color:#FFD23F;font-variant-numeric:tabular-nums}' +
    '.cw-tiles{display:flex;gap:6px;justify-content:center}.cw-tiles span{width:40px;height:46px;border-radius:10px;background:#FFF6DE;box-shadow:inset 0 -4px 0 #D2BC7E;color:#2A2140;font:800 26px/46px "Baloo 2",system-ui;text-align:center}' +
    '.cw-sc2{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:min(320px,100%)}.cw-sc2 div{background:#211D42;border-radius:16px;padding:12px 8px}.cw-sc2 b{display:block;font:800 36px/1 "Baloo 2",system-ui}.cw-sc2 span{font-size:13px;color:#A9A3CC}' +
    '.cw-toast{position:absolute;left:50%;top:38%;transform:translateX(-50%);z-index:4;font:800 30px/1 "Baloo 2",system-ui;color:#FFD23F;text-shadow:0 2px 0 #15122B;pointer-events:none;animation:cw-up .9s ease-out forwards}@keyframes cw-up{from{opacity:1;transform:translate(-50%,0)}to{opacity:0;transform:translate(-50%,-40px)}}' +
    '@media (max-height:640px){.cw-wall{min-height:44px}.cw-tray{height:46px}.cw-tray span{width:34px;height:40px;font-size:22px;line-height:40px}.cw-keys{margin-top:4px}.cw-k{height:44px}}' +
    '@media (prefers-reduced-motion:reduce){.cw-toast{animation:none;opacity:0}.cw-tray.bad span{animation:none}}';
  function css() {
    if (document.getElementById('cupwt-css')) return;
    var s = document.createElement('style'); s.id = 'cupwt-css'; s.textContent = CSS; (document.head || document.documentElement).appendChild(s);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function first(s) { return String(s || '').trim().split(/\s+/)[0] || 'Opponent'; }
  function num(n) { return (Math.round(Number(n) || 0)).toLocaleString('en-IN'); }
  function initials(n) { var p = String(n || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
  var COLS = ['#FFD23F', '#4C9BFF', '#FF6FB5', '#4BE39A', '#B6F36A'];
  function face(p, col) {
    var u = p && p.photoUrl && /^(https:|\/)/.test(p.photoUrl) ? p.photoUrl : '';
    return '<span class="cw-av" style="background:' + col + '">' + esc(initials(p && p.name)) + (u ? '<img alt="" src="' + esc(u) + '" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '</span>';
  }

  /* ---------- sound: a few short tones (Word Trip's: a step up the scale per letter, a run for a word) ---------- */
  var AC = null, soundOn = true;
  try { soundOn = localStorage.getItem('cup-wt-sound') !== '0'; } catch (e) {}
  function ac() {
    if (!soundOn) return null;
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (AC.state !== 'running') { try { var p = AC.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
    return AC;
  }
  function tone(f, d, o) {
    o = o || {}; var a = ac(); if (!a) return;
    try {
      var t = a.currentTime + (o.at || 0), os = a.createOscillator(), g = a.createGain();
      os.type = o.type || 'triangle'; os.frequency.setValueAtTime(f, t); if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + d);
      g.gain.setValueAtTime(o.vol || 0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      os.connect(g); g.connect(a.destination); os.start(t); os.stop(t + d + 0.03);
    } catch (e) {}
  }
  var SCALE = [523, 587, 659, 698, 784, 880, 988, 1047];
  var sfx = {
    letter: function (i) { tone(SCALE[Math.min(i, 7)], 0.08, { vol: 0.08 }); },
    word: function (n) { for (var i = 0; i < Math.min(n, 6); i++) tone(SCALE[i], 0.09, { vol: 0.1, at: i * 0.045 }); },
    full: function () { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.16, { vol: 0.14, at: i * 0.07 }); }); },
    no: function () { tone(220, 0.18, { type: 'sawtooth', to: 160, vol: 0.06 }); },
    tick: function () { tone(880, 0.05, { type: 'square', vol: 0.04 }); },
    go: function () { tone(784, 0.12, { vol: 0.16 }); tone(1047, 0.25, { vol: 0.16, at: 0.1 }); }
  };
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function unlockAudio() { return !!ac(); }

  function start(o) {
    css();
    var mount = o.mount, off = Number(o.clockOffset) || ((Number(o.serverNow) || Date.now()) - Date.now());
    var now = function () { return Date.now() + off; };
    var startAt = typeof o.startAt === 'number' ? o.startAt : Date.parse(o.startAt);
    var wtNow = function () { try { return (typeof o.wt === 'function' ? o.wt() : o.wt) || {}; } catch (e) { return {}; } };
    var W = wtNow(), STOPS = W.stops || 3, STOP_MS = (W.stopSec || 60) * 1000, GAP_MS = (W.gapSec || 4) * 1000;
    var me = o.me || {}, opp = o.solo ? null : o.opponent || null;
    /* Per stop: the words the server took ([word, pts]) and the ones on their way (pending). */
    var found = [], pending = [], score = 0, stopScore = [];
    for (var s = 0; s < STOPS; s++) { found.push([]); stopScore.push(0); }
    if (Array.isArray(o.resume)) o.resume.forEach(function (list, k) { if (k < STOPS && Array.isArray(list)) { found[k] = list.slice(); stopScore[k] = list.reduce(function (t, x) { return t + (Number(x[1]) || 0); }, 0); } });
    score = stopScore.reduce(function (a, b) { return a + b; }, 0);
    var k = -1, letters = '', order = [], tray = [], used = {}, phase = '', lastTick = -1, alive = true, failSince = 0, queue = [];
    var root = document.createElement('div'); root.className = 'cw';
    root.innerHTML =
      '<div class="cw-top"><div class="cw-p">' + face(me, '#FFD23F') + '<span class="tx"><span class="nm">You</span><b class="sc" data-me>0</b></span></div>' +
      '<div class="cw-ck"><b data-clk>1:00</b><small data-stp>SET 1 OF ' + STOPS + '</small></div>' +
      '<div class="cw-p r">' + (opp ? face(opp, '#4C9BFF') + '<span class="tx"><span class="nm">' + esc(first(opp.name)) + '</span><b class="sc" data-op>0</b></span>' : '<span class="tx"><span class="nm">Playing alone</span><b class="sc" style="font-size:15px">You go through</b></span>') + '</div></div>' +
      '<div class="cw-dots" data-dots></div>' +
      '<div class="cw-net" data-net hidden role="status">Reconnecting… your words are kept and sent when it’s back.</div>' +
      '<div class="cw-wall"><div class="cw-wh"><span data-wc>0 words</span><span data-ss></span></div><div class="cw-ws" data-ws aria-live="polite"></div></div>' +
      '<div class="cw-msg" data-msg></div>' +
      '<div class="cw-tray" data-tray></div>' +
      '<div class="cw-wheel" data-wheel><svg class="cw-svg" data-svg></svg></div>' +
      '<div class="cw-keys"><button type="button" class="cw-k" data-sh>Shuffle</button><button type="button" class="cw-k" data-del>Delete</button><button type="button" class="cw-k go" data-go>Enter</button></div>' +
      '<div class="cw-cov" data-cov role="status"></div>';
    mount.appendChild(root);
    var $ = function (q) { return root.querySelector('[data-' + q + ']'); };
    var $wheel = $('wheel'), $svg = $('svg'), $tray = $('tray'), $msg = $('msg'), $cov = $('cov'), $ws = $('ws'), $clk = $('clk');
    var tiles = [], geo = null;

    function cover(html) { if ($cov.getAttribute('data-h') === html) { $cov.hidden = false; return; } $cov.setAttribute('data-h', html); $cov.innerHTML = html; $cov.hidden = false; }
    function uncover() { $cov.hidden = true; }
    function msg(t, cls) { $msg.textContent = t || ''; $msg.className = 'cw-msg' + (cls ? ' ' + cls : ''); }
    function tilesHtml(word) { return '<div class="cw-tiles">' + String(word).toUpperCase().split('').map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') + '</div>'; }

    /* ---------- the wheel: the stop's letters round a circle, tap or swipe ---------- */
    function size() {
      var w = Math.min(root.clientWidth - 28, 330), h = root.clientHeight;
      var d = Math.max(170, Math.min(w, h - 430));
      return d;
    }
    function layout() {
      var n = order.length; if (!n) { $wheel.style.width = $wheel.style.height = '0px'; return; }
      var d = size(), t = Math.round(Math.min(64, d * (n > 6 ? 0.25 : 0.28))), r = d / 2 - t / 2 - 8;
      $wheel.style.width = $wheel.style.height = d + 'px';
      geo = { d: d, t: t, pos: [] };
      tiles.forEach(function (el, i) {
        var a = -Math.PI / 2 + (2 * Math.PI * i) / n, x = d / 2 + r * Math.cos(a) - t / 2, y = d / 2 + r * Math.sin(a) - t / 2;
        geo.pos.push([x + t / 2, y + t / 2]);
        el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.width = el.style.height = t + 'px'; el.style.fontSize = Math.round(t * 0.5) + 'px';
      });
      $svg.setAttribute('viewBox', '0 0 ' + d + ' ' + d);
      drawLine();
    }
    function buildTiles() {
      tiles.forEach(function (el) { el.remove(); }); tiles = [];
      order.forEach(function (t, i) {
        var el = document.createElement('div'); el.className = 'cw-t'; el.textContent = t.c; el.setAttribute('data-i', i); el.setAttribute('role', 'button'); el.setAttribute('aria-label', t.c);
        $wheel.appendChild(el); tiles.push(el);
      });
      layout();
    }
    function drawLine(pt) {
      if (!geo) return;
      var pts = tray.map(function (t) { return geo.pos[order.indexOf(t)]; }).filter(Boolean);
      if (pt) pts.push(pt);
      $svg.innerHTML = pts.length > 1 ? '<polyline points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="none" stroke="#FFD23F" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>' : '';
    }
    function paintTray(cls) {
      $tray.className = 'cw-tray' + (cls ? ' ' + cls : '');
      $tray.innerHTML = tray.map(function (t) { return '<span>' + esc(t.c) + '</span>'; }).join('');
      tiles.forEach(function (el, i) { el.classList.toggle('u', !!used[order[i].id]); });
      $('go').disabled = phase !== 'play' || tray.length < 3; $('del').disabled = phase !== 'play' || !tray.length; $('sh').disabled = phase !== 'play';
    }
    function add(i) {
      if (phase !== 'play') return false;
      var t = order[i]; if (!t || used[t.id]) return false;
      used[t.id] = 1; tray.push(t); sfx.letter(tray.length - 1); buzz(6); paintTray(); drawLine(); msg('');
      return true;
    }
    function clearTray() { tray = []; used = {}; paintTray(); drawLine(); }
    function tileAt(x, y) {
      if (!geo) return -1;
      var r = $wheel.getBoundingClientRect(), px = x - r.left, py = y - r.top, best = -1, bd = Infinity;
      geo.pos.forEach(function (p, i) { var d = Math.hypot(p[0] - px, p[1] - py); if (d < bd) { bd = d; best = i; } });
      return bd <= geo.t * 0.62 ? best : -1;
    }
    var swipe = null;
    $wheel.addEventListener('pointerdown', function (e) {
      if (phase !== 'play') return;
      var i = tileAt(e.clientX, e.clientY); if (i < 0) return;
      e.preventDefault(); try { $wheel.setPointerCapture(e.pointerId); } catch (x) {}
      ac();
      var fresh = !used[order[i].id];
      if (!fresh && tray.length && tray[tray.length - 1] === order[i]) { swipe = { moved: false, start: i, tapBack: true }; return; }
      if (fresh) add(i);
      swipe = { moved: false, start: i };
    });
    $wheel.addEventListener('pointermove', function (e) {
      if (!swipe || phase !== 'play') return;
      var r = $wheel.getBoundingClientRect();
      var i = tileAt(e.clientX, e.clientY);
      if (i >= 0 && i !== swipe.start) { swipe.moved = true; }
      if (i >= 0 && !used[order[i].id]) { swipe.moved = true; add(i); }
      else if (i >= 0 && tray.length > 1 && tray[tray.length - 2] === order[i]) { var t = tray.pop(); delete used[t.id]; paintTray(); }
      drawLine(swipe.moved ? [e.clientX - r.left, e.clientY - r.top] : null);
    });
    function endSwipe() {
      var s = swipe; swipe = null; if (!s) return;
      if (s.tapBack && !s.moved) { var t = tray.pop(); if (t) delete used[t.id]; paintTray(); drawLine(); return; }
      if (s.moved) { if (tray.length >= 3) submit(); else if (tray.length) { msg('Words have 3 letters or more', 'b'); clearTray(); } else drawLine(); }
      else drawLine();
    }
    $wheel.addEventListener('pointerup', endSwipe);
    $wheel.addEventListener('pointercancel', endSwipe);
    root.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    root.addEventListener('touchmove', function (e) { if (e.cancelable && !e.target.closest('.cw-ws')) e.preventDefault(); }, { passive: false });
    $('del').addEventListener('click', function () { var t = tray.pop(); if (t) delete used[t.id]; paintTray(); drawLine(); });
    $('sh').addEventListener('click', function () {
      if (phase !== 'play') return;
      for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = order[i]; order[i] = order[j]; order[j] = x; }
      tiles.forEach(function (el, i) { el.textContent = order[i].c; el.setAttribute('aria-label', order[i].c); });
      paintTray(); drawLine();
    });
    $('go').addEventListener('click', function () { if (tray.length >= 3) submit(); });
    function onKey(e) {
      if (phase !== 'play' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter') { if (tray.length >= 3) submit(); e.preventDefault(); return; }
      if (e.key === 'Backspace') { var t = tray.pop(); if (t) delete used[t.id]; paintTray(); drawLine(); e.preventDefault(); return; }
      var c = String(e.key || '').toLowerCase();
      if (!/^[a-z]$/.test(c)) return;
      for (var i = 0; i < order.length; i++) if (order[i].c === c && !used[order[i].id]) { add(i); return; }
    }
    document.addEventListener('keydown', onKey);

    /* ---------- a word: shown at once as on its way, then as the server judged it ---------- */
    var REASON = { short: 'Words have 3 letters or more', letters: 'Use only these letters', unknown: 'Not in the word list', again: 'Already found', limit: 'Too many tries on these letters', junk: 'Not a word' };
    function submit() {
      var w = tray.map(function (t) { return t.c; }).join(''), sk = k;
      clearTray();
      if (phase !== 'play') return;
      if (found[sk].some(function (x) { return x[0] === w; }) || pending.some(function (x) { return x.k === sk && x.w === w; })) { msg('Already found', 'b'); sfx.no(); flash(w, 'bad'); return; }
      var t = Math.max(0, now() - (startAt + sk * (STOP_MS + GAP_MS)));
      var p = { k: sk, w: w, t: Math.round(t), tries: 0 };
      pending.push(p); paintWall();
      send(p);
    }
    function send(p) {
      p.tries++;
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; failed(p); } }, 6000);
      Promise.resolve().then(function () { return o.onWord(p.k, p.w, p.t); }).then(function (j) {
        if (done || !alive) return; done = true; clearTimeout(timer);
        failSince = 0; netBanner();
        pending = pending.filter(function (x) { return x !== p; });
        var v = j && j.verdict;
        if (typeof j.score === 'number') score = j.score;
        if (v && v.ok) {
          found[p.k].push([v.word, v.pts]); stopScore[p.k] = j.stopScore != null ? j.stopScore : stopScore[p.k] + v.pts;
          if (v.full) { sfx.full(); buzz([20, 30, 60]); msg('Every letter! +' + num(v.pts), 'g'); } else { sfx.word(p.w.length); buzz(15); msg(v.combo > 1 ? 'Combo ×' + v.combo : 'Nice!', 'g'); }
          toast('+' + num(v.pts) + (v.combo > 1 ? ' ×' + v.combo : ''));
          if (p.k === k) flash(p.w, 'ok');
        } else {
          sfx.no(); buzz(30);
          if (p.k === k) { msg(REASON[v && v.reason] || 'Not a word', 'b'); flash(p.w, 'bad'); }
        }
        paintScore(); paintWall();
      }).catch(function (e) {
        if (done || !alive) return; done = true; clearTimeout(timer);
        /* The server said no (the stop is over, the match decided): the word is dropped, not retried. */
        if (e && e.status >= 400 && e.status < 500) { pending = pending.filter(function (x) { return x !== p; }); if (p.k === k) msg(e.message || 'Not taken', 'b'); paintWall(); return; }
        failed(p);
      });
    }
    function failed(p) {
      if (!failSince) failSince = Date.now();
      netBanner();
      var stopEnds = startAt + p.k * (STOP_MS + GAP_MS) + STOP_MS + 1500;
      if (now() < stopEnds && p.tries < 6) setTimeout(function () { if (alive) send(p); }, Math.min(2500, 500 * p.tries));
      else { pending = pending.filter(function (x) { return x !== p; }); paintWall(); }
    }
    function netBanner() {
      var off = (failSince && Date.now() - failSince > 800) || (o.online && o.online() === false);
      $('net').hidden = !off;
    }
    var flashT = 0;
    function flash(w, cls) {
      clearTimeout(flashT);
      $tray.className = 'cw-tray ' + cls; $tray.innerHTML = w.toUpperCase().split('').map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('');
      flashT = setTimeout(function () { if (!tray.length) { $tray.className = 'cw-tray'; $tray.innerHTML = ''; } }, 650);
    }
    function toast(t) { var el = document.createElement('div'); el.className = 'cw-toast'; el.textContent = t; root.appendChild(el); setTimeout(function () { el.remove(); }, 950); }
    function paintScore() {
      $('me').textContent = num(score);
      var op = o.getOpponent && o.getOpponent();
      var $op = $('op'); if ($op) $op.textContent = op && op.score != null ? num(op.score) : '0';
    }
    function paintWall() {
      if (k < 0 || k >= STOPS) return;
      var list = found[k], pend = pending.filter(function (x) { return x.k === k; });
      var count = (wtNow().counts || [])[k];
      $('wc').innerHTML = '<b>' + list.length + '</b>' + (count ? ' of ' + count + ' words' : list.length === 1 ? ' word' : ' words');
      $('ss').textContent = 'This set: ' + num(stopScore[k]);
      var h = list.map(function (x) { return '<span class="cw-w' + (x[0].length === letters.length ? ' full' : '') + '">' + esc(x[0]) + '<i>+' + num(x[1]) + '</i></span>'; }).join('') +
        pend.map(function (x) { return '<span class="cw-w p">' + esc(x.w) + '<i>…</i></span>'; }).join('');
      if ($ws.getAttribute('data-h') !== h) { $ws.setAttribute('data-h', h); $ws.innerHTML = h; $ws.scrollTop = $ws.scrollHeight; }
    }
    function paintDots() {
      var h = ''; for (var i = 0; i < STOPS; i++) h += '<i class="' + (i < k ? 'done' : i === k ? 'on' : '') + '"></i>';
      $('dots').innerHTML = h;
    }
    function dealStop(nk) {
      k = nk; letters = (wtNow().letters || [])[k] || '';
      order = letters.split('').map(function (c, i) { return { c: c, id: k + ':' + i }; });
      tray = []; used = {}; buildTiles(); paintTray(); paintDots(); paintWall(); msg('');
      $('stp').textContent = 'SET ' + (k + 1) + ' OF ' + STOPS;
    }

    /* ---------- the clock: which stop, which cover ---------- */
    function fmt(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    function tick() {
      if (!alive) return;
      var t = now() - startAt, span = STOP_MS + GAP_MS;
      paintScore(); netBanner();
      if (!isFinite(startAt)) { phase = 'load'; cover('<h2>Loading…</h2><p>Getting your match ready.</p>'); return; }
      if (t < 0) {
        phase = 'count';
        var n = Math.ceil(-t / 1000);
        cover('<small>' + (o.attempt ? 'REPLAY · NEW LETTERS' : 'SET 1 OF ' + STOPS) + '</small><div class="cw-big">' + n + '</div><p>' + (W.len || '') + ' letters. Make as many words as you can in ' + Math.round(STOP_MS / 1000) + ' seconds.</p>' + (opp ? '<p>Same letters for you and ' + esc(first(opp.name)) + '.</p>' : '<p>' + esc(first((o.opponent || {}).name || 'Your opponent')) + ' didn’t come. You play alone and go to the next round.</p>'));
        if (n !== lastTick) { lastTick = n; if (n <= 3) sfx.tick(); }
        return;
      }
      var sk = Math.floor(t / span), inStop = t - sk * span;
      if (sk >= STOPS || (sk === STOPS - 1 && inStop >= STOP_MS)) {
        if (phase !== 'end') { phase = 'end'; clearTray(); }
        cover('<small>TIME’S UP</small><h2>Your score: ' + num(score) + '</h2>' +
          (opp ? '<div class="cw-sc2"><div><b>' + num(score) + '</b><span>You</span></div><div><b>' + num((o.getOpponent && o.getOpponent() || {}).score || 0) + '</b><span>' + esc(first(opp.name)) + '</span></div></div><p>Waiting for the result…</p>' : '<p>You go to the next round. Waiting for the others…</p>') +
          (pending.length ? '<p>Sending your last words…</p>' : ''));
        return;
      }
      if (inStop >= STOP_MS) {
        /* Between two stops: the next one's number and a countdown, in big plain words. */
        if (phase !== 'gap') { phase = 'gap'; clearTray(); }
        var nl = (wtNow().letters || [])[sk + 1];
        cover('<small>SET ' + (sk + 1) + ' DONE · ' + num(stopScore[sk]) + ' POINTS</small><h2>Stop ' + (sk + 2) + ' of ' + STOPS + '</h2><div class="cw-big">' + Math.max(1, Math.ceil((span - inStop) / 1000)) + '</div><p>' + (nl ? nl.length + ' new letters' : 'New letters') + ' coming up.</p>');
        return;
      }
      if (sk !== k || !letters) {
        dealStop(sk);
        if (!letters) { phase = 'load'; cover('<small>SET ' + (sk + 1) + ' OF ' + STOPS + '</small><h2>Loading the letters…</h2><p>The clock is running: they’ll be here in a moment.</p>'); k = -1; return; }
        sfx.go();
      }
      if (phase !== 'play') { phase = 'play'; uncover(); paintTray(); }
      var left = STOP_MS - inStop;
      $clk.textContent = fmt(left); $clk.className = left <= 10000 ? 'low' : '';
      var sec = Math.ceil(left / 1000); if (sec <= 5 && sec !== lastTick) { lastTick = sec; sfx.tick(); }
    }
    var iv = setInterval(tick, 200);
    var onResize = function () { layout(); };
    window.addEventListener('resize', onResize);
    tick();
    return {
      stop: function () { alive = false; clearInterval(iv); window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey); root.remove(); },
      score: function () { return score; },
      state: function () { return { phase: phase, stop: k, score: score, found: found, pending: pending.length }; }
    };
  }
  window.CupWordTrip = { start: start, unlockAudio: unlockAudio };
})();
