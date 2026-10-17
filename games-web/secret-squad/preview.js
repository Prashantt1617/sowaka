/* PREVIEW: a simulated Secret Squad v2 server and office, so every screen can be clicked through without a backend. It speaks the same
   contract as the real server (docs/secret-squad.md, "Transport" to "SquadCard, Standing, Final"): it builds the very `squad:state`
   the server sends, answers `squad:join`, `squad:leave`, `squad:scan`, `squad:sync` and `squad:board` with the same acks and errors,
   and plays colleagues who join the lobby, scan each other (and you) and link up. The rules are the engine's: +100 / −25 to both
   players, no lock ever, links chain, a squad completes when everyone still in is linked (+200, topped up by 100 per missing place,
   plus ½ point per second left), scores can go below 0, fresh squads each round. It is NOT the server: no persistence, no rate limits.
   URL switches:  ?plan=HQ|Noida|Kolkata|Gurgaon   the office's round plan (default HQ: 2 rounds, squads of 10 then 5)
                  ?web             the browser sign-in first (any email; the code is 123456)
                  ?scan=native     pretend the app's scanner is there (Sowaka.scanQr); it "scans" a colleague
                  ?bare            no preview panel (screenshots)   ?speed=4   a busier office
   window.__squadPreview drives it from tests: go(scenario), skip(), nextScan(kind), scanMe(kind), state(), sim, quiet(on). */
