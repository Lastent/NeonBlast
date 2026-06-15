const fs = require('fs');
const { JSDOM } = require('jsdom');
const { Sim } = require('./sim');
let pass=true; const chk=(c,m)=>{ console.log((c?'PASS':'FAIL')+' - '+m); if(!c) pass=false; };

// stub script injected BEFORE the page script: mock WebSocket, canvas ctx, rAF
const STUB = `<script>
  window.__sent=[]; window.__wsInstances=[]; window.__raf=null;
  function MockWS(url){ this.url=url; this.readyState=0; window.__wsInstances.push(this); }
  MockWS.prototype.send=function(d){ try{window.__sent.push(JSON.parse(d));}catch(e){window.__sent.push(d);} };
  MockWS.prototype.close=function(){ this.readyState=3; if(this.onclose) this.onclose({}); };
  MockWS.prototype._recv=function(o){ if(this.onmessage) this.onmessage({data:JSON.stringify(o)}); };
  window.WebSocket=MockWS;
  var gctx={ createLinearGradient:function(){return {addColorStop:function(){}};},
             createRadialGradient:function(){return {addColorStop:function(){}};},
             measureText:function(){return {width:10};} };
  var ctxProxy=new Proxy(gctx,{ get:function(t,p){ if(p in t) return t[p]; return function(){}; }, set:function(){return true;} });
  window.HTMLCanvasElement.prototype.getContext=function(){ return ctxProxy; };
  window.requestAnimationFrame=function(cb){ window.__raf=cb; return 1; };
  window.cancelAnimationFrame=function(){};
  if(!window.performance) window.performance={now:function(){return Date.now();}};
<\/script>`;

let html = fs.readFileSync('./public/index.html','utf8').replace('<head>', '<head>'+STUB);

const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true });
const win = dom.window, doc = win.document;

function build(mode){
  const s=new Sim(); s.setMode(mode); s.addPlayer('me','Yo'); s.addPlayer('p2','Dos');
  s.startMatch(); for(let t=0;t<2.3;t+=1/30) s.tick(1/30);   // reach 'playing'
  return s.snapshot();
}

setTimeout(()=>{
  try{
    const inst = win.__wsInstances[0];
    chk(!!inst, 'el cliente abre una conexión WebSocket al cargar');
    inst.readyState=1; if(inst.onopen) inst.onopen({});
    inst._recv({ t:'welcome', id:'me' });

    // create room
    doc.getElementById('nameInput').value='Yo';
    doc.getElementById('createBtn').click();
    const created = win.__sent.find(m=>m.t==='create');
    chk(created && created.name==='Yo', 'pulsar "Crear sala" envía create con el nombre');

    // server confirms lobby
    inst._recv({ t:'lobby', code:'WXYZ', mode:'coop', host:'me', started:false,
      players:[{id:'me',name:'Yo',slot:0,color:'#38f0ff'},{id:'p2',name:'Dos',slot:1,color:'#ff3d8b'}] });
    chk(!doc.getElementById('roomPanel').classList.contains('hidden'), 'tras lobby se muestra la sala de espera');
    chk(doc.getElementById('roomCode').textContent==='WXYZ', 'la sala muestra el código recibido');
    chk(doc.getElementById('playerList').children.length===2, 'la sala lista a los 2 jugadores');

    // game state arrives (coop)
    const snap = build('coop');
    inst._recv({ t:'state', snap, host:'me' });
    chk(!doc.getElementById('gameWrap').classList.contains('hidden'), 'al llegar el estado se entra a la vista de juego');

    // render a couple of frames without throwing
    let threw=null;
    try{ win.__raf && win.__raf(16); inst._recv({t:'state',snap:build('coop'),host:'me'}); win.__raf && win.__raf(33); }catch(e){ threw=e; }
    chk(!threw, 'renderiza el juego sin lanzar errores'+(threw?(': '+threw.message):''));
    chk(/Nivel/.test(doc.getElementById('topinfo').textContent), 'el HUD coop muestra el nivel y el tiempo');

    // input: movement + bomb
    win.__sent.length=0;
    win.dispatchEvent(new win.KeyboardEvent('keydown',{code:'ArrowRight'}));
    const inp = win.__sent.find(m=>m.t==='input');
    chk(inp && inp.keys.right===true && inp.last==='right', 'una tecla de dirección envía input con la dirección');
    win.dispatchEvent(new win.KeyboardEvent('keydown',{code:'Space'}));
    chk(win.__sent.some(m=>m.t==='action' && m.a==='bomb'), 'la barra espaciadora envía la acción de bomba');
    win.dispatchEvent(new win.KeyboardEvent('keydown',{code:'ShiftLeft'}));
    chk(win.__sent.some(m=>m.t==='action' && m.a==='detonate'), 'Shift envía la acción de detonar');

    // versus snapshot also renders + gameover overlay
    const vs = (()=>{ const s=new Sim(); s.setMode('versus'); s.addPlayer('me','Yo'); s.addPlayer('p2','Dos'); s.startMatch(); for(let t=0;t<2.3;t+=1/30)s.tick(1/30); const sn=s.snapshot(); sn.status='gameover'; sn.message='🏆 Yo GANA LA PARTIDA'; return sn; })();
    let threw2=null; try{ inst._recv({t:'state',snap:vs,host:'me'}); win.__raf && win.__raf(50); }catch(e){ threw2=e; }
    chk(!threw2, 'renderiza versus + fin de partida sin errores'+(threw2?(': '+threw2.message):''));
    chk(doc.getElementById('endov').classList.contains('show'), 'el overlay de fin de partida aparece en gameover');

    console.log(pass?'\nRESULT: CLIENT OK':'\nRESULT: FAIL');
  }catch(e){ console.error('TEST ERROR:', e&&e.stack||e); pass=false; }
  finally{ setTimeout(()=>process.exit(pass?0:1), 50); }
}, 60);
