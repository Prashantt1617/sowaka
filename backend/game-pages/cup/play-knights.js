/* One Knights round, played inside the tournament page (cup/page.html), with the contract of cup/play.js (window.CupPlay) and
 * cup/play-trails.js (window.CupTrails), so the page can take any of them. The Meow puzzle in the Knights Tournament look:
 * an n×n board of n colour regions; one knight per row, column and region; knights never touch, diagonals too.
 * Tap: × → knight → clear. A slide puts × on every empty square it crosses. A clashing knight shows "!" (display only:
 * the server judges). First right board wins; Resign gives the match away; at the cap the one with more right wins.
 *
 *   const h = CupKnights.start({
 *     mount, knights: { n, g },       // the match's board (regions only) from the server
 *     startAt, serverNow, clockOffset, roundSec = 300, attempt,
 *     me: { name, userId }, opponent: { name } | null, solo,
 *     getOpponentLive: () => placed | null,   // the opponent's knights on the board now
 *     onLive(placed, { knights }),  // on every change of the knight set (the host throttles and POSTs { knights })
 *     onProgress(p), resume,        // p = { cells } kept by the host; resume puts it back after a reload
 *     onResign: () => Promise,      // the host POSTs /resign
 *     onClose(),                    // the player leaves the result screen
 *     sound = true,
 *   });
 *   h.result(match, myId)  // the match is decided: the result screen.  h.stop()  h.state()  h.score()
 *   CupKnights.unlockAudio()  CupKnights.boardHtml({ n, g }, { size, key, placed })  CupKnights.drawBoard(mount, kn, opts) */