(function(){
'use strict';
const params=new URLSearchParams(location.search);
if(params.has('web')&&!window.__SQUAD)window.__SQUAD={web:true};

/* ---------------------------------------------------------------- a seeded random, so a run can be repeated */
let seed=+(params.get('seed')||7)>>>0||7;
const rnd=()=>{ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
const pick=a=>a[Math.floor(rnd()*a.length)];
const shuffle=a=>{ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const uuid=()=>'x'.repeat(8).replace(/x/g,()=>Math.floor(rnd()*16).toString(16))+'-'+Date.now().toString(36)+'-'+Math.floor(rnd()*1e9).toString(36);

/* ---------------------------------------------------------------- the word bank and the office plans (the handoff's word packs) */
const BANK=[["Pets",["Dog","Parrot","Cat","Goldfish","Rabbit","Tortoise","Puppy","Kitten","Labrador","Pomeranian"]],["Predators",["Lion","Jaguar","Shark","Leopard","Cheetah","Wolf","Fox","Crocodile","Cobra","Panther"]],["Herbivores",["Elephant","Camel","Zebra","Giraffe","Deer","Rhino","Hippo","Kangaroo","Panda","Gorilla"]],["Aquatic animals",["Dolphin","Starfish","Octopus","Jellyfish","Seahorse","Whale","Crab","Turtle","Prawn","Seal"]],["Planets",["Saturn","Mercury","Venus","Earth","Jupiter","Uranus","Neptune","Pluto"]],["Fruits",["Mango","Orange","Kiwi","Banana","Grapes","Papaya","Guava","Watermelon","Pineapple","Apple"]],["Veggies",["Potato","Tomato","Ladyfinger","Drumstick","Onion","Brinjal","Cabbage","Palak","Gobhi","Carrot"]],["North Indian food",["Chole Bhature","Rajma Chawal","Paratha","Butter Chicken","Dal Makhani","Paneer Tikka","Naan","Kachori","Lassi","Makki di Roti"]],["South Indian food",["Idli","Pongal","Dosa","Vada","Sambar","Upma","Uttapam","Appam","Rasam","Payasam"]],["Ice cream flavours",["Vanilla","Strawberry","Kulfi","Belgian Chocolate","Tender Coconut","Butterscotch","Kesar Pista","Tutti Frutti","Black Currant","Choco Chip"]],["Body parts",["Elbow","Palm","Knee","Nail","Thumb","Ankle","Chin","Ear","Nose","Lip"]],["Internal organs",["Brain","Kidney","Stomach","Lungs","Liver","Intestine","Appendix","Bladder","Food Pipe","Windpipe"]],["Shapes",["Circle","Heart","Cone","Diamond","Square","Triangle","Star","Oval","Cube","Arrow"]],["Sports",["Hockey","Chess","Cricket","Football","Kabaddi","Kho-Kho","Badminton","Tennis","Wrestling","Volleyball"]],["Board games",["Ludo","Carrom","Snakes & Ladders","Business","Scrabble","Chinese Checkers","Pictionary"]],["Dances",["Bhangra","Garba","Dandiya","Kathak","Bharatanatyam","Ghoomar","Lavani","Kuchipudi","Odissi","Kathakali"]],["Festivals",["Diwali","Bihu","Onam","Holi","Eid","Christmas","Navratri","Lohri","Durga Puja","Raksha Bandhan"]],["Cars",["Creta","Safari","Scorpio","Swift","Thar","Nano","Alto","Innova","Fortuner","Wagon R"]],["Phone brands",["Samsung","BlackBerry","Redmi","Vivo","Oppo","Realme","OnePlus","Nokia","Motorola","Lava"]],["Watch brands",["Titan","Noise","boAt","Fastrack","Casio","Sonata","Timex","Fossil","Rolex","HMT"]],["Airlines",["Air India","IndiGo","SpiceJet","Emirates","Vistara","Akasa","Qatar Airways","Etihad","Lufthansa","British Airways"]],["Office items",["Stapler","Mouse","Keyboard","Monitor","Laptop","Printer","Pen","Notebook","Calendar","Whiteboard"]],["Colours",["Red","Peach","Lime","Blue","Green","Yellow","Pink","Purple","Maroon","Brown"]],["Rivers",["Ganga","Yamuna","Kaveri","Narmada","Godavari","Brahmaputra","Sutlej","Hooghly","Ravi","Nile"]],["Europe",["France","Russia","Germany","Italy","Spain","England","Switzerland","Greece","Netherlands","Portugal"]],["Asia",["Japan","China","Nepal","Bhutan","Sri Lanka","Thailand","Singapore","Malaysia","Bangladesh","Indonesia"]],["Chocolates",["Dairy Milk","Mars","Five Star","Gems","Galaxy","Munch","Perk","KitKat","Milky Bar","Eclairs"]],["Mithai",["Laddoo","Jalebi","Barfi","Rasgulla","Gulab Jamun","Peda","Kaju Katli","Rasmalai","Halwa","Sandesh"]],["Biscuits",["Parle-G","Tiger","Hide & Seek","Monaco","Good Day","Marie","Bourbon","Oreo","Krackjack","50-50"]],["Birds",["Peacock","Kingfisher","Sparrow","Crow","Eagle","Owl","Pigeon","Myna","Koel","Swan"]],["Insects",["Ant","Butterfly","Mosquito","Bee","Housefly","Cockroach","Grasshopper","Dragonfly","Firefly","Termite"]],["Cricket words",["Wicket","Duck","Bat","Six","Four","Over","Boundary","Catch","Run","Pitch"]],["Jewellery",["Bangle","Ring","Chain","Necklace","Earrings","Payal","Nath","Bracelet","Kada","Locket"]],["Clothes",["Saree","Tie","Kurta","Jeans","Shirt","Dupatta","Jacket","Sweater","Socks","Lehenga"]],["Instruments",["Sitar","Drum","Flute","Tabla","Guitar","Harmonium","Dholak","Piano","Violin","Shehnai"]],["Flowers",["Rose","Sunflower","Lotus","Jasmine","Marigold","Hibiscus","Tulip","Lily","Champa","Raat Ki Rani"]],["Cities",["Delhi","Mumbai","Kolkata","Chennai","Jaipur","Pune","Agra","Lucknow","Indore","Bhopal"]],["Spices",["Haldi","Mustard","Jeera","Elaichi","Laung","Dalchini","Kali Mirch","Ajwain","Hing","Saunf"]],["Breakfast",["Poha","Cornflakes","Bread Butter","Toast","Omelette","Boiled Eggs","Oats","Sandwich","Chilla","Muesli"]],["Weather",["Rain","Cloud","Storm","Thunder","Fog","Monsoon","Snow","Breeze","Rainbow","Lightning"]],["Hot drinks",["Chai","Hot Chocolate","Coffee","Green Tea","Kadha","Haldi Doodh","Lemon Tea","Badam Milk","Filter Coffee","Bournvita"]],["Cold drinks",["Thums Up","Red Bull","Mountain Dew","Sprite","Limca","Maaza","Frooti","Pepsi","Coke","Rooh Afza"]]];
const PLANS={"HQ":{"people":140,"rounds":[[10,480000,60000,["Pets","Predators","Herbivores","Aquatic animals","Ice cream flavours","Chocolates","Mithai","Biscuits","Fruits","Veggies","North Indian food","South Indian food","Body parts","Internal organs"]],[5,480000,0,["Birds","Insects","Cricket words","Shapes","Sports","Board games","Dances","Festivals","Cars","Phone brands","Watch brands","Jewellery","Airlines","Office items","Clothes","Instruments","Flowers","Colours","Planets","Spices","Rivers","Cities","Europe","Asia","Hot drinks","Cold drinks","Breakfast","Weather"]]]},"Noida":{"people":43,"rounds":[[6,300000,60000,["Pets","Predators","Herbivores","Aquatic animals","Ice cream flavours","Chocolates","Mithai"]],[5,300000,60000,["Fruits","Veggies","North Indian food","South Indian food","Body parts","Internal organs","Shapes","Planets","Colours"]],[3,300000,0,["Sports","Board games","Dances","Festivals","Cars","Phone brands","Watch brands","Jewellery","Airlines","Office items","Clothes","Instruments","Europe","Asia"]]]},"Kolkata":{"people":14,"rounds":[[2,180000,30000,["Pets","Predators","Herbivores","Aquatic animals","Birds","Insects","Cricket words"]],[2,180000,30000,["Ice cream flavours","Chocolates","Colours","Fruits","Veggies","North Indian food","South Indian food"]],[2,180000,30000,["Body parts","Internal organs","Shapes","Sports","Board games","Dances","Festivals"]],[2,180000,30000,["Cars","Phone brands","Watch brands","Airlines","Office items","Planets","Mithai"]],[2,180000,0,["Europe","Asia","Rivers","Cities","Hot drinks","Cold drinks","Breakfast"]]]},"Gurgaon":{"people":13,"rounds":[[2,180000,30000,["Pets","Predators","Herbivores","Aquatic animals","Birds","Insects","Cricket words"]],[2,180000,30000,["Ice cream flavours","Chocolates","Colours","Fruits","Veggies","North Indian food","South Indian food"]],[2,180000,30000,["Body parts","Internal organs","Shapes","Sports","Board games","Dances","Festivals"]],[2,180000,30000,["Cars","Phone brands","Watch brands","Airlines","Office items","Planets","Mithai"]],[2,180000,0,["Europe","Asia","Rivers","Cities","Hot drinks","Cold drinks","Breakfast"]]]}};
const planName=Object.keys(PLANS).find(k=>k.toLowerCase()===String(params.get('plan')||'HQ').toLowerCase())||'HQ';
const PLAN=PLANS[planName];
const OFFICE=planName;
const RULES={right:100,wrong:-25,squadBonus:200,perMissing:100,timeBonusPerSecond:.5,dealMs:10000,qrWindowMs:20000,awayMs:60000,typedCodes:false};
const LOBBY_MS=5*60e3, KEEP_MS=2*60*60e3, TOP=5;

/* ---------------------------------------------------------------- the people */
const ME='u-me';
const FIRST=['Priya','Arjun','Kabir','Neha','Rohan','Ananya','Vikram','Meera','Ishaan','Sara','Dev','Karan','Aisha','Nikhil','Pooja','Rahul','Tara','Aman','Riya','Isha',
  'Kunal','Sneha','Varun','Diya','Manish','Zoya','Aditya','Sana','Harsh','Nisha','Yash','Kavya','Rohit','Anjali','Siddharth','Tanya','Gaurav','Ira','Mohit','Lavanya',
  'Abhay','Bhavna','Chetan','Deepa','Farhan','Gita','Hari','Juhi','Kiran','Leela'];
const LAST=['Nair','Sharma','Khan','Gupta','Mehta','Rao','Singh','Iyer','Malhotra','Das','Patel','Joshi','Verma','Bose','Ali','Jain','Sen','Yadav','Kapoor','Reddy'];
const DEPTS=['Design','Engineering','Sales','HR','Marketing','Finance'];
const COUNT=Math.max(5,Math.min(+(params.get('people')||0)||({HQ:40,Noida:43,Kolkata:14,Gurgaon:13}[planName]||PLAN.people),150));
const people=[{userId:ME,name:'Tanvi Sharma',initials:'T',dept:'Design',bot:false,photoUrl:null}];
for(let i=0;i<COUNT-1;i++){ const f=FIRST[i%FIRST.length], l=LAST[(i*7+3)%LAST.length];
  people.push({userId:'u-'+(i+1),name:f+' '+l,initials:f[0]+l[0],dept:DEPTS[i%DEPTS.length],bot:true,photoUrl:i===COUNT-6?'/media/preview-missing-photo.jpg':null}); }   // one face whose photo won't load: the initials stay
const P=id=>people.find(p=>p.userId===id);

const sim={v:1,next:null,session:null,quiet:false,ending:null};
const now=()=>Date.now();
let H=null, online=true, pushT=0;
function changed(){ sim.v++; if(pushT)return; pushT=setTimeout(()=>{ pushT=0; push(); },30); }
class Rule extends Error{ constructor(status,message){ super(message); this.status=status; } }

/* ---------------------------------------------------------------- a session: lobby, rounds, breaks */
function newSession(startsAt){ const t=now();
  sim.session={id:'ss-'+planName.toLowerCase()+'-'+Math.floor(rnd()*1e6).toString(36),status:'lobby',lobbyOpensAt:startsAt-LOBBY_MS,startsAt,phaseEndsAt:startsAt,roundIndex:0,
    rounds:PLAN.rounds.map(([squadSize,huntMs,breakMs,categories])=>({squadSize,huntMs,breakMs,categories})),players:[],totals:{},round:null,history:[],cancelReason:null,codeSeed:Math.floor(rnd()*1e9)};
  sim.next=null; void t; return sim.session; }
const playerOf=id=>sim.session&&sim.session.players.find(p=>p.userId===id);
function join(id,at){ const s=sim.session; let p=playerOf(id);
  if(!p){ const x=P(id); p={userId:id,name:x.name,initials:x.initials,photoUrl:x.photoUrl,dept:x.dept,left:false,playing:false,squad:undefined,word:null,away:false,online:true,joinedAt:at||now()}; s.players.push(p); }
  else { p.left=false; }
  return p; }
function leave(id){ const s=sim.session; const i=s.players.findIndex(p=>p.userId===id); if(i>=0)s.players.splice(i,1); }
function squadSizes(n,target){ if(n<2)return []; let k=Math.max(2,Math.round(n/Math.max(2,target))); k=Math.max(k,Math.ceil(n/10)); k=Math.min(k,Math.floor(n/2));
  const dealt=Math.min(n,k*10), base=Math.floor(dealt/k), extra=dealt%k; return Array.from({length:k},(_,i)=>base+(i<extra?1:0)); }
const bonusFor=(size,standard)=>Math.max(0,RULES.squadBonus+RULES.perMissing*(standard-size));
function deal(i,at){ const s=sim.session; at=at||now(); if(s.round)s.history.push(s.round);
  s.roundIndex=i; const c=s.rounds[i];
  const eligible=s.players.filter(p=>!p.left);
  for(const p of s.players){ p.playing=false; p.squad=undefined; p.word=null; p.away=false; }
  const round={index:i,squads:[],edges:[],scans:{},points:{},completions:{},notices:{},missesAgainst:{},dealtAt:at,huntStartsAt:at+RULES.dealMs,endsAt:at+RULES.dealMs+c.huntMs,overAt:null,skipped:false};
  s.round=round;
  if(eligible.length<4){ round.skipped=true; round.overAt=at; endPhase(at); return; }
  const sizes=squadSizes(eligible.length,c.squadSize).sort((a,b)=>b-a);
  const order=[ME].filter(id=>eligible.some(p=>p.userId===id)).concat(shuffle(eligible.filter(p=>p.userId!==ME).map(p=>p.userId)));
  const used=new Set(), cats=[];
  for(const size of sizes){ let cat=(c.categories||[]).map(n=>BANK.find(b=>b[0]===n)).find(b=>b&&!used.has(b[0])&&b[1].length>=size);
    if(!cat)cat=BANK.find(b=>!used.has(b[0])&&b[1].length>=size); used.add(cat[0]); cats.push(cat); }
  let k=0;
  sizes.forEach((size,j)=>{ const members=order.slice(k,k+size); k+=size; const cat=cats[j];
    round.squads.push({members,words:cat[1].slice(0,size),category:cat[0],bonus:bonusFor(size,c.squadSize),finishedAt:null,place:null,timeBonus:0});
    members.forEach((id,w)=>{ const p=playerOf(id); p.playing=true; p.squad=j; p.word=cat[1][w]; }); });
  s.status='dealing'; s.phaseEndsAt=round.huntStartsAt; }
function startHunt(){ const s=sim.session; s.status='hunt'; s.phaseEndsAt=s.round.endsAt; }
function endPhase(at){ const s=sim.session, last=s.roundIndex>=s.rounds.length-1;
  if(last){ s.status='over'; s.phaseEndsAt=at+KEEP_MS; } else { s.status='break'; s.phaseEndsAt=at+s.rounds[s.roundIndex].breakMs; } }
function endRound(at){ const s=sim.session, r=s.round; at=at||now(); if(!r||s.status!=='hunt')return;
  r.overAt=at; const fin=r.squads.filter(q=>q.finishedAt).length;
  r.squads.map((q,i)=>({q,size:largest(i)})).filter(e=>!e.q.finishedAt).sort((a,b)=>b.size-a.size).forEach((e,i)=>{ e.q.place=fin+i+1; });
  endPhase(at); }

/* ---------------------------------------------------------------- links and squads */
function groups(si){ const r=sim.session.round, members=r.squads[si].members, parent=new Map(members.map(id=>[id,id]));
  const find=id=>{ let x=id; while(parent.get(x)!==x)x=parent.get(x); return x; };
  for(const e of r.edges){ if(!parent.has(e.a)||!parent.has(e.b))continue; const ra=find(e.a), rb=find(e.b); if(ra!==rb)parent.set(ra,rb); }
  return new Map(members.map(id=>[id,find(id)])); }
function linkedWith(id){ const p=playerOf(id), r=sim.session.round; if(!r||!p||p.squad===undefined)return [id]; const g=groups(p.squad), mine=g.get(id); return r.squads[p.squad].members.filter(m=>g.get(m)===mine); }
function largest(si){ const c=new Map(); for(const v of groups(si).values())c.set(v,(c.get(v)||0)+1); return Math.max(0,...c.values()); }
const present=si=>sim.session.round.squads[si].members.filter(id=>!playerOf(id).away);
function credit(id,d){ const s=sim.session, before=s.totals[id]||0, after=before+d; s.totals[id]=after; s.round.points[id]=(s.round.points[id]||0)+d; return {before,after}; }
function notify(to,kind,about,at){ const r=sim.session.round; for(const id of to){ const l=r.notices[id]; if(l&&l.kind===kind&&l.userId===about)continue; r.notices[id]={kind,userId:about,at}; } }
function settle(si,at){ const r=sim.session.round, q=r.squads[si]; if(q.finishedAt)return false; const pr=present(si);
  if(pr.length<2){ if(pr.length===1)notify([pr[0]],'squad_left',pr[0],at); return false; }
  const g=groups(si), root=g.get(pr[0]); if(!pr.every(id=>g.get(id)===root))return false;
  q.finishedAt=at; q.place=r.squads.filter(x=>x.finishedAt).length;
  const secondsLeft=Math.max(0,Math.floor((r.endsAt-at)/1000)), timeBonus=Math.floor(secondsLeft*RULES.timeBonusPerSecond); q.timeBonus=timeBonus;
  for(const id of q.members.filter(m=>g.get(m)===root)){ const {before,after}=credit(id,q.bonus+timeBonus); r.completions[id]={at,bonus:q.bonus,timeBonus,secondsLeft,before,after}; }
  return true; }
function maybeEnd(at){ const s=sim.session, r=s.round; if(s.status!=='hunt')return false;
  const open=r.squads.some((q,i)=>!q.finishedAt&&present(i).length>=2); if(at<r.endsAt&&open)return false; endRound(at); return true; }

/* ---------------------------------------------------------------- QR codes: one per player per 20 s window; the one before still scans */
const win=t=>Math.floor(t/RULES.qrWindowMs);
const codeCache=new Map();
function codesIn(w){ const s=sim.session, key=s.id+':'+s.round.index+':'+w; if(codeCache.has(key))return codeCache.get(key);
  const used=new Set(), m=new Map(); let h=(s.codeSeed^(w*2654435761))>>>0;
  for(const p of s.players){ if(!p.playing)continue; let c; do{ h=Math.imul(h^(h>>>13),1103515245)+12345>>>0; c=String(1000+h%9000); }while(used.has(c)); used.add(c); m.set(p.userId,c); }
  codeCache.set(key,m); return m; }
const qrOf=(id,t)=>{ const s=sim.session; const c=codesIn(win(t||now())).get(id); return c?'SQ1:'+s.id+':'+s.round.index+':'+c:null; };
function holder(code,t){ for(const w of [win(t),win(t)-1]){ for(const [id,c] of codesIn(w))if(c===code)return {id,current:w===win(t)}; } return null; }

/* ---------------------------------------------------------------- a scan (the engine's rules and messages) */
function hunter(id){ const s=sim.session; if(!s||s.status!=='hunt'||!s.round)throw new Rule(409,'Scanning opens when the hunt starts.');
  const p=playerOf(id); if(!p||!p.playing||p.squad===undefined)throw new Rule(403,'You’re not in this round. You’ll play the next one.');
  if(p.away)throw new Rule(409,'Reconnecting… try again in a moment.'); return p; }
function scanQr(fromId,text,at){ at=at||now(); const s=sim.session, from=hunter(fromId), r=s.round;
  if(r.squads[from.squad].finishedAt)throw new Rule(409,'Your squad is complete. Your QR and scanner are off for the rest of the round.');
  const m=/^SQ1:([^:]+):(\d+):(\d{4})$/.exec(String(text||'').trim());
  if(!m||m[1]!==s.id||+m[2]!==r.index)throw new Rule(404,'That QR isn’t from this round of Secret Squad.');
  const h=holder(m[3],at), to=h&&playerOf(h.id);
  if(!to||!to.playing||to.left||to.squad===undefined)throw new Rule(404,'That QR has expired. Scan it again: it changes every 20 seconds.');
  if(to.userId===fromId)throw new Rule(400,'That’s your own QR.');
  if(r.squads[to.squad].finishedAt)throw new Rule(409,to.name+'’s squad is complete: their QR has stopped working.');
  if(to.away)throw new Rule(404,'That QR has expired. Scan it again: it changes every 20 seconds.');
  return resolve(fromId,to.userId,at); }
function resolve(fromId,toId,at){ const s=sim.session, r=s.round, from=playerOf(fromId), to=playerOf(toId);
  const ev=(id,result,role,other,delta,b,a)=>{ r.scans[id]={id:uuid(),result,role,otherId:other,delta,before:b,after:a,completed:false,at}; };
  const out=(result,delta,completed)=>({result,delta,total:s.totals[fromId]||0,otherName:to.name,otherWord:to.word,completed});
  if(linkedWith(fromId).includes(toId)){ const t=s.totals[fromId]||0; ev(fromId,'already','scanner',toId,0,t,t); changed(); return out('already',0,false); }
  if(from.squad===to.squad){ r.edges.push({a:fromId,b:toId,at}); const a=credit(fromId,RULES.right), b=credit(toId,RULES.right);
    ev(fromId,'right','scanner',toId,RULES.right,a.before,a.after); ev(toId,'right','scanned',fromId,RULES.right,b.before,b.after);
    const completed=settle(from.squad,at); if(completed){ r.scans[fromId].completed=true; r.scans[toId].completed=true; }
    const o=out('right',RULES.right,completed); maybeEnd(at); changed(); return o; }
  const a=credit(fromId,RULES.wrong), b=credit(toId,RULES.wrong);
  ev(fromId,'wrong','scanner',toId,RULES.wrong,a.before,a.after); ev(toId,'wrong','scanned',fromId,RULES.wrong,b.before,b.after);
  r.missesAgainst[toId]=(r.missesAgainst[toId]||0)+1; changed(); return out('wrong',RULES.wrong,false); }
function setAway(id,away,at){ const s=sim.session, r=s.round, p=playerOf(id); if(!p||!r)return; at=at||now();
  if(away){ p.away=true; const q=r.squads[p.squad]; if(q&&!q.finishedAt){ notify(q.members.filter(m=>m!==id),'teammate_away',id,at); settle(p.squad,at); } }
  else if(p.away){ p.away=false; const q=r.squads[p.squad]; if(q&&!q.finishedAt){ r.edges=r.edges.filter(e=>e.a!==id&&e.b!==id); notify(q.members.filter(m=>m!==id),'teammate_back',id,at); } }
  maybeEnd(at); changed(); }

/* ---------------------------------------------------------------- standings and the view (the engine's sessionViewFor) */
function standings(){ const s=sim.session; const rounds=s.history.concat(s.round?[s.round]:[]); const dealt=new Set(rounds.flatMap(r=>r.squads.flatMap(q=>q.members)));
  const rows=s.players.filter(p=>dealt.has(p.userId)).map(p=>({userId:p.userId,name:p.name,initials:p.initials,photoUrl:p.photoUrl||null,points:s.totals[p.userId]||0}))
    .sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name));
  let rank=0; return rows.map((row,i)=>{ if(i===0||rows[i-1].points!==row.points)rank=i+1; return Object.assign(row,{rank}); }); }
const short=p=>({userId:p.userId,name:p.name,initials:p.initials,photoUrl:p.photoUrl||null});
function card(round,si,me){ const q=round.squads[si]; const saved=sim.session.round; sim.session.round=round; const g=groups(si); sim.session.round=saved; const mine=me?g.get(me.userId):undefined;
  return {roundNumber:round.index+1,category:q.category,words:q.words,size:q.members.length,bonus:q.bonus,timeBonus:q.timeBonus||0,complete:!!q.finishedAt,place:q.place||0,
    members:q.members.map((id,i)=>Object.assign(short(playerOf(id)),{word:q.words[i],me:id===(me&&me.userId),linked:mine!==undefined&&g.get(id)===mine}))}; }
function viewFor(uid){ const s=sim.session, t=now(), meP=P(uid);
  const out={v:sim.v,now:t,office:OFFICE,me:{userId:uid,name:meP.name,initials:meP.initials,photoUrl:meP.photoUrl||null},next:s?null:sim.next,session:null};
  if(!s)return out;
  const me=playerOf(uid), r=s.round, st=standings(), rankOf=new Map(st.map(x=>[x.userId,x]));
  out.session={id:s.id,status:s.status,lobbyOpensAt:s.lobbyOpensAt,startsAt:s.startsAt,phaseEndsAt:s.phaseEndsAt,roundIndex:s.roundIndex,roundNumber:s.roundIndex+1,roundCount:s.rounds.length,
    rounds:s.rounds.map(c=>({squadSize:c.squadSize,huntMs:c.huntMs,breakMs:c.breakMs})),rules:Object.assign({},RULES),
    clock:{lobbyEndsAt:s.status==='lobby'?s.startsAt:null,revealEndsAt:s.status==='dealing'&&r?r.huntStartsAt:null,huntEndsAt:s.status==='hunt'&&r?r.endsAt:null,breakEndsAt:s.status==='break'?s.phaseEndsAt:null},
    joined:!!me&&!me.left,playing:!!(me&&me.playing)&&!!r&&!r.skipped,
    players:s.status==='lobby'?s.players.filter(p=>!p.left).length:s.players.filter(p=>p.playing).length,
    faces:s.status==='lobby'?s.players.slice(-12).reverse().map(short):[],
    totalPoints:me?s.totals[uid]||0:0,cancelReason:s.cancelReason,round:null,final:null};
  if(r){ const done=s.status==='break'||s.status==='over'||!!r.overAt;
    const v={index:r.index,number:r.index+1,squadSize:s.rounds[r.index].squadSize,skipped:!!r.skipped,dealtAt:r.dealtAt,huntStartsAt:r.huntStartsAt,endsAt:r.endsAt,overAt:r.overAt,
      board:{squads:r.squads.length,complete:r.squads.filter(q=>q.finishedAt).length,hunting:r.squads.filter((q,i)=>!q.finishedAt&&present(i).length>=2).length,stuck:r.squads.filter((q,i)=>!q.finishedAt&&present(i).length<2).length},
      me:null,squad:null,scan:null,notice:null,results:null};
    const dealt=me&&me.playing&&me.squad!==undefined&&!r.skipped?me:null;
    if(done){ const mine=dealt?rankOf.get(uid):null; const [tid,scans]=Object.entries(r.missesAgainst).sort((a,b)=>b[1]-a[1])[0]||[];
      v.results={skipped:!!r.skipped,rank:mine?mine.rank:null,of:st.length,roundPoints:dealt?r.points[uid]||0:0,total:dealt?s.totals[uid]||0:0,squad:dealt?card(r,dealt.squad,dealt):null,top:st.slice(0,TOP),
        squads:r.squads.map((q,i)=>({place:q.place||0,category:q.category,words:q.words,size:q.members.length,linked:largest(i),complete:!!q.finishedAt,finishedAt:q.finishedAt||null,mine:dealt?dealt.squad===i:false})).sort((a,b)=>a.place-b.place),
        trickiest:tid?{word:playerOf(tid).word,scans}:null}; }
    if(dealt){ const q=r.squads[dealt.squad], live=s.status==='hunt'&&!q.finishedAt&&!dealt.away;
      v.me={word:dealt.word,qr:live?qrOf(uid,t):null,qrExpiresAt:live?(win(t)+1)*RULES.qrWindowMs:null,code:null,away:dealt.away,roundPoints:r.points[uid]||0};
      const ids=linkedWith(uid), person=id=>{ const p=playerOf(id); return Object.assign(short(p),{word:p.word}); };
      const members=ids.map(id=>Object.assign(person(id),{me:id===uid,away:!!playerOf(id).away}));
      const awayMembers=q.members.filter(id=>!ids.includes(id)&&playerOf(id).away).map(person);
      const needed=present(dealt.squad).length, linkedPresent=ids.filter(id=>!playerOf(id).away).length, comp=r.completions[uid], reveal=!!q.finishedAt||done;
      v.squad={size:q.members.length,bonus:q.bonus,needed,more:q.finishedAt?0:Math.max(0,needed-linkedPresent),members,awayMembers,unknown:Math.max(0,q.members.length-members.length-awayMembers.length),
        complete:q.finishedAt?{at:q.finishedAt,place:q.place||0,category:q.category,bonus:comp?comp.bonus:0,timeBonus:comp?comp.timeBonus:0,secondsLeft:comp?comp.secondsLeft:0,before:comp?comp.before:s.totals[uid]||0,after:comp?comp.after:s.totals[uid]||0}:null,
        category:reveal?q.category:null,words:reveal?q.words:null};
      const last=r.scans[uid]; if(last)v.scan={id:last.id,result:last.result,role:last.role,other:person(last.otherId),delta:last.delta,before:last.before,after:last.after,completed:last.completed,at:last.at};
      const n=r.notices[uid]; if(n){ const a=playerOf(n.userId); v.notice={kind:n.kind,name:a?a.name:'A teammate',word:a?a.word:null,at:n.at}; } }
    out.session.round=v; }
  if(s.status==='over'){ const mine=rankOf.get(uid); let last=null;
    if(me)for(const round of s.history.concat(s.round?[s.round]:[]).reverse()){ const i=round.squads.findIndex(q=>q.members.includes(uid)); if(i>=0){ last=card(round,i,me); break; } }
    out.session.final={rank:mine?mine.rank:null,of:st.length,total:me?s.totals[uid]||0:0,lastSquad:last,leaderboard:st}; }
  return out; }

/* ---------------------------------------------------------------- the clock and the colleagues' own moves */
let botT=0, joinT=0, lastWin=0;
const speed=()=>Math.max(.2,+(params.get('speed')||1));
function tick(){ const s=sim.session, t=now();
  if(!s){ if(sim.next&&sim.next.lobbyOpensAt<=t){ const n=sim.next; newSession(n.startsAt); sim.session.id=n.sessionId; changed(); } return; }
  if(s.status==='lobby'){ if(t>=s.startsAt){ deal(0,t); changed(); }
    else if(!sim.quiet&&t>joinT){ joinT=t+(900+rnd()*1500)/speed(); const p=people.find(x=>x.bot&&!playerOf(x.userId)); if(p){ join(p.userId,t); changed(); } } return; }
  if(s.status==='dealing'){ if(t>=s.phaseEndsAt){ startHunt(); changed(); } return; }
  if(s.status==='break'){ if(t>=s.phaseEndsAt){ deal(s.roundIndex+1,t); changed(); } return; }
  if(s.status!=='hunt')return;
  if(maybeEnd(t)){ changed(); return; }
  if(win(t)!==lastWin){ lastWin=win(t); changed(); }
  if(!sim.quiet&&t>botT){ botT=t+(1600+rnd()*2400)/speed(); botMove(t); } }
function botMove(t){ const s=sim.session, r=s.round;
  const free=id=>{ const p=playerOf(id); return p&&p.playing&&!p.away&&!r.squads[p.squad].finishedAt; };
  const bots=s.players.filter(p=>p.userId!==ME&&free(p.userId)).map(p=>p.userId); if(!bots.length)return;
  const a=pick(bots), pa=playerOf(a);
  const mates=r.squads[pa.squad].members.filter(m=>m!==a&&!linkedWith(a).includes(m)&&free(m));
  let b=null; const roll=rnd();
  if(roll<.12&&free(ME)&&!linkedWith(a).includes(ME))b=ME;
  else if(roll<.62&&mates.filter(m=>m!==ME).length)b=pick(mates.filter(m=>m!==ME));
  if(!b){ const others=s.players.filter(p=>p.userId!==a&&p.userId!==ME&&free(p.userId)).map(p=>p.userId); if(!others.length)return; b=pick(others); }
  try{ scanQr(a,qrOf(b,t),t); }catch(e){} }

/* ---------------------------------------------------------------- the transport the page talks to */
function push(){ if(H&&online)H.state(viewFor(ME)); paintPanel(); }
function handle(ev,p){ const s=sim.session;
  if(ev==='squad:sync'){ setTimeout(push,20); return {}; }
  if(ev==='squad:board'){ if(s&&s.status==='over'&&(!p.sessionId||p.sessionId===s.id))return {sessionId:s.id,office:OFFICE,endsAt:new Date((s.round&&s.round.overAt)||now()).toISOString(),results:standings()};
    // A finished game made up for the board: everyone in the office, most points first (one below 0), ties shared.
    const rows=people.map((x,i)=>({userId:x.userId,name:x.name,initials:x.initials,photoUrl:x.photoUrl||null,points:x.userId===ME?410:x.userId==='u-5'?Math.round(1780-4*61-(4%3)*15):Math.round(1780-i*61-(i%3)*15)-(i===people.length-1?1900:0)}))
      .sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name)); let rank=0; rows.forEach((r,i)=>{ if(i===0||rows[i-1].points!==r.points)rank=i+1; r.rank=rank; });
    return {sessionId:p.sessionId||'ss-preview-board',office:OFFICE,endsAt:new Date(now()-36e5).toISOString(),results:rows}; }
  if(ev==='squad:join'){ if(!s)throw new Rule(404,'There’s no Secret Squad open for your office right now.');
    if(s.status==='over'||s.status==='cancelled')throw new Rule(409,'This game has ended.');
    join(ME); changed(); return {}; }
  if(ev==='squad:leave'){ if(!s)throw new Rule(404,'There’s no Secret Squad open for your office right now.');
    if(s.status==='dealing'||s.status==='hunt')throw new Rule(409,'You can leave between rounds.'); leave(ME); changed(); return {}; }
  if(ev==='squad:scan'||ev==='squad:check'){ if(p&&p.code!=null&&p.qr==null)throw new Rule(400,'Scan their QR code.'); if(!s)throw new Rule(409,'Scanning opens when the hunt starts.');
    return scanQr(ME,p&&p.qr); }
  throw new Rule(400,'Unknown request.'); }
