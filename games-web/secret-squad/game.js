/* Secret Squad: the page. Everything it shows comes from the server's latest `squad:state` (docs/secret-squad.md); the page only
   keeps what is local by nature: which view is open (the keypad, the camera, your QR), the digits typed so far, which results and
   notices have been seen, and the points of rounds it watched end. The connection is behind one small interface, so the same page
   runs against the real server (live.js: socket.io, `/squad` on `/connect/socket`) and the simulated one (preview.js):
     NET.connect(auth, {state, fatal, online, authFailed}) -> {request(event, payload) -> Promise of ack data, sync(), close()}
   auth is {ticket} in the app, {token} in a browser after the email-code sign-in. */
(function(){
'use strict';
if(window.__squadHopping)return;                        // live.js is reloading the page onto a copy that may reach the server

const Q=(window.__SQUAD&&typeof window.__SQUAD==='object')?window.__SQUAD:null;
const NET=window.SquadLive||window.SquadPreview||null;
const WEB=!!(Q&&Q.web&&!Q.ticket);
const TOKEN_KEY='sowaka.secretSquad.token', EMAIL_KEY='sowaka.secretSquad.email', MEMO_KEY='sowaka.secretSquad.memo';
const DEFAULT_LOCK_MS=45000, AWAY_AFTER_MS=60000;

const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store={get(k){try{return window.localStorage.getItem(k);}catch(e){return null;}},set(k,v){try{window.localStorage.setItem(k,v);}catch(e){}},
  del(k){try{window.localStorage.removeItem(k);}catch(e){}}};
const memo={get(k){try{return JSON.parse(window.sessionStorage.getItem(MEMO_KEY)||'{}')[k];}catch(e){return undefined;}},
  set(k,v){try{const m=JSON.parse(window.sessionStorage.getItem(MEMO_KEY)||'{}');m[k]=v;window.sessionStorage.setItem(MEMO_KEY,JSON.stringify(m));}catch(e){}}};
const haptic=k=>{try{const S=window.Sowaka;if(S&&typeof S.haptic==='function')S.haptic(k);}catch(e){}};
const reduced=()=>{try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches||!!(window.Sowaka&&window.Sowaka.reduceMotion);}catch(e){return false;}};

/* ---------------------------------------------------------------- the clock: the server's, corrected by `now` on every state */
let skew=0;
const now=()=>Date.now()+skew;
const pad2=n=>String(n).padStart(2,'0');
function fmt(ms,padded){ let s=Math.max(0,Math.ceil(ms/1000)); const h=Math.floor(s/3600); s-=h*3600; const m=Math.floor(s/60); s-=m*60;
  return h?h+':'+pad2(m)+':'+pad2(s):(padded?pad2(m):m)+':'+pad2(s); }
const mins=ms=>Math.round(ms/60000);
function dayOf(ms){ const d=new Date(ms), t=new Date(now()), a=new Date(t.getFullYear(),t.getMonth(),t.getDate()).getTime(), b=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
  const diff=Math.round((b-a)/864e5); if(diff===0)return 'Today'; if(diff===1)return 'Tomorrow';
  try{ return d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}).replace(',',''); }catch(e){ return d.toDateString().slice(0,10); } }
function hm(ms){ const d=new Date(ms); let h=d.getHours(); const m=d.getMinutes(), ap=h<12?'am':'pm'; h=h%12||12; return h+':'+pad2(m)+' '+ap; }
const ord=n=>{ const v=n%100; return n+((v>10&&v<14)?'th':({1:'st',2:'nd',3:'rd'}[n%10]||'th')); };
const first=name=>String(name||'').trim().split(/\s+/)[0]||'Someone';
const hue=id=>{ let h=0; for(const c of String(id||''))h=(h*31+c.charCodeAt(0))>>>0; return h%360; };
const cap=w=>{ const s=String(w||''); return s.charAt(0).toUpperCase()+s.slice(1).toLowerCase(); };

/* ---------------------------------------------------------------- what the page holds */
let st=null, lastV=-1, lastSid=null;           // the latest squad:state, its version and session
let conn=null, online=true, offlineSince=0, fatal=null, connecting=false;
const ui={mode:'main', digits:'', bad:false, sending:false, answering:null, intro:{}, seenResult:{}, seenNotice:{}, mine:{}, declined:{}, known:{},
  toast:null, toastT:0, scanHint:'', camFailed:false, lastCode:null,
  signin:{step:'email', email:store.get(EMAIL_KEY)||'', otp:'', busy:false, error:'', note:''}};
let token=WEB?store.get(TOKEN_KEY):null;

const S_=()=>st&&st.session||null;
const R_=()=>{ const s=S_(); return s&&s.round||null; };
const P_=()=>{ const r=R_(); return r&&r.player||null; };
const SQ_=()=>{ const r=R_(); return r&&r.squad||null; };
const cfg=i=>{ const s=S_(); return (s&&Array.isArray(s.rounds)&&s.rounds[i])||{}; };
const roundKey=()=>{ const s=S_(); return s?s.id+':'+(s.roundIndex|0):''; };
const lockMs=()=>{ const s=S_(); const c=s?cfg(s.roundIndex|0):{}; return +c.lockMs>0?+c.lockMs:DEFAULT_LOCK_MS; };
const office=()=>(st&&st.office)||'';
const sizeLabel=n=>n===2?'pairs':'squads of '+n;
function roundLabel(i){ const s=S_(); if(!s)return ''; const c=cfg(i), n=s.roundCount||(s.rounds||[]).length||1;
  const size=c.squadSize?(c.squadSize===2?'find your pair':'squads of '+c.squadSize):'';
  return (n>1?'Round '+(i+1)+' of '+n:'One round')+(size?' · '+size:''); }
function roundsSummary(rounds){ if(!Array.isArray(rounds)||!rounds.length)return '';
  const sizes=rounds.map(r=>r.squadSize).filter(Boolean);
  if(rounds.length===1)return 'One round'+(sizes[0]?' · '+sizeLabel(sizes[0]):'')+(rounds[0].huntMs?' · '+mins(rounds[0].huntMs)+' min':'');
  const uniq=[...new Set(sizes)];
  return rounds.length+' rounds'+(sizes.length?' · '+(uniq.length===1?sizeLabel(uniq[0]):'squads of '+sizes.slice(0,-1).join(', ')+' and '+sizes[sizes.length-1]):''); }
