/* Secret Squad v2: the page. Everything it shows comes from the server's latest `squad:state` (docs/secret-squad.md, "Transport" to
   "SquadCard, Standing, Final"); the page only keeps what is local by nature: which view is open (How to play, the camera), which
   scan results and squad-complete screens were seen, and when a score started counting. The connection is behind one small
   interface, so the same page runs against the real server (live.js: socket.io, `/squad` on `/connect/socket`) and the simulated
   one (preview.js):
     NET.connect(auth, {state, fatal, online, authFailed}) -> {request(event, payload) -> Promise of ack data, sync(), close()}
   auth is {ticket} in the app, {token} in a browser after the email-code sign-in.
   The screens are the design canvas's (Landing, Lobby, Word/Word2, Hunt/Hunt2, Right/Wrong/Scanned, Break, Final), and the full
   leaderboard is drawn in the Results card's theme. Scanning only: the app's own scanner (Sowaka.scanQr), else the browser camera
   with jsQR. Typed codes are off (rules.typedCodes is false); nothing here asks for one. */
(function(){
'use strict';
if(window.__squadHopping)return;                        // live.js is reloading the page onto a copy that may reach the server

const Q=(window.__SQUAD&&typeof window.__SQUAD==='object')?window.__SQUAD:null;
const NET=window.SquadLive||window.SquadPreview||null;
const WEB=!!(Q&&Q.web&&!Q.ticket);
const TOKEN_KEY='sowaka.secretSquad.token', EMAIL_KEY='sowaka.secretSquad.email', MEMO_KEY='sowaka.secretSquad.memo2';
/* The rules as documented. A session carries its own (`session.rules`), and the page uses those; these are only for the screens
   shown before a session exists (`state.next` has no rules in it). */
const DEFAULT_RULES={right:100,wrong:-25,squadBonus:200,perMissing:100,timeBonusPerSecond:.5,dealMs:10000,qrWindowMs:20000,awayMs:60000,typedCodes:false};
const HOW_MS=3800, COUNT_DELAY=900, COUNT_MS=840, COUNT_STEPS=24;

const $=id=>document.getElementById(id);
const all=sel=>document.querySelectorAll(sel);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store={get(k){try{return window.localStorage.getItem(k);}catch(e){return null;}},set(k,v){try{window.localStorage.setItem(k,v);}catch(e){}},
  del(k){try{window.localStorage.removeItem(k);}catch(e){}}};
const memo={get(k){try{return JSON.parse(window.sessionStorage.getItem(MEMO_KEY)||'{}')[k];}catch(e){return undefined;}},
  set(k,v){try{const m=JSON.parse(window.sessionStorage.getItem(MEMO_KEY)||'{}');m[k]=v;window.sessionStorage.setItem(MEMO_KEY,JSON.stringify(m));}catch(e){}}};
const haptic=k=>{try{const S=window.Sowaka;if(S&&typeof S.haptic==='function')S.haptic(k);}catch(e){}};
const reduced=()=>{try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches||!!(window.Sowaka&&window.Sowaka.reduceMotion);}catch(e){return false;}};
let MOVE=!reduced();
function motion(){ MOVE=!reduced(); document.documentElement.classList.toggle('move',MOVE); }

/* ---------------------------------------------------------------- the clock: the server's, corrected by `now` on every state */
let skew=0;
const now=()=>Date.now()+skew;
const pad2=n=>String(n).padStart(2,'0');
function fmt(ms){ let s=Math.max(0,Math.ceil(ms/1000)); const h=Math.floor(s/3600); s-=h*3600; const m=Math.floor(s/60); s-=m*60;
  return h?h+':'+pad2(m)+':'+pad2(s):m+':'+pad2(s); }
function dayOf(ms){ const d=new Date(ms), t=new Date(now()), a=new Date(t.getFullYear(),t.getMonth(),t.getDate()).getTime(), b=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
  const diff=Math.round((b-a)/864e5); if(diff===0)return 'Today'; if(diff===1)return 'Tomorrow';
  try{ return d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}).replace(',',''); }catch(e){ return d.toDateString().slice(0,10); } }
function hm(ms){ const d=new Date(ms); let h=d.getHours(); const m=d.getMinutes(), ap=h<12?'am':'pm'; h=h%12||12; return h+':'+pad2(m)+' '+ap; }
const ord=n=>{ const v=n%100; return n+((v>10&&v<14)?'th':({1:'st',2:'nd',3:'rd'}[n%10]||'th')); };
const first=name=>String(name||'').trim().split(/\s+/)[0]||'Someone';
const shortName=name=>{ const p=String(name||'').trim().split(/\s+/); return p.length>1?p[0]+' '+p[p.length-1].charAt(0).toUpperCase()+'.':(p[0]||'Someone'); };
const hue=id=>{ let h=0; for(const c of String(id||''))h=(h*31+c.charCodeAt(0))>>>0; return h; };
const UP=w=>String(w||'').toUpperCase();
const MINUS='−';
const n0=n=>{ n=Math.round(+n||0); return (n<0?MINUS:'')+Math.abs(n).toLocaleString('en-US'); };
const sgn=n=>{ n=Math.round(+n||0); return (n<0?MINUS:'+')+Math.abs(n).toLocaleString('en-US'); };
const sizeLabel=n=>(+n===2?'pairs':'squads of '+(n|0));
const plural=(n,one,many)=>(n===1?one:many);
/* A word's font size so its widest part fits `width` px: measured in Lexend at that weight and letter-spacing (em), so a word is
   never split mid-word; words of two or more parts wrap at the spaces. */
const measure=document.createElement('canvas').getContext('2d');
function emWidth(s,weight,ls){ try{ measure.font=(weight||800)+' 100px Lexend,system-ui,sans-serif'; return measure.measureText(s).width/100+String(s).length*(ls||0); }catch(e){ return String(s).length*.8; } }
const fitPx=(w,max,width,min,weight,ls)=>{ const em=Math.max(.5,...String(w||'').split(/\s+/).filter(Boolean).map(x=>emWidth(x,weight||800,ls==null?.05:ls)));
  return Math.max(min||9,Math.min(max,Math.floor(width/em*2)/2)); };

/* ---------------------------------------------------------------- what the page holds */
let st=null, lastV=-1, lastSid=null;           // the latest squad:state, its version and session
let conn=null, online=true, offlineSince=0, fatal=null, connecting=false;
const ui={mode:'main', sending:false, how:null, board:null, toast:null, toastT:0, camFailed:false, scanHint:'', counts:{}, known:{}, seenFaces:{},
  seen:memo.get('seen')||{}, seenDone:memo.get('done')||{}, seenNotice:{}, lastQr:null, opening:0,
  signin:{step:'email', email:store.get(EMAIL_KEY)||'', otp:'', busy:false, error:'', note:''}};
let token=WEB?store.get(TOKEN_KEY):null;

const S_=()=>st&&st.session||null;
const R_=()=>{ const s=S_(); return s&&s.round||null; };
const ME_=()=>{ const r=R_(); return r&&r.me||null; };
const SQ_=()=>{ const r=R_(); return r&&r.squad||null; };
const rules=()=>{ const s=S_(); return Object.assign({},DEFAULT_RULES,(s&&s.rules)||{}); };
const roundsCfg=()=>{ const s=S_(); return (s&&Array.isArray(s.rounds)&&s.rounds)||(st&&st.next&&Array.isArray(st.next.rounds)&&st.next.rounds)||[]; };
const cfg=i=>roundsCfg()[i]||{};
const roundKey=()=>{ const s=S_(), r=R_(); return s?s.id+':'+(r?r.index:s.roundIndex|0):''; };
const office=()=>(st&&st.office)||'';
const meId=()=>st&&st.me&&st.me.userId||'';
const roundNo=()=>{ const s=S_(); return s?(s.roundNumber||((s.roundIndex|0)+1)):1; };
const roundCount=()=>{ const s=S_(); return s?(s.roundCount||(s.rounds||[]).length||1):(roundsCfg().length||1); };
const halfPoint=tb=>(+tb===.5?'½ point':(+tb===1?'1 point':(+tb)+' points'));
function seenSave(){ const keys=Object.keys(ui.seen); if(keys.length>80)for(const k of keys.slice(0,keys.length-80))delete ui.seen[k]; memo.set('seen',ui.seen); memo.set('done',ui.seenDone); }