window.SquadPreview={
  connect(auth,h){ H=h; online=true; setTimeout(push,150);
    return {request:(ev,p)=>new Promise((res,rej)=>setTimeout(()=>{ if(!online)return rej(new Rule(0,'Not connected. Try again in a moment.')); try{ res(handle(ev,p||{})); }catch(e){ rej(e); } },120)),
      sync(){ setTimeout(push,60); }, close(){ if(H===h)H=null; }}; },
  auth:{request:email=>new Promise((res,rej)=>setTimeout(()=>/@/.test(email)?res({success:true}):rej(new Rule(400,'Enter your work email.')),400)),
    verify:(email,otp)=>new Promise((res,rej)=>setTimeout(()=>otp==='123456'?res({success:true,token:'preview-token',user:{name:'Tanvi Sharma'}}):rej(new Rule(401,'That code is wrong or has expired.')),400)),
    logout:()=>Promise.resolve({})},
};

/* In the app (the default here): the bridge is there, haptics and all, but no scanner unless ?scan=native. In a browser (?web): none. */
if(!params.has('web')&&!window.Sowaka){ window.Sowaka={native:true,haptic(){}}; document.documentElement.classList.add('app'); }
/* The app's scanner, pretended: it "scans" whoever nextScan() asked for, else an unlinked squadmate half the time, else anyone. */
const queued=[];
function target(kind){ const s=sim.session, r=s&&s.round, me=playerOf(ME); if(!r||!me||me.squad===undefined)return null;
  const mates=r.squads[me.squad].members.filter(m=>m!==ME), linked=linkedWith(ME);
  const others=s.players.filter(p=>p.playing&&p.squad!==me.squad&&!r.squads[p.squad].finishedAt&&!p.away).map(p=>p.userId);
  if(kind==='right')return mates.find(m=>!linked.includes(m)&&!playerOf(m).away)||null;
  if(kind==='already')return mates.find(m=>linked.includes(m))||null;
  if(kind==='wrong')return others[0]||null;
  if(kind==='own')return ME;
  return null; }