const locked=()=>{ const p=P_(); return !!(p&&p.lockedUntil&&p.lockedUntil>now()); };
const openAsk=()=>{ const r=R_(); const a=r&&r.ask; return a&&a.id&&!(a.expiresAt&&a.expiresAt<now()-1500)?a:null; };
const openAsking=()=>{ const r=R_(); const a=r&&r.asking; return a&&a.id&&!(a.expiresAt&&a.expiresAt<now()-1500)?a:null; };
const finished=()=>{ const q=SQ_(); return !!(q&&q.finishedAt); };

/* When a hunt started: the round says so if the server sends it; else the page remembers it from the hunt it watched. */
function huntStart(i){ const r=R_(); if(r&&+r.huntStartedAt)return +r.huntStartedAt; const s=S_(); return s?memo.get('hs:'+s.id+':'+i)||null:null; }
/* A finish time as m:ss into the hunt: finishedAt is taken as a server timestamp, or as ms into the hunt when it is that small. */
function elapsedOf(fin,i){ if(!fin)return null; if(fin<1e11)return fin; const hs=huntStart(i); return hs?Math.max(0,fin-hs):null; }
/* Points as the rules pay them, shown only when the round says what it pays (pointsPerMember, timeBonusPerSecond); else not guessed. */
function pointsFor(linked,fin,i){ const c=cfg(i); if(!(+c.pointsPerMember>=0)||c.pointsPerMember==null)return null;
  let p=(linked>1?linked:0)*(+c.pointsPerMember); const el=elapsedOf(fin,i);
  if(fin&&el!=null&&c.huntMs&&c.timeBonusPerSecond!=null)p+=Math.floor(Math.max(0,(c.huntMs-el)/1000)*(+c.timeBonusPerSecond)); return p; }

/* ---------------------------------------------------------------- small pieces of markup */
const T=(at,padded,cls)=>'<span class="num'+(cls?' '+cls:'')+'" data-cd="'+(+at||0)+'"'+(padded?' data-p="1"':'')+'></span>';
function av(p,cls){ const ini=esc(String((p&&(p.initials||first(p.name)))||'?').charAt(0).toUpperCase());
  const img=p&&p.photoUrl&&/^(https:\/\/|\/(?!\/))/.test(p.photoUrl)?'<img alt="" src="'+esc(p.photoUrl)+'">':'';
  return '<span class="av'+(cls?' '+cls:'')+'" style="--h:'+hue(p&&(p.userId||p.name))+'" aria-hidden="true">'+ini+img+'</span>'; }
const bar=(badge,right)=>'<div class="bar"><span class="badge">'+esc(badge)+'</span>'+(right||'')+'</div>';
const clock=(at,padded)=>'<span class="clock" data-low="'+(+at||0)+'">'+T(at,padded)+'</span>';
const whereChip=()=>WEB?'<span class="where">Browser</span>':'';
const btn=(label,act,cls,extra)=>'<button type="button" class="btn'+(cls?' '+cls:'')+'" data-act="'+act+'"'+(extra||'')+'>'+label+'</button>';
const icoQr='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#FFCC2E" stroke-width="2.2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>';
function howItWorks(){ const s=S_(), n=s||st&&st.next, c=(n&&n.rounds&&n.rounds[0])||{}, lk=Math.round(((s&&cfg(0).lockMs)||DEFAULT_LOCK_MS)/1000);
  return '<div class="box steps"><b>How it works</b>'+
    '<span>1. You get a word. Some colleagues’ words share a secret theme with it.</span>'+
    '<span>2. Check their code. Same squad: you’re linked. Wrong: both wait '+lk+' s.</span>'+
    '<span>3. Link your whole squad before '+(c.huntMs?fmt(c.huntMs):'the clock')+' runs out.</span></div>'; }
function foot(){ if(!WEB)return ''; const me=st&&st.me;
  return '<div class="foot">'+(me&&me.name?'<span>Playing as '+esc(me.name)+'</span><span aria-hidden="true">·</span>':'')+'<button type="button" class="link" style="padding:0;min-height:0" data-act="signout">Sign out</button></div>'; }

/* Your squad: who you have linked (with their words), away teammates' words, and a ? for each still to find. */
function squadBox(withNames){ const q=SQ_(); if(!q)return ''; const rk=roundKey(); const known=ui.known[rk]||(ui.known[rk]={});
  const linked=(Array.isArray(q.linked)?q.linked:[]).slice().sort((a,b)=>(b.me?1:0)-(a.me?1:0)), away=Array.isArray(q.awayWords)?q.awayWords:[];
  const present=linked.filter(m=>!m.away).length, needed=q.needed||q.size||0;
  const chips=[];
  for(const m of linked){ const isNew=!m.me&&!known[m.userId]; known[m.userId]=1;
    const label=m.me&&withNames?'You · '+esc(cap(m.word))+(m.away?' · away':''):m.away?'Away · '+esc(cap(m.word)):(withNames?esc(first(m.name))+' · ':'')+esc(cap(m.word));
    chips.push('<span class="chip '+(m.away?'away':'ok')+(isNew?' new':'')+'">'+(m.away?'':'✓ ')+label+'</span>'); }
  for(const a of away)chips.push('<span class="chip away">Away · '+esc(cap(a.word))+'</span>');
  for(let i=0;i<Math.max(0,q.unknown|0)&&i<24;i++)chips.push('<span class="chip q" aria-label="not found yet">?</span>');
  const words=linked.map(m=>cap(m.word)).concat(away.map(a=>cap(a.word))).filter(Boolean);
  let hint;
  if(words.length<2)hint='Say your word out loud and listen for words that could share a theme with it.';
  else{ const left=q.unknown|0; hint=words.slice(0,-1).join(', ')+' and '+words[words.length-1]+': what links them?'+(left?' '+(left===1?'One':left)+' left to find.':''); }
  if(needed<=1&&!q.finishedAt)hint='Everyone else in your squad left the game, so it can’t finish. Links you made still count.';
  return '<div class="box"><div class="row"><b>Your squad</b><span class="s">'+present+' of '+needed+' linked</span></div>'+
    '<div class="chips">'+chips.join('')+'</div><span class="s">'+esc(hint)+'</span></div>'; }

function noticeBox(){ const r=R_(); const n=r&&r.notice; if(!n||!n.kind)return ''; const key=n.kind+'|'+n.name+'|'+n.at;
  if(ui.seenNotice[key]||(n.at&&now()-n.at>90000))return ''; const q=SQ_()||{}; const nm=esc(first(n.name)), w=esc(cap(n.word));
  let title, body;
  if(n.kind==='teammate_away'){ title=nm+' left the game'; body=(w?'Their word was '+w+'. ':'')+(q.needed?'Your squad now needs '+q.needed+', not '+(q.needed+1)+'.':''); }
  else if(n.kind==='teammate_back'){ title=nm+' is back'; body=(w?'Their word is '+w+'. ':'')+'Check them again to link them.'; }
  else if(n.kind==='squad_left'){ title='Your squad is down to you'; body='Everyone else left the game, so your squad can’t finish. You keep points for links you made.'; }
  else return '';
  return '<div class="box warn" role="note"><b>'+title+'</b><span class="s">'+body+'</span><button type="button" class="x" data-act="notice" data-key="'+esc(key)+'" aria-label="Dismiss">×</button></div>'; }