/* ---------------------------------------------------------------- icons */
const svg=(w,h,body,extra)=>'<svg width="'+w+'" height="'+h+'" viewBox="0 0 24 24" aria-hidden="true" '+(extra||'')+'>'+body+'</svg>';
const IC={
  bolt:(c,s)=>svg(s||14,s||14,'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>','fill="'+(c||'#FFE27A')+'"'),
  clock:(c,s)=>svg(s||15,s||15,'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>','fill="none" stroke="'+(c||'#FFCC2E')+'" stroke-width="2.4" stroke-linecap="round"'),
  check:(c,s,w)=>svg(s||16,s||16,'<path d="M5 12.5l4.5 4.5L19 7.5"/>','fill="none" stroke="'+c+'" stroke-width="'+(w||3)+'" stroke-linecap="round" stroke-linejoin="round"'),
  x:(c,s,w)=>svg(s||14,s||14,'<path d="M6 6l12 12M18 6 6 18"/>','fill="none" stroke="'+c+'" stroke-width="'+(w||3.2)+'" stroke-linecap="round"'),
  lock:(c,s)=>svg(s||15,s||15,'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>','fill="none" stroke="'+(c||'#8A88A0')+'" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'),
  people:(c,s,w)=>svg(s||20,s||20,'<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14.5 20a4.5 4.5 0 0 1 7-3.7"/>','fill="none" stroke="'+c+'" stroke-width="'+(w||2.2)+'" stroke-linecap="round" stroke-linejoin="round"'),
  scan:(c,s)=>svg(s||24,s||24,'<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>','fill="none" stroke="'+c+'" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"'),
  bulb:()=>svg(22,22,'<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>','fill="none" stroke="#C99A00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
  close:(c)=>svg(18,18,'<path d="M6 6l12 12M18 6 6 18"/>','fill="none" stroke="'+(c||'#3D4259')+'" stroke-width="2.2" stroke-linecap="round"'),
  back:()=>svg(20,20,'<path d="M15 5l-7 7 7 7"/>','fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'),
  crown:(w,h,cls)=>'<svg class="'+(cls||'')+'" width="'+w+'" height="'+h+'" viewBox="0 0 28 22" aria-hidden="true"><path d="M2 6l6 6 6-10 6 10 6-6-2 14H4z" fill="#FFCC2E" stroke="#C99A00" stroke-width="1.5" stroke-linejoin="round"/><circle cx="14" cy="2.5" r="2" fill="#E8434F"/></svg>',
  arrow:()=>'<svg width="34" height="24" viewBox="0 0 34 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h26M20 4l9 8-9 8"/></svg>',
};

/* ---------------------------------------------------------------- small pieces of markup */
const PAL=['#FFD6DA','#CDE3FF','#BFE6C8','#FFE8A3','#D9D2FF','#FFC9A8'];
/* A face: the photo if there is one (root-relative or https only), else the initials on a colour of their own. */
function av(p,cls){ p=p||{}; const mine=!!meId()&&p.userId===meId();
  const ini=String(p.initials||first(p.name).charAt(0)||'?').slice(0,2).toUpperCase();
  const img=p.photoUrl&&/^(https:\/\/|\/(?!\/))/.test(p.photoUrl)?'<img alt="" src="'+esc(p.photoUrl)+'">':'';
  return '<span class="av'+(mine?' me':'')+(cls?' '+cls:'')+'" style="--avbg:'+PAL[hue(p.userId||p.name)%PAL.length]+'" aria-hidden="true">'+esc(ini)+img+'</span>'; }
const T=at=>'<span class="num" data-tick data-cd="'+(+at||0)+'"></span>';
const ptsPill=(v,cls)=>'<span class="pill pts num'+(cls?' '+cls:'')+'" aria-label="'+esc(n0(v))+' points">'+IC.bolt()+'<span>'+esc(n0(v))+'</span> pts</span>';
const clockPill=at=>'<span class="pill clk num" data-lowat="'+(+at||0)+'" role="timer" aria-label="Round clock">'+IC.clock()+T(at)+'</span>';
const top=(l,c,r)=>'<div class="top">'+(l||'<span class="sp"></span>')+(c!=null?'<span class="ttl">'+c+'</span>':'')+(r||'<span class="sp"></span>')+'</div>';
const btn=(label,act,cls,extra)=>'<button type="button" class="cta'+(cls?' '+cls:'')+'" data-act="'+act+'"'+(extra||'')+'>'+label+'</button>';
const howBtn=()=>btn('How to play','how','ghost',' aria-haspopup="dialog"');
const signOutPill=()=>WEB?'<button type="button" class="pill out" data-act="signout">Sign out</button>':'<span class="sp"></span>';
function foot(){ if(!WEB)return ''; const me=st&&st.me; return '<div class="foot">'+(me&&me.name?'<span>Playing as '+esc(me.name)+' in a browser</span>':'<span>In a browser</span>')+'</div>'; }
/* The envelope from the feed card. */
function envelope(words){ const w=(words||['MARS','KITKAT','MUNCH','?']).slice(0,4);
  return '<div class="env-wrap" aria-hidden="true"><span class="spark" style="left:2px;top:22px;animation-delay:.2s"></span><span class="spark" style="right:0;top:8px;animation-delay:1.1s;width:8px;height:8px"></span>'+
    '<span class="spark" style="right:6px;top:84px;animation-delay:1.7s;width:7px;height:7px"></span><div class="env-float"><div class="env-back"></div><div class="env-card">'+
    w.map((x,i)=>'<i'+(i===3?' style="color:#E8434F;font-size:22px"':'')+'>'+esc(x)+'</i>').join('')+'</div><div class="env-front"></div><div class="env-flap"></div><div class="env-seal">S</div><span class="env-stamp">TOP SECRET</span></div><div class="env-shadow"></div></div>'; }
function rays(){ return '<div class="rays" aria-hidden="true"></div>'; }
function confetti(){ const c=['#FFCC2E','#FF9EB5','#C6F432','#8FD3FF','#FFCC2E','#FF9EB5'], d=[0,1.1,.4,1.8,.9,1.5];
  return c.map((x,i)=>'<span class="conf" aria-hidden="true" style="left:'+(8+i*15.6).toFixed(0)+'%;background:'+x+';animation-delay:'+d[i]+'s"></span>').join(''); }
/* A score that counts from `from` to `to` a beat after the screen opens (tick() writes it; none of that with reduced motion). */
function countUp(key,from,to){ if(!ui.counts[key])ui.counts[key]=Date.now();
  return '<span class="num v" data-tick data-count="'+esc(key)+'|'+(+from||0)+'|'+(+to||0)+'">'+esc(n0(MOVE?from:to))+'</span>'; }

/* ---------------------------------------------------------------- scanning: the app's scanner, else the browser's camera */
const canNativeScan=()=>{ const S=window.Sowaka; return !!(S&&typeof S.scanQr==='function'); };
const canCamera=()=>!ui.camFailed&&!(window.Sowaka&&window.Sowaka.native)&&!!(navigator.mediaDevices&&typeof navigator.mediaDevices.getUserMedia==='function')&&
  window.isSecureContext!==false&&typeof window.jsQR==='function';
const canScan=()=>canNativeScan()||canCamera();
const canClose=()=>{ const S=window.Sowaka; return !!(S&&typeof S.close==='function'); };

/* ---------------------------------------------------------------- the full leaderboard (board:<session>, or #board on the web) */
const boardWanted=()=>{ try{ const w=String((window.Sowaka&&window.Sowaka.startChallengeId)||'');
  if(/^board(:|$)/.test(w))return w.slice(6); if(/^#board/.test(location.hash))return location.hash.slice(7); }catch(e){} return null; };
let boardChecked=false;
function wantBoard(){ if(boardChecked)return; const id=boardWanted(); if(id===null)return; boardChecked=true; ui.board={sessionId:id, asked:false, data:null, error:null}; }
wantBoard();
function loadBoard(){ const b=ui.board; if(!b||b.asked||!conn)return; b.asked=true;
  request('squad:board',b.sessionId?{sessionId:b.sessionId}:{}).then(d=>{ if(ui.board===b){ b.data=d||{}; render(); } })
    .catch(e=>{ if(ui.board===b){ b.error=e.message||'The leaderboard didn’t load.'; render(); } }); }

/* ---------------------------------------------------------------- which screen */
/* The last scan I took part in, shown once per id (the server sends it to both phones); Right and Wrong only ("already" is a toast). */
function pendingScan(){ const s=S_(), r=R_(); const x=r&&r.scan; if(!s||!x||!x.id||ui.seen[x.id])return null;
  if(x.result!=='right'&&x.result!=='wrong')return null;
  if(!['hunt','break','over'].includes(s.status))return null;
  if(x.at&&now()-x.at>(s.status==='hunt'?120000:45000))return null; return x; }
/* Squad complete: once per round, when `squad.complete` first appears (for the round's last squad it arrives with the break). */
function pendingDone(){ const s=S_(), q=SQ_(); const c=q&&q.complete; if(!s||!c||ui.seenDone[roundKey()])return null;
  if(s.status==='hunt')return c; if((s.status==='break'||s.status==='over')&&now()-(+c.at||0)<60000)return c; return null; }

function view(){
  if(fatal)return vFatal();
  if(WEB&&!token)return vSignin();
  if(ui.board&&st)return vBoard();
  if(!st)return vConnecting();
  const s=S_();
  if(!s)return vLanding();
  if(s.status==='cancelled')return vCancelled();
  if(s.status==='lobby')return s.joined?vLobby():vLanding();
  if(!s.joined)return s.status==='over'?vFinal():vLanding();
  const x=s.playing&&pendingScan(); if(x)return vResult(x);
  const c=pendingDone(); if(c)return vDone(c);
  if(s.status==='over')return vFinal();
  if(s.status==='break')return vBreak();
  if(!s.playing||!R_()||!ME_())return vWaiting();
  if(s.status==='dealing')return vReveal();
  if(s.status==='hunt')return ui.mode==='scan'?vScan():vHunt();
  return vWaiting();
}

/* ---------------------------------------------------------------- the quiet screens */
function vConnecting(){ return {key:'connecting',tc:'#5B4BD6',html:'<div class="scr"><section class="hero fill" style="justify-content:center">'+envelope()+
  '<h1 class="ph" tabindex="-1">Secret Squad</h1><p class="lob-note">Connecting…</p></section></div>'}; }
function vFatal(){ return {key:'fatal',tc:'#5B4BD6',html:'<div class="scr"><section class="hero" style="padding-bottom:60px">'+top(null,'Secret Squad')+
  '<div class="qmark">'+IC.x('#D0283E',52,3)+'</div><h1 class="ph" tabindex="-1">'+esc(fatal.title||'Can’t play right now')+'</h1></section>'+
  '<section class="panel fill"><p class="s" style="text-align:center">'+esc(fatal.message)+'</p>'+(WEB&&token?'<button type="button" class="link" data-act="signout">Sign out</button>':'')+'</section></div>'}; }
function vSignin(){ const g=ui.signin, otp=g.step==='otp';
  return {key:'signin:'+g.step,tc:'#5B4BD6',html:'<div class="scr"><section class="hero" style="padding-bottom:56px">'+top('<span class="pill web">BROWSER</span>','Secret Squad','<span class="sp" style="width:72px"></span>')+envelope()+
    '<h1 class="ph" tabindex="-1">Sign in to play</h1><p class="lob-note" style="margin-top:0">Use the email you use for Sowaka.</p></section>'+
    '<section class="panel fill">'+
    '<input class="field" id="em" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@company.com" aria-label="Work email"'+(g.busy?' disabled':'')+'>'+
    (otp?btn('Send a new code','send','ghost',g.busy?' disabled':''):btn(g.busy?'Sending…':'Email me a code','send','',g.busy?' disabled':''))+
    (otp?'<p class="s">'+(g.note?esc(g.note)+' ':'')+'Then enter the code:</p>'+
      '<label class="otp"><span class="sr">6-digit code</span><div class="digits" id="otpbox" aria-hidden="true">'+'<span data-tick></span>'.repeat(6)+'</div>'+
      '<input id="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*"'+(g.busy?' disabled':'')+'></label>'+
      btn(g.busy?'Checking…':'Sign in','verify','',' id="vbtn" disabled'):'')+
    (g.error?'<p class="err" role="alert">'+esc(g.error)+'</p>':'')+
    '<p class="s" style="text-align:center;margin-top:auto">You stay signed in on this phone</p></section></div>'}; }
function vCancelled(){ const s=S_(), n=st.next;
  return {key:'cancelled',tc:'#5B4BD6',html:'<div class="scr"><section class="hero" style="padding-bottom:60px">'+top(null,esc(office()||'Secret Squad'),signOutPill())+
    '<div class="qmark">'+IC.x('#D0283E',52,3)+'</div><h1 class="ph" tabindex="-1">Called off</h1><p class="lob-note" style="margin-top:0">'+esc(s.cancelReason||'This Secret Squad was called off.')+'</p></section>'+
    '<section class="panel fill"><div class="info one"><div class="l"><span class="k">What happens now</span><span class="s">No points go to the leaderboard for this game.</span></div></div>'+
    (n&&n.startsAt?'<div class="info one"><div class="l"><span class="k">Next game</span><span class="big sm">'+esc(dayOf(n.startsAt))+' · '+esc(hm(n.startsAt))+'</span></div></div>':'')+howBtn()+foot()+'</section></div>'}; }

/* ---------------------------------------------------------------- Landing: the game screen (Landing.dc.html) */
/* The squad art: mixed-up words fly into their groups, light up and get linked. Illustration, not data. */
function squadArt(){ const tag=(top,label,col)=>'<span class="tagp lnk" style="top:'+top+'px"><span style="color:'+col+'">'+IC.check(col,13,3.2)+label+'</span></span>';
  const sq=(cls,l,t,sx,sy,r,w)=>'<span class="sq '+cls+'" style="left:'+l+'px;top:'+t+'px;--sx:'+sx+'px;--sy:'+sy+'px;--r:'+r+'deg"><span>'+w+'</span></span>';
  return '<div class="art" role="img" aria-label="Words in the same category make one squad: Dog, Cat and Parrot are Pets; Mars, KitKat and Munch are Chocolates">'+
    '<svg width="350" height="280" viewBox="0 0 350 280" aria-hidden="true" style="position:absolute;inset:0"><g class="lnk" style="transform-origin:175px 75px"><path d="M98 75h34M218 75h34" stroke="#FFCC2E" stroke-width="5" stroke-linecap="round"/></g>'+
    '<g class="lnk" style="transform-origin:175px 215px"><path d="M98 215h34M218 215h34" stroke="#FF9EB5" stroke-width="5" stroke-linecap="round"/></g></svg>'+
    tag(18,'PETS','#7A5600')+tag(158,'CHOCOLATES','#A3264A')+
    sq('pets',8,54,250,128,-10,'DOG')+sq('pets',130,54,-120,140,8,'CAT')+sq('pets',252,54,-230,70,-6,'PARROT')+
    sq('choc',8,194,130,-150,9,'MARS')+sq('choc',130,194,124,-122,-8,'KITKAT')+sq('choc',252,194,-118,-96,6,'MUNCH')+'</div>'; }
function roundsLine(rounds){ if(!rounds||!rounds.length)return ''; const sizes=rounds.map(r=>r.squadSize|0).filter(Boolean), uniq=[...new Set(sizes)];
  const sz=uniq.length===1?sizeLabel(uniq[0]):'squads of '+sizes.join(', then ');
  return '<b>'+(rounds.length===1?'1 round':rounds.length+' rounds')+'</b> · '+esc(sz); }
function vLanding(){
  const s=S_(), n=st.next, o=office();
  let mode='none';
  if(s&&s.status==='lobby')mode='open'; else if(s&&['dealing','hunt','break'].includes(s.status))mode='live'; else if(n&&n.startsAt)mode='soon';
  let info='', join='';
  if(mode==='open'||mode==='soon'){
    const starts=mode==='open'?s.startsAt:n.startsAt, opens=mode==='open'?s.lobbyOpensAt:(n.lobbyOpensAt||n.startsAt), far=starts-now()>864e5;
    const left='<div class="l"><span class="k">'+(far?'Next game':'Game starts in')+'</span><span class="big num'+(far?' sm':'')+'">'+(far?esc(dayOf(starts))+'<br>'+esc(hm(starts)):T(starts))+'</span></div>';
    let right;
    if(mode==='open'){ const faces=(Array.isArray(s.faces)?s.faces:[]).slice(0,4);
      right='<div class="r">'+(faces.length?'<div class="stack">'+faces.map(f=>av(f)).join('')+'</div>':'')+'<span class="t"><b class="num">'+(s.players|0)+'</b> '+plural(s.players|0,'person','people')+' waiting</span></div>'; }
    else right='<div class="r"><span class="t">'+roundsLine(n.rounds)+'</span><span class="t">The lobby opens '+Math.max(1,Math.round((starts-opens)/60000))+' min before</span></div>';
    info='<div class="info">'+left+right+'</div>';
    if(mode==='open')join=btn('Join lobby','join','',ui.sending?' disabled':'');
    else { const farOpen=opens-now()>864e5;
      join='<button type="button" class="cta locked" disabled aria-label="Join lobby, locked until the lobby opens"><span class="l1">'+IC.lock()+'Join lobby</span><span class="l2 num">'+
        (farOpen?'Opens '+esc(dayOf(opens))+' '+esc(hm(opens)):'<span data-tick data-opens="'+opens+'"></span>')+'</span></button>'; }
  } else if(mode==='live'){
    const r=R_(), clk=s.clock||{}, at=clk.huntEndsAt||clk.revealEndsAt||clk.breakEndsAt||s.phaseEndsAt;
    const k=s.status==='break'?'Next round in':s.status==='dealing'?'Hunt starts in':'Round ends in';
    info='<div class="info"><div class="l"><span class="k">'+k+'</span><span class="big num">'+T(at)+'</span></div><div class="r"><span class="t"><b>Round '+roundNo()+' of '+roundCount()+'</b> is on</span>'+
      '<span class="t"><b class="num">'+(s.players|0)+'</b> '+plural(s.players|0,'person','people')+' playing'+(r&&r.board&&r.board.squads?' · '+(r.board.complete|0)+' of '+r.board.squads+' squads done':'')+'</span></div></div>';
    const nextNo=roundNo()+1, last=nextNo>roundCount();
    join=last?'<button type="button" class="cta locked" disabled><span class="l1">Last round</span><span class="l2">Join the next game</span></button>':btn('Join for round '+nextNo,'join','',ui.sending?' disabled':'');
  } else {
    info='<div class="info one"><div class="l"><span class="k">No game scheduled</span><span class="s">'+(o?'Nothing is on the calendar for '+esc(o)+' yet. ':'')+'A post on the feed will say when the next Secret Squad is.</span></div></div>';
  }
  return {key:'landing:'+mode,tc:'#5B4BD6',html:'<div class="scr">'+
    '<header class="bar1"><span class="sp"></span><span class="ttl">'+esc(o||'Games')+'</span>'+signOutPill()+'</header>'+
    '<section class="hero fill" aria-label="Secret Squad" style="padding:0 20px 46px;justify-content:center;gap:6px">'+squadArt()+
      '<h1 class="land-h" tabindex="-1">Secret Squad</h1><p class="land-s">Same category is same squad – find your squad mates!</p></section>'+
    '<section class="panel" aria-label="Join the game">'+info+
      (join?'<div class="btn2" style="margin-top:4px">'+join+howBtn()+'</div>':howBtn())+foot()+'</section></div>'};
}

/* ---------------------------------------------------------------- Lobby (Lobby.dc.html) */
const RING_C=2*Math.PI*86;
function ring(label,at,from,cls){ return '<div class="ring'+(cls?' '+cls:'')+'" role="timer" aria-label="'+esc(label)+'"><svg width="196" height="196" viewBox="0 0 196 196" aria-hidden="true">'+
  '<circle cx="98" cy="98" r="86" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.14)" stroke-width="12"/>'+
  '<circle cx="98" cy="98" r="86" fill="none" stroke="#FFCC2E" stroke-width="12" stroke-linecap="round" data-ring="'+(+from||0)+'|'+(+at||0)+'|'+RING_C.toFixed(1)+'" stroke-dasharray="0 '+RING_C.toFixed(1)+'" transform="rotate(-90 98 98)"/></svg>'+
  '<div class="ri"><span class="k">'+esc(label)+'</span><span class="v tick num">'+T(at)+'</span></div></div>'; }
function facesGrid(s){ const mine=meId(), list=(Array.isArray(s.faces)?s.faces:[]).filter(f=>f.userId!==mine).slice(0,12);
  const known=ui.seenFaces[s.id]||(ui.seenFaces[s.id]={});
  const me=st.me||{};
  const cells=['<li class="you">'+av({userId:me.userId,name:me.name,initials:me.initials,photoUrl:me.photoUrl})+'<span class="n">You</span></li>'].concat(list.map((f,i)=>{
    if(!known[f.userId])known[f.userId]=Date.now(); const fresh=Date.now()-known[f.userId]<2000;
    return '<li class="'+(fresh?'hop':'')+'" style="animation-delay:'+(.15+i*.07).toFixed(2)+'s" data-key="'+esc(f.userId)+'">'+av(f)+'<span class="n">'+esc(first(f.name))+'</span></li>'; }));
  const more=Math.max(0,(s.players|0)-1-list.length);
  return '<ul class="faces" aria-label="People in the lobby">'+cells.join('')+'</ul>'+(more?'<span class="more">and <b class="num">'+more+'</b> more</span>':''); }
function vLobby(){ const s=S_();
  return {key:'lobby',tc:'#5B4BD6',html:'<div class="scr"><section class="hero" aria-label="Lobby" style="padding-bottom:58px">'+top(null,'Secret Squad',signOutPill())+
    '<span class="pill in" style="margin-top:4px">'+IC.check('#C6F432',16,3)+'You’re in!</span>'+
    ring('Round 1 starts in',s.startsAt,s.lobbyOpensAt)+
    '<p class="lob-note">Stay here. Your secret word is coming!</p></section>'+
    '<section class="panel fill" aria-label="People in the lobby" style="margin-top:-34px;padding:20px 16px calc(24px + var(--padb));gap:12px">'+
      '<div class="lob-h"><h2 tabindex="-1"><span class="num">'+(s.players|0)+'</span> '+plural(s.players|0,'person','people')+' here</h2><span class="joining"><span class="dot live"></span>More joining</span></div>'+
      facesGrid(s)+
      '<div class="btn2 eq" style="margin-top:auto;padding:0 4px">'+howBtn()+btn('Leave lobby','leave','quiet',ui.sending?' disabled':'')+'</div>'+foot()+'</section></div>'}; }

/* Joined, but this round was dealt before you came: you play from the next one. */
function vWaiting(){ const s=S_(), r=R_(), clk=s.clock||{}, c=cfg(s.roundIndex|0), R=rules();
  const at=clk.huntEndsAt||clk.revealEndsAt||s.phaseEndsAt, from=clk.huntEndsAt?(r&&r.huntStartsAt||at-(c.huntMs||0)):(at-(R.dealMs||10000));
  const next=roundNo()+1, last=next>roundCount();
  return {key:'waiting:'+roundKey(),tc:'#5B4BD6',html:'<div class="scr"><section class="hero" style="padding-bottom:58px">'+top(null,'Secret Squad',ptsPill(s.totalPoints))+
    '<span class="pill in" style="margin-top:4px">'+IC.check('#C6F432',16,3)+(last?'You’re in':'You’re in for round '+next)+'</span>'+
    ring(clk.huntEndsAt?'Round '+roundNo()+' ends in':'Round '+roundNo()+' hunt starts in',at,from)+
    '<p class="lob-note">'+(last?'You joined during the last round. The results come when it ends.':'Round '+roundNo()+' was dealt before you joined. Your word comes when round '+next+' starts.')+'</p></section>'+
    '<section class="panel fill">'+(r&&r.board&&r.board.squads?'<p class="boardline"><b>'+(r.board.complete|0)+' of '+r.board.squads+'</b> squads done in '+esc(office())+' · '+(r.board.hunting|0)+' still hunting</p>':'')+
      howBtn()+foot()+'</section></div>'}; }

/* ---------------------------------------------------------------- the word reveal (Word.dc.html, Word2.dc.html) */
function badgeText(){ const s=S_(), size=(R_()&&R_().squadSize)||cfg(s.roundIndex|0).squadSize;
  return 'ROUND '+roundNo()+(roundCount()>1?' OF '+roundCount():'')+(size?' · '+UP(sizeLabel(size)):''); }
function vReveal(){ const s=S_(), me=ME_(), q=SQ_()||{}, R=rules(), clk=s.clock||{}, at=clk.revealEndsAt||s.phaseEndsAt;
  const word=UP(me.word), more=Math.max(1,(q.size||cfg(s.roundIndex|0).squadSize||2)-1);
  const bonus=q.bonus!=null?q.bonus:R.squadBonus;
  const burst=[[-130,-90,-200,'#FFCC2E'],[130,-100,220,'#C6F432'],[-150,10,160,'#FF9EB5'],[150,0,-170,'#8FD3FF'],[-70,-140,260,'#FFFFFF'],[80,-150,-240,'#FFCC2E']]
    .map(b=>'<i style="--x:'+b[0]+'px;--y:'+b[1]+'px;--r:'+b[2]+'deg;background:'+b[3]+'"></i>').join('');
  return {key:'reveal:'+roundKey(),tc:'#4A3BC2',html:'<div class="scr"><section class="hero night fill" aria-label="Your secret word" style="padding-bottom:46px">'+
    '<div class="top" style="padding:6px 4px 0"><span class="ttl l rv-name">Secret Squad</span>'+
      '<span class="cdpill" role="timer" aria-label="Hunt starts in"><span class="k">Hunt<br>starts in</span><span class="c"><span class="num" data-tick data-secs="'+(+at||0)+'"></span></span></span>'+ptsPill(s.totalPoints)+'</div>'+
    '<span class="pill yel" style="margin-top:8px">'+esc(badgeText())+'</span>'+
    '<h1 class="rv-h" tabindex="-1">'+(roundNo()===1?'Game on!':'New round, new word!')+'</h1>'+
    '<div class="stage"><div class="burst" aria-hidden="true">'+burst+'</div>'+
      '<div class="wordcard"><span class="k">YOUR SECRET WORD</span><span class="w wobble" style="font-size:'+fitPx(word,72,230,22)+'px">'+esc(word)+'</span></div>'+
      '<div class="env" aria-hidden="true"><div class="env-back"></div><div class="env-front"></div><div class="env-flap"></div><span class="env-stamp">TOP SECRET</span></div></div></section>'+
    '<section class="panel" aria-label="Get ready" style="margin-top:-32px;padding:18px 20px calc(22px + var(--padb));gap:10px">'+
      '<h2 class="find">Find <span>'+more+' more '+plural(more,'person','people')+'</span> with the same category</h2>'+
      '<div class="rules2"><div class="rule ok"><span class="k">'+IC.check('#1F9E3A',15,3.2)+'Right match</span><span class="v num">'+esc(sgn(R.right))+'</span><span class="s">Whoever scans, you both get it</span></div>'+
        '<div class="rule no"><span class="k">'+IC.x('#D0283E',13,3.4)+'Wrong match</span><span class="v num">'+esc(sgn(R.wrong))+'</span><span class="s">Whoever scans, you both lose it</span></div></div>'+
      '<div class="bonusrow"><span class="ic">'+IC.people('#5B4BD6')+'</span><span class="t">Whole squad found? <b>Everyone</b> gets a squad bonus<small>plus '+esc(halfPoint(R.timeBonusPerSecond))+' for every second left</small></span><span class="v num">'+esc(sgn(bonus))+'</span></div>'+
    '</section></div>'}; }

/* ---------------------------------------------------------------- the hunt (Hunt.dc.html, Hunt2.dc.html) */
/* Your squad's circles: you, everyone you've linked (word and name), away teammates' words, and a ? for each still to find. */
function slotsOf(q,me){ const rk=roundKey(), known=ui.known[rk]||(ui.known[rk]={});
  const members=(Array.isArray(q.members)?q.members:[]).slice().sort((a,b)=>(b.me?1:0)-(a.me?1:0));
  const out=[];
  for(const m of members){ if(!known[m.userId])known[m.userId]=Date.now(); const isNew=!m.me&&Date.now()-known[m.userId]<2000; out.push({kind:m.me?'me':(m.away?'away':'mate'),word:m.word||(m.me&&me&&me.word)||'',name:m.me?'You':first(m.name),isNew,id:m.userId}); }
  for(const a of (Array.isArray(q.awayMembers)?q.awayMembers:[]))out.push({kind:'away',word:a.word,name:first(a.name)+' · away',id:a.userId});
  const size=Math.max(q.size|0,out.length+(q.unknown|0));
  for(let i=out.length;i<size;i++)out.push({kind:'q'});
  return out; }
/* The word inside a circle: the mockup's sizes, stepped down for long words until they fit the circle (about 38 px across inside, or 48). */
function slotFont(w,big,inner){ const L=Math.max(1,...String(w||'').split(/\s+/).map(x=>x.length)); const base=big?(L>5?8.5:L>3?10:12):(L>6?10:L>4?11.5:13);
  return fitPx(UP(w),base,inner||(big?37:46),6,700,.02); }
function huntSlots(q,me){ const list=slotsOf(q,me), big=list.length>5;
  return '<ul class="slots'+(big?' big':'')+'" aria-label="Your squad">'+list.map(x=>x.kind==='q'
    ?'<li><span class="slot q" aria-hidden="true">?</span><span class="n q" aria-hidden="true">?</span><span class="sr">Not found yet</span></li>'
    :'<li data-key="'+esc(x.id)+'"><span class="slot '+(x.kind==='me'?'me':x.kind==='away'?'away':'')+(x.isNew?' new':'')+'" style="font-size:'+slotFont(x.word,big)+'px">'+esc(UP(x.word))+'</span><span class="n">'+esc(x.name)+'</span></li>').join('')+'</ul>'; }
function noticeBox(){ const r=R_(); const n=r&&r.notice; if(!n||!n.kind)return ''; const key=n.kind+'|'+n.name+'|'+n.at;
  if(ui.seenNotice[key]||(n.at&&now()-n.at>90000))return ''; const q=SQ_()||{}; const nm=esc(first(n.name)), w=esc(UP(n.word));
  let title, body;
  if(n.kind==='teammate_away'){ title=nm+' is away'; body=(w?'Their word was '+w+'. ':'')+(q.needed?'Your squad now needs '+q.needed+'.':''); }
  else if(n.kind==='teammate_back'){ title=nm+' is back'; body=(w?'Their word is '+w+'. ':'')+'Scan them again to link up.'; }
  else if(n.kind==='squad_left'){ title='Your squad is down to you'; body='Everyone else left the game, so it can’t be completed. Your points stay.'; }
  else return '';
  return '<div class="note" role="note" data-key="note"><span><b>'+title+'</b>'+body+'</span><button type="button" class="x" data-act="notice" data-key="'+esc(key)+'" aria-label="Dismiss">'+IC.close('#5C2B0C')+'</button></div>'; }
function vHunt(){ const s=S_(), r=R_(), me=ME_(), q=SQ_()||{}, R=rules(), clk=s.clock||{}, done=!!q.complete;
  const word=UP(me.word), bonus=q.bonus!=null?q.bonus:R.squadBonus;
  const linkedPresent=(q.members||[]).filter(m=>!m.away).length;
  let zone;
  if(done)zone='<div class="qrcard off" data-key="done"><span class="big">'+IC.check('#1F9E3A',40,3)+'</span><b>Squad complete!</b><span class="s">Your category was <b style="font-size:14px">'+esc(UP(q.complete.category||q.category))+'</b>. Your QR has stopped: the round ends when every squad is found or the clock runs out.</span></div>';
  else if(me.away)zone='<div class="qrcard off" data-key="away"><span class="big w">'+IC.x('#D0283E',34,3)+'</span><b>Reconnecting…</b><span class="s">You were away for a while. Your squad is going on without you: scan them again when you’re back.</span></div>';
  else if(!me.qr)zone='<div class="qrcard off" data-key="noqr"><b>Your QR is on its way</b></div>';
  else zone='<div class="qrcard" data-key="qr" role="img" aria-label="Your QR code. It changes every '+Math.round((R.qrWindowMs||20000)/1000)+' seconds."><span class="k" aria-hidden="true">YOUR QR</span><canvas data-qr-live width="176" height="176"></canvas></div>'+
    '<div class="qrtime" aria-hidden="true"><div class="qrbar"><i data-qrbar></i></div><span>New QR in <span class="num" data-tick data-qrleft></span>s</span></div>';
  let action;
  if(done)action='<p class="boardline" data-key="b">'+(r.board&&r.board.squads?'<b>'+(r.board.complete|0)+' of '+r.board.squads+'</b> squads done in '+esc(office())+' · ':'')+'results at 0:00 or when every squad is found</p>';
  else if(me.away)action='<button type="button" class="cta locked" disabled data-key="b"><span class="l1">'+IC.scan('#8A88A0',20)+'Scan their QR</span><span class="l2">Reconnecting…</span></button>';
  else if(!canScan())action='<button type="button" class="cta locked" disabled data-key="b"><span class="l1">'+IC.scan('#8A88A0',20)+'Scan their QR</span><span class="l2">'+(window.Sowaka&&window.Sowaka.native?'Update the Sowaka app to scan':'This browser can’t use the camera')+'</span></button>';
  else action='<button type="button" class="cta" data-act="scan" data-key="b"'+(ui.sending?' disabled':'')+'>'+IC.scan('#0B5A2A')+(ui.sending?'Checking…':'Scan their QR')+'</button>';
  return {key:'hunt:'+roundKey(),tc:'#5B4BD6',html:'<div class="scr"><section class="hero fill" aria-label="Your word and QR" style="align-items:stretch;gap:12px;padding:calc(16px + var(--padt)) 18px 50px">'+
    '<div class="hunt-top">'+clockPill(clk.huntEndsAt||s.phaseEndsAt)+'<span class="pill rnd">ROUND '+roundNo()+(roundCount()>1?' of '+roundCount():'')+'</span>'+ptsPill(s.totalPoints)+'</div>'+
    '<h1 class="myword" tabindex="-1"><span class="k">YOUR WORD</span><span class="w" style="font-size:'+fitPx(word,50,262,20)+'px">'+esc(word)+'</span></h1>'+
    '<div class="rchips"><span class="rchip ok">'+IC.check('#1F9E3A',16,3)+'Right <b class="num">'+esc(sgn(R.right))+'</b></span><span class="rchip no">'+IC.x('#D0283E',14,3.2)+'Wrong <b class="num">'+esc(sgn(R.wrong))+'</b></span>'+
      '<span class="rchip bn">'+IC.people('#C99A00',16,2.4)+'Squad <b class="num">'+esc(sgn(bonus))+'</b></span></div>'+
    '<div class="qrzone">'+zone+'</div></section>'+
    '<section class="panel" aria-label="Your squad" style="margin-top:-32px;gap:16px">'+noticeBox()+
      '<div class="sqh"><h2>Your squad</h2><span><b class="num">'+linkedPresent+'</b> of '+(q.needed||q.size||0)+' found</span></div>'+huntSlots(q,me)+action+'</section></div>'}; }

/* The browser's camera, when the app's scanner isn't there (the scan view of Hunt.dc.html). */
function vScan(){ return {key:'scan',tc:'#0B0D1A',html:'<div class="cam" role="dialog" aria-modal="true" aria-labelledby="camh">'+
  '<button type="button" class="iconbtn close" data-act="back" aria-label="Close the camera">'+IC.close('#FFFFFF')+'</button>'+
  '<h2 id="camh" tabindex="-1">Point at their code</h2><p>It checks by itself — no typing</p>'+
  '<div class="frame">'+(ui.camFailed?'':'<video id="vid" playsinline muted autoplay></video>')+
    '<svg width="240" height="240" viewBox="0 0 240 240" aria-hidden="true"><path d="M18 64V30a12 12 0 0 1 12-12h34M176 18h34a12 12 0 0 1 12 12v34M222 176v34a12 12 0 0 1-12 12h-34M64 222H30a12 12 0 0 1-12-12v-34" fill="none" stroke="#C6F432" stroke-width="7" stroke-linecap="round"/></svg>'+
    (ui.camFailed?'':'<span class="scanline"></span>')+'</div>'+
  '<span class="hint" id="camhint" aria-live="polite">'+esc(ui.camFailed?'The camera isn’t available here. Open Secret Squad in the Sowaka app to scan.':(ui.scanHint||'Hold steady: it scans by itself'))+'</span></div>'}; }

/* ---------------------------------------------------------------- Right / Wrong / "[Name] scanned you" (Right, Wrong, Scanned) */
function vResult(x){ const s=S_(), me=ME_()||{}, q=SQ_()||{}, ok=x.result==='right', scanned=x.role==='scanned', R=rules(), other=x.other||{};
  const key='scan:'+x.id, myWord=UP(me.word), theirs=UP(other.word);
  const bursts=ok?[[-110,-70,-200,'#FFE27A'],[110,-80,220,'#FFFFFF'],[-120,40,160,'#C6F432'],[120,30,-170,'#FFE27A']].map(b=>'<span class="bst" style="--x:'+b[0]+'px;--y:'+b[1]+'px;--r:'+b[2]+'deg;background:'+b[3]+'"></span>').join(''):'';
  let box;
  if(ok){ const list=slotsOf(q,me), big=list.length>5, more=x.completed||q.complete?0:(q.more|0);
    box='<div class="sqbox'+(big?' big':'')+'"><div class="grid">'+list.map(sl=>sl.kind==='q'?'<div><span class="rs q" aria-hidden="true">?</span>'+(big?'':'<span class="nm" style="opacity:.7">?</span>')+'</div>'
      :'<div><span class="rs'+(sl.id===other.userId?' new':'')+'" style="font-size:'+slotFont(sl.word,big)+'px">'+esc(UP(sl.word))+'</span><span class="nm">'+esc(sl.name)+'</span></div>').join('')+'</div>'+
      '<span class="line">'+(more?more+' more to find':'That’s everyone!')+'</span></div>'; }
  else box='<div class="nudge"><span class="ic">'+IC.bulb()+'</span><span>'+(scanned?'Not the same category. You both lose '+Math.abs(R.wrong)+'.':'Not the same category. What else goes with '+esc(myWord)+'?')+'</span></div>';
  const label=s.status==='hunt'&&!x.completed?'Keep hunting':'Continue';
  return {key, tc:ok?'#2FBF55':'#F0566A', bg:ok?'#16893A':'#B4233A', html:'<div class="res '+(ok?'ok':'no')+'" role="alertdialog" aria-labelledby="resh">'+
    '<div class="tr"><span class="pill pts dk num" data-countbox>'+IC.bolt()+countUp(key,x.before,x.after)+' pts</span></div>'+
    '<div class="mid"><div class="vwrap">'+bursts+'<span class="verdict">'+(ok?IC.check('#1F9E3A',72,3):IC.x('#D0283E',64,3))+'</span></div>'+
      (scanned?'<span class="kick">'+IC.scan('#FFFFFF',16)+esc(first(other.name))+' scanned you</span>':'')+
      '<h1 id="resh" tabindex="-1">'+(ok?'Same squad!':'Not your squad')+'</h1>'+
      '<div class="join"><div class="c l"><span class="w" style="font-size:'+fitPx(myWord,20,106,11)+'px">'+esc(myWord)+'</span><span class="n">You</span></div>'+
        '<div class="mid2"><span class="ln"></span><span class="jt">'+(ok?IC.check('#1F9E3A',18,3.4):IC.x('#D0283E',15,3.6))+'</span></div>'+
        '<div class="c r"><span class="w" style="font-size:'+fitPx(theirs||'?',20,106,11)+'px">'+esc(theirs||'?')+'</span><span class="n">'+esc(first(other.name))+'</span></div></div>'+
      '<span class="delta num">'+esc(sgn(x.delta))+'</span>'+
      '<div class="score" data-countbox><span class="ic">'+IC.bolt('#FFCC2E',20).replace('aria-hidden','stroke="#C99A00" stroke-width="1.6" stroke-linejoin="round" aria-hidden')+'</span><span class="tx"><span class="k">Your score</span>'+countUp(key,x.before,x.after)+'</span></div>'+
      box+'</div>'+
    btn(label,'seen','white',' data-id="'+esc(x.id)+'"')+'</div>'}; }

/* ---------------------------------------------------------------- squad complete (the done view of Hunt.dc.html) */
function vDone(c){ const s=S_(), r=R_()||{}, q=SQ_()||{}, me=ME_()||{}, key='done:'+roundKey();
  const chips=slotsOf(q,me).filter(x=>x.kind!=='q').map((x,i)=>'<span class="wchip'+(x.kind==='away'?' off':'')+'"><b>'+esc(UP(x.word))+'</b><span>'+esc(x.name)+'</span></span>').join('');
  const took=r.huntStartsAt&&c.at?fmt(c.at-r.huntStartsAt):null;
  const nextI=(s.roundIndex|0)+1, nx=cfg(nextI), more=nextI<roundCount();
  const label=s.status==='over'?'See results':s.status==='break'?'See round results':'Continue';
  return {key,tc:'#5B4BD6',html:'<div class="done" role="alertdialog" aria-labelledby="doneh">'+rays()+confetti()+
    '<span class="kick2">ROUND '+roundNo()+(c.place?' · '+UP(ord(c.place))+' SQUAD DONE':' · SQUAD DONE')+'</span>'+
    '<h1 id="doneh" tabindex="-1">You found<br>your squad!</h1>'+
    '<span class="bpill lime">'+IC.people('#0B5A2A',18,2.4)+'Squad bonus <b class="num">'+esc(sgn(c.bonus))+'</b> for everyone!</span>'+
    (c.timeBonus>0?'<span class="bpill gold">'+IC.clock('#141B3F',17)+'<b class="num">'+esc(sgn(c.timeBonus))+'</b> for time left</span>':'')+
    '<div class="catcard"><span class="k">Your secret category was</span><span class="cat" style="font-size:'+fitPx(UP(c.category),34,290,18,800,.06)+'px">'+esc(UP(c.category))+'</span><div class="wchips">'+chips+'</div></div>'+
    '<div class="duo">'+(took?'<span class="a">Done in <b class="num">'+took+'</b></span>':'')+'<span class="b" data-countbox>Points <b>'+countUp(key,c.before,c.after)+'</b></span></div>'+
    (more?'<span class="nextp">Next: Round '+(nextI+1)+(nx.squadSize?' · '+esc(sizeLabel(nx.squadSize)):'')+' · new word!</span>':'')+
    btn(label,'done')+'</div>'}; }

/* ---------------------------------------------------------------- the round's results and the break (Break.dc.html) */
function lbRows(rows,mineRow,n){ const me=meId(); const top=(rows||[]).slice(0,n||5); const list=top.slice();
  const shown=list.some(r=>r.userId===me);
  let html=list.map((r,i)=>lbRow(r,i,r.userId===me)).join('');
  if(!shown&&mineRow)html+='<li class="gap" aria-hidden="true">···</li>'+lbRow(mineRow,list.length,true);
  return '<ol class="lb">'+html+'</ol>'; }
function lbRow(r,i,you){ const rk=r.rank|0; return '<li class="'+(you?'you':'')+'" style="animation-delay:'+(.5+i*.08).toFixed(2)+'s"><span class="rk num'+(rk>=1&&rk<=3?' r'+rk:'')+'">'+rk+'</span>'+av(r)+
  '<span class="nm">'+esc(you?'You':shortName(r.name))+'</span><span class="p num">'+esc(n0(r.points))+'</span></li>'; }
function squadSummary(card,res,prefix){ if(!card)return ''; const r=R_()||{};
  const mine=(res&&Array.isArray(res.squads)?res.squads:[]).find(x=>x.mine);
  const took=card.complete&&mine&&mine.finishedAt&&r.huntStartsAt&&card.roundNumber===(r.number||roundNo())?fmt(mine.finishedAt-r.huntStartsAt):null;
  const linked=(card.members||[]).filter(m=>m.linked).length;
  const bits=[prefix+' <b>'+esc(UP(card.category))+'</b>'];
  if(card.complete){ if(took)bits.push('found in '+took); bits.push(esc(sgn(card.bonus))+' squad bonus'); if(card.timeBonus>0)bits.push(esc(sgn(card.timeBonus))+' for time left'); }
  else bits.push(linked+' of '+(card.size|0)+' found');
  const members=(card.members||[]).slice().sort((a,b)=>(b.me?1:0)-(a.me?1:0));
  const chips=members.map((m,i)=>'<span class="wchip ch'+(m.me?'':' lt')+(card.complete||m.linked||m.me?'':' off')+'" style="animation-delay:'+(.4+i*.05).toFixed(2)+'s"><b>'+esc(UP(m.word))+'</b><span>'+esc(m.me?'You':first(m.name))+'</span></span>').join('');
  return '<div class="sqsum pop"><span>'+bits.join(' · ')+'</span><div class="wchips sm">'+chips+'</div></div>'; }
function breakLen(ms){ const s=Math.round((ms||0)/1000); if(s>=60&&s%60===0)return (s/60)+' minute break'; if(s>=60)return fmt(ms)+' break'; return s+' second break'; }
function vBreak(){ const s=S_(), r=R_()||{}, res=r.results, i=s.roundIndex|0, nx=cfg(i+1), clk=s.clock||{}, at=clk.breakEndsAt||s.phaseEndsAt;
  const n=roundNo(), dealt=res&&res.rank!=null&&s.playing;
  let cards;
  if(res&&res.skipped)cards='<div class="msgbox pop"><b>Round '+n+' was skipped</b><span>Fewer than 4 players were in. The next round starts after the break.</span></div>';
  else if(dealt)cards='<div class="cards2 pop"><div class="card w"><span class="k">Your rank</span><span class="v num">#'+res.rank+'</span><span class="s">of '+(res.of|0)+' '+plural(res.of|0,'player','players')+'</span></div>'+
    '<div class="card g"><span class="k">Your points</span><span class="v num">'+esc(n0(res.total))+'</span><span class="s">so far</span></div></div>';
  else cards='<div class="msgbox pop"><b>You’re in for round '+(n+1)+'</b><span>You joined after round '+n+' was dealt. Your word comes when the next round starts.</span></div>';
  const meRow=dealt?{userId:meId(),name:'You',initials:st.me&&st.me.initials,photoUrl:st.me&&st.me.photoUrl,points:res.total,rank:res.rank}:null;
  const total=(+cfg(i).breakMs)||Math.max(0,at-(r.overAt||now()));
  const C=2*Math.PI*32;
  return {key:'break:'+roundKey(),tc:'#5B4BD6',html:'<div class="scr"><section class="hero res2" aria-label="Round '+n+' over">'+rays()+
    '<div class="top" style="padding:4px 4px 0"><span class="ttl l">Secret Squad</span><span class="pill yel">ROUND '+n+' OVER</span></div>'+
    '<h1 class="sr" tabindex="-1">Round '+n+' over</h1>'+cards+(dealt&&res.squad?squadSummary(res.squad,res,'Your squad was'):'')+'</section>'+
    '<section class="panel fill" style="padding:18px 20px calc(24px + var(--padb))"><section aria-label="Leaderboard" style="display:flex;flex-direction:column;gap:8px">'+
      '<div class="lbh"><h2>Leaderboard</h2><span>After round '+n+(office()?' · '+esc(office()):'')+'</span></div>'+
      (res&&Array.isArray(res.top)&&res.top.length?lbRows(res.top,meRow,5):'<p class="s">Nobody scored this round.</p>')+'</section>'+
      '<div class="brk" role="timer" aria-label="Round '+(n+1)+' starts in"><span class="rg"><svg width="74" height="74" viewBox="0 0 74 74" aria-hidden="true"><circle cx="37" cy="37" r="32" fill="#FFFFFF" stroke="#FFE8A3" stroke-width="7"/>'+
        '<circle cx="37" cy="37" r="32" fill="none" stroke="#C99A00" stroke-width="7" stroke-linecap="round" data-ring="'+(at-total)+'|'+at+'|'+C.toFixed(1)+'" stroke-dasharray="0 '+C.toFixed(1)+'" transform="rotate(-90 37 37)"/></svg><span class="tick num">'+T(at)+'</span></span>'+
        '<span class="tx"><b>'+esc(breakLen(total))+'</b><span>Round '+(n+1)+' starts in <b class="num">'+T(at)+'</b></span><small>Next: '+esc(nx.squadSize?sizeLabel(nx.squadSize):'new squads')+', new word</small></span></div>'+foot()+'</section></div>'}; }

/* ---------------------------------------------------------------- the final results (Final.dc.html) */
function vFinal(){ const s=S_(), f=s.final||{}, r=R_()||{}, n=roundCount(), played=s.joined&&f.rank!=null;
  const meRow=played?{userId:meId(),name:'You',initials:st.me&&st.me.initials,photoUrl:st.me&&st.me.photoUrl,points:f.total,rank:f.rank}:null;
  const lb=Array.isArray(f.leaderboard)?f.leaderboard:[];
  const span=n===2?'Both rounds':n===1?'One round':'All '+n+' rounds';
  const card=f.lastSquad;
  const back=canClose()?btn('Back to Games','close'):'';
  return {key:'final:'+s.id,tc:'#5B4BD6',html:'<div class="scr"><section class="hero res2" aria-label="Game over">'+rays()+confetti()+
    '<div class="top" style="padding:4px 4px 0"><span class="ttl l">Secret Squad</span><span class="pill yel">GAME OVER</span></div>'+
    '<div class="fin-h pop">'+IC.crown(34,28,'fcrown')+'<h1 tabindex="-1">Final results</h1></div>'+
    (played?'<div class="cards2 pop"><div class="card w"><span class="k">Final rank</span><span class="v num">#'+f.rank+'</span><span class="s">of '+(f.of|0)+' '+plural(f.of|0,'player','players')+'</span></div>'+
      '<div class="card g"><span class="k">Your points</span><span class="v num">'+esc(n0(f.total))+'</span><span class="s">in total</span></div></div>'
      :'<div class="msgbox pop"><b>'+(s.joined?'Thanks for joining':'Thanks for watching')+'</b><span>'+(lb.length?lb.length+' '+plural(lb.length,'person','people')+' played in '+esc(office()||'this office')+'.':'Nobody played this time.')+'</span></div>')+
    (played&&card?squadSummary(card,card.roundNumber===r.number?r.results:null,(n>1?'Round '+card.roundNumber+' squad was':'Your squad was')):'')+'</section>'+
    '<section class="panel fill" style="padding:18px 20px calc(26px + var(--padb))"><section aria-label="Leaderboard" style="display:flex;flex-direction:column;gap:8px">'+
      '<div class="lbh"><h2>Leaderboard</h2><span>'+span+(office()?' · '+esc(office()):'')+'</span></div>'+(lb.length?lbRows(lb,meRow,5):'<p class="s">No scores this time.</p>')+'</section>'+
      '<div style="margin-top:auto;display:flex;flex-direction:column;gap:6px">'+(back||btn('View full leaderboard','fullboard'))+(back?'<button type="button" class="link" data-act="fullboard">View full leaderboard</button>':'')+'</div>'+foot()+'</section></div>'}; }

/* ---------------------------------------------------------------- the full leaderboard, in the game-over card's theme (Results.dc.html) */
function podiumCol(row,place){ if(!row)return '<div class="col p'+place+'"></div>'; const you=row.userId===meId();
  return '<div class="col p'+place+'"><div class="who"><span style="position:relative;display:inline-block">'+av(row)+(place===1?IC.crown(24,19,'crown'):'')+'</span><span class="nm">'+esc(you?'You':shortName(row.name))+'</span></div>'+
    '<div class="bar"><small>#'+(row.rank|0)+'</small><b class="num">'+esc(n0(row.points))+'</b></div></div>'; }
function vBoard(){ const b=ui.board, d=b.data, me=meId();
  loadBoard();
  const head='<button type="button" class="link back" data-act="board-close">'+IC.back()+'Back to the game</button>';
  if(b.error)return {key:'board:err',tc:'#F4F5F9',html:'<div class="bscr">'+head+'<div class="rcard"><div class="hd" style="padding-right:6px"><span class="kp"><i></i>LEADERBOARD</span><h1 tabindex="-1">No leaderboard</h1><p>'+esc(b.error)+'</p></div></div></div>'};
  if(!d)return {key:'board:wait',tc:'#F4F5F9',html:'<div class="bscr">'+head+'<div class="rcard">'+envelope()+'<div class="hd"><span class="kp"><i></i>LEADERBOARD</span><h1 tabindex="-1">Secret Squad</h1><p>Loading the leaderboard…</p></div></div></div>'};
  const rows=Array.isArray(d.results)?d.results:[];
  const mine=rows.find(r=>r.userId===me);
  const rest=rows.slice(3);
  const conf=['#FFCC2E','#E8434F','#6C5CE7','#22C55E','#FFCC2E','#2F80ED'].map((c,i)=>'<span class="conf" aria-hidden="true" style="left:'+[12,28,46,62,76,90][i]+'%;background:'+c+';animation-delay:'+[0,1.2,.5,2,1.6,.9][i]+'s"></span>').join('');
  const when=d.endsAt?dayOf(+new Date(d.endsAt))+' · '+hm(+new Date(d.endsAt)):'';
  return {key:'board:'+(d.sessionId||''),tc:'#F4F5F9',html:'<div class="bscr">'+head+
    '<article class="rcard" aria-label="Secret Squad leaderboard">'+envelope(['DOG','PARROT','MANGO','KIWI'])+
      '<div class="hd"><span class="kp"><i></i>GAME OVER</span><h1 tabindex="-1">Secret Squad</h1><p>'+esc([d.office,rows.length===1?'1 player':rows.length+' players'].filter(Boolean).join(' · '))+(when?'<br>'+esc(when):'')+'</p></div>'+
      (rows.length?'<section class="lavbox" aria-label="Everyone who played">'+rays()+conf+'<span class="cap">Full leaderboard</span>'+
        (mine?'<span class="mine">Your rank <b class="num">#'+(mine.rank|0)+'</b> · <b class="num">'+esc(n0(mine.points))+'</b> pts</span>':'')+
        '<div class="podium">'+podiumCol(rows[2],3)+podiumCol(rows[0],1)+podiumCol(rows[1],2)+'</div>'+
        (rest.length?'<ol class="rlist" start="4">'+rest.map((r,i)=>'<li class="'+(r.userId===me?'you':'')+'" style="animation-delay:'+Math.min(2.4,1.3+i*.06).toFixed(2)+'s"><span class="rk num">'+(r.userId===me?'#':'')+(r.rank|0)+'</span>'+av(r)+
          '<span class="nm">'+esc(r.userId===me?'You':r.name)+'</span><span class="p num">'+esc(n0(r.points))+'</span></li>').join('')+'</ol>':'')+'</section>'
        :'<div class="lavbox"><span class="cap">No one played this time</span></div>')+
    '</article></div>'}; }

/* ---------------------------------------------------------------- How to play: six animated scenes, in a sheet */
const QR_MINI='<svg width="104" height="104" viewBox="0 0 11 11" shape-rendering="crispEdges" fill="#141B3F" aria-hidden="true">'+
  [[0,0],[1,0],[2,0],[0,1],[2,1],[0,2],[1,2],[2,2],[8,0],[9,0],[10,0],[8,1],[10,1],[8,2],[9,2],[10,2],[0,8],[1,8],[2,8],[0,9],[2,9],[0,10],[1,10],[2,10],[4,0],[6,1],[5,2],[4,4],[5,4],[7,4],[9,4],[1,5],[3,5],[6,5],[8,5],[10,5],[4,6],[5,7],[7,7],[9,7],[4,8],[6,8],[8,9],[10,9],[5,10],[7,10],[9,10],[6,6],[2,6],[0,5]]
    .map(p=>'<rect x="'+p[0]+'" y="'+p[1]+'" width="1" height="1"/>').join('')+'</svg>';
function howScenes(){ const R=rules(), n=roundCount(), known=!!S_()||!!(st&&st.next);
  return [
    {cap:'You get a secret word', art:'<div class="hw-env"></div><div class="hw-word">DOG</div>'},
    {cap:'Find people in the same category', art:'<span class="hw-tagline hw-tag">'+IC.check('#7A5600',12,3.4).replace('<svg','<svg style="vertical-align:-1px;margin-right:4px"')+'ANIMALS</span>'+
      '<span class="hw-chip hw-y hw-gather" style="left:calc(50% - 135px);top:82px;--sx:90px;--sy:90px;--r:-12deg">DOG</span><span class="hw-chip hw-y hw-gather" style="left:calc(50% - 37px);top:82px;--sx:-60px;--sy:110px;--r:10deg">CAT</span>'+
      '<span class="hw-chip hw-y hw-gather" style="left:calc(50% + 51px);top:82px;--sx:-170px;--sy:60px;--r:-8deg">LION</span><span class="hw-tag" style="position:absolute;left:calc(50% - 133px);top:132px;width:262px;height:4px;border-radius:4px;background:#FFCC2E"></span>'+
      '<span class="hw-chip hw-p hw-leave" style="left:calc(50% + 33px);top:172px">MARS</span><span class="hw-tag" style="position:absolute;left:calc(50% + 125px);top:176px;width:30px;height:30px;border-radius:50%;background:#fff;display:grid;place-items:center">'+IC.x('#D0283E',14,3.4)+'</span>'},
    {cap:'Scan their QR', art:'<div class="hw-qr">'+QR_MINI+'<svg width="150" height="150" viewBox="0 0 150 150" aria-hidden="true"><path d="M6 34V18a12 12 0 0 1 12-12h16M116 6h16a12 12 0 0 1 12 12v16M144 116v16a12 12 0 0 1-12 12h-16M34 144H18a12 12 0 0 1-12-12v-16" fill="none" stroke="#C6F432" stroke-width="6" stroke-linecap="round"/></svg><span class="hw-scanl"></span></div>'+
      '<span class="hw-beep">'+IC.check('#0B5A2A',22,3.2)+'</span>'},
    {cap:'Right '+sgn(R.right)+' · Wrong '+sgn(R.wrong)+' — for both of you', art:'<div class="hw-rw"><div><span class="hw-mark ok hw-tag" style="animation-delay:.2s">'+IC.check('#FFFFFF',46,3.2)+'</span><span class="hw-n hw-up" style="color:#C6F432">'+esc(sgn(R.right))+'</span>'+
      '<span class="hw-pair"><i style="background:#FFD6DA"></i><i style="background:#CDE3FF"></i></span></div><div><span class="hw-mark no hw-shake">'+IC.x('#FFFFFF',40,3.4)+'</span><span class="hw-n hw-up" style="animation-delay:.9s;color:#FFB3BE">'+esc(sgn(R.wrong))+'</span>'+
      '<span class="hw-pair"><i style="background:#FFE8A3"></i><i style="background:#D9D2FF"></i></span></div></div>'},
    {cap:'Whole squad found: '+sgn(R.squadBonus)+' each, plus '+halfPoint(R.timeBonusPerSecond)+' per second left', art:'<div style="position:absolute;top:34px;left:0;right:0;display:flex;justify-content:center;gap:8px">'+
      [.1,.4,.7,1,1.3].map(d=>'<span class="hw-fill" style="animation-delay:'+d+'s"></span>').join('')+'</div>'+
      '<div style="position:absolute;top:118px;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:12px">'+
        '<span class="hw-stamp" style="width:132px;padding:10px 0;border-radius:16px;background:#C6F432;color:#0B5A2A;display:flex;flex-direction:column;align-items:center;box-shadow:0 5px 0 #1F7A32"><b style="font-size:30px;font-weight:800;line-height:1">'+esc(sgn(R.squadBonus))+'</b><span style="font-size:12px;font-weight:700;letter-spacing:.1em">SQUAD BONUS</span></span>'+
        '<span class="hw-stamp" style="animation-delay:2s;width:132px;padding:10px 0;border-radius:16px;background:#fff;color:#3A2E9E;display:flex;flex-direction:column;align-items:center;box-shadow:0 5px 0 #C9C2F2"><b style="font-size:30px;font-weight:800;line-height:1">+'+Math.floor(80*(+R.timeBonusPerSecond||0))+'</b><span style="font-size:12px;font-weight:700;letter-spacing:.1em">1:20 LEFT</span></span></div>'},
    {cap:(known?(n>1?n+' rounds, a new squad each round. ':'One round. '):'Play multiple rounds. New squad each round! ')+'Most points wins!', art:'<div style="display:flex;align-items:center;gap:14px;margin-top:-44px">'+
      '<span class="hw-big hw-tag" style="animation-delay:.2s;background:#fff;color:#3A2E9E;box-shadow:0 6px 0 #C9C2F2"><span class="k">ROUND</span><span class="v">1</span></span>'+
      '<span class="hw-tag" style="animation-delay:.7s;display:inline-flex">'+IC.arrow()+'</span>'+
      '<span class="hw-big hw-tag" style="animation-delay:1.1s;background:#FFCC2E;color:#141B3F;box-shadow:0 6px 0 #C99A00"><span class="k">ROUND</span><span class="v">'+(known&&n>1?n:2)+'</span></span></div>'+
      '<span class="hw-win">'+IC.crown(24,19)+'MOST POINTS WINS</span>'},
  ]; }
function howSheet(){ const h=ui.how; if(!h)return ''; const sc=howScenes(), i=h.i%sc.length, last=i===sc.length-1;
  return '<div class="dim" data-act="how-dim"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="howh" aria-describedby="howcap">'+
    '<span class="grab" aria-hidden="true"></span><div class="hh"><h2 id="howh">How to play</h2><button type="button" class="iconbtn x" data-act="how-close" aria-label="Close">'+IC.close()+'</button></div>'+
    '<div class="hw-stage" aria-hidden="true"><div class="hw-scene" data-key="scene'+i+'">'+sc[i].art+'</div></div>'+
    '<p class="hw-cap" id="howcap" aria-live="polite" data-key="cap'+i+'">'+esc(sc[i].cap)+'</p>'+
    '<div class="hw-dots" role="group" aria-label="Steps">'+sc.map((x,k)=>'<button type="button" data-act="how-go" data-i="'+k+'" aria-label="Step '+(k+1)+' of '+sc.length+'"'+(k===i?' aria-current="step"':'')+'><span></span></button>').join('')+'</div>'+
    btn(last?'Got it!':'Next','how-next','',' data-key="next"')+'</section></div>'; }
function openHow(from){ ui.how={i:0,t0:Date.now(),from:from||null}; render(); const x=document.querySelector('[data-act=how-close]'); if(x)try{ x.focus(); }catch(e){} haptic('light'); }
function closeHow(){ if(!ui.how)return; const from=ui.how.from; ui.how=null; render(); const b=document.querySelector('[data-act=how]'); if(b)try{ b.focus(); }catch(e){} void from; }
function howTo(i){ if(!ui.how)return; ui.how.i=(i+6)%6; ui.how.t0=Date.now(); render(); }

/* ---------------------------------------------------------------- the layer: How to play, the toast, the connection */
function layer(){ let h=howSheet();
  const s=S_();
  if(ui.toast&&ui.toastT>Date.now())h+='<div class="toast'+(!online&&st?' up':'')+'" role="status">'+esc(ui.toast)+'</div>';
  if(!online&&!fatal&&st){ const long=offlineSince&&Date.now()-offlineSince>rules().awayMs*.75&&s&&s.status==='hunt';
    h+='<div class="net" role="status"><span class="spin" aria-hidden="true"></span>'+(long?'Still reconnecting. After a minute away your squad stops waiting.':'Reconnecting…')+'</div>'; }
  return h; }

/* ---------------------------------------------------------------- drawing: the screen is morphed in place, so what didn't change keeps its animation */
function morph(a,b){
  if(a.nodeType!==b.nodeType||a.nodeName!==b.nodeName||(a.nodeType===1&&a.getAttribute('data-key')!==b.getAttribute('data-key'))){ a.replaceWith(b); return; }
  if(a.nodeType===3||a.nodeType===8){ if(a.nodeValue!==b.nodeValue)a.nodeValue=b.nodeValue; return; }
  if(a.nodeType!==1||a.nodeName==='CANVAS'||a.nodeName==='VIDEO')return;
  for(const at of [...a.attributes])if(!at.name.startsWith('data-t-')&&!b.hasAttribute(at.name))a.removeAttribute(at.name);
  for(const at of [...b.attributes])if(a.getAttribute(at.name)!==at.value)a.setAttribute(at.name,at.value);
  if(a.nodeName==='INPUT'||a.hasAttribute('data-tick'))return;
  morphKids(a,b); }
function morphKids(a,b){ const A=[...a.childNodes], B=[...b.childNodes], n=Math.min(A.length,B.length);
  for(let i=0;i<n;i++)morph(A[i],B[i]);
  for(let i=n;i<A.length;i++)A[i].remove();
  for(let i=n;i<B.length;i++)a.appendChild(B[i]); }
function paint(el,html,fresh){ if(fresh){ el.innerHTML=html; return; } const t=document.createElement('template'); t.innerHTML=html; morphKids(el,t.content); }

let cur={key:null,html:null}, curLayer=null;
function render(){
  const v=view(), m=$('screen');
  const changedKey=v.key!==cur.key;
  if(changedKey||v.html!==cur.html){
    paint(m,v.html,changedKey);
    if(changedKey){ const root=m.firstElementChild; if(root&&cur.key!==null)root.classList.add('in');
      if(cur.key!==null){ try{ window.scrollTo(0,0); }catch(e){} const h=m.querySelector('h1[tabindex],h2[tabindex]'); if(h&&!/^signin/.test(v.key)&&!ui.how)try{ h.focus({preventScroll:true}); }catch(e){} } }
    after(v.key,changedKey);
  }
  const tc=document.querySelector('meta[name="theme-color"]'); if(tc&&v.tc&&tc.content!==v.tc)tc.content=v.tc;
  const bg=v.bg||(v.tc==='#F4F5F9'?'#F4F5F9':'#FFFFFF'); if(document.body.style.backgroundColor!==bg)document.body.style.backgroundColor=bg;
  cur=v;
  const l=layer(); if(l!==curLayer){ paint($('layer'),l,curLayer===null||(!!l!==!!curLayer)); curLayer=l; }
  m.inert=!!ui.how;
  tick();
  camera(v.key==='scan');
}
function after(key,changedKey){
  if(/^signin/.test(key)){ const em=$('em'); if(em){ if(changedKey)em.value=ui.signin.email; if(changedKey&&ui.signin.step==='email')setTimeout(()=>{ try{ em.focus(); }catch(e){} },60); }
    const o=$('otp'); if(o){ if(changedKey)o.value=ui.signin.otp; paintOtp(); if(changedKey)setTimeout(()=>{ try{ o.focus(); }catch(e){} },60); } }
  if(key==='scan'&&stream){ const v=$('vid'); if(v&&v.srcObject!==stream){ v.srcObject=stream; v.play().catch(()=>{}); } }
}
let syncedOpening=0;
function tick(){
  const t=now(), wall=Date.now();
  all('[data-cd]').forEach(e=>{ const txt=fmt(+e.getAttribute('data-cd')-t); if(e.textContent!==txt)e.textContent=txt; });
  all('[data-secs]').forEach(e=>{ const v=String(Math.max(0,Math.ceil((+e.getAttribute('data-secs')-t)/1000))); if(e.textContent!==v)e.textContent=v; });
  all('[data-opens]').forEach(e=>{ const at=+e.getAttribute('data-opens'); const txt=at>t?'Opens in '+fmt(at-t):'Opening…'; if(e.textContent!==txt)e.textContent=txt;
    if(at<=t&&conn&&wall-syncedOpening>3000){ syncedOpening=wall; try{ conn.sync(); }catch(x){} } });
  all('[data-lowat]').forEach(e=>{ const left=+e.getAttribute('data-lowat')-t; const low=left<30000&&left>-1000; if(low!==e.hasAttribute('data-t-low')){ if(low)e.setAttribute('data-t-low',''); else e.removeAttribute('data-t-low'); } });
  all('[data-ring]').forEach(e=>{ const [a,b,c]=e.getAttribute('data-ring').split('|').map(Number); const f=b>a?Math.max(0,Math.min(1,(b-t)/(b-a))):0;
    const d=(c*f).toFixed(1)+' '+c.toFixed(1); if(e.getAttribute('stroke-dasharray')!==d)e.setAttribute('stroke-dasharray',d); });
  all('[data-count]').forEach(e=>{ const p=e.getAttribute('data-count').split('|'), to=+p[p.length-1], from=+p[p.length-2], key=p.slice(0,-2).join('|');
    const t0=ui.counts[key]||wall, el=wall-t0-COUNT_DELAY, f=!MOVE?1:el<=0?0:Math.min(1,Math.floor(el/COUNT_MS*COUNT_STEPS)/COUNT_STEPS);
    const txt=n0(from+(to-from)*f); if(e.textContent!==txt)e.textContent=txt;
    const box=e.closest('[data-countbox]')||e; if(MOVE){ setFlag(box,'data-t-run',f<1); setFlag(box,'data-t-done',f>=1); setFlag(e,'data-t-run',f<1); } });
  const me=ME_(), R=rules();
  all('[data-qrleft]').forEach(e=>{ const v=me&&me.qrExpiresAt?String(Math.max(0,Math.ceil((me.qrExpiresAt-t)/1000))):''; if(e.textContent!==v)e.textContent=v; });
  all('[data-qrbar]').forEach(e=>{ const f=me&&me.qrExpiresAt?Math.max(0,Math.min(1,(me.qrExpiresAt-t)/(R.qrWindowMs||20000))):0; const tr='scaleX('+f.toFixed(3)+')'; if(e.style.transform!==tr)e.style.transform=tr; });
  all('canvas[data-qr-live]').forEach(cv=>drawQr(cv,me&&me.qr));
  if(ui.how&&MOVE&&wall-ui.how.t0>HOW_MS)howTo(ui.how.i+1);
}
function setFlag(el,name,on){ if(on!==el.hasAttribute(name)){ if(on)el.setAttribute(name,''); else el.removeAttribute(name); } }
function drawQr(cv,text){ if(!text||typeof window.qrcode!=='function'||cv.__q===text)return;
  try{ const q=window.qrcode(0,'M'); q.addData(text); q.make(); const n=q.getModuleCount(), px=Math.max(4,Math.floor(400/n));
    cv.width=cv.height=n*px; const g=cv.getContext('2d'); g.fillStyle='#FFFFFF'; g.fillRect(0,0,cv.width,cv.height); g.fillStyle='#141B3F';
    for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))g.fillRect(c*px,r*px,px,px);
    const fresh=cv.__q!=null; cv.__q=text; cv.setAttribute('data-qr-text',text);
    if(fresh&&MOVE){ cv.classList.remove('fresh'); void cv.offsetWidth; cv.classList.add('fresh'); } }catch(e){ console.warn('QR failed',e); } }
function paintOtp(){ const box=$('otpbox'), o=$('otp'); if(!box||!o)return; const d=ui.signin.otp;
  [...box.children].forEach((sp,i)=>{ sp.textContent=d[i]||'·'; sp.className=d[i]?'on':(i===d.length?'cur':''); });
  const v=$('vbtn'); if(v)v.disabled=d.length!==6||ui.signin.busy; }

let liveT=0;
function say(text){ const l=$('live'); if(!l)return; l.textContent=''; clearTimeout(liveT); liveT=setTimeout(()=>{ l.textContent=text; },60); }
function toast(text,ms){ ui.toast=String(text||''); ui.toastT=Date.now()+(ms||3200); say(ui.toast); render(); setTimeout(render,(ms||3200)+50); }

/* ---------------------------------------------------------------- the camera (browser only), decoded with jsQR */
let stream=null, camBusy=false, scanT=0, lastDecode=0;
const off=document.createElement('canvas');
function camera(on){
  if(!on){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } cancelAnimationFrame(scanT); return; }
  if(stream||camBusy||ui.camFailed)return;
  camBusy=true;
  navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false}).then(s=>{
    camBusy=false;
    if(cur.key!=='scan'){ s.getTracks().forEach(t=>t.stop()); return; }
    stream=s; const v=$('vid'); if(v){ v.srcObject=s; v.play().catch(()=>{}); } loop();
  }).catch(err=>{ camBusy=false; ui.camFailed=true; console.warn('camera',err&&err.name); render(); });
}
function loop(){ scanT=requestAnimationFrame(loop); const t=performance.now(); if(t-lastDecode<150)return; lastDecode=t;
  const v=$('vid'); if(!v||!stream||v.readyState<2||!v.videoWidth)return;
  const scale=Math.min(1,640/Math.max(v.videoWidth,v.videoHeight)); const w=Math.round(v.videoWidth*scale), h=Math.round(v.videoHeight*scale);
  off.width=w; off.height=h; const g=off.getContext('2d',{willReadFrequently:true}); g.drawImage(v,0,0,w,h);
  let hit=null; try{ hit=window.jsQR(g.getImageData(0,0,w,h).data,w,h,{inversionAttempts:'dontInvert'}); }catch(e){ return; }
  if(!hit||!hit.data)return;
  if(!/^SQ\d*:/i.test(hit.data)){ if(ui.scanHint!=='That isn’t a Secret Squad QR'){ ui.scanHint='That isn’t a Secret Squad QR'; const h2=$('camhint'); if(h2)h2.textContent=ui.scanHint; } return; }
  haptic('light'); ui.mode='main'; ui.scanHint=''; camera(false); sendScan(hit.data); }