function qrFor(kind){ if(kind==='stale')return 'SQ1:old-session:0:1234'; const id=target(kind); return id?qrOf(id):null; }
if(params.get('scan')==='native'){ window.Sowaka=Object.assign({haptic(){}},window.Sowaka||{},{native:true,scanQr(){ return new Promise(res=>setTimeout(()=>{
    const s=sim.session; if(!s||s.status!=='hunt')return res(null);
    const kind=queued.shift()||(rnd()<.5?'right':'wrong'); res(qrFor(kind)||qrFor('wrong')); },500)); }}); document.documentElement.classList.add('app'); }

/* ---------------------------------------------------------------- scenarios: each screen, on demand */
function freshSession(startsInMs){ newSession(now()+startsInMs); return sim.session; }
function everyoneIn(){ for(const p of people)join(p.userId,now()-60e3); }
/* A round dealt `ago` ms ago (its hunt `ago−10 s` in), optionally with the hunt clock set to `leftMs`. */
function roundAt(i,leftMs){ const s=sim.session, c=s.rounds[i], t=now(); const huntStart=t-(c.huntMs-leftMs);
  deal(i,huntStart-RULES.dealMs); startHunt(); }
function linkSome(si,n,at){ const r=sim.session.round, m=r.squads[si].members; for(let k=1;k<Math.min(n,m.length);k++)resolve(m[k-1],m[k],at); }
/* Plays the other squads of the round as an office would: most complete at different times, some don't, a few wrong scans. */
function playOthers(opts){ opts=opts||{}; const s=sim.session, r=s.round, t=now(), span=t-r.huntStartsAt, mine=(playerOf(ME)||{}).squad;
  r.squads.forEach((q,i)=>{ if(i===mine&&!opts.mine)return; const at=r.huntStartsAt+Math.round(span*(.25+.6*((i*37)%11)/11));
    if(i%4===3)linkSome(i,Math.max(2,Math.floor(q.members.length/2)),at);
    else for(let k=1;k<q.members.length;k++)resolve(q.members[k-1],q.members[k],at-(q.members.length-k)*4000); });
  for(let k=0;k<Math.min(6,r.squads.length*2);k++){ const a=r.squads[k%r.squads.length].members[0], b=r.squads[(k+1)%r.squads.length].members[1]; if(a&&b&&a!==ME&&b!==ME)resolve(a,b,r.huntStartsAt+5000+k*1000); } }