function codeCard(){ const p=P_()||{};
  if(p.away)return '<div class="code off"><small>YOUR CODE</small>Away</div>';
  if(!p.code)return '<div class="code off"><small>YOUR CODE</small>—</div>';
  const fresh=ui.lastCode&&ui.lastCode!==p.code; ui.lastCode=p.code;
  return '<div class="code'+(fresh?' fresh':'')+'" aria-label="Your code '+esc(String(p.code).split('').join(' '))+'"><small>YOUR CODE</small>'+
    String(p.code).split('').map((d,i)=>'<span class="d" style="animation-delay:'+(i*40)+'ms">'+esc(d)+'</span>').join('')+
    (p.qr&&typeof window.qrcode==='function'?'<button type="button" class="qrb" data-act="qr" aria-label="Show my QR code">'+icoQr+'</button>':'')+'</div>'; }
const rotLine=()=>{ const p=P_()||{}; return p.code&&p.codeExpiresAt?'<div class="rot">New code in '+T(p.codeExpiresAt)+'</div>':''; };

/* ---------------------------------------------------------------- scanning: the app's scanner, else the browser's camera, else typing */
const canNativeScan=()=>{ const S=window.Sowaka; return !!(S&&typeof S.scanQr==='function'); };
const canCamera=()=>!ui.camFailed&&!(window.Sowaka&&window.Sowaka.native)&&!!(navigator.mediaDevices&&typeof navigator.mediaDevices.getUserMedia==='function')&&
  window.isSecureContext!==false&&typeof window.jsQR==='function';
const canScan=()=>canNativeScan()||canCamera();

/* ---------------------------------------------------------------- the screens */
function view(){
  if(fatal)return vFatal();
  if(WEB&&!token)return vSignin();
  if(!st)return {key:'connecting',html:bar('Secret Squad',whereChip())+'<div class="grow"></div><div class="center"><div class="env" aria-hidden="true"></div><p class="s">Connecting…</p></div><div class="grow"></div>'};
  const s=S_();
  if(!s)return vNone();
  if(s.status==='cancelled')return vCancelled();
  if(s.status==='lobby')return vLobby();
  if(s.status==='over')return vOver();
  if(s.status==='break')return vBreak();
  if(!s.joined)return vNotJoined();
  if(!s.playing||!R_()||!P_())return vWaiting();
  if(s.status==='dealing')return vWord();
  if(s.status==='hunt'){
    if(finished())return vDone();
    if(!ui.intro[roundKey()])return vWord();
    const r=pendingResult(); if(r)return r.kind==='match'?vMatch(r):vMiss(r);
    if(ui.mode==='keypad')return vKeypad();
    if(ui.mode==='scan')return vScan();
    if(ui.mode==='qr')return vQr();
    return vHunt();
  }
  return vWaiting();
}

function vFatal(){ return {key:'fatal',html:bar('Secret Squad',whereChip())+'<div class="grow"></div><div class="mark nope" aria-hidden="true">!</div>'+
  '<h1 class="big" style="font-size:32px" tabindex="-1">'+esc(fatal.title||'Can’t play right now')+'</h1><p class="s center">'+esc(fatal.message)+'</p><div class="grow"></div>'+foot()}; }

function vSignin(){ const g=ui.signin, otp=g.step==='otp';
  return {key:'signin:'+g.step,html:bar('Secret Squad','<span class="where">Browser</span>')+
    '<h1 class="t" style="margin-top:18px" tabindex="-1">Sign in to play</h1><p class="s">Use the email you use for Sowaka.</p>'+
    '<input class="field" id="em" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@company.com" aria-label="Work email"'+(g.busy?' disabled':'')+'>'+
    (otp?btn('Send a new code','send','ghost',g.busy?' disabled':''):btn(g.busy?'Sending…':'Email me a code','send','',g.busy?' disabled':''))+
    (otp?'<p class="s" style="margin-top:6px">'+(g.note?esc(g.note)+' ':'')+'Then enter the code:</p>'+
      '<label class="otp"><span class="sr">6-digit code</span><div class="digits six" id="otpbox" aria-hidden="true">'+'<span></span>'.repeat(6)+'</div>'+
      '<input id="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*"'+(g.busy?' disabled':'')+'></label>'+
      btn(g.busy?'Checking…':'Sign in','verify','',' id="vbtn" disabled'):'')+
    (g.error?'<p class="err" role="alert">'+esc(g.error)+'</p>':'')+
    '<p class="s center push">You stay signed in on this phone</p>'}; }

function vNone(){ const n=st.next, o=office();
  if(!n||!n.startsAt)return {key:'none',html:bar(o||'Secret Squad',whereChip())+'<div class="env" aria-hidden="true"></div>'+
    '<h1 class="t center" tabindex="-1">No game scheduled</h1><p class="s center">'+(o?'Nothing is on the calendar for '+esc(o)+' yet. ':'')+'A post on the feed will say when the next Secret Squad is.</p>'+howItWorks()+'<div class="grow"></div>'+foot()};
  const opens=n.lobbyOpensAt||n.startsAt;
  return {key:'next',html:bar(o||'Secret Squad',whereChip())+'<div class="env" aria-hidden="true"></div>'+
    '<p class="s center" style="font-weight:700;letter-spacing:.08em">NEXT SECRET SQUAD</p><h1 class="when" tabindex="-1">'+esc(dayOf(n.startsAt))+' · '+esc(hm(n.startsAt))+'</h1>'+
    (n.rounds&&n.rounds.length?'<div class="center"><span class="chip y">'+esc(roundsSummary(n.rounds))+'</span></div>':'')+
    '<div class="count"><span>'+(opens>now()?'Lobby opens in':'Lobby open')+'</span><b>'+(opens>now()?T(opens):'Now')+'</b></div>'+howItWorks()+'<div class="grow"></div>'+foot()}; }

