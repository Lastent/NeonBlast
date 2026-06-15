const { Sim, TILE } = require('./sim');
let pass=true; const chk=(c,m)=>{ console.log((c?'PASS':'FAIL')+' - '+m); if(!c) pass=false; };
const adv=(s,sec,dt)=>{ dt=dt||1/30; for(let t=0;t<sec;t+=dt) s.tick(dt); };
const carve=(s,y)=>{ for(let x=1;x<14;x++) if(s.grid[y][x]!=='wall') s.grid[y][x]='floor'; };
const at=(p,cx,cy)=>{ p.px=(cx+0.5)*TILE; p.py=(cy+0.5)*TILE; };
const cellOf=p=>({x:Math.floor(p.px/TILE),y:Math.floor(p.py/TILE)});
const P=(s,i)=>s.players.get(s.order[i]);

// ============ VERSUS ============
{
  const s=new Sim(); s.setMode('versus');
  s.addPlayer('a','Ana'); s.addPlayer('b','Beto');
  s.startMatch();
  chk(s.status==='countdown','versus: arranca en cuenta regresiva');
  adv(s,2.2);
  chk(s.status==='playing','versus: pasa a jugando tras la cuenta');
  const a=P(s,0), b=P(s,1);
  chk(a.alive&&b.alive&&a.lives===1&&b.lives===1,'versus: ambos vivos con 1 vida');
  // set up a clean kill: A bombs, B caught in blast, A made invulnerable
  carve(s,5); at(a,5,5); at(b,7,5); a.range=3; a.invuln=999; b.invuln=0; a.bombType='normal';
  s.action('a','bomb'); adv(s,2.6);
  chk(!b.alive && b.out,'versus: B muere por la explosión de A');
  chk(a.wins===1,'versus: A gana la ronda (wins=1)');
  chk(s.status==='roundover','versus: estado ronda terminada');
  adv(s,2.7);
  chk(s.status==='countdown' && s.round===2,'versus: arranca ronda 2 tras la pausa');
}

// ============ VERSUS match end (first to 3) ============
{
  const s=new Sim(); s.setMode('versus'); s.addPlayer('a'); s.addPlayer('b');
  s.startMatch(); adv(s,2.2);
  const a=P(s,0), b=P(s,1);
  for(let r=0;r<3 && s.status!=='gameover';r++){
    let g=0; while(s.status!=='playing' && g++<400) s.tick(1/30);   // wait out the countdown
    if(s.status!=='playing') break;
    a.invuln=999; b.invuln=0; b.alive=true; b.out=false;
    carve(s,5); at(a,5,5); at(b,7,5); a.range=3; a.bombType='normal';
    s.action('a','bomb');
    let g2=0; while(s.status==='playing' && g2++<300) s.tick(1/30);  // let the round resolve
  }
  chk(a.wins>=3,'versus: A acumula 3 victorias');
  chk(s.status==='gameover' && s.winnerId==='a','versus: fin de partida, campeón A');
}

// ============ COOP movement + bomb + powerup ============
{
  const s=new Sim(); s.setMode('coop'); s.addPlayer('a','Ana');
  s.startMatch(); adv(s,2.2);
  const a=P(s,0); s.enemies.length=0;        // clear for a deterministic test
  carve(s,5); at(a,3,5); a.invuln=0;
  const x0=a.px;
  s.input('a',{right:true},'right'); adv(s,0.5);
  chk(a.px>x0,'coop: el jugador se mueve a la derecha con input');
  s.input('a',{},null);
  // bomb destroys a soft block and reveals a powerup we plant
  at(a,3,5); s.grid[5][6]='soft'; s.hidden['6,5']='fire'; a.range=4; a.invuln=999;
  s.action('a','bomb'); adv(s,2.6);
  chk(s.grid[5][6]==='floor','coop: la bomba destruye el bloque blando');
  chk(s.powerups.get('6,5')==='fire','coop: aparece el power-up oculto');
  // walk over it
  const r0=a.range; at(a,6,5); adv(s,1/30);
  chk(a.range===r0+1 && !s.powerups.has('6,5'),'coop: recoger fuego sube el alcance');
}

// ============ COOP respawn + level clear ============
{
  const s=new Sim(); s.setMode('coop'); s.addPlayer('a'); s.addPlayer('b');
  s.startMatch(); adv(s,2.2);
  const a=P(s,0); s.enemies.length=0; a.invuln=0; a.lives=3;
  s.killPlayer(a,null);
  chk(!a.alive && a.lives===2,'coop: morir cuesta una vida');
  adv(s,1.3);
  chk(a.alive,'coop: reaparece tras el temporizador');
  // level clear: clear enemies, reveal exit, stand a player on it
  s.enemies.length=0; s.exit={x:3,y:5,revealed:true}; s.grid[5][3]='floor';
  const b=P(s,1); at(b,3,5); b.invuln=999; adv(s,1/30);
  chk(s.status==='levelclear','coop: nivel superado al pisar la salida sin enemigos');
  const lv=s.level; adv(s,1.7+2.2);
  chk(s.level===lv+1 && s.status==='playing','coop: avanza al siguiente nivel');
}

// ============ MECHANICS: remote, pierce, kick (versus map, no enemies) ============
{
  const s=new Sim(); s.setMode('coop'); s.addPlayer('a');
  s.startMatch(); adv(s,2.2);
  const a=P(s,0); s.enemies.length=0; s.exit.revealed=false; a.invuln=999;
  // remote: no auto-explode, detonate on action
  carve(s,5); at(a,4,5); a.bombType='remote'; a.maxBombs=5; a.range=2;
  s.action('a','bomb'); adv(s,3.0);
  chk(s.bombs.length===1,'remoto: no estalla solo tras 3s');
  s.action('a','detonate'); adv(s,1/30);
  chk(s.bombs.length===0,'remoto: detona con la acción');
  adv(s,0.6);
  // pierce: through soft, stop at wall
  carve(s,7); s.grid[7][7]='soft'; s.grid[7][8]='soft'; s.grid[7][10]='wall';
  at(a,5,7); a.bombType='pierce'; a.range=8;
  s.action('a','bomb'); adv(s,2.6);
  chk(s.grid[7][7]==='floor'&&s.grid[7][8]==='floor','perforante: rompe dos bloques en línea');
  chk(s.grid[7][10]==='wall' && !s.flameAt(10,7) && !s.flameAt(11,7),'perforante: se detiene en la pared sólida');
  adv(s,0.6);
  // kick
  carve(s,9); a.bombType='normal'; a.canKick=true; a.maxBombs=5;
  at(a,6,9); s.action('a','bomb'); adv(s,1/30);
  at(a,6,9); s.input('a',{left:true},'left'); adv(s,0.4); s.input('a',{},null); // step off left
  at(a,5,9); s.input('a',{right:true},'right'); adv(s,0.4); s.input('a',{},null);
  const kicked=s.bombs[0];
  chk(kicked && kicked.cx>6,'patada: la bomba se desliza al lado opuesto del jugador');
}

console.log(pass?'\nRESULT: SIM OK':'\nRESULT: FAIL'); process.exit(pass?0:1);