/* You were the busy one: you scanned most of your squad yourself (so the sample ranks you near the top, as the canvas does). */
function playMine(complete,at){ const r=sim.session.round, mine=playerOf(ME).squad, m=r.squads[mine].members;
  const n=complete?m.length:Math.max(2,Math.ceil(m.length/2)); for(let k=1;k<n;k++)resolve(k%4===3?m[k-1]:ME,m[k],at-(n-k)*9000); }
function playedRound(i,complete){ roundAt(i,60e3); const r=sim.session.round, t=now();
  playMine(complete!==false,r.huntStartsAt+Math.round((t-r.huntStartsAt)*.4)); playOthers(); resolve(ME,target('wrong')||ME,r.huntStartsAt+30000); endRound(t); }
const SC={
  landing(){ sim.session=null; sim.next={sessionId:'ss-next',lobbyOpensAt:now()+2*864e5-LOBBY_MS,startsAt:now()+2*864e5,rounds:PLAN.rounds.map(([squadSize,huntMs,breakMs])=>({squadSize,huntMs,breakMs}))}; },
  landingLocked(){ SC.landing(); sim.next.startsAt=now()+LOBBY_MS+(22*60+13)*1e3; sim.next.lobbyOpensAt=sim.next.startsAt-LOBBY_MS; },
  landingSoon(){ SC.landing(); sim.next.startsAt=now()+LOBBY_MS+4000; sim.next.lobbyOpensAt=sim.next.startsAt-LOBBY_MS; },
  empty(){ sim.session=null; sim.next=null; },
  lobbyOpen(){ const s=freshSession(4*60e3+12e3); for(const p of people.slice(1,people.length-4))join(p.userId,now()-30e3); void s; },
  lobby(){ SC.lobbyOpen(); join(ME); sim.session.startsAt=sim.session.phaseEndsAt=now()+134e3; },
  reveal(){ freshSession(-1000); everyoneIn(); deal(0,now()-1500); },
  hunt(){ freshSession(-60e3); everyoneIn(); roundAt(0,7*60e3+12e3); const m=sim.session.round.squads[playerOf(ME).squad].members; resolve(ME,m[1],now()-40e3); playOthers(); sim.session.round.scans={}; },
  right(){ SC.hunt(); scanQr(ME,qrOf(target('right'))); },
  wrong(){ freshSession(-60e3); everyoneIn(); roundAt(0,6*60e3); scanQr(ME,qrOf(target('wrong'))); },
  scanned(){ SC.hunt(); const m=sim.session.round.squads[playerOf(ME).squad].members, by=m.find(x=>x!==ME&&!linkedWith(ME).includes(x)); scanQr(by,qrOf(ME)); },
  nearlyDone(){ freshSession(-60e3); everyoneIn(); roundAt(0,90e3+600); const m=sim.session.round.squads[playerOf(ME).squad].members; for(let k=2;k<m.length;k++)resolve(m[k-1],m[k],now()-(m.length-k)*5000); playOthers(); sim.session.round.scans={}; },
  complete(){ SC.nearlyDone(); scanQr(ME,qrOf(target('right'))); },
  huntDone(){ SC.complete(); },
  away(){ SC.hunt(); const m=sim.session.round.squads[playerOf(ME).squad].members; setAway(m[m.length-1],true); },
  meAway(){ SC.hunt(); playerOf(ME).away=true; },
  breakTime(){ freshSession(-20*60e3); everyoneIn(); playedRound(0); sim.session.phaseEndsAt=now()+(sim.session.rounds[0].breakMs||30e3)-3e3; },
  reveal2(){ SC.breakTime(); deal(1,now()-1500); },
  hunt2(){ SC.breakTime(); roundAt(1,5*60e3+30e3); const m=sim.session.round.squads[playerOf(ME).squad].members; resolve(m[1],ME,now()-50e3); playOthers(); sim.session.round.scans={}; },
  final(){ freshSession(-40*60e3); everyoneIn(); const n=sim.session.rounds.length; for(let i=0;i<n;i++)playedRound(i,i!==1||n<3); },
  /* Kolkata's round 3 of 5 (pairs), or the plan's middle round: deal it and start the hunt with the plan's clock. */
  middle(){ freshSession(-40*60e3); everyoneIn(); const n=sim.session.rounds.length, k=Math.min(2,n-1); for(let i=0;i<k;i++)playedRound(i); sim.session.status='break'; deal(k,now()-1500); },
  middleHunt(){ SC.middle(); startHunt(); sim.session.round.huntStartsAt=now()-20e3; sim.session.round.endsAt=sim.session.round.huntStartsAt+sim.session.rounds[sim.session.roundIndex].huntMs; sim.session.phaseEndsAt=sim.session.round.endsAt; },
  watching(){ freshSession(-60e3); for(const p of people.slice(1))join(p.userId,now()-60e3); roundAt(0,5*60e3); playOthers({mine:true}); },
  waiting(){ SC.watching(); join(ME); },
  cancelled(){ SC.breakTime(); sim.session.status='cancelled'; sim.session.cancelReason='Called off by HR'; sim.session.phaseEndsAt=now()+KEEP_MS;
    sim.next={sessionId:'ss-n2',lobbyOpensAt:now()+3*864e5-LOBBY_MS,startsAt:now()+3*864e5,rounds:PLAN.rounds.map(([squadSize,huntMs,breakMs])=>({squadSize,huntMs,breakMs}))}; },
};
function go(name){ if(name==='offline')return offlineFor(8000); if(name==='fatal'){ if(H)H.fatal({code:'no_office'}); return; }
  const f=SC[name]; if(!f)throw new Error('no scenario '+name);
  sim.quiet=true; codeCache.clear(); f(); sim.v+=10; online=true; if(H)H.online(true); push(); }