function vCancelled(){ const n=st.next;
  return {key:'cancelled',html:bar(office()||'Secret Squad',whereChip())+'<div class="grow"></div><div class="mark nope" aria-hidden="true">✕</div>'+
    '<h1 class="big" style="font-size:34px" tabindex="-1">Called off</h1><p class="s center">This Secret Squad was called off. No points were given for an unfinished round.</p>'+
    (S_().totalPoints?'<div class="box hi row"><b>You earned</b><span class="earn">+'+(S_().totalPoints|0)+' pts</span></div>':'')+
    (n&&n.startsAt?'<div class="box center"><span class="s">Next game</span><b>'+esc(dayOf(n.startsAt))+' · '+esc(hm(n.startsAt))+'</b></div>':'')+'<div class="grow"></div>'+foot()}; }

function vLobby(){ const s=S_(), o=office(), faces=Array.isArray(s.faces)?s.faces.slice(0,12):[], more=Math.max(0,(s.players|0)-faces.length);
  return {key:'lobby',html:bar(o||'Secret Squad',clock(s.phaseEndsAt))+
    '<div class="big num" style="font-size:64px;margin-top:6px">'+(s.players|0)+'</div><p class="s center" style="margin-top:-8px">'+((s.players|0)===1?'person':'people')+' in the '+esc(o||'')+' lobby</p>'+
    (faces.length?'<div class="avs" style="justify-content:center">'+faces.map(f=>av(f)).join('')+(more?'<span class="av more">+'+more+'</span>':'')+'</div>':'')+
    (s.rounds&&s.rounds.length?'<div class="center"><span class="chip y">'+esc(roundsSummary(s.rounds))+'</span></div>':'')+
    howItWorks()+
    '<p class="s center push">Squads are made at '+esc(hm(s.startsAt||s.phaseEndsAt))+'</p>'+
    (s.joined?btn('Leave the lobby','leave','ghost',ui.sending?' disabled':''):btn('Join the lobby','join','go',ui.sending?' disabled':''))+foot()}; }

function vNotJoined(){ const s=S_(), last=(s.roundIndex|0)>=(s.roundCount||1)-1;
  return {key:'notjoined',html:bar(office()||'Secret Squad',clock(s.phaseEndsAt,true))+'<div class="rlabel"><span>'+esc(roundLabel(s.roundIndex|0))+'</span></div>'+
    '<div class="env" aria-hidden="true"></div><h1 class="t center" tabindex="-1">A round is on</h1>'+
    '<p class="s center">'+(s.players|0)+' people in '+esc(office())+' are hunting for their squads.'+(last?' This is the last round.':' Join now to play from the next round.')+'</p>'+
    boardBox()+'<div class="grow"></div>'+(last?'':btn('Join for round '+((s.roundIndex|0)+2),'join','go',ui.sending?' disabled':''))+foot()}; }

function vWaiting(){ const s=S_(), last=(s.roundIndex|0)>=(s.roundCount||1)-1, next=(s.roundIndex|0)+2;
  return {key:'waiting',html:bar(office()||'Secret Squad',clock(s.phaseEndsAt,true))+'<div class="rlabel"><span>'+esc(roundLabel(s.roundIndex|0))+'</span></div>'+
    '<div class="env" aria-hidden="true"></div><h1 class="t center" tabindex="-1">'+(last?'Last round is on':'You’re in for round '+next)+'</h1>'+
    '<p class="s center">'+(last?'You joined after this round started. Watch how the squads are doing.':'Round '+((s.roundIndex|0)+1)+' was already dealt when you joined. You get a word when round '+next+' starts.')+'</p>'+
    boardBox()+'<div class="grow"></div>'+foot()}; }

function boardBox(){ const r=R_(); const b=r&&r.board; if(!b||!b.squads)return '';
  return '<p class="s" style="margin-bottom:-6px">'+esc(office())+' board</p><div class="rank"><em>✓</em><b>'+(b.finished|0)+' of '+b.squads+' squads done</b><small>'+(b.hunting|0)+' still hunting'+(b.stuck?'<br>'+b.stuck+' can’t finish':'')+'</small></div>'; }

function vWord(){ const s=S_(), p=P_(), q=SQ_()||{}, dealing=s.status==='dealing', c=cfg(s.roundIndex|0);
  const others=Math.max(0,(q.size||c.squadSize||2)-1), word=esc(String(p.word||'').toUpperCase());
  const ques=Math.min(others,11), more=others-ques;
  return {key:'word:'+roundKey(),dark:true,html:bar('Secret Squad',dealing?'<span class="clock"><span class="num" data-static="'+(c.huntMs||0)+'"></span></span>':clock(s.phaseEndsAt,true))+
    '<div class="rlabel"><span>'+esc(roundLabel(s.roundIndex|0))+'</span></div>'+
    '<p class="s center" style="margin-top:8px;font-weight:700;letter-spacing:.1em">YOUR WORD</p>'+
    '<h1 class="word" tabindex="-1"><small>KEEP IT ON YOUR SCREEN</small>'+word+'</h1>'+
    '<div class="box"><b>'+(others===1?'1 other shares':others+' others share')+' a secret theme with '+esc(cap(p.word))+'.</b>'+
    '<span class="s">Nobody knows the theme, not even you. Some words are made to look like they belong together when they don’t.</span></div>'+
    '<div class="avs" style="justify-content:center;margin-top:2px">'+av({initials:st.me&&st.me.initials,name:st.me&&st.me.name,userId:st.me&&st.me.userId})+
      '<span class="av more">?</span>'.repeat(ques)+(more?'<span class="av more">+'+more+'</span>':'')+'</div>'+
    '<div class="grow"></div>'+
    (dealing?'<button type="button" class="btn no" disabled>Hunt starts in '+T(s.phaseEndsAt)+'</button>':btn('Start hunting','intro','go'))}; }

function huntBar(){ const s=S_(), p=P_()||{}; return bar(String(p.word||'Secret Squad'),clock(s.phaseEndsAt,true))+
  '<div class="rlabel"><span>'+esc(roundLabel(s.roundIndex|0))+'</span>'+(R_().board&&R_().board.squads?'<span><b>'+(R_().board.finished|0)+'</b> of '+R_().board.squads+' squads done</span>':'')+'</div>'; }

function checkButtons(){ const ask=openAsk(), asking=openAsking(), p=P_()||{};
  if(p.away)return '';
  if(locked())return '<div class="box"><div class="row"><b>Checks paused</b><span class="redt">'+T(p.lockedUntil)+'</span></div>'+
    '<div class="lockbar"><i data-lock="'+(p.lockedUntil-lockMs())+'|'+p.lockedUntil+'"></i></div><span class="s">Your code still works: teammates can check you while you wait.</span></div>'+
    '<button type="button" class="btn no" disabled>Check again in '+T(p.lockedUntil)+'</button>';
  if(asking)return '<button type="button" class="btn no" disabled>Waiting for '+esc(first(asking.toName))+'…</button>';
  if(ask)return '<button type="button" class="btn no" disabled>Answer '+esc(first(ask.fromName))+' first</button>';
  if(canScan())return '<div class="btns">'+btn('Type a code','keypad')+btn('Scan a code','scan','ghost')+'</div>';
  return btn('Enter a colleague’s code','keypad'); }

