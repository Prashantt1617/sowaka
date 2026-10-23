/* One Odd One Out round, played inside the tournament page (cup/page.html).
 *
 * The same game as game-pages/odd-one-out.html: the seeded boards are copied from it verbatim (the block between the seeded-boards markers),
 * and so are the scoring rules (20 a find, +10 when found within a second of the board showing, times the streak multiplier, ×1 to ×5;
 * a wrong tap costs a second of the clock and the streak). Both players of a match get one seed, so they see the same boards in the same order.
 *
 *   const h = CupPlay.start({
 *     mount,                 // element (or selector) the round fills; best a full-screen fixed box
 *     boardSeed,             // the match's seed (whole number)
 *     startAt,               // server time the round starts (ms or ISO); nothing can be tapped before it
 *     serverNow,             // server time when the response carrying startAt was made (ms or ISO)
 *     receivedAt,            // optional: Date.now() when that response arrived (default: now)
 *     clockOffset,           // optional: server minus client clock in ms; wins over serverNow/receivedAt
 *     roundSec = 45,
 *     me: { name, photoUrl? }, opponent: { name, photoUrl? } | null,   // a face in the round frame; initials when there's no photo or it fails
 *     getOpponentLive: () => number | null,   // polled 4× a second; the host keeps it fresh from /state
 *     onLive(score, progress), // on a change, at most 4× a second; progress = { board, tap?, ok? }: the board index the player is on now
 *                            // (board N of the seed), the last tile tapped and whether it was the odd one (ok: true means the tap
 *                            // found board N−1's odd tile and moved on; false, a wrong tap on board N). Viewers draw it with drawBoard.
 *     onFinal(score),        // exactly once, when the round is over (also after the app comes back from the background)
 *     onStart(),             // optional: the board just appeared
 *     onProgress(p),         // optional: after every find and miss, { score, gi, streak, cleared, miss } — the host keeps it to resume
 *     resume,                // optional: that object, after a reload mid-round: the round carries on from it (same boards onward)
 *     sound = true,
 *   });
 *   h.stop();  h.score();  h.state();   // 'wait' | 'play' | 'closing' | 'over' | 'stopped'
 *   CupPlay.unlockAudio()   // call inside the tap that joins the match, so iOS lets the countdown beep
 *   CupPlay.boardHtml(seed, n, { size, tap, ok, color, key })   // board n of a seed, read-only, as HTML (for a page that patches its DOM)
 *   CupPlay.drawBoard(mount, seed, n, opts)                      // the same, put into mount
 *
 * Input is touchstart (taken at once, no scroll or zoom), pointerdown for a mouse, click for a keyboard. A tap keeps the moment the finger
 * landed: a tap that reaches the page late (a busy phone) is judged by when it was made, both for the one-second bonus and at the buzzer
 * (the round waits a moment after time for taps made before it). No network, no dependencies. */