function offlineFor(ms){ online=false; if(H)H.online(false); paintPanel(); setTimeout(()=>{ online=true; if(H){ H.online(true); push(); } },ms); }
function skip(){ const s=sim.session; sim.quiet=false;
  if(!s){ if(sim.next)sim.next.lobbyOpensAt=now(); else SC.lobbyOpen(); changed(); return; }
  if(s.status==='lobby'){ if(!playerOf(ME))join(ME); s.startsAt=s.phaseEndsAt=now(); }
  else if(s.status==='dealing')s.phaseEndsAt=now();
  else if(s.status==='hunt')endRound(now());
  else if(s.status==='break')s.phaseEndsAt=now();
  else { SC.landingSoon(); }
  changed(); }

/* A fresh preview opens on the lobby, filling up, with the whole flow at its real pace (Skip moves it on). */
SC.lobbyOpen(); sim.session.startsAt=sim.session.phaseEndsAt=now()+LOBBY_MS-20e3; sim.session.lobbyOpensAt=now()-20e3;
sim.session.players.splice(6);
setInterval(tick,250);

/* ---------------------------------------------------------------- the preview panel: scenarios, and who is nearby with a Scan button each */
const LIST=[['landing','Game screen (2 days)'],['landingLocked','Join locked'],['landingSoon','Lobby opens in 4 s'],['empty','Nothing scheduled'],['lobbyOpen','Lobby open, not in'],['lobby','Lobby (in)'],
  ['reveal','Word, round 1'],['hunt','Hunt'],['right','Right'],['wrong','Wrong (below 0)'],['scanned','Scanned you'],['nearlyDone','One to go, 1:30 left'],['complete','Squad complete'],
  ['away','Teammate away'],['meAway','You were away'],['breakTime','Break'],['reveal2','Word, round 2'],['hunt2','Hunt, round 2'],['middle','Round 3 word'],['middleHunt','Round 3 hunt'],['final','Final'],
  ['watching','Not joined, round on'],['waiting','Joined mid-round'],['cancelled','Called off'],['offline','Reconnecting'],['fatal','Fatal']];