function vHunt(){ const p=P_()||{};
  return {key:'hunt',html:huntBar()+noticeBox()+
    (p.away?'<div class="box warn"><b>You were away</b><span class="s">Your squad stopped counting on you. Stay on this screen and ask a teammate to check you again.</span></div>':'')+
    codeCard()+rotLine()+checkButtons()+squadBox(true)+'<div class="grow"></div>'}; }

function vKeypad(){ const s=S_(), ask=openAsk(), asking=openAsking();
  const keys=[1,2,3,4,5,6,7,8,9].map(n=>'<button type="button" data-act="key" data-k="'+n+'" aria-label="'+n+'">'+n+'</button>').join('')+
    '<button type="button" class="sm" data-act="key" data-k="c">Clear</button><button type="button" data-act="key" data-k="0" aria-label="0">0</button><button type="button" class="sm" data-act="key" data-k="b" aria-label="Delete">⌫</button>';
  const blocked=locked()?'Check again in '+T(P_().lockedUntil):asking?'Waiting for '+esc(first(asking.toName))+'…':ask?'Answer '+esc(first(ask.fromName))+' first':'';
  return {key:'keypad',html:bar(String(P_().word||''),clock(s.phaseEndsAt,true))+
    '<h1 class="t center" style="font-size:24px;margin-top:6px" tabindex="-1">Whose code?</h1>'+
    '<div class="digits" id="kd" role="img" aria-label="Code typed so far"><span></span><span></span><span></span><span></span></div>'+
    '<p class="s center" id="khint" style="min-height:20px">Type the 4 digits on their screen.</p>'+
    '<div class="pad">'+keys+'</div><div class="grow"></div>'+
    (blocked?'<button type="button" class="btn no" disabled>'+blocked+'</button>':btn(ui.sending?'Checking…':'Check','check','',' id="kcheck" disabled'))+
    '<button type="button" class="link" data-act="back">Back to my code</button>'}; }

function vScan(){ const s=S_(), p=P_()||{};
  return {key:'scan',html:bar(String(p.word||''),WEB?'<span class="where">Browser</span>':clock(s.phaseEndsAt,true))+
    (p.qr?'<canvas class="qr sm" data-qr="'+esc(p.qr)+'" role="img" aria-label="Your QR code"></canvas>':'')+
    (p.code?'<div class="rot">or tell them your code: <b class="num">'+esc(String(p.code).split('').join(' '))+'</b> · new code in '+T(p.codeExpiresAt)+'</div>':'')+
    '<div class="cam'+(ui.camFailed?' fail':'')+'" id="cam">'+(ui.camFailed?'':'<video id="vid" playsinline muted autoplay></video>')+
      '<span id="camhint" aria-live="polite">'+esc(ui.camFailed?'The camera isn’t available here. Type the code instead.':(ui.scanHint||'Point at a colleague’s code'))+'</span></div>'+
    btn('Type a code instead','keypad','ghost')}; }

function vQr(){ const s=S_(), p=P_()||{};
  return {key:'qr',html:bar(String(p.word||''),clock(s.phaseEndsAt,true))+'<h1 class="t center" style="font-size:24px;margin-top:6px" tabindex="-1">Your QR code</h1>'+
    '<p class="s center">Let a colleague scan it, or read them the code.</p>'+
    (p.qr?'<canvas class="qr" data-qr="'+esc(p.qr)+'" role="img" aria-label="Your QR code"></canvas>':'')+codeCard().replace(/<button[^]*?<\/button>/,'')+rotLine()+'<div class="grow"></div>'+btn('Done','back','ghost')}; }

function pendingResult(){ const r=R_(); const x=r&&r.result; if(!x||!x.id||ui.seenResult[x.id])return null; if(x.kind!=='match'&&x.kind!=='miss')return null;
  if(x.at&&now()-x.at>120000)return null; return x; }
function vMatch(x){ const s=S_();
  return {key:'match:'+x.id,html:bar(String(P_().word||''),clock(s.phaseEndsAt,true))+'<div class="mark yes" aria-hidden="true">✓</div>'+
    '<h1 class="big" tabindex="-1">Same squad!</h1><p class="s center">'+esc(first(x.otherName))+(x.otherWord?' ('+esc(cap(x.otherWord))+')':'')+' is with you</p>'+
    squadBox(false)+'<div class="grow"></div>'+btn('Keep hunting','seen','',' data-id="'+esc(x.id)+'"')}; }
function vMiss(x){ const s=S_(), p=P_()||{}, lk=locked();
  return {key:'miss:'+x.id,html:bar(String(p.word||''),clock(s.phaseEndsAt,true))+'<div class="mark nope" aria-hidden="true">✕</div>'+
    '<h1 class="big" tabindex="-1">Different squads</h1><p class="s center">'+esc(first(x.otherName))+'’s word'+(x.otherWord?', '+esc(cap(x.otherWord))+',':'')+' isn’t in your squad</p>'+
    (lk?'<div class="box"><div class="row"><b>Checks paused</b><span class="redt">'+T(p.lockedUntil)+'</span></div><div class="lockbar"><i data-lock="'+(p.lockedUntil-lockMs())+'|'+p.lockedUntil+'"></i></div>'+
      '<span class="s">Your code still works: teammates can check you while you wait.</span></div>':'')+
    '<div class="grow"></div>'+(lk?'<button type="button" class="btn no" disabled>Check again in '+T(p.lockedUntil)+'</button><button type="button" class="link" data-act="seen" data-id="'+esc(x.id)+'">Back to my code</button>':btn('Keep hunting','seen','',' data-id="'+esc(x.id)+'"'))}; }