(function () {
  'use strict';
  if (window.CupPlay) return;

/* seeded-boards:start
   Everything a board depends on, and nothing else: board g of a round is a pure function of (seed, g), so two players given one seed see the same
   boards in the same order whatever they tap. A solo round takes a random seed; a challenge takes the server's. The Sowaka backend's check script
   (src/scripts/game-challenge-check.ts) runs this block on its own, so keep it free of anything outside it. */
const EASY=[['🐶','🐱'],['🍎','🍌'],['⭐','🌙'],['🚗','🚲'],['🌵','🌸'],['🐸','🐷'],['🍕','🍩'],['⚽','🎈'],['🐧','🦊'],['☕','🍦']];
const MED=[['🙂','🙃'],['🍊','🍑'],['🐭','🐹'],['🐻','🐨'],['🌲','🌳'],['👍','👎'],['🔒','🔓'],['🍋','🍐'],['🐯','🦁'],['🌞','🌝'],['🚕','🚗'],['👈','👉'],['🐰','🐭'],['🍓','🍒']];
const HARD=[['😀','😃'],['😐','😑'],['🕐','🕑'],['🌖','🌔'],['😮','😯'],['🔈','🔉'],['🙈','🙉'],['😺','😸'],['📪','📫'],['😛','😝'],['🕒','🕘'],['🌗','🌓'],['😄','😁'],['🐵','🙊']];
const MIRROR=['🐟','🦆','🐕','🚀','🐌','🦖','🏃','🐘','🚜','🦄','🐊','🐿'];
const sizeFor=g=>g<3?2:g<7?3:g<13?4:g<21?5:6;
function rng(a){ return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function boardAt(sd,g){
  const r=rng(sd*7919+g*104729+13), n=sizeFor(g), pick=a=>a[Math.floor(r()*a.length)];
  const roll=r(); let tier=g<4?'e':g<10?(roll<.5?'e':'m'):g<18?(roll<.5?'m':'h'):(roll<.45?'h':roll<.75?'x':'m');
  let base,odd,flip=false;
  if(tier==='x'){ base=odd=pick(MIRROR); flip=true; } else { const p=pick(tier==='e'?EASY:tier==='m'?MED:HARD); const sw=r()<.5; base=sw?p[1]:p[0]; odd=sw?p[0]:p[1]; }
  return {n,base,odd,flip,at:Math.floor(r()*n*n)};
}
/* seeded-boards:end */

  /* Scoring, as in odd-one-out.html. */
  const PENALTY = 1, QUICK = 1.0, MAXMULT = 5;
  const multFor = s => Math.min(MAXMULT, 1 + Math.floor(Math.max(0, s - 1) / 3));
  const MILE = { 5: 'On fire!', 10: 'Unstoppable!', 15: 'Machine!', 20: 'Legend!', 30: 'Unreal!' };
  const NEXT_MS = 130, NEXT_MS_REDUCED = 40;   // the pause between a find and the next board
  const LIVE_MS = 250;
  const badFace = {};                         // onLive and the opponent's score: 4× a second
  const COLS = ['#F5B82E', '#FFE08A', '#FF6B57', '#FFFFFF', '#6FD3F2', '#3DDC97'];

  const fmtn = x => Math.round(x).toLocaleString('en-IN');
  const reduce = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const first = n => String(n || '').trim().split(/\s+/)[0] || '';
  const toMs = v => { if (v == null || v === '') return NaN; if (typeof v === 'number') return v; const n = Number(v); return isFinite(n) ? n : Date.parse(v); };
  const initials = n => { const p = String(n || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); };
  const okUrl = u => typeof u === 'string' && /^(https:|data:image\/|blob:|\/)/i.test(u) ? u : '';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- look ---------- */
  const CSS = `
.cp{--bg:#15122B;--panel:#221C44;--panel2:#2A2350;--line:#3B3270;--ink:#F4F1FF;--muted:#B9B2D9;--deep:#0C0A1C;--y:#F5B82E;--yd:#B9861A;--co:#FF6B57;--cy:#6FD3F2;--gr:#3DDC97;
  --disp:"Lilita One","Arial Rounded MT Bold","Trebuchet MS",system-ui,sans-serif;--body:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  position:relative;box-sizing:border-box;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:hidden;
  padding:max(12px,env(safe-area-inset-top,0px)) 14px max(14px,env(safe-area-inset-bottom,0px));
  background:var(--bg) radial-gradient(rgba(255,255,255,.06) 1.5px,transparent 2px) 0 0/22px 22px;color:var(--ink);font-family:var(--body);
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;touch-action:none;overscroll-behavior:none}
.cp *{box-sizing:border-box}
.cp-top{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:stretch;flex-shrink:0}
.cp-p{min-width:0;padding:8px 10px 9px;border-radius:16px;background:var(--panel);border:2px solid var(--line);box-shadow:0 4px 0 var(--deep);display:flex;flex-direction:column;gap:2px;transition:border-color .2s,box-shadow .2s}
.cp-p.op{text-align:right;align-items:flex-end}
.cp-p small{font-weight:800;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);line-height:1.2}
.cp-who{display:flex;align-items:center;gap:6px;min-width:0;max-width:100%}.cp-p.op .cp-who{flex-direction:row-reverse}
.cp-face{position:relative;flex:none;width:24px;height:24px;border-radius:50%;overflow:hidden;display:grid;place-items:center;font-family:var(--disp);font-size:.62rem;color:var(--bg);background:var(--rc);border:2px solid var(--bg);box-shadow:0 0 0 2px var(--rc)}
.cp-face img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%}
.cp-vs .cp-face{width:44px;height:44px;font-size:1rem;border-width:3px;box-shadow:0 0 0 3px var(--rc)}
.cp-p b{font-weight:700;font-size:.84rem;line-height:1.2;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cp-sc{font-family:var(--disp);font-size:1.9rem;line-height:1;font-variant-numeric:tabular-nums;display:inline-block}
.cp-p.me .cp-sc{color:var(--y)} .cp-p.op .cp-sc{color:var(--co)}
.cp-p.lead.me{border-color:var(--y);box-shadow:0 4px 0 var(--deep),0 0 18px -6px var(--y)}
.cp-p.lead.op{border-color:var(--co);box-shadow:0 4px 0 var(--deep),0 0 18px -6px var(--co)}
.cp-mid{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:54px}
.cp-mid b{font-family:var(--disp);font-weight:400;font-size:2rem;line-height:1;font-variant-numeric:tabular-nums}
.cp-mid small{font-weight:800;font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.cp-mid.low b{color:var(--co)}
.cp-bar{flex-shrink:0;height:12px;border-radius:999px;background:var(--panel2);overflow:hidden;border:2px solid var(--line)}
.cp-bar i{display:block;height:100%;width:100%;border-radius:999px;background:linear-gradient(90deg,var(--cy),var(--y));transform-origin:left center;transition:transform .1s linear;will-change:transform}
.cp-bar.low i{background:var(--co)}
.cp-row{flex-shrink:0;display:flex;justify-content:space-between;align-items:center;gap:10px}
.cp-combo{display:inline-flex;align-items:baseline;gap:7px;padding:4px 12px 5px;border-radius:999px;background:var(--panel);border:2px solid var(--line);transition:border-color .2s}
.cp-combo b{font-family:var(--disp);font-weight:400;font-size:1.25rem;line-height:1}
.cp-combo small,.cp-found{font-weight:800;font-size:.64rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.cp-combo.hot{border-color:var(--y)} .cp-combo.hot b,.cp-combo.hot small{color:var(--y)}
.cp-found{font-variant-numeric:tabular-nums}
.cp-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
.cp-board{position:relative;width:300px;height:300px;--w:300px;--n:2}
.cp-grid{display:grid;grid-template-columns:repeat(var(--n),1fr);grid-auto-rows:1fr;gap:calc(var(--w)/var(--n)*.08);width:100%;height:100%}
.cp-cell{font:inherit;font-size:calc(var(--w)/var(--n)*.56);line-height:1;padding:0;margin:0;border:0;border-radius:calc(var(--w)/var(--n)*.2);background:var(--panel);
  box-shadow:0 calc(var(--w)/var(--n)*.05) 0 var(--deep);display:grid;place-items:center;color:var(--ink);cursor:pointer;min-width:0;min-height:0;overflow:hidden;
  -webkit-tap-highlight-color:transparent;touch-action:none;outline:none}
.cp-cell i{font-style:normal;display:block;pointer-events:none}
.cp-cell.flip i{transform:scaleX(-1)}
.cp-cell.ok{background:var(--gr)}
.cp-cell.no{background:var(--co)}
.cp-cell.was{outline:4px solid var(--y);outline-offset:-4px}
.cp-cell:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.cp-tick{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-family:var(--disp);font-size:calc(var(--w)*.5);line-height:1;color:var(--co);opacity:.3;pointer-events:none;z-index:1}
.cp-fx{position:absolute;left:-40px;top:-40px;pointer-events:none;z-index:3}
.cp-toasts{position:absolute;inset:0;pointer-events:none;z-index:4}
.cp-toast{position:absolute;left:50%;top:-18px;font-family:var(--disp);font-size:1.6rem;white-space:nowrap;color:var(--ink);transform:translate(-50%,0);
  text-shadow:0 2px 0 rgba(0,0,0,.55),0 0 6px rgba(0,0,0,.45);will-change:transform,opacity}
.cp-toast.big{font-size:2.5rem;color:var(--y);top:30%}
.cp-toast.bad{color:var(--co)}
.cp-cover{position:absolute;inset:-6px;border-radius:22px;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:12px;z-index:5}
.cp-cover[hidden]{display:none}
.cp-cover.end{background:rgba(21,18,43,.8)}
.cp-cover h2{margin:0;font-family:var(--disp);font-weight:400;font-size:2.2rem;line-height:1.05;text-transform:uppercase}
.cp-cover p{margin:0;color:var(--muted);font-size:.95rem;max-width:30ch}
.cp-cover p b{color:var(--ink)}
.cp-cover .cp-n{font-family:var(--disp);font-size:8rem;line-height:1;color:var(--y);text-shadow:0 7px 0 var(--yd)}
.cp-cover .cp-in{font-family:var(--disp);font-size:3.4rem;line-height:1;color:var(--cy);font-variant-numeric:tabular-nums}
.cp-cover .cp-big{font-family:var(--disp);font-size:3.6rem;line-height:1;color:var(--y);font-variant-numeric:tabular-nums}
.cp-vs{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1rem}
.cp-vs i{font-style:normal;font-family:var(--disp);font-size:.95rem;color:var(--muted)}
.cp-vs .a{color:var(--y)} .cp-vs .b{color:var(--co)}
.cp-flash{position:absolute;inset:0;background:var(--y);opacity:0;pointer-events:none;z-index:6}
@keyframes cp-rise{0%{opacity:0;transform:translate(-50%,10px) scale(.7)}18%{opacity:1;transform:translate(-50%,0) scale(1.1)}100%{opacity:0;transform:translate(-50%,-56px) scale(1)}}
@keyframes cp-pop{0%{transform:scale(.3);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes cp-okpop{50%{transform:scale(1.25)}100%{transform:scale(0);opacity:0}}
@keyframes cp-shake{20%{transform:translateX(-7px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}
@keyframes cp-beat{50%{transform:scale(1.12)}}
@keyframes cp-flashk{0%{opacity:.45}100%{opacity:0}}
@media (prefers-reduced-motion:no-preference){
  .cp-toast{animation:cp-rise 1s ease-out forwards} .cp-grid.in .cp-cell{animation:cp-pop .16s cubic-bezier(.2,1.6,.4,1) both}
  .cp-cell.ok{animation:cp-okpop .22s ease-in forwards} .cp-cell.no{animation:cp-shake .3s} .cp-cover .cp-n{animation:cp-pop .45s}
  .cp-mid.low b{animation:cp-beat .5s infinite} .cp-flash.on{animation:cp-flashk .5s ease-out}
}
@media (prefers-reduced-motion:reduce){.cp-toast{opacity:1}}
`;
  function addStyle() {
    if (document.getElementById('cupplay-css')) return;
    const s = document.createElement('style'); s.id = 'cupplay-css'; s.textContent = CSS; (document.head || document.documentElement).appendChild(s);
  }

  /* ---------- sound (Web Audio only; silent where it is blocked) ---------- */
  let AC = null, OUT = null, soundOn = true;
  function ac() {
    if (!soundOn) return null;
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        const comp = AC.createDynamicsCompressor(); OUT = AC.createGain(); OUT.gain.value = 2.2; OUT.connect(comp); comp.connect(AC.destination);
      } catch (e) { AC = null; return null; }
    }
    if (AC.state !== 'running') { try { const p = AC.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
    return AC;
  }
  function tone(f, d, o) {
    o = o || {}; const a = ac(); if (!a || a.state !== 'running') return;
    try {
      const t = a.currentTime + (o.at || 0), os = a.createOscillator(), g = a.createGain();
      os.type = o.type || 'triangle'; os.frequency.setValueAtTime(f, t); if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + d);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.vol || 0.16, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      os.connect(g); g.connect(OUT); os.start(t); os.stop(t + d + 0.03);
    } catch (e) {}
  }
  const SC = [0, 2, 4, 7, 9], nt = i => 261.63 * Math.pow(2, (SC[i % 5] + 12 * Math.min(2, Math.floor(i / 5))) / 12);
  const sfx = {
    pop(s, m) { const i = Math.min(s, 14); tone(nt(i), 0.12, { vol: .2 }); tone(nt(i) * 2, 0.09, { type: 'sine', vol: .09, at: .03 }); if (m > 1) tone(nt(i) * 1.5, 0.16, { type: 'sine', vol: .05 + m * .01, at: .05 }); },
    quick() { tone(1568, 0.06, { type: 'sine', vol: .09, at: .06 }); tone(2093, 0.1, { type: 'sine', vol: .09, at: .11 }); },
    no() { tone(150, 0.12, { type: 'square', to: 90, vol: .12 }); tone(110, 0.16, { type: 'square', to: 70, vol: .1, at: .1 }); },
    mult(m) { tone(440 * Math.pow(1.122, m * 2), 0.18, { type: 'sawtooth', to: 880 * Math.pow(1.122, m * 2), vol: .07, at: .04 }); },
    lost() { tone(330, 0.25, { type: 'sine', to: 165, vol: .09, at: .15 }); },
    grow() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.1, { vol: .13, at: .08 + i * .05 })); },
    mile() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.2, { vol: .18, at: i * .07 })); [523, 784, 1047].forEach(f => tone(f, 0.8, { type: 'sine', vol: .08, at: .4 })); },
    tick(k) { k = k || 1; tone(700 + k * 70, 0.05, { type: 'square', vol: .07 + k * .008 }); tone(350 + k * 35, 0.09, { type: 'sine', vol: .1, at: .02 }); },
    count() { tone(523, 0.14, { vol: .18 }); },
    go() { tone(784, 0.12, { vol: .2 }); tone(1047, 0.3, { vol: .2, at: .1 }); },
    timeup() { tone(196, 0.9, { type: 'sine', to: 98, vol: .22 }); tone(294, 0.9, { type: 'triangle', to: 147, vol: .12 }); },
    ahead() { tone(880, 0.09, { vol: .12 }); tone(1175, 0.16, { vol: .12, at: .08 }); },
  };
  function buzz(p) { /* The app's haptic where there is one; the browser's vibrate otherwise. */
    try { const S = window.Sowaka; if (S && S.native && S.haptic) { S.haptic(Array.isArray(p) ? 'heavy' : p >= 30 ? 'medium' : 'light'); return; } if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
  }

  /* ---------- one round ---------- */
  let current = null;

  function start(opts) {
    opts = opts || {};
    if (current) current.stop();
    addStyle();
    const mount = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    if (!mount) throw new Error('CupPlay.start: no mount');
    const seed = Math.floor(Number(opts.boardSeed));
    if (!isFinite(seed)) throw new Error('CupPlay.start: boardSeed must be a number');
    const ROUND = Math.max(5, Number(opts.roundSec) || 45);
    soundOn = opts.sound !== false;
    const onLive = typeof opts.onLive === 'function' ? opts.onLive : () => {};
    const onFinal = typeof opts.onFinal === 'function' ? opts.onFinal : () => {};
    const onStart = typeof opts.onStart === 'function' ? opts.onStart : () => {};
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
    const getOpp = typeof opts.getOpponentLive === 'function' ? opts.getOpponentLive : () => null;
    const meName = (opts.me && opts.me.name) || 'You';
    const opp = opts.opponent && opts.opponent.name ? { name: String(opts.opponent.name), photoUrl: okUrl(opts.opponent.photoUrl) } : null;
    const mePhoto = okUrl(opts.me && opts.me.photoUrl);
    const face = (name, url, col) => '<span class="cp-face" style="--rc:' + col + '" aria-hidden="true">' + esc(initials(name)) + (url ? '<img src="' + esc(url) + '" alt="" decoding="async" referrerpolicy="no-referrer" draggable="false">' : '') + '</span>';

    /* The server's clock, as this phone sees it: offset = server − client. */
    let offset = Number(opts.clockOffset);
    if (!isFinite(offset)) {
      const sn = toMs(opts.serverNow), ra = toMs(opts.receivedAt);
      offset = isFinite(sn) ? sn - (isFinite(ra) ? ra : Date.now()) : 0;
    }
    const wall = () => Date.now() + offset;
    let startWall = toMs(opts.startAt); if (!isFinite(startWall)) startWall = wall() + 3000;
    let endWall = startWall + ROUND * 1000;
    /* A tap's own moment on the server clock, from the event's stamp (performance clock), or now if the stamp is off. */
    const stampOf = e => { const n = performance.now(), t = e && e.timeStamp; return t > n - 1000 && t <= n ? t : n; };
    const wallOfStamp = t => wall() - (performance.now() - t);

    /* DOM */
    const root = document.createElement('div'); root.className = 'cp';
    root.innerHTML =
      '<div class="cp-top">' +
        '<div class="cp-p me"><small>You</small><div class="cp-who">' + face(meName, mePhoto, '#F5B82E') + '<b>' + esc(first(meName) || 'You') + '</b></div><span class="cp-sc">0</span></div>' +
        '<div class="cp-mid" role="timer" aria-label="Seconds left"><b>' + ROUND + '</b><small>sec</small></div>' +
        '<div class="cp-p op"><small>Opponent</small><div class="cp-who">' + (opp ? face(opp.name, opp.photoUrl, '#FF6B57') : '') + '<b>' + esc(opp ? first(opp.name) || 'Opponent' : 'No-show') + '</b></div><span class="cp-sc">' + (opp ? '–' : '0') + '</span></div>' +
      '</div>' +
      '<div class="cp-bar"><i></i></div>' +
      '<div class="cp-row"><span class="cp-combo"><b>×1</b><small>streak 0</small></span><span class="cp-found">0 found</span></div>' +
      '<div class="cp-stage"><div class="cp-board">' +
        '<div class="cp-grid" aria-label="Find the tile that is different"></div>' +
        '<div class="cp-tick" hidden></div><canvas class="cp-fx" aria-hidden="true"></canvas><div class="cp-toasts" aria-live="polite"></div>' +
        '<div class="cp-cover"></div>' +
      '</div></div>' +
      '<div class="cp-flash"></div>';
    mount.appendChild(root);
    /* A photo that doesn't load leaves the initials under it. */
    root.addEventListener('error', e => { const t = e.target; if (t && t.tagName === 'IMG' && t.parentNode && t.parentNode.classList.contains('cp-face')) { badFace[t.getAttribute('src')] = 1; t.remove(); } }, true);
    const q = s => root.querySelector(s);
    const $score = q('.cp-p.me .cp-sc'), $meBox = q('.cp-p.me'), $oppBox = q('.cp-p.op'), $opp = q('.cp-p.op .cp-sc');
    const $mid = q('.cp-mid'), $secs = q('.cp-mid b'), $bar = q('.cp-bar'), $barI = q('.cp-bar i');
    const $combo = q('.cp-combo'), $cx = q('.cp-combo b'), $streak = q('.cp-combo small'), $found = q('.cp-found');
    const $stage = q('.cp-stage'), $board = q('.cp-board'), $grid = q('.cp-grid'), $tick = q('.cp-tick'), $fx = q('.cp-fx'), $toasts = q('.cp-toasts');
    const $cover = q('.cp-cover'), $flash = q('.cp-flash');

    /* State, as in the game: the board index, the score, the streak. */
    let state = 'wait', gi = 0, cur = null, score = 0, streak = 0, cleared = 0, miss = 0, shownAt = 0, locked = true, lastSec = -1;
    let finalSent = false, stopped = false, lag = 0, closeAt = 0, lastTap = -1, lastOk = false;
    /* Back after a reload mid-round: the score, the board reached and the clock the misses cost, as they were. */
    const rs = opts.resume && typeof opts.resume === 'object' ? opts.resume : null;
    const int = v => Math.max(0, Math.floor(Number(v) || 0));
    if (rs) { score = int(rs.score); gi = int(rs.gi); streak = int(rs.streak); cleared = int(rs.cleared); miss = int(rs.miss); endWall -= miss * PENALTY * 1000; }
    const progress = () => { try { onProgress({ score, gi, streak, cleared, miss }); } catch (e) {} };
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!stopped) fn(); }, ms); timers.add(id); return id; };

    const fctx = $fx.getContext('2d'); let parts = [], fxOn = false, fxRaf = 0, dpr = 1;
    /* Board size: the largest square the stage holds. */
    let boardBox = null, side = 300;
    function fit() {
      const w = $stage.clientWidth, h = $stage.clientHeight;
      const s = Math.max(120, Math.floor(Math.min(w - 4, h > 120 ? h - 12 : w, 560)));
      if (s !== side) { side = s; $board.style.width = $board.style.height = s + 'px'; $board.style.setProperty('--w', s + 'px'); }
      boardBox = null; fxSize();
    }
    const box = () => boardBox || (boardBox = $board.getBoundingClientRect());
    let ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(fit); ro.observe($stage); }
    const unbox = () => { boardBox = null; };
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', unbox, { passive: true, capture: true });
    fit();

    /* Confetti, on a small canvas over the board only. */
    function fxSize() { dpr = Math.min(1.5, window.devicePixelRatio || 1); const W = side + 80; $fx.width = Math.round(W * dpr); $fx.height = Math.round(W * dpr); $fx.style.width = $fx.style.height = W + 'px'; }
    function burst(x, y, n) {
      if (reduce()) return; n = Math.min(n, 34);
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 7; parts.push({ x: x + 40, y: y + 40, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4, s: 4 + Math.random() * 5, c: COLS[i % COLS.length], life: 40 + Math.random() * 22 }); }
      if (parts.length > 120) parts = parts.slice(-120);
      if (!fxOn) { fxOn = true; fxRaf = requestAnimationFrame(fxLoop); }
    }
    function fxLoop() {
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0); fctx.clearRect(0, 0, side + 80, side + 80); parts = parts.filter(p => p.life > 0);
      for (const p of parts) { p.vy += 0.32; p.x += p.vx; p.y += p.vy; p.vx *= .985; p.life--; fctx.globalAlpha = Math.min(1, p.life / 18); fctx.fillStyle = p.c; fctx.fillRect(p.x - p.s / 2, p.y - p.s / 3, p.s, p.s * .6); }
      fctx.globalAlpha = 1;
      if (parts.length && !stopped) fxRaf = requestAnimationFrame(fxLoop); else { fxOn = false; fctx.clearRect(0, 0, side + 80, side + 80); }
    }

    /* Points over the tile: placed from the finger's own spot, so no layout is read on a tap (the board's box is kept). */
    function toast(text, cls, x, y) {
      const t = document.createElement('span'); t.className = 'cp-toast' + (cls ? ' ' + cls : ''); t.textContent = text;
      if (x != null) { t.style.left = Math.max(84, Math.min(side - 84, x)) + 'px'; t.style.top = Math.max(-10, y - 40) + 'px'; }
      $toasts.appendChild(t); later(() => t.remove(), 1050);
    }
    const bump = el => { if (reduce() || !el.animate) return; try { el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 300 }); } catch (e) {} };
    function flash() { if (reduce() || !$flash.animate) return; try { $flash.animate([{ opacity: .45 }, { opacity: 0 }], { duration: 500, easing: 'ease-out' }); } catch (e) {} }

    /* ---------- the HUD ---------- */
    let oppShown = undefined;
    function renderTime() {
      const left = state === 'wait' ? ROUND : Math.max(0, (endWall - wall()) / 1000);
      const s = Math.ceil(left);
      if ($secs.textContent !== String(s)) $secs.textContent = s;
      $barI.style.transform = 'scaleX(' + Math.min(1, left / ROUND).toFixed(4) + ')';
      const low = state !== 'wait' && left <= 10; $mid.classList.toggle('low', low); $bar.classList.toggle('low', low);
    }
    function renderCombo() {
      const m = multFor(streak + 1); $cx.textContent = '×' + m; $streak.textContent = 'streak ' + streak; $combo.classList.toggle('hot', m > 1);
      $found.textContent = cleared + ' found';
    }
    function renderLead() {
      const o = typeof oppShown === 'number' ? oppShown : null;
      $meBox.classList.toggle('lead', o != null && score > o); $oppBox.classList.toggle('lead', o != null && o > score);
    }
    function pollOpp() {
      if (!opp) return;
      let v = null; try { v = getOpp(); } catch (e) {}
      v = v == null || !isFinite(Number(v)) ? null : Math.round(Number(v));
      if (v === oppShown) return;
      oppShown = v; $opp.textContent = v == null ? '–' : fmtn(v); renderLead();
    }

    /* ---------- live score out ---------- */
    let liveSent = null, liveAt = -1e9, liveTimer = 0;
    /* The score and where the player is: the board index, and the last tap on it (or the find that left the one before). */
    const liveKey = () => score + ':' + gi + ':' + lastTap + ':' + lastOk;
    function pushLive() {
      if (finalSent || stopped || liveKey() === liveSent) return;
      const n = performance.now(), wait = LIVE_MS - (n - liveAt);
      if (wait > 0) { if (!liveTimer) liveTimer = later(() => { liveTimer = 0; pushLive(); }, wait); return; }
      liveAt = n; liveSent = liveKey();
      const p = { board: gi }; if (lastTap >= 0) { p.tap = lastTap; p.ok = lastOk; }
      try { onLive(score, p); } catch (e) {}
    }

    /* ---------- the countdown ---------- */
    let coverKey = '';
    function renderWait() {
      const ms = startWall - wall();
      if (ms <= 0) { begin(); return; }
      const k = Math.ceil(ms / 1000);
      if (k <= 3) {
        if (coverKey !== 'n' + k) { coverKey = 'n' + k; $cover.innerHTML = '<div class="cp-n">' + k + '</div>'; sfx.count(); buzz(20); }
      } else {
        const key = 'w' + k;
        if (coverKey !== key) {
          const ok = u => u && !badFace[u] ? u : '';
          const vs = '<div class="cp-vs">' + face(meName, ok(mePhoto), '#F5B82E') + '<span class="a">' + esc(first(meName) || 'You') + '</span><i>VS</i><span class="b">' + esc(opp ? first(opp.name) : 'the clock') + '</span>' + (opp ? face(opp.name, ok(opp.photoUrl), '#FF6B57') : '') + '</div>';
          const mm = Math.floor(k / 60), ss = k % 60;
          $cover.innerHTML = '<h2>Get ready</h2>' + vs + '<div class="cp-in">' + (mm ? mm + ':' + String(ss).padStart(2, '0') : ss) + '</div><p>Same boards for both of you. Tap the tile that is different.</p>';
          coverKey = key;
        }
      }
    }

    /* ---------- the round ---------- */
    function showGrid() {
      cur = boardAt(seed, gi); const n = cur.n; let html = '';
      for (let i = 0; i < n * n; i++) {
        html += '<button type="button" class="cp-cell' + (cur.flip && i === cur.at ? ' flip' : '') + '" data-i="' + i + '" aria-label="Tile ' + (Math.floor(i / n) + 1) + ', ' + (i % n + 1) + '"><i>' + (i === cur.at ? cur.odd : cur.base) + '</i></button>';
      }
      $board.style.setProperty('--n', n); $grid.className = 'cp-grid in'; $grid.innerHTML = html;
      shownAt = performance.now(); locked = false;
    }
    function begin() {
      if (state !== 'wait') return;
      state = 'play'; $cover.hidden = true; $cover.innerHTML = ''; boardBox = null;
      sfx.go(); showGrid(); renderTime(); renderCombo();
      toast('GO!', 'big');
      try { onStart(); } catch (e) {}
      liveSent = null; pushLive();
    }

    function tap(i, cell, x, y, t) {
      if (state !== 'play' && state !== 'closing') return;
      if (locked || !cur) return;
      /* After the buzzer only a tap made before it counts. */
      if (wallOfStamp(t) >= endWall) return;
      if (i !== cur.at) {
        if (cell.classList.contains('no')) return;
        miss++; const had = streak; streak = 0; endWall -= PENALTY * 1000; cell.classList.add('no'); sfx.no(); if (had >= 4) sfx.lost(); buzz([30, 40, 30]);
        toast('−' + PENALTY + ' s', 'bad', x, y); renderCombo(); renderTime(); progress(); lastTap = i; lastOk = false; pushLive(); return;
      }
      locked = true; const dt = Math.max(0, t - shownAt) / 1000, quick = dt <= QUICK; streak++; cleared++;
      const m = multFor(streak), pm = multFor(streak - 1), pts = (20 + (quick ? 10 : 0)) * m, before = score; score += pts;
      cell.classList.add('ok'); sfx.pop(streak, m); if (quick) sfx.quick(); if (m > pm && streak > 1) sfx.mult(m); buzz(m > 2 ? [15, 20, 25] : 12);
      if (x != null) burst(x, y, 8 + m * 4 + (quick ? 4 : 0));
      toast('+' + fmtn(pts) + (quick ? '  quick!' : ''), '', x, y);
      const ms = streak;
      if (MILE[ms]) later(() => { toast(MILE[ms], 'big'); sfx.mile(); flash(); buzz([40, 30, 80]); }, 120);
      else if (m > pm && streak > 1) later(() => toast('×' + m + '!', 'big'), 100);
      $score.textContent = fmtn(score); bump($score); bump($cx);
      const o = typeof oppShown === 'number' ? oppShown : null; if (o != null && before <= o && score > o) later(sfx.ahead, 250);
      renderLead(); renderCombo();
      const n0 = cur.n; gi++; lastTap = i; lastOk = true; progress(); pushLive();
      later(() => { if (state !== 'play' && state !== 'closing') return; if (sizeFor(gi) > n0) sfx.grow(); showGrid(); }, reduce() ? NEXT_MS_REDUCED : NEXT_MS);
    }

    function tick() {
      if (stopped) return;
      if (state === 'wait') { renderWait(); if (state === 'wait') return; }
      if (state === 'play') {
        const left = (endWall - wall()) / 1000, s = Math.ceil(left);
        if (s !== lastSec) {
          lastSec = s;
          if (s <= 10 && s > 0) { sfx.tick(11 - s); if (s <= 3) buzz(15); $tick.hidden = false; $tick.textContent = s; if (!reduce() && $tick.animate) { try { $tick.animate([{ transform: 'translate(-50%,-50%) scale(1.5)', opacity: .6 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: .3 }], { duration: 900, easing: 'ease-out' }); } catch (e) {} } }
          else $tick.hidden = true;
        }
        renderTime();
        if (left <= 0) {
          /* Time. A tap made before the buzzer that reaches the page a moment late still counts: wait for it, longer on a phone whose taps run late. */
          state = 'closing'; closeAt = performance.now() + Math.min(300, Math.max(100, lag + 60));
        }
      }
      if (state === 'closing') { renderTime(); if (performance.now() >= closeAt || document.hidden) finish(); }
      if (state === 'play' || state === 'closing' || state === 'wait') pollOpp();
    }

    function finish() {
      if (state === 'over' || stopped) return;
      state = 'over'; locked = true; $tick.hidden = true; renderTime();
      if (cur) { const c = $grid.children[cur.at]; if (c) c.classList.add('was'); }
      sfx.timeup(); buzz([60, 40, 160]);
      $cover.className = 'cp-cover end'; $cover.hidden = false;
      $cover.innerHTML = '<h2>Time!</h2><div class="cp-big">' + fmtn(score) + '</div><p>' + cleared + ' found' + (miss ? ' · ' + miss + ' wrong' : '') + '</p>';
      if (!finalSent) { finalSent = true; if (liveTimer) { clearTimeout(liveTimer); timers.delete(liveTimer); liveTimer = 0; } try { onFinal(score); } catch (e) {} }
      stopLoop();
    }

    /* ---------- input ---------- */
    const touchEvents = 'ontouchstart' in window;
    function cellOf(target) { const c = target && target.closest ? target.closest('.cp-cell') : null; return c && c.parentNode === $grid ? c : null; }
    function press(target, cx, cy, t) {
      const c = cellOf(target); if (!c) return;
      const n = performance.now(); lag = lag * .7 + Math.max(0, n - t) * .3;
      let x = null, y = null; if (cx != null) { const b = box(); x = cx - b.left; y = cy - b.top; }
      tap(+c.dataset.i, c, x, y, t);
    }
    function onTouch(e) {
      if (e.cancelable) e.preventDefault();
      const t = stampOf(e);
      for (let k = 0; k < e.changedTouches.length; k++) { const f = e.changedTouches[k]; press(f.target, f.clientX, f.clientY, t); }
      unlockAudio();
    }
    function onPointer(e) {
      if ((touchEvents && e.pointerType !== 'mouse') || e.button > 0) return;
      e.preventDefault(); press(e.target, e.clientX, e.clientY, stampOf(e)); unlockAudio();
    }
    function onClick(e) { if (e.detail === 0) { const c = cellOf(e.target); if (c) tap(+c.dataset.i, c, null, null, performance.now()); } }
    const noScroll = e => { if (e.cancelable) e.preventDefault(); };
    root.addEventListener('touchstart', onTouch, { passive: false });
    root.addEventListener('touchmove', noScroll, { passive: false });
    root.addEventListener('pointerdown', onPointer);
    root.addEventListener('click', onClick);
    root.addEventListener('contextmenu', noScroll);

    /* ---------- the clock loop: 20× a second while counting down (the 3-2-1 lands on the second), 10× a second in play ---------- */
    let loop = 0, loopMs = 0, oppEvery = 0;
    function runLoop(ms) { if (loopMs === ms) return; if (loop) clearInterval(loop); loopMs = ms; loop = setInterval(() => { step(); }, ms); }
    function stopLoop() { if (loop) clearInterval(loop); loop = 0; loopMs = 0; }
    function step() { tick(); if (state === 'play' && loopMs !== 100) runLoop(100); }
    /* Back from the background (or the screen waking): catch up at once; a round that ended meanwhile ends now with the score it has. */
    const wake = () => { if (!stopped) step(); };
    document.addEventListener('visibilitychange', wake);
    document.addEventListener('resume', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('focus', wake);

    renderTime(); renderCombo(); pollOpp(); if (score) $score.textContent = fmtn(score);
    $cover.hidden = false; renderWait();
    if (state === 'wait') runLoop(50); else runLoop(100);
    if (state === 'play' && endWall <= wall()) step();

    const handle = {
      stop() {
        if (stopped) return; stopped = true; state = 'stopped';
        stopLoop(); timers.forEach(clearTimeout); timers.clear(); if (fxRaf) cancelAnimationFrame(fxRaf);
        document.removeEventListener('visibilitychange', wake); document.removeEventListener('resume', wake); window.removeEventListener('pageshow', wake); window.removeEventListener('focus', wake);
        window.removeEventListener('resize', fit); window.removeEventListener('scroll', unbox, { capture: true }); if (ro) ro.disconnect();
        if (root.parentNode) root.parentNode.removeChild(root);
        if (current === handle) current = null;
      },
      score: () => score,
      state: () => state,
      found: () => cleared,
    };
    current = handle;
    return handle;
  }

  function unlockAudio() { if (!soundOn) return; const a = ac(); return !!a; }

  /* ---------- a board for viewers: board g of a seed, read-only, small ----------
     The same boardAt as the round, so a viewer sees exactly the board the player has. The odd tile is never marked (the opponent may be watching).
     opts: size (px, default 140), tap + ok (the last tap: ok false paints that tile coral; ok true flashes the board green, a find),
     color (the player's colour, for the frame), key (a data-k for a page that patches its DOM by keys: a new key replays the flash). */
  const VCSS = `
.cpv{--w:140px;--n:2;position:relative;width:var(--w);height:var(--w);padding:calc(var(--w)*.035);border-radius:calc(var(--w)*.09);background:#15122B;
  border:2px solid var(--pc,#3B3270);box-shadow:0 4px 0 #0C0A1C;box-sizing:content-box;flex:none}
.cpv-g{display:grid;grid-template-columns:repeat(var(--n),1fr);grid-auto-rows:1fr;gap:calc(var(--w)/var(--n)*.08);width:100%;height:100%}
.cpv-c{display:grid;place-items:center;border-radius:calc(var(--w)/var(--n)*.2);background:#221C44;box-shadow:0 calc(var(--w)/var(--n)*.05) 0 #0C0A1C;
  font-size:calc(var(--w)/var(--n)*.56);line-height:1;overflow:hidden;min-width:0;min-height:0}
.cpv-c i{font-style:normal;display:block}
.cpv-c.flip i{transform:scaleX(-1)}
.cpv-c.no{background:#FF6B57;animation:cpv-no .6s ease-out}
.cpv.ok::after{content:"";position:absolute;inset:-2px;border-radius:inherit;box-shadow:0 0 0 3px #3DDC97,0 0 22px #3DDC97;opacity:0;animation:cpv-ok .9s ease-out;pointer-events:none}
.cpv-n{position:absolute;right:calc(var(--w)*.03);bottom:calc(var(--w)*-.02);transform:translateY(50%);padding:1px 7px;border-radius:999px;background:var(--pc,#3B3270);color:#15122B;
  font:400 calc(max(10px,var(--w)*.075)) "Lilita One","Arial Rounded MT Bold",system-ui,sans-serif;letter-spacing:.02em}
@keyframes cpv-ok{0%{opacity:1}100%{opacity:0}}
@keyframes cpv-no{0%{transform:scale(1.15)}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.cpv-c.no,.cpv.ok::after{animation:none}.cpv.ok::after{opacity:.8}}`;
  function addViewStyle() {
    if (document.getElementById('cupplay-view-css')) return;
    const st = document.createElement('style'); st.id = 'cupplay-view-css'; st.textContent = VCSS; (document.head || document.documentElement).appendChild(st);
  }
  function boardHtml(seed, g, o) {
    o = o || {}; addViewStyle();
    seed = Math.floor(Number(seed)); g = Math.max(0, Math.floor(Number(g) || 0));
    if (!isFinite(seed)) return '';
    const b = boardAt(seed, g), n = b.n, size = Math.max(60, Math.round(Number(o.size) || 140));
    const tap = Number.isInteger(o.tap) && o.tap >= 0 && o.tap < n * n ? o.tap : -1;
    const wrong = tap >= 0 && o.ok === false && tap !== b.at, found = o.ok === true;
    let cells = '';
    for (let i = 0; i < n * n; i++) cells += '<span class="cpv-c' + (b.flip && i === b.at ? ' flip' : '') + (wrong && i === tap ? ' no' : '') + '"><i>' + (i === b.at ? b.odd : b.base) + '</i></span>';
    const col = typeof o.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(o.color) ? ';--pc:' + o.color : '';
    return '<div class="cpv' + (found ? ' ok' : '') + '"' + (o.key != null ? ' data-k="' + esc(o.key) + '"' : '') + ' style="--w:' + size + 'px;--n:' + n + col + '" role="img" aria-label="Board ' + (g + 1) + (wrong ? ', a wrong tap' : found ? ', just found one' : '') + '">' +
      '<div class="cpv-g">' + cells + '</div><span class="cpv-n" aria-hidden="true">#' + (g + 1) + '</span></div>';
  }
  function drawBoard(mount, seed, g, o) {
    const el = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if (el) el.innerHTML = boardHtml(seed, g, o);
    return el;
  }

  window.CupPlay = { start, unlockAudio, boardAt, sizeFor, multFor, boardHtml, drawBoard, version: 2 };
})();