window.__squadDecode=(data,w,h)=>{ const r=typeof window.jsQR==='function'?window.jsQR(data,w,h):null; return r&&r.data||null; };

/* ---------------------------------------------------------------- talking to the server */
function request(ev,payload){ if(!conn)return Promise.reject(Object.assign(new Error('Not connected yet. Try again in a moment.'),{status:0})); return conn.request(ev,payload||{}); }
async function act(ev,payload,okSay){ if(ui.sending)return; ui.sending=true; render();
  try{ await request(ev,payload); if(okSay)say(okSay); }catch(e){ haptic('heavy'); toast(e.message||'Something went wrong. Try again.'); }
  finally{ ui.sending=false; render(); } }
/* A scan resolves at once on both phones: the Right/Wrong screen comes from the state the server pushes right after the ack (its
   `round.scan` carries the before/after for the count). Should that push be slow, the page asks for the state again. */
async function sendScan(text){ if(ui.sending)return; ui.sending=true; render();
  try{ const before=(R_()&&R_().scan&&R_().scan.id)||null; await request('squad:scan',{qr:String(text)});
    setTimeout(()=>{ const x=R_()&&R_().scan; if((!x||x.id===before)&&conn)try{ conn.sync(); }catch(e){} },1200); }
  catch(e){ haptic('heavy'); toast(e.message||'That scan didn’t go through. Try again.',4200); }
  finally{ ui.sending=false; render(); } }