function vDone(){ const s=S_(), q=SQ_(), i=s.roundIndex|0, el=elapsedOf(q.finishedAt,i), linked=(q.linked||[]).length, pts=pointsFor(linked,q.finishedAt,i);
  const words=(q.linked||[]).slice().sort((a,b)=>(b.me?1:0)-(a.me?1:0)).map(m=>'<span class="chip '+(m.away?'away':'ok')+'">'+esc(cap(m.word))+'</span>').concat((q.awayWords||[]).map(a=>'<span class="chip away">'+esc(cap(a.word))+'</span>'));
  return {key:'done:'+roundKey(),dark:true,html:bar('Secret Squad',clock(s.phaseEndsAt,true))+'<div class="rlabel"><span>'+esc(roundLabel(i))+'</span></div>'+
    '<h1 class="big" style="font-size:34px;margin-top:8px;color:var(--yellow)" tabindex="-1">'+(el!=null?'All linked in '+fmt(el):'All linked!')+'</h1>'+
    '<p class="s center">'+(q.place?ord(q.place)+' in '+esc(office())+' so far':'Squad complete')+(pts!=null?' · +'+pts+' pts each':'')+'</p>'+
    '<div class="box center"><span class="s">YOUR SECRET THEME WAS</span>'+
      '<div class="t" style="font-size:34px">'+esc(q.theme||'Revealed at the end')+'</div><div class="chips" style="justify-content:center">'+words.join('')+'</div></div>'+
    boardBox()+'<p class="s center push">Your code has stopped working. Results come when the clock runs out.</p>'}; }

function rankRows(res,i){ const list=Array.isArray(res&&res.squads)?res.squads:[]; const medal=['🥇','🥈','🥉'];
  return '<div class="ranks">'+list.map(sq=>{ const el=elapsedOf(sq.finishedAt,i), pts=pointsFor(sq.linked|0,sq.finishedAt,i);
    const left=sq.finishedAt?(el!=null?fmt(el):hm(sq.finishedAt<1e11?now():sq.finishedAt).replace(' ','\u00a0')):(sq.linked|0)+' of '+(sq.size|0);
    return '<div class="rank'+(sq.mine?' me':'')+'"><em>'+(sq.finishedAt&&sq.place>=1&&sq.place<=3?medal[sq.place-1]:(sq.place|0))+'</em><b>'+esc(sq.theme||'')+
      '<span class="theme">'+(sq.words||[]).map(w=>esc(cap(w))).join(' · ')+'</span></b><small>'+left+(pts!=null?'<br>+'+pts:'')+'</small></div>'; }).join('')+'</div>'; }
function trickiest(res){ const t=res&&res.trickiest; if(!t||!t.word)return '';
  return '<div class="box" style="gap:3px"><b>Trickiest word: '+esc(cap(t.word))+'</b><span class="s">'+(t.checks|0)+' '+((t.checks|0)===1?'person':'people')+' from other squads checked the '+esc(cap(t.word))+' holder.</span></div>'; }

function vBreak(){ const s=S_(), i=s.roundIndex|0, r=R_()||{}, res=r.results, next=cfg(i+1), n=s.roundCount||(s.rounds||[]).length;
  const played=s.joined&&s.playing!==false&&res&&res.points!=null;
  return {key:'break:'+roundKey(),html:bar(n>1?'Round '+(i+1)+' results':(office()||'')+' results',clock(s.phaseEndsAt))+
    (played?'<div class="box hi row"><b>You earned</b><span class="earn">+'+(res.points|0)+' pts</span></div>':'')+
    (s.totalPoints?'<p class="s" style="margin-top:-4px">'+(s.totalPoints|0)+' pts so far this session</p>':'')+
    (s.joined&&!played?'<div class="box"><b>You\u2019re in for round '+(i+2)+'</b><span class="s">You joined after round '+(i+1)+' was dealt. You get a word when the next round starts.</span></div>':'')+
    (res?rankRows(res,i)+trickiest(res):'<p class="s center">Results are on their way…</p>')+
    '<div class="box navy push" style="gap:7px"><div class="row"><span class="chip y">ROUND '+(i+2)+' OF '+n+'</span><span class="s">'+esc(next.squadSize?(next.squadSize===2?'find your pair':'squads of '+next.squadSize):'')+(next.huntMs?' · '+mins(next.huntMs)+' min':'')+'</span></div>'+
      '<div class="t" style="font-size:30px">Next round in <span style="color:var(--yellow)">'+T(s.phaseEndsAt)+'</span></div><span class="s">New squads, new words. Keep this screen open.</span>'+
      (!s.joined?btn('Join for round '+(i+2),'join','go',ui.sending?' disabled':''):'')+'</div>'+foot()}; }

function vOver(){ const s=S_(), i=s.roundIndex|0, r=R_()||{}, res=r.results, n=s.roundCount||(s.rounds||[]).length;
  const per=[]; for(let k=0;k<n;k++){ const v=memo.get('pts:'+s.id+':'+k); if(v!=null)per.push('<span class="chip">R'+(k+1)+' +'+v+'</span>'); }
  const nx=st.next;
  return {key:'over:'+s.id,html:bar((office()||'Final')+' results',clock(now()-1))+
    '<div class="box navy center" style="gap:6px"><span class="s" style="letter-spacing:.08em;font-weight:700">'+(s.joined?'YOUR TOTAL':'SESSION OVER')+'</span>'+
      (s.joined?'<div class="total num">+'+(s.totalPoints|0)+' pts</div><span class="s">from '+(n>1?n+' rounds':'the round')+' of Secret Squad</span>'+(per.length>1?'<div class="split">'+per.join('')+'</div>':''):'<div class="t" style="font-size:28px">Thanks for watching</div>')+'</div>'+
    (res?(n>1?'<p class="s" style="font-weight:700;margin-bottom:-4px">'+esc(roundLabel(i))+'</p>':'')+
      (res.points!=null&&s.joined&&s.playing!==false?'<div class="box hi row"><b>You earned</b><span class="earn">+'+(res.points|0)+' pts</span></div>':'')+rankRows(res,i)+trickiest(res):'')+
    (nx&&nx.startsAt?'<div class="box center"><span class="s">Next game</span><b>'+esc(dayOf(nx.startsAt))+' · '+esc(hm(nx.startsAt))+'</b></div>':'')+
    '<div class="grow"></div>'+foot()}; }