let panel=null, open=false;
function paintPanel(){ if(!panel||!open)return; const s=sim.session, r=s&&s.round, list=panel.querySelector('#pvnear');
  if(!r||s.status!=='hunt'){ list.innerHTML='<i>Colleagues show during the hunt.</i>'; return; }
  const me=playerOf(ME), mine=me&&me.squad;
  list.innerHTML=s.players.filter(p=>p.userId!==ME&&p.playing).sort((a,b)=>(a.squad===mine?0:1)-(b.squad===mine?0:1)).slice(0,24).map(p=>
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px'+(p.squad===mine?';font-weight:800':'')+'"><span>'+(p.squad===mine?'★ ':'')+p.name.split(' ')[0]+' · '+p.word+(p.away?' (away)':'')+(linkedWith(ME).includes(p.userId)?' ✓':'')+'</span>'+
    '<span><button type="button" data-pvscan="'+p.userId+'" style="font:600 11px system-ui;background:#C6F432;padding:4px 8px;border-radius:8px">I scan</button> <button type="button" data-pvme="'+p.userId+'" style="font:600 11px system-ui;background:#EEEAFF;padding:4px 8px;border-radius:8px">Scans me</button></span></div>').join(''); }
function mountPanel(){ if(window.__pvBare||params.has('bare'))return;
  const b=document.createElement('button'); b.type='button'; b.textContent='Preview'; b.setAttribute('aria-label','Preview controls');
  b.style.cssText='position:fixed;right:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:50;font:700 12px system-ui;padding:8px 11px;border-radius:999px;background:#8F7BFF;color:#fff;box-shadow:0 3px 10px rgba(0,0,0,.25);opacity:.85;min-height:44px';
  panel=document.createElement('div');
  panel.style.cssText='position:fixed;right:10px;left:10px;bottom:calc(60px + env(safe-area-inset-bottom,0px));max-width:410px;margin-left:auto;max-height:70vh;overflow:auto;z-index:50;background:#fff;color:#141B3F;border-radius:16px;padding:12px;box-shadow:0 8px 30px rgba(0,0,0,.3);font:13px system-ui;display:none';
  panel.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>Preview: simulated server ('+OFFICE+')</b><button type="button" data-pv="skip" style="font:700 12px system-ui;background:#C6F432;padding:6px 10px;border-radius:9px;border:2px solid #1F7A32">Skip phase ▸</button></div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:5px">'+LIST.map(([k,l])=>'<button type="button" data-pv="'+k+'" style="font:600 12px system-ui;background:#F4F2FC;padding:6px 9px;border-radius:9px">'+l+'</button>').join('')+'</div>'+
    '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:10px;font-weight:700">'+Object.keys(PLANS).map(k=>'<a href="?plan='+k+'&scan=native" style="color:#3A2E9E">'+k+'</a>').join('')+
    '<a href="?web" style="color:#3A2E9E">In a browser (code 123456)</a><a href="?plan='+planName+'&scan=native" style="color:#3A2E9E">App with scanner</a><a href="?plan='+planName+'&speed=4" style="color:#3A2E9E">Busy office</a><a href="?plan='+planName+'#board" style="color:#3A2E9E">Full leaderboard</a></div>'+
    '<div style="margin-top:10px;font-weight:800">Nearby (★ your squad)</div><div id="pvnear" style="display:flex;flex-direction:column;gap:3px;margin-top:4px"></div>';
  b.onclick=()=>{ open=!open; panel.style.display=open?'block':'none'; paintPanel(); };
  panel.addEventListener('click',e=>{ const t=e.target.closest('[data-pv],[data-pvscan],[data-pvme]'); if(!t)return;
    if(t.hasAttribute('data-pvscan')){ try{ scanQr(ME,qrOf(t.getAttribute('data-pvscan'))); }catch(x){ alert(x.message); } return; }
    if(t.hasAttribute('data-pvme')){ try{ scanQr(t.getAttribute('data-pvme'),qrOf(ME)); }catch(x){ alert(x.message); } return; }
    const k=t.getAttribute('data-pv'); if(k==='skip')skip(); else go(k); });
  document.body.append(panel,b); }
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountPanel); else mountPanel();
setInterval(()=>{ if(open)paintPanel(); },1000);

window.__squadPreview={go,skip,state:()=>viewFor(ME),sim,plan:planName,people,
  nextScan:kind=>{ queued.push(kind); },
  /* A colleague scans you: 'right' (an unlinked squadmate) or 'wrong' (someone from another squad). */
  scanMe:kind=>{ const s=sim.session, r=s.round, me=playerOf(ME); const id=kind==='right'?r.squads[me.squad].members.find(m=>m!==ME&&!linkedWith(ME).includes(m)):target('wrong'); return scanQr(id,qrOf(ME)); },
  qrOf, target, endRound:()=>{ endRound(now()); changed(); }, quiet:q=>{ sim.quiet=!!q; }, offline:offlineFor, push:()=>{ sim.v++; push(); },
  setLeft:ms=>{ const r=sim.session.round; r.endsAt=now()+ms; sim.session.phaseEndsAt=r.endsAt; changed(); },
  pushRaw:st=>{ if(H)H.state(st); }};
})();