function startScan(){
  if(canNativeScan()){ let p; try{ p=window.Sowaka.scanQr(); }catch(err){ p=Promise.reject(err); }
    Promise.resolve(p).then(text=>{ if(text)sendScan(String(text)); }).catch(e=>toast((e&&e.message)||'Scanning didn’t work. Try again.')); return; }
  if(canCamera()){ ui.mode='scan'; ui.scanHint=''; render(); return; }
  toast('Scanning needs the Sowaka app or a camera.'); }

/* A new state: the clock is corrected, older versions are dropped, and anything new to tell the player is told once. */
function onState(next){
  if(!next||typeof next!=='object')return;
  const sid=next.session&&next.session.id||null, v=+next.v||0;
  if(sid&&sid===lastSid&&v<lastV)return;
  lastSid=sid; lastV=v;
  if(+next.now>0)skew=+next.now-Date.now();
  const prev=st;
  // A broadcast to everyone watching the office carries no `me`: keep the one we know.
  if(!next.me&&prev&&prev.me)next.me=prev.me;
  st=next;
  const s=S_(), r=R_(), ps=prev&&prev.session||null, pr=ps&&ps.id===(s&&s.id)?ps.round:null;
  if(s){
    if(s.status!=='hunt'&&ui.mode==='scan')ui.mode='main';
    const x=r&&r.scan;
    if(prev&&x&&x.id&&!ui.seen[x.id]&&(!pr||!pr.scan||pr.scan.id!==x.id)){
      const nm=first(x.other&&x.other.name);
      if(x.result==='already'){ ui.seen[x.id]=1; seenSave(); haptic('light'); toast('You and '+nm+' are already linked. No points either way.'); }
      else { if(ui.mode==='scan')ui.mode='main';
        haptic(x.result==='right'?'medium':'heavy');
        say((x.role==='scanned'?nm+' scanned you. ':'')+(x.result==='right'?'Same squad! ':'Not your squad. ')+nm+' has '+UP(x.other&&x.other.word)+'. '+sgn(x.delta)+'. Your score is '+n0(x.after)+'.'); }
    }
    const c=r&&r.squad&&r.squad.complete;
    if(prev&&c&&!(pr&&pr.squad&&pr.squad.complete)){ haptic('medium'); if(!(x&&x.completed))say('Squad complete! The category was '+c.category+'. '+sgn(c.bonus)+' squad bonus'+(c.timeBonus>0?', '+sgn(c.timeBonus)+' for time left':'')+'.'); }
    const was=ps&&ps.id===s.id?ps.status:null;
    if(prev&&was!==s.status){
      if(s.status==='dealing'&&r&&r.me&&r.me.word){ haptic('medium'); say('Round '+roundNo()+'. Your secret word is '+r.me.word+'. The hunt starts in 10 seconds.'); }
      else if(s.status==='hunt'&&r&&r.me)say('The hunt is on. Scan their QR to find your squad.');
      else if(s.status==='break'&&r&&r.results&&r.results.rank)say('Round '+roundNo()+' over. You are '+ord(r.results.rank)+' of '+r.results.of+' with '+n0(r.results.total)+' points.');
      else if(s.status==='over'&&s.final&&s.final.rank)say('Game over. You finished '+ord(s.final.rank)+' of '+s.final.of+' with '+n0(s.final.total)+' points.');
      else if(s.status==='lobby'&&s.joined)say('You’re in the lobby.');
    }
    const n=r&&r.notice; if(prev&&n&&n.kind&&(!pr||!pr.notice||pr.notice.at!==n.at||pr.notice.kind!==n.kind)){ haptic('light'); say(n.kind==='teammate_away'?first(n.name)+' is away. Their word was '+n.word+'.':n.kind==='teammate_back'?first(n.name)+' is back. Scan them again.':'Your squad is down to you.'); }
    if(prev&&r&&r.me&&r.me.away&&!(pr&&pr.me&&pr.me.away))say('You were marked away. Reconnecting.');
  }
  render();
}