/* ---------------------------------------------------------------- the layer: the Allow sheet, waiting for an Allow, the toast, the connection */
function layer(){ let h='';
  const s=S_(), hunting=s&&s.status==='hunt'&&s.playing;
  const ask=hunting&&openAsk();
  if(ask){ const busy=ui.answering===ask.id, lk=Math.round(lockMs()/1000);
    h+='<div class="dim"></div><div class="sheet" role="alertdialog" aria-labelledby="askt" aria-describedby="askd">'+
      '<div class="row">'+av({initials:ask.fromInitials,name:ask.fromName,userId:ask.fromName},'lg')+'<b id="askt">'+esc(first(ask.fromName))+' wants to check if you’re in the same squad</b></div>'+
      '<span class="s" id="askd">If you’re not, you both wait '+lk+' seconds before your next check.'+(ask.expiresAt?' <span class="ring">'+T(ask.expiresAt)+'</span>':'')+'</span>'+
      '<div class="btns">'+btn('Not now','deny','ghost',busy?' disabled':'')+btn('Allow','allow','',busy?' disabled':'')+'</div></div>';
  } else { const asking=hunting&&openAsking();
    if(asking)h+='<div class="sheet" role="status"><div class="row"><span class="spin" aria-hidden="true"></span><b>Waiting for '+esc(first(asking.toName))+' to tap Allow</b>'+
      (asking.expiresAt?'<span class="ring">'+T(asking.expiresAt)+'</span>':'')+'</div><span class="s">Ask them to answer on their phone. If they don’t, it ends by itself.</span></div>'; }
  if(ui.toast&&ui.toastT>Date.now())h+='<div class="toast'+(!online&&st?' up':'')+'" role="status">'+esc(ui.toast)+'</div>';
  if(!online&&!fatal&&st){ const long=offlineSince&&Date.now()-offlineSince>AWAY_AFTER_MS*.75&&s&&s.status==='hunt';
    h+='<div class="net" role="status"><span class="spin" aria-hidden="true"></span>'+(long?'Still reconnecting. After a minute away your squad stops waiting.':'Reconnecting…')+'</div>'; }
  return h; }

/* ---------------------------------------------------------------- drawing */
let cur={key:null,html:null}, curLayer=null;
function render(){
  const v=view(), m=$('screen');
  const changedKey=v.key!==cur.key;
  if(changedKey||v.html!==cur.html){
    m.innerHTML=v.html;
    if(changedKey){ m.classList.remove('in'); void m.offsetWidth; m.classList.add('in'); if(cur.key!==null){ try{ window.scrollTo(0,0); }catch(e){} const h=m.querySelector('h1[tabindex]'); if(h&&!/^signin/.test(v.key))try{ h.focus({preventScroll:true}); }catch(e){} } }
    after(v.key,changedKey);
  }
  document.body.classList.toggle('dark',!!v.dark);
  const tc=document.querySelector('meta[name="theme-color"]'); if(tc)tc.content=v.dark?'#141B3F':'#FFF9ED';
  cur=v;
  const l=layer(); if(l!==curLayer){ $('layer').innerHTML=l; curLayer=l; }
  tick();
  camera(v.key==='scan');
}
function after(key,changedKey){
  document.querySelectorAll('canvas[data-qr]').forEach(drawQr);
  if(key==='keypad')paintKeypad();
  if(/^signin/.test(key)){ const em=$('em'); if(em){ em.value=ui.signin.email; if(changedKey&&ui.signin.step==='email')setTimeout(()=>{ try{ em.focus(); }catch(e){} },60); }
    const o=$('otp'); if(o){ o.value=ui.signin.otp; paintOtp(); if(changedKey)setTimeout(()=>{ try{ o.focus(); }catch(e){} },60); } }
  if(key==='scan'&&stream){ const v=$('vid'); if(v&&v.srcObject!==stream){ v.srcObject=stream; v.play().catch(()=>{}); } }
}
function tick(){
  const t=now();
  document.querySelectorAll('[data-cd]').forEach(e=>{ const at=+e.getAttribute('data-cd'); const txt=fmt(at-t,e.hasAttribute('data-p')); if(e.textContent!==txt)e.textContent=txt; });
  document.querySelectorAll('[data-static]').forEach(e=>{ const txt=fmt(+e.getAttribute('data-static'),true); if(e.textContent!==txt)e.textContent=txt; });
  document.querySelectorAll('[data-low]').forEach(e=>{ const at=+e.getAttribute('data-low'); const s=S_(); e.classList.toggle('low',!!(s&&s.status==='hunt'&&at-t<60000&&at>t-1000)); });
  document.querySelectorAll('[data-lock]').forEach(e=>{ const [a,b]=e.getAttribute('data-lock').split('|').map(Number); const f=b>a?Math.max(0,Math.min(1,(b-t)/(b-a))):0; e.style.transform='scaleX('+f.toFixed(3)+')'; });
}
function drawQr(cv){ const text=cv.getAttribute('data-qr'); if(!text||typeof window.qrcode!=='function'||cv.__q===text)return;
  try{ const q=window.qrcode(0,'M'); q.addData(text); q.make(); const n=q.getModuleCount(), px=Math.max(4,Math.floor(400/n));
    cv.width=cv.height=n*px; const g=cv.getContext('2d'); g.fillStyle='#FFFFFF'; g.fillRect(0,0,cv.width,cv.height); g.fillStyle='#1D1B2C';
    for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))g.fillRect(c*px,r*px,px,px); cv.__q=text; }catch(e){ console.warn('QR failed',e); } }
function paintKeypad(){ const box=$('kd'); if(!box)return; const d=ui.digits;
  [...box.children].forEach((sp,i)=>{ sp.textContent=d[i]||'·'; sp.className=d[i]?'on':(i===d.length?'cur':''); });
  box.classList.toggle('bad',ui.bad); box.setAttribute('aria-label',d?'Typed '+d.split('').join(' '):'Nothing typed yet');
  const k=$('kcheck'); if(k)k.disabled=d.length!==4||ui.sending; }
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
  if(!/^SQ\d*:/i.test(hit.data)){ if(ui.scanHint!=='That isn’t a Secret Squad code'){ ui.scanHint='That isn’t a Secret Squad code'; const h2=$('camhint'); if(h2)h2.textContent=ui.scanHint; } return; }
  haptic('light'); ui.mode='main'; ui.scanHint=''; camera(false); sendCheck({qr:hit.data}); }
window.__squadDecode=(data,w,h)=>{ const r=typeof window.jsQR==='function'?window.jsQR(data,w,h):null; return r&&r.data||null; };

/* ---------------------------------------------------------------- talking to the server */
function request(ev,payload){ if(!conn)return Promise.reject(Object.assign(new Error('Not connected yet. Try again in a moment.'),{status:0})); return conn.request(ev,payload||{}); }
async function act(ev,payload,okSay){ if(ui.sending)return; ui.sending=true; render();
  try{ await request(ev,payload); if(okSay)say(okSay); }catch(e){ haptic('heavy'); toast(e.message||'Something went wrong. Try again.'); }
  finally{ ui.sending=false; render(); } }
async function sendCheck(payload){ if(ui.sending)return; ui.sending=true; render();
  try{ const d=await request('squad:check',payload); if(d&&d.askId)ui.mine[d.askId]=1; ui.digits=''; ui.mode='main'; }
  catch(e){ haptic('heavy'); if(ui.mode==='keypad'){ ui.bad=true; paintKeypad(); setTimeout(()=>{ ui.bad=false; paintKeypad(); },900); }
    toast(e.message||'That check didn’t go through. Try again.',4200); }
  finally{ ui.sending=false; render(); } }
