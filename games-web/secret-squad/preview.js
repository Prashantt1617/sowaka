/* PREVIEW: a simulated Secret Squad server and office, so every screen can be clicked through without a backend. It speaks the same
   contract as the real server (docs/secret-squad.md): it builds the very `squad:state` the server sends, answers the same requests with
   the same acks, and plays 19 colleagues who join the lobby, check each other (and you), link up, go away and come back. It is NOT the
   server: no persistence, no rate limits, and its points are only what the rules say.
   URL switches:  ?web          the browser sign-in first (any email; the code is 123456)
                  ?scan=native  pretend the app's scanner is there (Sowaka.scanQr); it "scans" a colleague
                  ?bare         no preview panel (screenshots)
   window.__squadPreview drives it from tests: go(scenario), skip(), state(), nearby(), panel(open). */
(function(){
'use strict';
const params=new URLSearchParams(location.search);
if(params.has('web')&&!window.__SQUAD)window.__SQUAD={web:true};

/* ---------------------------------------------------------------- a seeded random, so a run can be repeated */
let seed=+(params.get('seed')||7)>>>0||7;
const rnd=()=>{ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
const pick=a=>a[Math.floor(rnd()*a.length)];
const shuffle=a=>{ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };

/* ---------------------------------------------------------------- the office and the words (packs of themes written to mislead each other) */
const OFFICE='Gurgaon';
const PACKS=[
  [['Chocolate bars',['Mars','Galaxy','Gems','Perk','Munch','Bounty','Snickers']],['Car names',['Jaguar','Beetle','Mustang','Swift','Safari','Nano']],
   ['Coding languages',['Python','Ruby','Java','Rust','Dart','Go']],['Space',['Mercury','Pluto','Comet','Venus','Orbit','Nova']]],
  [['Card games',['Rummy','Snap','Poker','Bridge','Patience','Uno']],['Dances',['Tango','Bhangra','Garba','Twist','Waltz','Samba']],
   ['Sauces',['Pesto','Ketchup','Mayo','Tabasco','Mustard','Chutney']],['Things with keys',['Piano','Keyboard','Map','Lock','Diary','Laptop']]],
  [['Board games',['Chess','Ludo','Carrom','Scrabble','Monopoly','Cluedo']],['Rivers',['Ganga','Nile','Thames','Indus','Seine','Yamuna']],
   ['Fruity colours',['Orange','Lime','Peach','Plum','Cherry','Lemon']],['Sweets',['Ladoo','Jalebi','Barfi','Halwa','Rasgulla','Peda']]],
];
const ME='u-tanvi';
const PEOPLE=[[ME,'Tanvi Sharma','Design'],['u-arjun','Arjun Mehta','Engineering'],['u-priya','Priya Nair','Sales'],['u-kabir','Kabir Khan','Engineering'],
  ['u-neha','Neha Gupta','HR'],['u-munch','Rohan Das','Design'],['u-ananya','Ananya Rao','Sales'],['u-vikram','Vikram Singh','Engineering'],['u-isha','Isha Kapoor','Marketing'],
  ['u-dev','Dev Patel','Engineering'],['u-meera','Meera Iyer','Finance'],['u-karan','Karan Malhotra','Sales'],['u-sana','Sana Sheikh','Design'],
  ['u-aditya','Aditya Joshi','Engineering'],['u-pooja','Pooja Verma','HR'],['u-rahul','Rahul Bose','Marketing'],['u-zoya','Zoya Ali','Engineering'],
  ['u-nikhil','Nikhil Jain','Finance'],['u-diya','Diya Sen','Sales'],['u-manish','Manish Yadav','Engineering']];
const ROUNDS=[
  {squadSize:5,huntMs:17*60e3,breakMs:2*60e3,lockMs:45e3,pointsPerMember:40,timeBonusPerSecond:.5},
  {squadSize:3,huntMs:12*60e3,breakMs:2*60e3,lockMs:45e3,pointsPerMember:40,timeBonusPerSecond:.5},
  {squadSize:2,huntMs:8*60e3,breakMs:2*60e3,lockMs:45e3,pointsPerMember:40,timeBonusPerSecond:.5}];
const LOBBY_MS=3*60e3, DEAL_MS=10e3, ASK_MS=20e3, CODE_MS=20e3;

const sim={v:1,next:null,session:null,round:null,players:new Map(),totals:{},quiet:false};
for(const [id,name,dept] of PEOPLE)sim.players.set(id,{userId:id,name,initials:name.split(' ').map(w=>w[0]).join('').slice(0,2),dept,joined:false,fromRound:0,bot:id!==ME});
const P=id=>sim.players.get(id);
const now=()=>Date.now();
let seq=0; const uid=p=>p+(++seq).toString(36)+Math.floor(rnd()*1e6).toString(36);

/* ---------------------------------------------------------------- the round's mechanics */
function newSession(status,opts){ const t=now(); opts=opts||{};
  sim.session={id:uid('ss-'),status,lobbyOpensAt:t,startsAt:t+LOBBY_MS,phaseEndsAt:t+LOBBY_MS,roundIndex:0,rounds:ROUNDS.map(r=>Object.assign({},r))};
  sim.round=null; sim.totals={}; sim.next=null;
  for(const p of sim.players.values()){ p.joined=false; p.fromRound=0; }
  return sim.session; }
function joinAll(includeMe){ for(const p of sim.players.values())if(p.bot||includeMe){ p.joined=true; p.fromRound=0; } }
function deal(i){ const s=sim.session; s.roundIndex=i; const cfg=s.rounds[i];
  const playing=[...sim.players.values()].filter(p=>p.joined&&p.fromRound<=i).map(p=>p.userId);
  const n=playing.length, k=Math.max(2,Math.round(n/cfg.squadSize));
  /* Same department dealt round-robin, so a department spreads across squads. */
  const byDept={}; for(const id of shuffle(playing))(byDept[P(id).dept]=byDept[P(id).dept]||[]).push(id);
  const order=[].concat(...Object.values(byDept));
  const squads=Array.from({length:k},(_,j)=>({id:'sq'+j,members:[],words:{},theme:'',finishedAt:0,place:0}));
  order.forEach((id,j)=>squads[j%k].members.push(id));
  /* Make sure you sit with the people the scenarios talk about in round 1 (Arjun, Priya, Neha, Rohan): the artifact's squad. */
  if(i===0&&squads[0].members.length>=5){ const want=[ME,'u-arjun','u-priya','u-neha','u-munch']; for(const id of want){ const from=squads.find(q=>q.members.includes(id)); if(from===squads[0])continue;
      const out=squads[0].members.find(m=>!want.includes(m)); if(!out)break; from.members[from.members.indexOf(id)]=out; squads[0].members[squads[0].members.indexOf(out)]=id; } }
  const themes=shuffle([].concat(...PACKS.map(p=>shuffle(p)))).slice(0,k);
  if(i===0){ const choc=[].concat(...PACKS).find(t=>t[0]==='Chocolate bars'); const at=themes.findIndex(t=>t[0]==='Chocolate bars'); if(at>0)themes[at]=themes[0]; themes[0]=choc; }
  squads.forEach((q,j)=>{ const [name,words]=themes[j%themes.length]; q.theme=name;
    const ws=i===0&&j===0?['Mars','Galaxy','Gems','Perk','Munch'].concat(shuffle(words.filter(w=>!['Mars','Galaxy','Gems','Perk','Munch'].includes(w)))):shuffle(words);
    const ordered=i===0&&j===0?[ME,'u-arjun','u-priya','u-neha','u-munch'].filter(id=>q.members.includes(id)).concat(q.members.filter(id=>![ME,'u-arjun','u-priya','u-neha','u-munch'].includes(id))):q.members;
    ordered.forEach((id,w)=>{ q.words[id]=ws[w%ws.length]; }); });
  const squadOf={}; squads.forEach((q,j)=>q.members.forEach(id=>{ squadOf[id]=j; }));
  sim.round={index:i,squads,squadOf,playing:new Set(playing),edges:[],away:{},codes:{},locks:{},asks:{},results:{},notices:{},misses:{},final:null,huntStart:0};
  for(const id of playing)newCode(id,true);
}
function newCode(id,fresh){ const R=sim.round, used=new Set(); for(const c of Object.values(R.codes)){ used.add(c.code); if(c.prev)used.add(c.prev); }
  let code; do{ code=String(1000+Math.floor(rnd()*9000)); }while(used.has(code));
  const old=R.codes[id]; R.codes[id]={code,prev:fresh||!old?null:old.code,exp:now()+CODE_MS}; }
function groupOf(id){ const R=sim.round, parent={}; const f=x=>{ while(parent[x]&&parent[x]!==x)x=parent[x]; return x; };
  for(const [a,b] of R.edges){ parent[a]=parent[a]||a; parent[b]=parent[b]||b; const ra=f(a), rb=f(b); if(ra!==rb)parent[ra]=rb; }
  const root=f(id); const q=R.squads[R.squadOf[id]]; return q.members.filter(m=>f(m)===root||m===id); }
const sameGroup=(a,b)=>groupOf(a).includes(b);
function present(q){ return q.members.filter(m=>!sim.round.away[m]); }
function isFinished(q){ if(q.finishedAt)return true; const pr=present(q); if(pr.length<2)return false; const g=groupOf(pr[0]); return pr.every(m=>g.includes(m)); }
const stuck=q=>!q.finishedAt&&present(q).length<2;
function biggest(q){ let b=0; for(const m of q.members)b=Math.max(b,groupOf(m).length); return b; }
function checkFinishes(at){ const R=sim.round; let n=R.squads.filter(q=>q.finishedAt).length;
  for(const q of R.squads)if(!q.finishedAt&&isFinished(q)){ q.finishedAt=at||now(); q.place=++n; for(const m of q.members)delete R.locks[m]; } }
const free=id=>{ const R=sim.round; return R&&R.playing.has(id)&&!R.away[id]&&!(R.locks[id]>now())&&!Object.values(R.asks).some(a=>a.from===id||a.to===id)&&!R.squads[R.squadOf[id]].finishedAt; };
function result(id,kind,a,b,at){ const R=sim.round, other=a===id?b:a; R.results[id]={id:R._ask||uid('r-'),kind,otherName:P(other).name,otherWord:R.squads[R.squadOf[other]].words[other],at:at||now()}; }
function settle(ask,allow){ const R=sim.round; delete R.asks[ask.id]; R._ask=ask.id;
  if(allow===null){ result(ask.from,'expired',ask.from,ask.to); result(ask.to,'expired',ask.from,ask.to); }
  else if(!allow){ result(ask.from,'declined',ask.from,ask.to); result(ask.to,'declined',ask.from,ask.to); }
  else if(R.squadOf[ask.from]===R.squadOf[ask.to]){ R.edges.push([ask.from,ask.to]); result(ask.from,'match',ask.from,ask.to); result(ask.to,'match',ask.from,ask.to); checkFinishes(); }
  else { const until=now()+sim.session.rounds[R.index].lockMs; R.locks[ask.from]=until; R.locks[ask.to]=until; R.misses[ask.to]=(R.misses[ask.to]|0)+1;
    result(ask.from,'miss',ask.from,ask.to); result(ask.to,'miss',ask.from,ask.to); }
  R._ask=null; changed(); }
function ask(from,to,opts){ const R=sim.round, a={id:uid('ask-'),from,to,expiresAt:now()+ASK_MS,hold:!!(opts&&opts.hold)}; R.asks[a.id]=a;
  if(P(to).bot&&!a.hold)setTimeout(()=>{ if(R.asks[a.id])settle(a,rnd()<.88); },1200+rnd()*1800);
  changed(); return a; }
function endRound(){ const s=sim.session, R=sim.round, cfg=s.rounds[R.index]; const huntEnd=R.huntStart+cfg.huntMs;
  const order=R.squads.slice().sort((a,b)=>(a.finishedAt&&b.finishedAt)?a.finishedAt-b.finishedAt:a.finishedAt?-1:b.finishedAt?1:biggest(b)-biggest(a));
  order.forEach((q,j)=>{ q.place=j+1; });
  const pts={};
  for(const q of R.squads){ const big=biggest(q); const bonus=q.finishedAt?Math.floor(Math.max(0,(huntEnd-q.finishedAt)/1000)*cfg.timeBonusPerSecond):0;
    for(const m of q.members){ pts[m]=(big>1?big*cfg.pointsPerMember:0)+bonus; sim.totals[m]=(sim.totals[m]|0)+pts[m]; } }
  let trick=null; for(const [id,c] of Object.entries(R.misses))if(!trick||c>trick.checks)trick={word:R.squads[R.squadOf[id]].words[id],checks:c};
  R.final={order,pts,trickiest:trick};
  R.asks={};
  const last=R.index>=s.rounds.length-1;
  s.status=last?'over':'break'; s.phaseEndsAt=last?now():now()+cfg.breakMs;
  if(last)sim.next={sessionId:uid('ss-'),lobbyOpensAt:now()+7*864e5-3*60e3,startsAt:now()+7*864e5,rounds:ROUNDS.map(r=>({squadSize:r.squadSize,huntMs:r.huntMs}))};
  changed(); }
function startHunt(){ const s=sim.session, R=sim.round; s.status='hunt'; R.huntStart=now(); s.phaseEndsAt=now()+s.rounds[R.index].huntMs; changed(); }
function startDealing(i){ const s=sim.session; const n=[...sim.players.values()].filter(p=>p.joined&&p.fromRound<=i).length;
  if(n<4){ if(i>=s.rounds.length-1){ s.status='over'; s.phaseEndsAt=now(); } else { s.roundIndex=i+1; return startDealing(i+1); } changed(); return; }
  deal(i); s.status='dealing'; s.phaseEndsAt=now()+DEAL_MS; changed(); }

/* ---------------------------------------------------------------- the clock: phases, codes, asks, and the colleagues' own moves */
let botT=0, joinT=0;
function tick(){ const s=sim.session, t=now();
  if(!s){ if(sim.next&&sim.next.lobbyOpensAt<=t){ const n=sim.next; newSession('lobby'); sim.session.startsAt=n.startsAt; sim.session.phaseEndsAt=n.startsAt; changed(); } return; }
  if(s.status==='lobby'){ if(t>=s.phaseEndsAt)startDealing(0);
    else if(!sim.quiet&&t>joinT){ joinT=t+1400+rnd()*1600; const p=[...sim.players.values()].find(p=>p.bot&&!p.joined); if(p){ p.joined=true; changed(); } } return; }
  if(s.status==='dealing'){ if(t>=s.phaseEndsAt)startHunt(); return; }
  if(s.status==='break'){ if(t>=s.phaseEndsAt)startDealing(s.roundIndex+1); return; }
  if(s.status!=='hunt')return;
  const R=sim.round;
  if(t>=s.phaseEndsAt||R.squads.every(q=>q.finishedAt||stuck(q))){ endRound(); return; }
  let dirty=false;
  for(const id of R.playing)if(R.codes[id]&&R.codes[id].exp<=t){ newCode(id); dirty=true; }
  for(const a of Object.values(R.asks))if(a.expiresAt<=t){ settle(a,null); dirty=false; }
  for(const [id,u] of Object.entries(R.locks))if(u<=t){ delete R.locks[id]; dirty=true; }
  if(!sim.quiet&&t>botT){ botT=t+(2200+rnd()*2600)/speed(); botMove(); }
  if(dirty)changed(); }
const speed=()=>Math.max(.2,+(params.get('speed')||1));
function botMove(){ const R=sim.round; const bots=[...R.playing].filter(id=>P(id).bot&&free(id)); if(!bots.length)return; const a=pick(bots);
  const mates=R.squads[R.squadOf[a]].members.filter(m=>m!==a&&!sameGroup(a,m)&&!R.away[m]);
  let b;
  if(free(ME)&&R.playing.has(ME)&&rnd()<.14)b=ME;
  else if(mates.length&&rnd()<.34)b=pick(mates.filter(m=>m!==ME&&free(m)).concat([]))||null;
  if(!b){ const others=[...R.playing].filter(id=>id!==a&&id!==ME&&free(id)); if(!others.length)return; b=pick(others); }
  if(sameGroup(a,b)){ return; }
  const x=ask(a,b);
  if(b!==ME)setTimeout(()=>{ if(R.asks[x.id])settle(x,rnd()<.9); },900+rnd()*1500); }

/* ---------------------------------------------------------------- the state the server would send you */
function viewForMe(){ const s=sim.session, me=P(ME), t=now();
  const out={v:sim.v,now:t,office:OFFICE,me:{userId:ME,name:'Tanvi',initials:'T'},next:sim.next,session:null};
  if(!s)return out;
  const R=sim.round, joined=[...sim.players.values()].filter(p=>p.joined);
  const playing=!!(R&&R.playing.has(ME)&&(s.status==='dealing'||s.status==='hunt'||s.status==='break'||s.status==='over'));
  const so={id:s.id,status:s.status,lobbyOpensAt:s.lobbyOpensAt,startsAt:s.startsAt,phaseEndsAt:s.phaseEndsAt,roundIndex:s.roundIndex,roundCount:s.rounds.length,
    rounds:s.rounds.map(r=>Object.assign({},r)),joined:me.joined,playing:me.joined&&playing,players:joined.length+(sim.extra|0),
    faces:s.status==='lobby'?joined.filter(p=>p.userId!==ME).slice(-12).reverse().map(p=>({userId:p.userId,name:p.name,initials:p.initials,photoUrl:null})):[],
    totalPoints:sim.totals[ME]|0,round:null};
  out.session=so;
  if(!R||s.status==='lobby'||s.status==='cancelled')return out;
  const sq=R.squads, board={squads:sq.length,finished:sq.filter(q=>q.finishedAt).length,hunting:sq.filter(q=>!q.finishedAt&&!stuck(q)).length,stuck:sq.filter(stuck).length};
  const round={player:null,squad:null,board,ask:null,asking:null,result:null,notice:null,results:null};
  so.round=round;
  if(playing){ const q=sq[R.squadOf[ME]], c=R.codes[ME]||{}, over=s.status==='break'||s.status==='over';
    const live=!q.finishedAt&&!R.away[ME]&&!over;
    round.player={word:q.words[ME],code:live?c.code:null,codeExpiresAt:live?c.exp:0,qr:live?'SQ1:'+s.id+':'+R.index+':'+c.code:null,lockedUntil:R.locks[ME]>t?R.locks[ME]:0,away:!!R.away[ME]};
    const g=groupOf(ME);
    const linked=g.map(id=>({userId:id,name:P(id).name,initials:P(id).initials,word:q.words[id],me:id===ME,away:!!R.away[id]}));
    const awayWords=q.members.filter(m=>R.away[m]&&!g.includes(m)).map(m=>({name:P(m).name,word:q.words[m]}));
    round.squad={size:q.members.length,needed:present(q).length,linked,awayWords,unknown:q.members.length-linked.length-awayWords.length,
      finishedAt:q.finishedAt||0,place:q.finishedAt?q.place:0,theme:q.finishedAt||over?q.theme:null};
    const inA=Object.values(R.asks).find(a=>a.to===ME), outA=Object.values(R.asks).find(a=>a.from===ME);
    if(inA)round.ask={id:inA.id,fromName:P(inA.from).name,fromInitials:P(inA.from).initials,expiresAt:inA.expiresAt};
    if(outA)round.asking={id:outA.id,toName:P(outA.to).name,expiresAt:outA.expiresAt};
    round.result=R.results[ME]||null; round.notice=R.notices[ME]||null; }
  if((s.status==='break'||s.status==='over')&&R.final){ const mineQ=R.squadOf[ME];
    round.results={squads:R.final.order.map(q=>({place:q.place,theme:q.theme,words:q.members.map(m=>q.words[m]),finishedAt:q.finishedAt||0,linked:biggest(q),size:q.members.length,mine:playing&&R.squads.indexOf(q)===mineQ})),
      trickiest:R.final.trickiest,points:playing?R.final.pts[ME]|0:0}; }
  return out; }

/* ---------------------------------------------------------------- the transport the page talks to */
let H=null, online=true, pushT=0;
function changed(){ sim.v++; if(pushT)return; pushT=setTimeout(()=>{ pushT=0; push(); },30); }
function push(){ if(H&&online)H.state(viewForMe()); paintPanel(); }
const fail=(status,message)=>Object.assign(new Error(message),{status});
function handle(ev,p){ const s=sim.session, R=sim.round, me=P(ME);
  if(ev==='squad:sync'){ push(); return {}; }
  if(ev==='squad:board'){ // a made-up finished game: everyone in the office, most points first
    const rows=[...sim.players.values()].map((x,i)=>({userId:x.userId,name:x.name,initials:x.initials,photoUrl:null,points:(sim.totals[x.userId]|0)||Math.max(40,980-i*37)}))
      .sort((a,b)=>b.points-a.points); rows.forEach((r,i)=>{ r.rank=i>0&&rows[i-1].points===r.points?rows[i-1].rank:i+1; });
    return {sessionId:(s&&s.id)||'ss-preview',office:'Gurugram',endsAt:now(),results:rows}; }
  if(ev==='squad:join'){ if(!s||s.status==='over'||s.status==='cancelled')throw fail(409,'There’s no game to join right now.');
    if(s.status==='hunt'||s.status==='dealing'){ if(s.roundIndex>=s.rounds.length-1)throw fail(409,'This is the last round. Join the next game.'); }
    me.joined=true; me.fromRound=s.status==='lobby'?0:s.roundIndex+1; changed(); return {}; }
  if(ev==='squad:leave'){ if(!s||s.status!=='lobby')throw fail(409,'You can only leave while the lobby is open.'); me.joined=false; changed(); return {}; }
  if(ev==='squad:check'){
    if(!s||s.status!=='hunt'||!R||!R.playing.has(ME))throw fail(409,'Checks are open during the hunt.');
    const q=R.squads[R.squadOf[ME]]; if(q.finishedAt)throw fail(409,'Your squad is complete.');
    if(R.locks[ME]>now())throw fail(409,'Checks are paused for '+Math.ceil((R.locks[ME]-now())/1000)+' more seconds.');
    if(Object.values(R.asks).some(a=>a.from===ME||a.to===ME))throw fail(409,'Finish the check you have open first.');
    let code=p&&p.code!=null?String(p.code):null;
    if(p&&p.qr!=null){ const m=/^SQ1:([^:]+):(\d+):(\d{4})$/.exec(String(p.qr)); if(!m||m[1]!==s.id||+m[2]!==R.index)throw fail(404,'That QR is from another round.'); code=m[3]; }
    if(!/^\d{4}$/.test(code||''))throw fail(400,'Type all 4 digits.');
    const who=[...R.playing].find(id=>{ const c=R.codes[id]; return c&&(c.code===code||c.prev===code); });
    if(!who||R.away[who]||R.squads[R.squadOf[who]].finishedAt)throw fail(404,'Nobody has that code right now. Codes change every 20 s: ask for the new one.');
    if(who===ME)throw fail(400,'That’s your own code.');
    if(sameGroup(ME,who)){ R._ask=uid('r-'); const id=R._ask; result(ME,'already',ME,who); result(who,'already',ME,who); R._ask=null; changed(); return {askId:id}; }
    if(Object.values(R.asks).some(a=>a.from===who||a.to===who))throw fail(409,first(who)+' is in another check. Try again in a moment.');
    const a=ask(ME,who); return {askId:a.id}; }
  if(ev==='squad:answer'){ const a=R&&R.asks[p&&p.askId]; if(!a||a.to!==ME)throw fail(404,'That check has ended.'); settle(a,!!p.allow); return {}; }
  throw fail(400,'Unknown request.'); }
const first=id=>P(id).name.split(' ')[0];

window.SquadPreview={
  connect(auth,h){ H=h; online=true; setTimeout(push,150);
    return {request:(ev,p)=>new Promise((res,rej)=>setTimeout(()=>{ if(!online)return rej(fail(0,'Not connected. Try again in a moment.')); try{ res(handle(ev,p)); }catch(e){ rej(e); } },140)),
      sync(){ setTimeout(push,60); }, close(){ if(H===h)H=null; }}; },
  auth:{request:email=>new Promise((res,rej)=>setTimeout(()=>/@/.test(email)?res({success:true}):rej(fail(400,'Enter your work email.')),500)),
    verify:(email,otp)=>new Promise((res,rej)=>setTimeout(()=>otp==='123456'?res({success:true,token:'preview-token',user:{name:'Tanvi Sharma'}}):rej(fail(401,'That code is wrong or has expired.')),500)),
    logout:()=>Promise.resolve({})},
};

/* In the app (the default here): the bridge is there, haptics and all, but no scanner unless ?scan=native. In a browser (?web): none. */
if(!params.has('web')&&!window.Sowaka){ window.Sowaka={native:true,haptic(){}}; document.documentElement.classList.add('app'); }
/* The app's scanner, pretended: it "scans" an unlinked squadmate half the time, else anyone. */
if(params.get('scan')==='native'){ window.Sowaka=Object.assign(window.Sowaka||{},{native:true,haptic(){},scanQr(){ return new Promise(res=>setTimeout(()=>{
    const R=sim.round, s=sim.session; if(!R||!s||s.status!=='hunt')return res(null); const q=R.squads[R.squadOf[ME]];
    const mates=q?q.members.filter(m=>m!==ME&&!sameGroup(ME,m)&&!R.away[m]):[]; const id=mates.length&&rnd()<.5?pick(mates):pick([...R.playing].filter(x=>x!==ME));
    res(id?'SQ1:'+s.id+':'+R.index+':'+R.codes[id].code:null); },700)); }}); document.documentElement.classList.add('app'); }

/* ---------------------------------------------------------------- scenarios: each screen of the plan, on demand */
function hunting(i,leftMs,o){ o=o||{}; newSession('hunt'); joinAll(true); deal(i||0); const s=sim.session; s.status='hunt';
  const cfg=s.rounds[i||0]; s.phaseEndsAt=now()+(leftMs!=null?leftMs:cfg.huntMs-9e3); sim.round.huntStart=s.phaseEndsAt-cfg.huntMs; return sim.round; }
function link(a,b){ sim.round.edges.push([a,b]); }
function playOut(){ const R=sim.round, s=sim.session, cfg=s.rounds[R.index];
  R.squads.forEach((q,j)=>{ const mine=j===R.squadOf[ME];
    const doneFrac=mine?null:[null,.53,.92,null,.8,.66,.71,null,.6,null,.88][j%11];
    if(mine||doneFrac!=null){ for(let k=1;k<q.members.length;k++)link(q.members[0],q.members[k]); q.finishedAt=R.huntStart+(mine?673e3*(cfg.huntMs/1020e3):Math.round(cfg.huntMs*doneFrac)); }
    else { for(let k=1;k<Math.min(3,q.members.length);k++)link(q.members[0],q.members[k]); } });
  const fin=R.squads.filter(q=>q.finishedAt).sort((a,b)=>a.finishedAt-b.finishedAt); fin.forEach((q,j)=>{ q.place=j+1; });
  for(const id of R.playing){ if(R.squads[R.squadOf[id]].words[id]==='Mars')R.misses[id]=7; else if(rnd()<.3)R.misses[id]=1+Math.floor(rnd()*4); } }
const SC={
  none(){ sim.session=null; sim.round=null; sim.next={sessionId:'next-1',lobbyOpensAt:now()+(22*3600+50*60+10)*1e3,startsAt:now()+(22*3600+53*60+10)*1e3,rounds:ROUNDS.map(r=>({squadSize:r.squadSize,huntMs:r.huntMs}))}; },
  empty(){ sim.session=null; sim.round=null; sim.next=null; },
  lobby(){ newSession('lobby'); const s=sim.session; s.phaseEndsAt=s.startsAt=now()+134e3; [...sim.players.values()].filter(p=>p.bot).slice(0,15).forEach(p=>{ p.joined=true; }); sim.extra=0; },
  lobbyJoined(){ SC.lobby(); P(ME).joined=true; },
  lobbyBig(){ SC.lobby(); P(ME).joined=true; [...sim.players.values()].forEach(p=>{ p.joined=true; }); sim.extra=69; },
  dealing(){ newSession('dealing'); joinAll(true); deal(0); sim.session.status='dealing'; sim.session.phaseEndsAt=now()+8e3; },
  hunt(){ hunting(0,891e3); link(ME,'u-arjun'); },
  ask(){ SC.hunt(); ask(otherSquad('u-kabir'),ME,{hold:true}); },
  asking(){ SC.hunt(); ask(ME,'u-priya',{hold:true}); },
  match(){ hunting(0,723e3); link(ME,'u-arjun'); R_().edges.push([ME,'u-priya']); R_()._ask='m1'; result(ME,'match',ME,'u-priya',now()-1500); R_()._ask=null; },
  miss(){ hunting(0,638e3); link(ME,'u-arjun'); link(ME,'u-priya'); const k=otherSquad('u-kabir'); R_()._ask='x1'; result(ME,'miss',ME,k,now()-17e3); R_()._ask=null;
    R_().locks[ME]=now()+28e3; R_().locks[k]=now()+28e3; R_().misses[k]=1; },
  away(){ hunting(0,432e3); link(ME,'u-arjun'); link(ME,'u-priya'); R_().away['u-neha']=true; R_().notices[ME]={kind:'teammate_away',name:'Neha Gupta',word:'Perk',at:now()-2e3}; },
  back(){ SC.away(); delete R_().away['u-neha']; R_().notices[ME]={kind:'teammate_back',name:'Neha Gupta',word:'Perk',at:now()-1e3}; },
  alone(){ hunting(0,300e3); const q=R_().squads[R_().squadOf[ME]]; q.members.forEach(m=>{ if(m!==ME)R_().away[m]=true; }); R_().notices[ME]={kind:'squad_left',name:'',word:'',at:now()-1e3}; },
  done(){ hunting(0,347e3); const R=R_(); playOut(); R.squads.forEach(q=>{ if(q.finishedAt>now()){ q.finishedAt=0; q.place=0; } });
    const mine=R.squads[R.squadOf[ME]]; mine.finishedAt=R.huntStart+673e3; R.away['u-neha']=false; delete R.away['u-neha'];
    const fin=R.squads.filter(q=>q.finishedAt).sort((a,b)=>a.finishedAt-b.finishedAt); fin.forEach((q,j)=>{ q.place=j+1; }); },
  /* These end a round: the page is shown the hunt first (as it would have been), then the round ends. */
  breakTime(){ hunting(0,60e3); playOut(); return ()=>{ endRound(); sim.session.phaseEndsAt=now()+102e3; }; },
  round2(){ const f=SC.breakTime(); return ()=>{ f(); startDealing(1); }; },
  hunt2(){ const f=SC.breakTime(); return ()=>{ f(); startDealing(1); startHunt(); }; },
  over(){ SC.breakTime()(); for(const i of [1,2]){ deal(i); const s=sim.session; s.status='hunt'; s.phaseEndsAt=now()+60e3; sim.round.huntStart=s.phaseEndsAt-ROUNDS[i].huntMs; playOut(); if(i<2)endRound(); }
    return ()=>endRound(); },
  cancelled(){ SC.breakTime()(); sim.session.status='cancelled'; sim.next={sessionId:'n2',lobbyOpensAt:now()+3*864e5,startsAt:now()+3*864e5+180e3,rounds:ROUNDS.map(r=>({squadSize:r.squadSize,huntMs:r.huntMs}))}; },
  midround(){ hunting(1,500e3); /* you joined during round 2's hunt: you play from round 3 */
    sim.round.playing.delete(ME); P(ME).fromRound=2; const R=sim.round; const j=R.squadOf[ME]; R.squads[j].members=R.squads[j].members.filter(m=>m!==ME); delete R.squadOf[ME]; },
  notjoined(){ SC.midround(); P(ME).joined=false; },
  meaway(){ SC.hunt(); R_().away[ME]=true; },
};
const R_=()=>sim.round;
function otherSquad(id){ const R=R_(); if(R.squadOf[id]!==R.squadOf[ME])return id; return [...R.playing].find(x=>R.squadOf[x]!==R.squadOf[ME]); }
function pickOther(){ const R=R_(); return [...R.playing].find(x=>R.squadOf[x]!==R.squadOf[ME]); }
function go(name){ const f=SC[name]; if(!f)throw new Error('no scenario '+name);
  if(name==='offline'){ return offlineFor(8000); }
  if(name==='fatal'){ if(H)H.fatal({code:'no_office'}); return; }
  sim.quiet=true; const then=f(); sim.v+=10; online=true; if(H)H.online(true); push();
  if(typeof then==='function')setTimeout(()=>{ then(); sim.v+=10; push(); },400); }
SC.offline=()=>{}; SC.fatal=()=>{};
function offlineFor(ms){ online=false; if(H)H.online(false); paintPanel(); setTimeout(()=>{ online=true; if(H){ H.online(true); push(); } },ms); }

/* A fresh preview starts with a lobby that fills up, the whole flow at its real pace (Skip moves it on). */
SC.lobbyFill=()=>{ newSession('lobby'); const s=sim.session; s.phaseEndsAt=s.startsAt=now()+LOBBY_MS; [...sim.players.values()].filter(p=>p.bot).slice(0,4).forEach(p=>{ p.joined=true; }); };
SC.lobbyFill(); sim.quiet=false;
setInterval(tick,250);

/* ---------------------------------------------------------------- the preview panel (a cheat sheet: who holds which code) */
const LIST=[['none','No game: next one'],['empty','Nothing scheduled'],['lobby','Lobby'],['lobbyBig','Lobby, 91 in'],['dealing','Your word (dealing)'],['hunt','The hunt'],['ask','Allow sheet'],['asking','Waiting for Allow'],
  ['match','Same squad'],['miss','Not a match'],['away','Someone away'],['back','Back again'],['alone','Squad down to you'],['done','Squad complete'],['breakTime','Break: results'],['round2','Round 2 deals (3s)'],['hunt2','Round 2 hunt'],
  ['over','Final results'],['cancelled','Called off'],['midround','Joined mid-round'],['notjoined','Not joined, round on'],['meaway','You were away'],['offline','Reconnecting'],['fatal','Fatal']];
let panel=null, open=false;
function paintPanel(){ if(!panel||!open)return; const R=sim.round, s=sim.session; const list=panel.querySelector('#pvnear');
  if(!R||!s||(s.status!=='hunt'&&s.status!=='dealing')){ list.innerHTML='<i>Codes show during the hunt.</i>'; return; }
  const mine=R.squadOf[ME];
  list.innerHTML=[...R.playing].filter(id=>id!==ME).sort((a,b)=>(R.squadOf[a]===mine?0:1)-(R.squadOf[b]===mine?0:1)).map(id=>{ const c=R.codes[id]||{};
    return '<div style="display:flex;justify-content:space-between;gap:6px'+(R.squadOf[id]===mine?';font-weight:800':'')+'"><span>'+(R.squadOf[id]===mine?'★ ':'')+P(id).name.split(' ')[0]+' · '+R.squads[R.squadOf[id]].words[id]+(R.away[id]?' (away)':'')+'</span><span style="font-variant-numeric:tabular-nums">'+(c.code||'')+'</span></div>'; }).join(''); }
function mountPanel(){ if(window.__pvBare||params.has('bare'))return;
  const b=document.createElement('button'); b.type='button'; b.textContent='Preview'; b.setAttribute('aria-label','Preview controls');
  b.style.cssText='position:fixed;right:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:50;font:700 12px system-ui;padding:8px 11px;border-radius:999px;background:#8F7BFF;color:#fff;box-shadow:0 3px 10px rgba(0,0,0,.25);opacity:.85';
  panel=document.createElement('div');
  panel.style.cssText='position:fixed;right:10px;left:10px;bottom:calc(52px + env(safe-area-inset-bottom,0px));max-width:410px;margin-left:auto;max-height:70vh;overflow:auto;z-index:50;background:#fff;color:#1D1B2C;border-radius:16px;padding:12px;box-shadow:0 8px 30px rgba(0,0,0,.3);font:13px system-ui;display:none';
  panel.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>Preview: simulated server</b><button type="button" data-pv="skip" style="font:700 12px system-ui;background:#C6F432;padding:6px 10px;border-radius:9px;border:2px solid #1F7A32">Skip phase ▸</button></div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:5px">'+LIST.map(([k,l])=>'<button type="button" data-pv="'+k+'" style="font:600 12px system-ui;background:#F3E9D2;padding:6px 9px;border-radius:9px">'+l+'</button>').join('')+'</div>'+
    '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:10px;font-weight:700"><a href="?" style="color:#4A3BB5">In the app</a><a href="?web" style="color:#4A3BB5">In a browser (code 123456)</a><a href="?scan=native" style="color:#4A3BB5">App with scanner</a><a href="?speed=4" style="color:#4A3BB5">Busy office</a></div>'+
    '<div style="margin-top:10px;font-weight:800">Nearby (★ your squad)</div><div id="pvnear" style="display:flex;flex-direction:column;gap:3px;margin-top:4px"></div>';
  b.onclick=()=>{ open=!open; panel.style.display=open?'block':'none'; paintPanel(); };
  panel.addEventListener('click',e=>{ const t=e.target.closest('[data-pv]'); if(!t)return; const k=t.getAttribute('data-pv'); if(k==='skip')skip(); else go(k); });
  document.body.append(panel,b); }
function skip(){ const s=sim.session; sim.quiet=false;
  if(!s){ if(sim.next){ sim.next.lobbyOpensAt=now(); } else SC.lobbyFill(); changed(); return; }
  if(s.status==='hunt'){ endRound(); return; }
  if(s.status==='over'||s.status==='cancelled'){ SC.none(); changed(); return; }
  if(s.status==='lobby'&&!P(ME).joined){ P(ME).joined=true; }
  s.phaseEndsAt=now(); changed(); }
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountPanel); else mountPanel();
setInterval(()=>{ if(open)paintPanel(); },1000);

window.__squadPreview={go,skip,state:viewForMe,sim,
  nearby:()=>{ const R=sim.round; if(!R)return []; return [...R.playing].filter(id=>id!==ME).map(id=>({id,name:P(id).name,word:R.squads[R.squadOf[id]].words[id],code:(R.codes[id]||{}).code,mate:R.squadOf[id]===R.squadOf[ME],away:!!R.away[id]})); },
  answerMine:allow=>{ const a=Object.values(sim.round.asks).find(x=>x.from===ME); if(a)settle(a,allow); },
  quiet:q=>{ sim.quiet=!!q; }, offline:offlineFor,
  askMe:()=>{ const R=sim.round; if(R)ask(otherSquad('u-kabir'),ME,{hold:true}); },
  iAsk:()=>{ const R=sim.round; if(R)ask(ME,'u-priya',{hold:true}); },
  pushRaw:st=>{ if(H)H.state(st); },
  expireAsks:()=>{ const R=sim.round; if(R)for(const a of Object.values(R.asks))settle(a,null); }};
})();