/* ---------------------------------------------------------------- connecting */
function setFatal(code,message){
  const by={not_allowed:['Not open to you','Secret Squad isn’t open to your account. If you think it should be, ask your HR team.'],
    no_office:['No office yet','We don’t know which office you play in yet. Ask your HR team to add you to the office list.'],
    no_ticket:['Open it in Sowaka','Open Secret Squad from the Games tab in the Sowaka app.']};
  const d=by[code]||['Can’t play right now',message||'Close and reopen Secret Squad to keep playing.'];
  fatal={code:code||'fatal',title:d[0],message:message&&!by[code]?message:d[1]}; online=true; render(); }
function start(){
  if(conn||connecting)return;
  if(!NET){ setFatal('no_ticket'); return; }
  let auth;
  if(WEB){ if(!token){ render(); return; } auth={token}; }
  else if(Q&&Q.ticket)auth={ticket:Q.ticket};
  else if(window.SquadPreview)auth={ticket:'preview'};
  else { setFatal('no_ticket'); return; }
  connecting=true;
  conn=NET.connect(auth,{
    state:onState,
    fatal:(p)=>{ setFatal(p&&p.code,p&&p.message); },
    online:(on)=>{ if(on===online)return; online=on; offlineSince=on?0:Date.now(); if(on&&conn)try{ conn.sync(); }catch(e){} render(); },
    authFailed:(message)=>{ if(WEB){ store.del(TOKEN_KEY); token=null; try{ conn&&conn.close(); }catch(e){} conn=null; connecting=false; st=null;
        ui.signin={step:'email',email:ui.signin.email,otp:'',busy:false,error:message||'Please sign in again.',note:''}; render(); }
      else setFatal('ticket',message); }
  });
  connecting=false;
}