async function answer(allow){ const a=openAsk(); if(!a||ui.answering)return; ui.answering=a.id; if(!allow)ui.declined[a.id]=1; render();
  try{ await request('squad:answer',{askId:a.id,allow:!!allow}); haptic('light'); }
  catch(e){ toast(e.message||'That answer didn’t go through.'); }
  finally{ ui.answering=null; render(); } }

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
  const s=S_(), r=R_();
  if(s){ if(s.status==='hunt'&&s.phaseEndsAt){ const c=cfg(s.roundIndex|0); if(c.huntMs&&!memo.get('hs:'+s.id+':'+(s.roundIndex|0)))memo.set('hs:'+s.id+':'+(s.roundIndex|0),s.phaseEndsAt-c.huntMs); }
    if((s.status==='break'||s.status==='over')&&r&&r.results&&r.results.points!=null&&s.joined&&s.playing!==false)memo.set('pts:'+s.id+':'+(s.roundIndex|0),r.results.points|0);
    if(s.status!=='hunt'){ ui.mode='main'; ui.digits=''; }
    if(s.status==='hunt'&&r&&r.player&&r.player.away&&!(prev&&prev.session&&prev.session.round&&prev.session.round.player&&prev.session.round.player.away))say('You were marked away.');
  }
  const pr=prev&&prev.session&&prev.session.round||null;
  if(s&&r){
    if(s.status==='hunt'&&finished()&&!(pr&&pr.squad&&pr.squad.finishedAt)){ haptic('medium'); say('Squad complete!'); if(r.result)ui.seenResult[r.result.id]=1; }
    const x=r.result;
    if(x&&x.id&&!ui.seenResult[x.id]&&(!pr||!pr.result||pr.result.id!==x.id)){
      const nm=first(x.otherName), mine=!!ui.mine[x.id];
      if(x.kind==='match'){ haptic('medium'); say('Same squad! '+nm+' is with you.'); if(finished())ui.seenResult[x.id]=1; }
      else if(x.kind==='miss'){ haptic('heavy'); say('Different squads. Checks paused.'); }
      else { ui.seenResult[x.id]=1;
        if(x.kind==='already')toast('You and '+nm+' are already linked.');
        else if(x.kind==='declined'&&!ui.declined[x.id])toast(mine?nm+' said not now.':'Check with '+nm+' cancelled.');
        else if(x.kind==='expired')toast(mine?nm+' didn’t answer in time.':'You missed '+nm+'’s check.'); }
    }
    const a=r.ask; if(a&&a.id&&(!pr||!pr.ask||pr.ask.id!==a.id)){ haptic('medium'); say(first(a.fromName)+' wants to check if you’re in the same squad.'); }
    const n=r.notice; if(n&&n.kind&&(!pr||!pr.notice||pr.notice.at!==n.at||pr.notice.kind!==n.kind)){ haptic('light'); }
    if(s.status==='dealing'&&(!prev||!prev.session||prev.session.status!=='dealing'))haptic('medium');
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
  catch(e){ g.busy=false; g.error=e.message||'That code is wrong or has expired.'; g.otp=''; haptic('heavy'); render(); } }
async function signOut(){ const t=token; token=null; store.del(TOKEN_KEY); try{ conn&&conn.close(); }catch(e){} conn=null; st=null; lastV=-1; lastSid=null; fatal=null;
  ui.signin={step:'email',email:ui.signin.email,otp:'',busy:false,error:'',note:''}; render(); try{ if(t&&AUTH.logout)await AUTH.logout(t); }catch(e){} }

/* ---------------------------------------------------------------- taps and keys */
function key(k){ if(k==='c')ui.digits=''; else if(k==='b')ui.digits=ui.digits.slice(0,-1); else if(/^\d$/.test(k)&&ui.digits.length<4)ui.digits+=k; else return;
  haptic('light'); paintKeypad(); }
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]'); if(!b||b.disabled)return; const a=b.getAttribute('data-act');
  switch(a){
    case 'join': act('squad:join',{},'You’re in the lobby.'); break;
    case 'leave': act('squad:leave',{},'You left the lobby.'); break;
    case 'intro': ui.intro[roundKey()]=1; haptic('light'); render(); break;
    case 'keypad': ui.mode='keypad'; ui.digits=''; render(); break;
    case 'scan': if(canNativeScan()){ let p; try{ p=window.Sowaka.scanQr(); }catch(err){ p=Promise.reject(err); }
        Promise.resolve(p).then(text=>{ if(text)sendCheck({qr:String(text)}); }).catch(()=>toast('Scanning didn’t work. Type the code instead.')); }
      else if(canCamera()){ ui.mode='scan'; ui.scanHint=''; render(); } else { ui.mode='keypad'; render(); } break;
    case 'qr': ui.mode='qr'; render(); break;
    case 'back': ui.mode='main'; ui.digits=''; render(); break;
    case 'key': key(b.getAttribute('data-k')); break;
    case 'check': if(ui.digits.length===4)sendCheck({code:ui.digits}); break;
    case 'seen': ui.seenResult[b.getAttribute('data-id')]=1; ui.mode='main'; render(); break;
    case 'allow': answer(true); break;
    case 'deny': answer(false); break;
    case 'notice': ui.seenNotice[b.getAttribute('data-key')]=1; render(); break;
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
  if(cur.key!=='keypad'||e.metaKey||e.ctrlKey||e.altKey)return;
  if(/^\d$/.test(e.key)){ key(e.key); e.preventDefault(); }
  else if(e.key==='Backspace'){ key('b'); e.preventDefault(); }
  else if(e.key==='Escape'){ ui.mode='main'; render(); }
  else if(e.key==='Enter'&&ui.digits.length===4&&!locked()){ sendCheck({code:ui.digits}); e.preventDefault(); }
});
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'){ if(conn)try{ conn.sync(); }catch(e){} render(); } else camera(false); });
document.addEventListener('error',e=>{ const t=e.target; if(t&&t.tagName==='IMG'&&t.closest&&t.closest('.av'))t.remove(); },true);   // a photo that won't load leaves the initial
window.addEventListener('sowaka-ready',()=>{ document.documentElement.classList.add('app'); render(); });
if(reduced())document.documentElement.classList.add('still');

setInterval(()=>{ tick(); },250);
setInterval(()=>{ if(document.visibilityState!=='hidden')render(); },1000);

/* For the preview and the tests: what the page holds, read-only. */
window.__squadPage={state:()=>st,ui:()=>({mode:ui.mode,digits:ui.digits,key:cur.key}),now,render};

render();
start();
})();
