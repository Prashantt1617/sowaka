/* LIVE: Secret Squad against the real server (docs/secret-squad.md). In the app the server puts a signed ticket in the page
   (window.__SQUAD = {ticket, hopTicket}); in a phone browser, `GET /squad` puts {web: true} there and the page signs in by email
   code and connects with the session token. This file gives the page one small interface (see game.js):
     SquadLive.connect(auth, {state, fatal, online, authFailed}) -> {request(event, payload), sync(), close()}
   over socket.io (client 4.8.3, inlined ahead of this script): namespace /squad on path /connect/socket, requests with an ack of
   {ok: true, data} or {ok: false, status, message}.
   The policy hop, as Scribble's: today's app loads a catalog page as a string with connect-src 'none', so a page that finds that policy
   first reloads itself once, in the same WebView, at the same address plus ?ticket=<hopTicket>; the server serves that copy with a
   policy that allows its own socket, and the app hands it the bridge again when it has loaded. */
(function(){
'use strict';
const Q=(window.__SQUAD&&typeof window.__SQUAD==='object')?window.__SQUAD:null;
if(!Q)return;

/* ---------- the policy hop (app only: the browser copy has no such meta) ---------- */
function blockedByPolicy(){ for(const m of document.querySelectorAll('meta[http-equiv]')){ if(String(m.httpEquiv).toLowerCase()!=='content-security-policy')continue;
    const parts=String(m.content||'').split(';').map(s=>s.trim());
    const d=parts.find(s=>/^connect-src\s/i.test(s))||parts.find(s=>/^default-src\s/i.test(s));
    if(d&&/'none'/.test(d))return true; } return false; }
let hopFailed=false;
if(Q.ticket&&blockedByPolicy()){
  const here=location.protocol==='https:'||location.protocol==='http:';
  if(/[?&]ticket=/.test(location.search)||!here||!Q.hopTicket){ hopFailed=true; }
  else{
    window.__squadHopping=true; document.documentElement.classList.add('hop');
    /* The URL carries the short hop token, never the socket ticket. */
    location.replace(location.origin+location.pathname+'?ticket='+encodeURIComponent(Q.hopTicket));
    return;
  }
}

const errOf=(status,message)=>Object.assign(new Error(message||'Something went wrong. Try again.'),{status:status|0});
const CLOSE_AND_REOPEN='Close and reopen Secret Squad to keep playing.';

window.SquadLive={connect(auth,h){
  if(hopFailed){ setTimeout(()=>h.fatal({code:'blocked',message:'Secret Squad could not reach the game server. '+CLOSE_AND_REOPEN}),0); return {request:()=>Promise.reject(errOf(0,CLOSE_AND_REOPEN)),sync(){},close(){}}; }
  if(typeof window.io!=='function'){ setTimeout(()=>h.fatal({code:'no_client',message:CLOSE_AND_REOPEN}),0); return {request:()=>Promise.reject(errOf(0,CLOSE_AND_REOPEN)),sync(){},close(){}}; }
  const origin=String(Q.origin||location.origin).replace(/\/+$/,'');
  const sock=window.io(origin+'/squad',{path:Q.path||'/connect/socket',auth:auth.ticket?{ticket:String(auth.ticket)}:{token:String(auth.token)},
    transports:['websocket','polling'],tryAllTransports:true,reconnection:true,reconnectionDelay:800,reconnectionDelayMax:5000,randomizationFactor:.4,timeout:10000});
  let dead=false, offline=false;
  const waiters=[];
  function die(code,message){ if(dead)return; dead=true; try{ sock.io.reconnection(false); sock.disconnect(); }catch(e){}
    waiters.splice(0).forEach(w=>w.reject(errOf(0,message))); h.fatal({code,message}); }
  function ready(){ if(dead)return Promise.reject(errOf(0,CLOSE_AND_REOPEN)); if(sock.connected)return Promise.resolve();
    return new Promise((resolve,reject)=>{ const w={resolve,reject}; waiters.push(w);
      setTimeout(()=>{ const i=waiters.indexOf(w); if(i>=0){ waiters.splice(i,1); reject(errOf(0,'Not connected. Try again in a moment.')); } },8000); }); }
  function request(event,payload){ return ready().then(()=>new Promise((resolve,reject)=>{
    sock.timeout(8000).emit(event,payload||{},(err,res)=>{
      if(err)return reject(errOf(0,'No answer from the server. Try again.'));
      if(!res||typeof res!=='object')return reject(errOf(0));
      if(res.ok===false)return reject(errOf(res.status,res.message));
      resolve(res.data===undefined?{}:res.data); }); })); }
  const goOffline=()=>{ if(!offline){ offline=true; h.online(false); } };
  sock.on('connect',()=>{ waiters.splice(0).forEach(w=>w.resolve()); if(offline){ offline=false; h.online(true); }
    /* The server pushes a state on connect; ask too, in case that push is lost or late. */
    sock.emit('squad:sync',{},()=>{}); });
  sock.on('disconnect',reason=>{ if(dead)return;
    if(reason==='io server disconnect'){ die('closed','The game server closed this connection. '+CLOSE_AND_REOPEN); return; }
    if(reason==='io client disconnect')return;
    goOffline(); });
  sock.on('connect_error',err=>{ if(dead)return; const code=String((err&&err.data&&(err.data.code||err.data.message))||(err&&err.message)||'');
    if(/ticket|token|auth|forbidden|unauthori[sz]ed|session|not_allowed|offboard|expired/i.test(code)){
      if(/not_allowed|offboard/i.test(code)){ die('not_allowed'); return; }
      if(auth.token){ dead=true; try{ sock.io.reconnection(false); sock.disconnect(); }catch(e){} h.authFailed('Your sign-in has expired. Sign in again to play.'); return; }
      die(/expired/i.test(code)?'ticket_expired':'ticket_invalid',(/expired/i.test(code)?'This Secret Squad session has expired. ':'Secret Squad could not sign you in. ')+CLOSE_AND_REOPEN); return; }
    goOffline(); });
  sock.on('squad:state',p=>{ if(!dead)h.state(p); });
  sock.on('squad:fatal',p=>die((p&&p.code)||'fatal',(p&&p.message)||''));
  return {
    request,
    sync(){ if(sock.connected&&!dead)sock.emit('squad:sync',{},()=>{}); },
    close(){ dead=true; try{ sock.io.reconnection(false); sock.disconnect(); }catch(e){} }
  };
}};
})();