/* ---------------------------------------------------------------- browser sign-in: email, then the 6-digit code */
async function post(path,body,bearer){ const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:Object.assign({'Content-Type':'application/json'},bearer?{Authorization:'Bearer '+bearer}:{}),body:JSON.stringify(body||{})});
  let j=null; try{ j=await r.json(); }catch(e){}
  if(!r.ok||(j&&j.success===false))throw Object.assign(new Error((j&&j.message)||(r.status===429?'Too many tries. Wait a minute and try again.':'Something went wrong. Try again.')),{status:r.status});
  return j||{}; }
const AUTH=(NET&&NET.auth)||{request:email=>post('/auth/request-otp',{email}),verify:(email,otp)=>post('/auth/verify-otp',{email,otp}),logout:t=>post('/auth/logout',{},t)};
async function sendCode(){ const g=ui.signin; const em=$('em'); g.email=String(em?em.value:g.email).trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email)){ g.error='Enter your work email.'; render(); return; }
  g.busy=true; g.error=''; render();
  try{ await AUTH.request(g.email); store.set(EMAIL_KEY,g.email); g.step='otp'; g.otp=''; g.note='We emailed a code to '+g.email+'.'; say(g.note); }
  catch(e){ g.error=e.message; }
  finally{ g.busy=false; render(); } }