(function () {
  'use strict';
  if (window.CupKnights) return;
  var KNIGHT = 'data:image/webp;base64,UklGRpAFAABXRUJQVlA4WAoAAAAQAAAAQAAATwAAQUxQSLkBAAARX6CobSM2dQj2vlcjIqh/GOiKKUi5bW15o/cN2jI4RsWomJkZFCtGVduo4sDn2qiJ5Tw/b9L33mfAR/SfgSRJTWYtyWBYjj8YtypqDSHEr1Gfkry0PHZYTc6apIgq01xiEvJbR0V0+52N5yBeMVvIdKdEd+WlY/JV9+SyKXGphyPpJBagSLi4/dag5a6wgOrirt6wDKfiVgOVAjw/kyI1EikkYnGKFULECXrhxye4hwYgiPmRxwgk7GaPSaVJ2xJ523TSl2VuRftOnoVRWYVzn2QoJp3pg1DcQ5MzDT4Hc0Iq4CDKEsIGOVrK0H/wI4c1C39TGRq5abFTypEByo1pztI0Z3M/xYPQBXORzQkTSY3NFr4H8G/w0GbIN8Z8AibSQRzZMoCmZx+A6F3ebAGK3gqnBDBRhGe1vWXTEL2536cyc0Dd+wSnn/qwlcEBA4/OqkfnQUJGWzixBisNKKVOGOXfIbbJPVF4FqQGyiHcAaCKGmHcggnio56ISWqTeVZ/C+qPmAmijJMAnEt7CEUpPB/x9TVmfxJ1/P4gidh/AOIQU9hgLiukepiU3rRJGgl8YWCIljX/iQwAVlA4ILADAADwEwCdASpBAFAAPqlInUomJCKhq5Vc+MAVCWwAxRIguw/tPmgWXt0hRISe2w8znnRejXeQvQa6WX91f2jxEQ6KLFVRjYFGRJKgXIbxT8DuHTzW2ITq1PRKb8yjZTe+w06X9hdZCRHFIi9QgLulMPl3Ivjct8sDHMXkKwsxTIXWaPekw2w/phDMP58XhnpMnyXmZdcyKl9pWPpnIdhw5Z2rqLZ9o40Z3GAA/vz4SilAMF32OrlhCcDP8lZGkcvBXxyRrGYyWj4W3yHAc3AUZxITt4U29lOZPzgLfHaX/hYeft6Slsqr4daxtnPknRmH7zXzIgK3lfXbZsaDEEoCjpo3W0Dx3qJUCMSqM8uGlL6SzcmA9zahC/Wx8eQ0iJPLo/eqMCpRDE21mZv4P9R3eAXmq25aw5TzZSwd/6GKmgS39MF5oNKECN7v4g3/tzvnUBCcKIhZLR6kXvRNyT0Wfts1w57QKH7T6U85n4mNrYlqtgdQzFJWaFgrjwCpO28HwYn/vFp4O5xQHuKI8xBdJc+bbNA+vVOUxaAhOnM9K0TZmRodU4rSP3B9+SMOndV+tNiNlUe/2iH9Qx2cf/FAVKhDIxAOjGYZiN2Sr7DQpu/AqN2ix0OmsmzLnXsSezwjUhfCRX3f2gipYB7yGu6zdbsweWbGEoaoXIB5q+CjSaU1/9Dy+NMMlAEZiIyxzZtl21qVy02CfSO6d7rP60k6CA5DXxxeB3PA5fbmWEyHE4Y+DGYeAsHX6HCY/OATyX7mSCoGlBzR8MsRXkp+XbhoWTavypcqeWPUptvyRpCAOiVxxjzsuKhek9mVBLQLhyPy5XnB/ETnDath8QApBvviEEOpGi0OlJL1PzUdPtMBlNvqQ5XcSEx1atJU8RLiWTb5AWSmxTTz6W5gx8tinZ155l5q2VUz+TwcyyznIM//ETm6+x0ONm8DAk1Zg6i+APOGY/0QMHXI8cXDOhKaT5UZA3Xy6HGJ6oV8VaD4PEnzrlp5ph8k+XzeL7PC5AfQ2QmeFe+n/8Anv+ODRYasHMyC2p6SjH8dBFgfmNvZGVBvT2rO5Xk+NgtP6H5C8Y9bdxMeNtTXvMf6D0mycLL0HyjrS0H0Ruud5DlGaqb8e8jsFy+m4djpJr+wnD3ihkJP1hxrZU+OubF7xQkQGfNqWGB4SWlYsWcz+CkW0qsqwxItSxQoe51NftZsu81syG5T+ZH2W/5/YWQAhZ7sMUl9PrcwW8MWVkgtHFwV7eXbXG0XSwgAAA==';
  var BETS = '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';
  var HOOF = 'SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAwAAAAAAAAAAAAAAD/81jAAAAAAAAAAAAASW5mbwAAAA8AAAAJAAAEgABAQEBAQEBAQEBAQFhYWFhYWFhYWFhYcHBwcHBwcHBwcHCIiIiIiIiIiIiIiKCgoKCgoKCgoKCguLi4uLi4uLi4uLjQ0NDQ0NDQ0NDQ0Ojo6Ojo6Ojo6Ojo//////////////8AAAAATGF2YzYxLjE5AAAAAAAAAAAAAAAAJAMAAAAAAAAABIAsfNu3AAAAAAAAAAAAAAD/8zjEAAqYAe0fQxgABATuDlkiEmoEChwHz6nzko6X4glIn//66P8+pwYlz5fX//pghy7/zn/yahRYLQKBAKBQKRWKxWIP9wUtrk7hYVgB8EV2659NfQz78q/4GhHgUSAbQgSYoYRj4GiDBbv/8zjENCEavuZfmKACFHDBYfCWCgWPhyAtgeoNcUuX2c1S/D1xnBkBOBAyup0UUH/lc0c3c0LiS1IpL/9bpqat7O6S///umqyFacwaz+2l//zOapLe421jMXMu/+LVepcUqFLRAe3hFSEKAxf/8zjEDhhDftABmFAANTNeazTx2Gq4Xo1AWBdLBfDapeQIIIbkoxe0utEIHOdv/mnMSnEena788lJh8eYb//6Lb////mcuahx5jf///85XLF3OJDTj7Od62////8hO/5WnPPAYCGBYaZ6HAmH/8zjEDBejLqQBmjgADEWhve4CyoZStvSzEBQLxIHx4HRE9iB44g2JJQ5dVrofbaiHHr3/5yHZz7I9dPX/an//9V0t9tP/6Z7HHWR0OZzTD35tGUpQuh9s70+xD/h3/oWbtZyxhZvXau4NbWD/8zjEDBcjDsABmIAAAFnH4HpB7y9+ONJAN+Icb+T6SBuYESNya+pn0kzZB/3+lrb/rf0WUjS//6GylutGigv//7bdFWiipa2V//+t6amoUOicRUkZF46kLrO///61KVmn/+tcGYIXoto8TUX/8zjEDhgA7rUfzzAAfSWayuQqeC9evdvXrKy/wn2HEiVbajd2c/eZ/+dtExM8jLnDQ0ocDJJ4aPHWHg7RYLi5h7IsdJMRkp6b2ntty6jo0JBVQta5T4TdWbrKjDzklgqf2hIBaQk0FA1BDLj/8zjEDRfwqnBUykxEA5pl0qAYGprshmwCN/lq7kZJOiclzUXO2c1IqKHqiuSCIWPCMqCoiPCQSsJRUsYtcJhLypYqp9qFbzsRIfBoOo4GJCIs9pETgI9GCISiLBUse6mgZ0FQJRgAqcAGIoX/8zjEDBNoUjwAw9IgKHBMRFwyCwm8lWfUHQVGh1olYEzue0B0TP6SRJk6e5aIiwdqNBqRnlSv2ztBI9xoKhpYdwaJuKrAQCaVDTMGpXEqAHcqmDMEeMMyBmPpOCo0XXYPCweiutvYPYZFmJr/8zjEHQ1YLel8exIAhdKkSrHfW34t+KfoHij//rbxdmKi3//itUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=';
  var COLS = ['#1F56D8', '#63A9F7', '#1FA79F', '#3B30A6', '#9277F2', '#D6E9FF', '#8EE3EC', '#5C6F9F', '#C9A8FF'];
  var LIGHT = { 1: 1, 5: 1, 6: 1, 8: 1 };
  var CSS = '.ck{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;background:radial-gradient(120% 80% at 50% 0,#0B1440,#060B26 70%);color:#CFE6FF;font-family:"Plus Jakarta Sans",system-ui,sans-serif;padding:calc(10px + env(safe-area-inset-top)) 16px calc(14px + env(safe-area-inset-bottom));box-sizing:border-box;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:none}' +
    '.ck *{box-sizing:border-box}.ck button{font:inherit;color:inherit;cursor:pointer;border:0}' +
    '.ck-top{width:100%;max-width:520px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px}' +
    '.ck-p{min-width:0}.ck-p b{display:block;font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff}.ck-p small{font-size:12px;color:#8FB2E0;font-weight:700}.ck-p.r{text-align:right}' +
    '.ck-clk{font:800 30px/1 "Plus Jakarta Sans",system-ui;color:#fff;font-variant-numeric:tabular-nums;letter-spacing:.5px}.ck-clk.low{color:#FFB020}' +
    '.ck-bar{width:100%;max-width:520px;display:flex;justify-content:space-between;align-items:center;margin:10px 0}' +
    '.ck-bt{min-height:40px;padding:0 14px;border-radius:12px;background:#122057;font-weight:800;font-size:13px;letter-spacing:.4px}.ck-bt.rs{background:transparent;box-shadow:inset 0 0 0 2px #2E4A9A;color:#A9C3E6}' +
    '.ck-bd{position:relative;display:grid;border-radius:14px;overflow:hidden;background:#060B26;box-shadow:0 0 0 3px #060B26,0 0 0 5px #2E4A9A,0 14px 40px rgba(0,0,0,.5);touch-action:none}' +
    '.ck-c{position:relative;display:grid;place-items:center;border:0 solid #060B26}' +
    '.ck-c.ckx::after{content:"\\00d7";font:800 calc(var(--s)*.62)/1 "Plus Jakarta Sans",system-ui;color:#fff;opacity:.92}.ck-c.ckl.ckx::after{color:#0B1440;opacity:.75}' +
    '.ck-c img{width:78%;height:78%;object-fit:contain;padding:8%;border-radius:50%;background:#F2F8FF;box-shadow:0 2px 0 rgba(6,11,38,.45)}' +
    '.ck-c.ckk img{animation:ck-in .18s ease-out}.ck-c.ckb img{background:#FFE2A8;box-shadow:0 0 0 3px #FFB020}' +
    '.ck-c.ckb::before{content:"!";position:absolute;z-index:2;top:4%;right:6%;width:38%;height:38%;max-width:22px;max-height:22px;border-radius:50%;background:#FFB020;color:#060B26;font:800 calc(var(--s)*.26)/1 system-ui;display:grid;place-items:center}' +
    '.ck-c.cks{box-shadow:inset 0 0 0 3px #3DDC97}' +
    '@keyframes ck-in{0%{transform:scale(.4)}70%{transform:scale(1.12)}100%{transform:none}}' +
    '.ck-msg{min-height:40px;margin-top:12px;text-align:center;font-size:14px;font-weight:700;color:#A9C3E6;max-width:520px}.ck-msg.w{color:#FFB020}.ck-msg.g{color:#3DDC97}' +
    '.ck-cov{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;background:rgba(6,11,38,.94)}.ck-cov[hidden]{display:none}.ck-cov.w{background:#060B26}' +
    '.ck-cov h2{margin:0;font:800 30px/1.1 "Plus Jakarta Sans",system-ui;color:#fff}.ck-cov p{margin:0;max-width:340px;color:#A9C3E6;font-size:15px;line-height:1.45}' +
    '.ck-big{font:800 92px/1 "Plus Jakarta Sans",system-ui;color:#CFE6FF}.ck-kn{width:64px;height:80px;object-fit:contain}' +
    '.ck-go{min-height:54px;width:min(320px,100%);border-radius:16px;background:#CFE6FF;color:#060B26!important;font-weight:800!important;font-size:17px!important;box-shadow:0 5px 0 #5D86C9}' +
    '.ck-go.dk{background:#122057;color:#CFE6FF!important;box-shadow:0 5px 0 #060B26}.ck-go.red{background:#FF7A6B;box-shadow:0 5px 0 #A3392C}' +
    '.ck-tag{font-size:12px;font-weight:800;letter-spacing:1.5px;color:#7FC4FF}' +
    '.ckv{display:grid;border-radius:10px;overflow:hidden;box-shadow:0 0 0 2px #060B26,0 0 0 3px var(--pc,#2E4A9A)}.ckv i{border:0 solid #060B26}';
  function css() {
    if (document.getElementById('cupknights-css')) return;
    var s = document.createElement('style'); s.id = 'cupknights-css'; s.textContent = CSS; (document.head || document.documentElement).appendChild(s);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function first(s) { return String(s || '').trim().split(/\s+/)[0] || 'Your opponent'; }
  function valid(kn) { return kn && kn.n >= 4 && kn.n <= 12 && Array.isArray(kn.g) && kn.g.length === kn.n * kn.n; }
  /* The thick line between two regions, thin inside one. */
  function edges(kn, i, w) {
    var n = kn.n, g = kn.g, r = Math.floor(i / n), c = i % n, t = w + 'px', h = '1px';
    return 'border-top-width:' + (r && g[i - n] !== g[i] ? t : r ? h : 0) + ';border-left-width:' + (c && g[i - 1] !== g[i] ? t : c ? h : 0);
  }
  function clashes(n, g, a, b) {
    var ra = Math.floor(a / n), rb = Math.floor(b / n), ca = a % n, cb = b % n;
    return ra === rb || ca === cb || g[a] === g[b] || (Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1);
  }

  /* ---------- sound ---------- */
  var AC = null, soundOn = true, BUF = {};
  try { soundOn = localStorage.getItem('cup-knights-sound') !== '0'; } catch (e) {}
  function ac() {
    if (!soundOn) return null;
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (AC.state !== 'running') { try { var p = AC.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
    load('hoof', HOOF); load('bets', BETS);
    return AC;
  }
  /* A short mp3, base64, decoded once into a buffer. */
  function load(k, b64) {
    if (BUF[k]) return;
    BUF[k] = 'loading';
    try {
      var bin = atob(b64), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      var d = AC.decodeAudioData(u.buffer, function (b) { BUF[k] = b; }, function () { BUF[k] = null; });
      if (d && d.then) d.then(function (b) { BUF[k] = b; }).catch(function () {});
    } catch (e) { BUF[k] = null; }
  }
  function clip(k, vol) {
    var a = ac(), b = BUF[k]; if (!a || !b || b === 'loading') return false;
    try { var s = a.createBufferSource(), g = a.createGain(); g.gain.value = vol; s.buffer = b; s.connect(g); g.connect(a.destination); s.start(); return true; } catch (e) { return false; }
  }
  function tone(f, d, o) {
    o = o || {}; var a = ac(); if (!a) return;
    try {
      var t = a.currentTime + (o.at || 0), os = a.createOscillator(), g = a.createGain();
      os.type = o.type || 'triangle'; os.frequency.setValueAtTime(f, t); if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + d);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.vol || 0.16, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      os.connect(g); g.connect(a.destination); os.start(t); os.stop(t + d + 0.03);
    } catch (e) {}
  }
  function hoof() { if (!clip('hoof', 1.4)) tone(180, 0.09, { type: 'square', to: 90, vol: 0.12 }); }
  /* "Place your bets": the page calls it once per betting window; tries again for a moment while the clip decodes. */
  function bets(t) { if (!soundOn) return; if (!clip('bets', 1.2) && (t || 0) < 6) setTimeout(function () { bets((t || 0) + 1); }, 400); }
  /* Knights page: the first tap anywhere lets the sound play (iOS), so the bets call can be heard later. */
  document.addEventListener('pointerdown', function () { if (document.documentElement.classList.contains('kn')) ac(); }, true);
  var sfx = {
    mark: function () { tone(620, 0.04, { type: 'square', vol: 0.05 }); tone(420, 0.05, { type: 'sine', vol: 0.07, at: 0.02 }); },
    clear: function () { tone(392, 0.07, { type: 'sine', to: 300, vol: 0.1 }); },
    count: function () { tone(523, 0.14, { vol: 0.18 }); },
    go: function () { tone(784, 0.12, { vol: 0.2 }); tone(1047, 0.3, { vol: 0.2, at: 0.1 }); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.2, { vol: 0.2, at: i * 0.1 }); }); },
    lose: function () { [392, 330, 262, 196].forEach(function (f, i) { tone(f, 0.24, { type: 'sawtooth', vol: 0.08, at: i * 0.13 }); }); }
  };
  function buzz(p) {
    try { var S = window.Sowaka; if (S && S.native && S.haptic) { S.haptic(Array.isArray(p) ? 'heavy' : p >= 30 ? 'medium' : 'light'); return; } if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
  }
  function unlockAudio() { return !!ac(); }

  /* ---------- the round ---------- */
  var current = null;
  function start(o) {
    o = o || {}; css();
    if (current) current.stop();
    var mount = typeof o.mount === 'string' ? document.querySelector(o.mount) : o.mount;
    var kn = o.knights; if (!valid(kn)) throw new Error('CupKnights: no board');
    var n = kn.n, g = kn.g, N = n * n;
    var ms = function (v) { return typeof v === 'number' ? v : Date.parse(v); };
    var off = typeof o.clockOffset === 'number' ? o.clockOffset : (ms(o.serverNow) || Date.now()) - (o.receivedAt || Date.now());
    var now = function () { return Date.now() + off; };
    var startAt = ms(o.startAt) || now() + 4000, endAt = startAt + (o.roundSec || 300) * 1000;
    var cells = new Array(N).fill(0), state = 'wait', stopped = false, lastCount = -1, solved = false;
    if (o.resume && Array.isArray(o.resume.cells) && o.resume.cells.length === N) cells = o.resume.cells.map(function (v) { return v === 1 || v === 2 ? v : 0; });
    var opp = o.solo ? null : o.opponent, oppName = opp ? first(opp.name) : '';
    var root = document.createElement('div'); root.className = 'ck';
    root.innerHTML = '<div class="ck-top"><div class="ck-p"><b>You</b><small data-me></small></div><div class="ck-clk" data-clk>5:00</div>' +
      '<div class="ck-p r"><b>' + (opp ? esc(oppName) : 'No opponent') + '</b><small data-op>' + (opp ? '0 of ' + n + ' knights' : 'You play alone') + '</small></div></div>' +
      '<div class="ck-bar"><button type="button" class="ck-bt" data-snd></button><span class="ck-tag">KNIGHTS · ' + n + '×' + n + '</span><button type="button" class="ck-bt rs" data-rs>Resign</button></div>' +
      '<div class="ck-bd" data-bd role="grid" aria-label="Knights board, ' + n + ' by ' + n + '"></div><div class="ck-msg" data-msg aria-live="polite"></div>' +
      '<div class="ck-cov" data-cov></div>';
    mount.appendChild(root);
    var $ = function (k) { return root.querySelector('[data-' + k + ']'); };
    var $bd = $('bd'), $clk = $('clk'), $me = $('me'), $op = $('op'), $msg = $('msg'), $cov = $('cov'), $snd = $('snd'), $rs = $('rs');
    /* The board's size: the widest square that fits under the header and above the message. */
    var size = 0;
    function fit() {
      var w = Math.min(root.clientWidth - 32, 520), h = root.clientHeight - 210;
      var s = Math.floor(Math.max(180, Math.min(w, h)) / n); if (s === size) return; size = s;
      $bd.style.gridTemplateColumns = 'repeat(' + n + ',' + s + 'px)'; $bd.style.setProperty('--s', s + 'px');
      var bw = n >= 9 ? 3 : 4;
      for (var i = 0; i < N; i++) { var c = $bd.children[i]; c.style.cssText = 'width:' + s + 'px;height:' + s + 'px;background:' + COLS[g[i] % 9] + ';' + edges(kn, i, bw); }
    }
    var html = '';
    for (var i = 0; i < N; i++) html += '<div class="ck-c' + (LIGHT[g[i] % 9] ? ' ckl' : '') + '" data-i="' + i + '" role="gridcell"></div>';
    $bd.innerHTML = html;
    function bad() {
      var k = [], out = {};
      for (var i = 0; i < N; i++) if (cells[i] === 1) k.push(i);
      for (var a = 0; a < k.length; a++) for (var b = a + 1; b < k.length; b++) if (clashes(n, g, k[a], k[b])) { out[k[a]] = 1; out[k[b]] = 1; }
      return { k: k, bad: out };
    }
    function paint(fresh) {
      var x = bad();
      for (var i = 0; i < N; i++) {
        var c = $bd.children[i], v = cells[i], cls = 'ck-c' + (LIGHT[g[i] % 9] ? ' ckl' : '') + (v === 2 ? ' ckx' : v === 1 ? ' ckk' : '') + (x.bad[i] ? ' ckb' : '');
        if (c.className !== cls) c.className = cls;
        var has = !!c.firstChild;
        if (v === 1 && !has) c.innerHTML = '<img alt="" src="' + KNIGHT + '" draggable="false">';
        else if (v !== 1 && has) c.innerHTML = '';
        c.setAttribute('aria-label', 'Row ' + (Math.floor(i / n) + 1) + ', column ' + (i % n + 1) + (v === 1 ? ', knight' : v === 2 ? ', ×' : '') + (x.bad[i] ? ', clash' : ''));
      }
      $me.textContent = x.k.length + ' of ' + n + ' knights';
      var nb = Object.keys(x.bad).length;
      solved = x.k.length === n && !nb;
      if (state === 'play') msg(solved ? 'All ' + n + ' knights placed! Checking…' : nb ? 'Knights marked ! clash: same row, column or colour, or touching.' : 'Tap: × → knight → clear. Slide to cross out squares.', solved ? 'g' : nb ? 'w' : '');
      if (x.k.length !== lastCount || fresh) report(x.k);
      if (solved && state === 'play') { state = 'closing'; buzz([30, 40, 30]); }
    }
    var lastSent = '', sentAt = 0;
    function report(k) {
      lastCount = k.length; sentAt = now();
      var key = k.join(',');
      if (key === lastSent) return; lastSent = key;
      try { o.onLive && o.onLive(k.length, { knights: k.slice() }); } catch (e) {}
    }
    function keep() { try { o.onProgress && o.onProgress({ cells: cells.slice(), score: lastCount < 0 ? 0 : lastCount }); } catch (e) {} }
    function msg(t, cls) { $msg.textContent = t; $msg.className = 'ck-msg' + (cls ? ' ' + cls : ''); }
    function canPlay() { return state === 'play' && now() < endAt; }
    function act(i) {
      if (!canPlay()) return;
      var v = cells[i];
      cells[i] = v === 0 ? 2 : v === 2 ? 1 : 0;
      if (cells[i] === 1) { hoof(); buzz(12); } else if (cells[i] === 2) { sfx.mark(); buzz(6); } else sfx.clear();
      paint(); keep();
    }
    /* Tap and slide, as in Meow: a slide marks × on every empty square it crosses. */
    var press = null;
    function cellAt(x, y) { var e = document.elementFromPoint(x, y), c = e && e.closest ? e.closest('.ck-c') : null; return c && $bd.contains(c) ? +c.getAttribute('data-i') : -1; }
    function slide(i) { if (press.done[i]) return; press.done[i] = 1; if (cells[i] !== 0) return; cells[i] = 2; sfx.mark(); buzz(6); paint(); }
    $bd.addEventListener('pointerdown', function (e) {
      var c = e.target.closest && e.target.closest('.ck-c'); if (!c || !canPlay() || (e.button && e.button !== 0)) return;
      e.preventDefault(); unlockAudio(); press = { i: +c.getAttribute('data-i'), id: e.pointerId, moved: false, done: {} };
    });
    $bd.addEventListener('pointermove', function (e) {
      if (!press || e.pointerId !== press.id || !canPlay()) return;
      var i = cellAt(e.clientX, e.clientY); if (i < 0 || (i === press.i && !press.moved)) return;
      if (!press.moved) { press.moved = true; slide(press.i); }
      slide(i);
    });
    $bd.addEventListener('pointerup', function () { var p = press; press = null; if (!p) return; if (p.moved) { keep(); return; } act(p.i); });
    $bd.addEventListener('pointercancel', function () { var p = press; press = null; if (p && p.moved) keep(); });
    root.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    root.addEventListener('touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
    function sndLabel() { $snd.textContent = soundOn ? '🔊 Sound' : '🔇 Muted'; $snd.setAttribute('aria-pressed', soundOn ? 'true' : 'false'); }
    $snd.addEventListener('click', function () { soundOn = !soundOn; try { localStorage.setItem('cup-knights-sound', soundOn ? '1' : '0'); } catch (e) {} sndLabel(); if (soundOn) hoof(); });
    sndLabel();
    /* Resign: asked here (no window.confirm in the app), then the host tells the server. */
    $rs.addEventListener('click', function () {
      if (state !== 'play' && state !== 'wait') return;
      cover('<img class="ck-kn" alt="" src="' + KNIGHT + '"><h2>Resign this match?</h2><p>' + (opp ? esc(oppName) + ' goes through at once.' : 'You leave the tournament.') + '</p>' +
        '<button type="button" class="ck-go red" data-yes>Yes, resign</button><button type="button" class="ck-go dk" data-no>Keep playing</button><p data-err></p>');
      $cov.querySelector('[data-no]').onclick = function () { $cov.hidden = true; tick(); };
      $cov.querySelector('[data-yes]').onclick = function () {
        var b = this; b.disabled = true; b.textContent = 'Resigning…';
        Promise.resolve(o.onResign ? o.onResign() : null).then(function () { state = 'closing'; b.textContent = 'Resigned'; }).catch(function (e) {
          b.disabled = false; b.textContent = 'Yes, resign'; var p = $cov.querySelector('[data-err]'); if (p) p.textContent = (e && e.message) || 'That didn\'t reach the server. Try again.';
        });
      };
    });
    function cover(h) { $cov.innerHTML = h; $cov.hidden = false; $cov.classList.toggle('w', state === 'wait'); }
    var lastCd = -1;
    function tick() {
      if (stopped) return;
      var t = now();
      fit();
      if (state === 'wait') {
        if (t < startAt) {
          var s = Math.ceil((startAt - t) / 1000);
          if (s !== lastCd) {
            lastCd = s; if (s <= 3) sfx.count();
            if ($cov.querySelector('[data-yes]')) return;
            cover('<span class="ck-tag">' + (o.attempt ? 'REPLAY · A NEW BOARD' : 'KNIGHTS TOURNAMENT') + '</span><img class="ck-kn" alt="" src="' + KNIGHT + '"><div class="ck-big">' + s + '</div>' +
              '<p>' + (o.attempt ? 'You were level at the time. ' : '') + 'One knight in every row, column and colour. Knights never touch. First right board wins.</p>');
          }
          $clk.textContent = fmt(endAt - startAt);
          return;
        }
        state = 'play'; if (!$cov.querySelector('[data-yes]')) $cov.hidden = true; sfx.go(); buzz(20); paint(true);
      }
      var left = endAt - t;
      $clk.textContent = fmt(Math.max(0, left)); $clk.className = 'ck-clk' + (left < 30000 ? ' low' : '');
      if (state === 'play' && left <= 0) { state = 'closing'; press = null; msg('Time! The one with more knights in the right place wins…', 'w'); buzz([40, 40, 40]); }
      if ((state === 'play' || (state === 'closing' && solved)) && t - sentAt > 4000 && t < endAt + 3000) { lastSent = ''; report(bad().k); }
      if (opp && o.getOpponentLive) { var ol = o.getOpponentLive(); if (ol != null) { var tx = Math.max(0, Math.min(n, Math.round(ol))) + ' of ' + n + ' knights'; if ($op.textContent !== tx) $op.textContent = tx; } }
    }
    function fmt(m) { var s = Math.ceil(m / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    paint(); fit();
    if (now() >= startAt) { state = 'play'; paint(true); } else tick();
    var loop = setInterval(tick, 200);
    window.addEventListener('resize', fit);
    var wake = function () { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', wake);
    var shown = false;
    var handle = {
      /* The decided match (the host's S.me.match): who won, how, and how many each had right. */
      result: function (m, myId) {
        if (stopped || shown || !m || m.status !== 'done') return; shown = true; state = 'over'; press = null;
        var r = m.result || {}, right = m.right || r.right || {}, won = (m.winnerId || r.winnerId) === myId, how = m.decidedBy || r.decidedBy;
        var oid = opp && opp.userId, mine = right[myId], theirs = oid ? right[oid] : null;
        var line = how === 'finished' ? (won ? 'You placed all ' + n + ' knights first.' : esc(oppName) + ' placed all ' + n + ' knights first.' + (mine != null ? ' You had ' + mine + ' right.' : ''))
          : how === 'resigned' ? (won ? esc(oppName || 'Your opponent') + ' resigned.' : 'You resigned.')
          : how === 'solo' ? (won ? esc(oppName || 'Your opponent') + ' didn\'t show, so you go through.' : 'You didn\'t make it to the start.')
          : how === 'absent' ? 'Neither of you started, so one of you went through by the draw.'
          : how === 'replays' || (mine != null && mine === theirs) ? 'Level after the replays' + (mine != null ? ' at ' + mine + ' right' : '') + ', so one of you went through by the draw.'
          : mine != null ? 'Time up: you had ' + mine + ' right' + (theirs != null ? ', ' + esc(oppName) + ' had ' + theirs : '') + '.' : 'Time up.';
        var sol = m.knights && Array.isArray(m.knights.solution) ? m.knights.solution : null;
        if (sol) { var s = {}; sol.forEach(function (i) { s[i] = 1; }); for (var i = 0; i < N; i++) if (s[i]) $bd.children[i].classList.add('cks'); }
        (won ? sfx.win : sfx.lose)(); buzz(won ? [30, 40, 30] : 40);
        cover('<span class="ck-tag">' + esc(m.label || 'KNIGHTS TOURNAMENT') + '</span><img class="ck-kn" alt="" src="' + KNIGHT + '"><h2>' + (won ? 'YOU WON!' : 'KNOCKED OUT') + '</h2><p>' + line + '</p>' +
          (sol ? '<button type="button" class="ck-go dk" data-see>See the answer</button>' : '') + '<button type="button" class="ck-go" data-close>Back to the tournament</button>');
        var see = $cov.querySelector('[data-see]');
        if (see) see.onclick = function () { $cov.hidden = true; msg('Green squares: the right answer.', 'g'); $rs.textContent = 'Close'; $rs.onclick = function (e) { e.stopImmediatePropagation(); o.onClose && o.onClose(); }; };
        $cov.querySelector('[data-close]').onclick = function () { o.onClose && o.onClose(); };
      },
      stop: function () {
        if (stopped) return; stopped = true; state = 'stopped'; clearInterval(loop);
        window.removeEventListener('resize', fit); document.removeEventListener('visibilitychange', wake);
        if (root.parentNode) root.parentNode.removeChild(root);
        if (current === handle) current = null;
      },
      state: function () { return state; },
      score: function () { return Math.max(0, lastCount); },
      solved: function () { return solved; }
    };
    current = handle;
    return handle;
  }

  /* ---------- a board for viewers: the regions only (never the solution), with a "placed" tag ---------- */
  function boardHtml(kn, o) {
    o = o || {}; if (!valid(kn)) return ''; css();
    var n = kn.n, s = Math.max(6, Math.floor((Number(o.size) || 140) / n)), h = '';
    for (var i = 0; i < n * n; i++) h += '<i style="width:' + s + 'px;height:' + s + 'px;background:' + COLS[kn.g[i] % 9] + ';' + edges(kn, i, 2) + '"></i>';
    var col = typeof o.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(o.color) ? ';--pc:' + o.color : '';
    return '<div class="ckv"' + (o.key != null ? ' data-k="' + esc(o.key) + '"' : '') + ' style="grid-template-columns:repeat(' + n + ',' + s + 'px)' + col + '" role="img" aria-label="Knights board ' + n + ' by ' + n + (o.placed != null ? ', ' + o.placed + ' placed' : '') + '">' + h + '</div>';
  }
  function drawBoard(mount, kn, o) { var el = typeof mount === 'string' ? document.querySelector(mount) : mount; if (el) el.innerHTML = boardHtml(kn, o); return el; }

  window.CupKnights = { start: start, unlockAudio: unlockAudio, bets: bets, boardHtml: boardHtml, drawBoard: drawBoard, knight: KNIGHT, version: 1 };
})();
