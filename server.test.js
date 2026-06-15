process.env.PORT = 8137;
const WebSocket = require('ws');
const srv = require('./server');           // starts listening on 8137
const PORT = 8137;
let pass=true; const chk=(c,m)=>{ console.log((c?'PASS':'FAIL')+' - '+m); if(!c) pass=false; };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function client(){
  const ws=new WebSocket('ws://127.0.0.1:'+PORT);
  const msgs=[]; const waiters=[];
  ws.on('message',d=>{ const m=JSON.parse(d.toString()); msgs.push(m); for(const w of waiters.slice()){ if(w.pred(m)){ waiters.splice(waiters.indexOf(w),1); clearTimeout(w.to); w.res(m); } } });
  const api={
    ws,
    send:o=>ws.send(JSON.stringify(o)),
    open:()=>new Promise((res,rej)=>{ ws.on('open',res); ws.on('error',rej); }),
    waitFor:(pred,timeout=4000,label='msg')=>new Promise((res,rej)=>{
      const hit=msgs.find(pred); if(hit) return res(hit);
      const to=setTimeout(()=>rej(new Error('timeout: '+label)),timeout);
      waiters.push({pred,res,to});
    }),
    last:type=>[...msgs].reverse().find(m=>m.t===type),
    close:()=>ws.close()
  };
  return api;
}

(async()=>{
  try{
    // ---- lobby create/join ----
    const A=client(); await A.open();
    const wA=await A.waitFor(m=>m.t==='welcome'); chk(!!wA.id,'A recibe welcome con id');
    A.send({t:'create', name:'Ana', mode:'coop'});
    let lA=await A.waitFor(m=>m.t==='lobby'); 
    chk(lA.players.length===1 && lA.host===wA.id && lA.mode==='coop','A crea sala coop y es anfitrión');
    const code=lA.code;

    const B=client(); await B.open();
    const wB=await B.waitFor(m=>m.t==='welcome');
    B.send({t:'join', code, name:'Beto'});
    let lB=await B.waitFor(m=>m.t==='lobby' && m.players.length===2);
    chk(lB.players.length===2 && lB.code===code,'B se une por código; lobby con 2 jugadores');
    await A.waitFor(m=>m.t==='lobby' && m.players.length===2); 
    chk(true,'A recibe el lobby actualizado con 2 jugadores');

    // ---- join bad code ----
    const X=client(); await X.open(); await X.waitFor(m=>m.t==='welcome');
    X.send({t:'join', code:'ZZZZ', name:'X'});
    const err=await X.waitFor(m=>m.t==='error'); chk(/No existe/.test(err.msg),'unirse a código inexistente da error');
    X.close();

    // ---- host sets versus + starts; state flows; reaches playing ----
    A.send({t:'setmode', mode:'versus'});
    await A.waitFor(m=>m.t==='lobby' && m.mode==='versus'); chk(true,'anfitrión cambia a modo versus');
    A.send({t:'start'});
    const st=await A.waitFor(m=>m.t==='state', 3000); 
    chk(st.snap && st.snap.players.length===2 && st.snap.mode==='versus','llegan snapshots con 2 jugadores en versus');
    const playing=await A.waitFor(m=>m.t==='state' && m.snap.status==='playing', 5000, 'playing');
    chk(playing.snap.status==='playing','tras la cuenta regresiva el estado es playing');
    // inputs/actions don't crash and state keeps flowing
    A.send({t:'input', keys:{right:true}, last:'right'});
    A.send({t:'action', a:'bomb'});
    B.send({t:'input', keys:{left:true}, last:'left'});
    const moved=await A.waitFor(m=>m.t==='state', 1500);
    chk(!!moved.snap,'el estado sigue fluyendo tras enviar input/acción');

    // ---- versus needs 2 players to start ----
    const C=client(); await C.open(); await C.waitFor(m=>m.t==='welcome');
    C.send({t:'create', name:'Solo', mode:'versus'});
    await C.waitFor(m=>m.t==='lobby');
    C.send({t:'start'});
    const cerr=await C.waitFor(m=>m.t==='error'); chk(/2 jugadores/.test(cerr.msg),'versus con 1 jugador rechaza el inicio');
    C.close();

    // ---- host migration in lobby ----
    const D=client(); await D.open(); const wD=await D.waitFor(m=>m.t==='welcome');
    D.send({t:'create', name:'Dani', mode:'coop'});
    const lD=await D.waitFor(m=>m.t==='lobby'); const code2=lD.code;
    const E=client(); await E.open(); const wE=await E.waitFor(m=>m.t==='welcome');
    E.send({t:'join', code:code2, name:'Eva'});
    await E.waitFor(m=>m.t==='lobby' && m.players.length===2);
    D.close();                                   // host leaves
    const mig=await E.waitFor(m=>m.t==='lobby' && m.host===wE.id, 3000, 'migration');
    chk(mig.host===wE.id && mig.players.length===1,'si el anfitrión sale, E pasa a ser anfitrión');
    E.close();

    A.close(); B.close();
    console.log(pass?'\nRESULT: SERVER OK':'\nRESULT: FAIL');
  }catch(e){ console.error('TEST ERROR:', e&&e.stack||e); pass=false; }
  finally{
    for(const r of srv.rooms.values()){ if(r.loop) clearInterval(r.loop); }
    srv.wss.close(); srv.server.close();
    setTimeout(()=>process.exit(pass?0:1), 150);
  }
})();