async function verify(){ const g=ui.signin; if(g.otp.length!==6||g.busy)return; g.busy=true; g.error=''; render();
  try{ const j=await AUTH.verify(g.email,g.otp); if(!j||!j.token)throw new Error('That code didn’t work. Try again.');
    token=j.token; store.set(TOKEN_KEY,token); g.busy=false; g.otp=''; render(); start(); }
  catch(e){ g.busy=false; g.error=e.message||'That code is wrong or has expired.'; g.otp=''; const o=$('otp'); if(o)o.value=''; haptic('heavy'); render(); } }
async function signOut(){ const t=token; token=null; store.del(TOKEN_KEY); try{ conn&&conn.close(); }catch(e){} conn=null; st=null; lastV=-1; lastSid=null; fatal=null;
  ui.signin={step:'email',email:ui.signin.email,otp:'',busy:false,error:'',note:''}; render(); try{ if(t&&AUTH.logout)await AUTH.logout(t); }catch(e){} }

/* ---------------------------------------------------------------- taps and keys */
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]'); if(!b||b.disabled)return; const a=b.getAttribute('data-act');
  if(a==='how-dim'&&e.target!==b)return;                 // a tap inside the sheet is not a tap on the dimmed page
  switch(a){
    case 'join': act('squad:join',{},'You’re in the lobby.'); break;
    case 'leave': act('squad:leave',{},'You left the lobby.'); break;
    case 'how': openHow(); break;
    case 'how-close': case 'how-dim': closeHow(); break;
    case 'how-next': if(ui.how&&ui.how.i>=5)closeHow(); else howTo((ui.how?ui.how.i:0)+1); break;
    case 'how-go': howTo(+b.getAttribute('data-i')||0); break;
    case 'scan': haptic('light'); startScan(); break;
    case 'back': ui.mode='main'; render(); break;
    case 'seen': ui.seen[b.getAttribute('data-id')]=1; seenSave(); ui.mode='main'; haptic('light'); render(); break;
    case 'done': ui.seenDone[roundKey()]=1; seenSave(); haptic('light'); render(); break;
    case 'notice': ui.seenNotice[b.getAttribute('data-key')]=1; render(); break;
    case 'fullboard': { const s=S_(); ui.board={sessionId:s?s.id:'',asked:false,data:null,error:null}; render(); break; }
    case 'board-close': ui.board=null; render(); break;
    case 'close': try{ window.Sowaka.close(); }catch(err){} break;
    case 'send': sendCode(); break;
    case 'verify': verify(); break;
    case 'signout': signOut(); break;
  }
});
document.addEventListener('input',e=>{
  if(e.target.id==='em'){ ui.signin.email=e.target.value; }
  if(e.target.id==='otp'){ const d=String(e.target.value||'').replace(/\D/g,'').slice(0,6); if(e.target.value!==d)e.target.value=d; ui.signin.otp=d; paintOtp(); if(d.length===6)verify(); }
});
document.addEventListener('keydown',e=>{
  if(e.target&&e.target.id==='em'&&e.key==='Enter'){ e.preventDefault(); sendCode(); return; }
  if(ui.how){ if(e.key==='Escape'){ e.preventDefault(); closeHow(); } else if(e.key==='ArrowRight')howTo(ui.how.i+1); else if(e.key==='ArrowLeft')howTo(ui.how.i-1);
    else if(e.key==='Tab'){ const f=[...document.querySelectorAll('.sheet button')]; if(f.length){ const i=f.indexOf(document.activeElement); if(e.shiftKey&&i<=0){ e.preventDefault(); f[f.length-1].focus(); } else if(!e.shiftKey&&i===f.length-1){ e.preventDefault(); f[0].focus(); } } }
    return; }
  if(cur.key==='scan'&&e.key==='Escape'){ ui.mode='main'; render(); }
});
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'){ if(conn)try{ conn.sync(); }catch(e){} render(); } else camera(false); });
document.addEventListener('error',e=>{ const t=e.target; if(t&&t.tagName==='IMG'&&t.closest&&t.closest('.av'))t.remove(); },true);   // a photo that won't load leaves the initials
if(document.fonts&&document.fonts.load)document.fonts.load('800 20px Lexend').then(()=>{ cur.html=null; render(); },()=>{});
window.addEventListener('sowaka-ready',()=>{ document.documentElement.classList.add('app'); wantBoard(); motion(); render(); });
try{ const mq=window.matchMedia('(prefers-reduced-motion: reduce)'); (mq.addEventListener?mq.addEventListener.bind(mq,'change'):mq.addListener.bind(mq))(()=>{ motion(); render(); }); }catch(e){}
motion();

setInterval(()=>{ tick(); },250);
setInterval(()=>{ if(document.visibilityState!=='hidden')render(); },1000);

/* For the preview and the tests: what the page holds, read-only. */
window.__squadPage={state:()=>st,ui:()=>({mode:ui.mode,key:cur.key,how:ui.how?ui.how.i:null,board:!!ui.board,move:MOVE}),now,render};

render();
start();
})();
