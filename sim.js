'use strict';
// ============================================================================
// NEÓN BLAST — authoritative multiplayer simulation (headless, no rendering).
// Runs on the Node server. Clients only send input and render snapshots.
// ============================================================================

const COLS = 15, ROWS = 13, TILE = 44, HALF = TILE / 2;
const BOMB_TIME = 2.4, FLAME_TIME = 0.5;
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
const SPAWNS = [[1,1],[COLS-2,1],[1,ROWS-2],[COLS-2,ROWS-2]];
const COLORS = ['#38f0ff','#ff3d8b','#b6ff3d','#ffb23d'];
const WINS_TO_MATCH = 3;          // versus: first to 3 round wins takes the match

const clamp = (v,a,b)=> v<a?a:(v>b?b:v);
const key = (x,y)=> x+','+y;

class Sim {
  constructor(){
    this.mode = 'coop';
    this.status = 'lobby';        // lobby | countdown | playing | roundover | levelclear | gameover
    this.players = new Map();     // id -> player
    this.order = [];              // join order (for spawn assignment)
    this.bombs = []; this.bombGrid = null; this.flames = []; this.enemies = [];
    this.powerups = new Map(); this.hidden = {};
    this.grid = null; this.exit = {x:1,y:1,revealed:false};
    this.level = 1; this.round = 1;
    this.timeLeft = 0; this.punisher = false;
    this.timer = 0;               // generic countdown for countdown/roundover/levelclear
    this.bombSeq = 1;
    this.message = '';            // short banner for clients
    this.winnerId = null;
  }

  // ---- players ----
  addPlayer(id, name){
    if(this.players.has(id)) return this.players.get(id);
    if(this.players.size >= 4) return null;
    const idx = this.players.size;
    const p = {
      id, name: String(name||('P'+(idx+1))).slice(0,12), color: COLORS[idx], slot: idx,
      px:0, py:0, h:TILE*0.36, dir:'down', alive:false, out:false,
      lives:3, speed:3.0*TILE, maxBombs:1, range:1, bombType:'normal', canKick:false,
      invuln:0, walkT:0, score:0, wins:0,
      keys:{up:false,down:false,left:false,right:false}, last:null,
      queued:[]                   // pending 'bomb' / 'detonate' actions
    };
    this.players.set(id, p); this.order.push(id);
    return p;
  }
  removePlayer(id){
    this.players.delete(id);
    this.order = this.order.filter(x=>x!==id);
    // free that player's bombs' grid refs
    this.bombs = this.bombs.filter(b=> b.owner!==id || b.exploded);
    this.rebuildBombGrid();
  }
  input(id, keys, last){
    const p = this.players.get(id); if(!p) return;
    if(keys) p.keys = { up:!!keys.up, down:!!keys.down, left:!!keys.left, right:!!keys.right };
    if(last!==undefined) p.last = last;
  }
  action(id, type){
    const p = this.players.get(id); if(!p) return;
    if(type==='bomb' || type==='detonate') p.queued.push(type);
  }

  // ---- match flow ----
  setMode(m){ if(m==='coop'||m==='versus') this.mode = m; }
  startMatch(){
    this.level = 1; this.round = 1; this.winnerId = null;
    for(const p of this.players.values()){ p.score=0; p.wins=0; p.bombType='normal'; p.canKick=false; p.maxBombs=1; p.range=1; p.speed=3.0*TILE; }
    this.buildLevel();
    this.beginCountdown(this.mode==='coop' ? ('NIVEL '+this.level) : ('RONDA '+this.round));
  }
  beginCountdown(msg){ this.status='countdown'; this.timer=2.0; this.message=msg||''; }

  inBounds(cx,cy){ return cx>=0&&cy>=0&&cx<COLS&&cy<ROWS; }
  isPillar(x,y){ return x%2===0 && y%2===0; }

  buildLevel(){
    // grid
    this.grid = [];
    for(let y=0;y<ROWS;y++){ this.grid[y]=[];
      for(let x=0;x<COLS;x++){
        this.grid[y][x] = (x===0||y===0||x===COLS-1||y===ROWS-1||this.isPillar(x,y)) ? 'wall' : 'floor';
      }
    }
    // keep every spawn corner + its two neighbours clear (for up to 4 players)
    const safe = new Set();
    SPAWNS.forEach(([sx,sy])=>{
      [[0,0],[1,0],[0,1],[-1,0],[0,-1]].forEach(([dx,dy])=>{
        const x=sx+dx, y=sy+dy; if(this.inBounds(x,y)) safe.add(key(x,y));
      });
    });
    const soft=[];
    for(let y=1;y<ROWS-1;y++) for(let x=1;x<COLS-1;x++){
      if(this.grid[y][x]!=='floor') continue;
      if(safe.has(key(x,y))) continue;
      if(Math.random() < 0.72){ this.grid[y][x]='soft'; soft.push([x,y]); }
    }
    // hidden powerups (+ exit in coop)
    this.hidden={}; this.powerups=new Map(); this.exit={x:1,y:1,revealed:false};
    const used=new Set();
    if(this.mode==='coop' && soft.length){
      const ec = soft[(Math.random()*soft.length)|0];
      this.exit={x:ec[0],y:ec[1],revealed:false}; used.add(key(ec[0],ec[1]));
    }
    const pool=['bomb','bomb','fire','fire','speed','life','remote','pierce','kick'];
    const nPow = 5 + Math.min(6, (this.mode==='coop'?this.level:this.round));
    for(let i=0;i<nPow && soft.length;i++){
      const c=soft[(Math.random()*soft.length)|0]; if(used.has(key(c[0],c[1]))) continue; used.add(key(c[0],c[1]));
      this.hidden[key(c[0],c[1])] = pool[(Math.random()*pool.length)|0];
    }
    // entities
    this.bombs=[]; this.flames=[]; this.enemies=[]; this.punisher=false;
    this.rebuildBombGrid();
    // enemies only in coop
    if(this.mode==='coop'){
      const floor=[];
      for(let y=1;y<ROWS-1;y++) for(let x=1;x<COLS-1;x++) if(this.grid[y][x]==='floor') floor.push([x,y]);
      const farFromSpawns = c => SPAWNS.every(([sx,sy])=> (Math.abs(c[0]-sx)+Math.abs(c[1]-sy))>4);
      const spawnable = floor.filter(farFromSpawns);
      const n = Math.min(spawnable.length, 3 + this.level);
      for(let i=0;i<n;i++){
        if(!spawnable.length) break;
        const c=spawnable.splice((Math.random()*spawnable.length)|0,1)[0];
        const fast = this.level>=3 && Math.random()<0.3;
        const d=DIRS[(Math.random()*4)|0];
        this.enemies.push({ px:c[0]*TILE+HALF, py:c[1]*TILE+HALF, dx:d[0],dy:d[1],
          speed:(fast?2.4:1.7)*TILE, h:TILE*0.34, alive:true, bob:Math.random()*6,
          color: fast?'#ff3d8b':'#b6ff3d', chaser:fast });
      }
    }
    this.timeLeft = this.mode==='coop' ? Math.max(90, 230 - this.level*6) : 0;
    this.placePlayers(true);
  }

  placePlayers(fullReset){
    // assign spawn corner by slot; reset per-mode life/stat rules
    const ids = this.order.slice();
    ids.forEach((id,i)=>{
      const p=this.players.get(id); if(!p) return;
      const sp = SPAWNS[p.slot % SPAWNS.length];
      p.px=(sp[0]+0.5)*TILE; p.py=(sp[1]+0.5)*TILE; p.dir='down'; p.invuln=1.5; p.walkT=0;
      p.queued.length=0;
      if(this.mode==='versus'){
        p.alive=true; p.out=false; p.lives=1;
        p.bombType='normal'; p.canKick=false; p.maxBombs=1; p.range=2; p.speed=3.2*TILE; // versus: a livelier baseline
      } else {
        // coop: revive everyone for a fresh level; keep upgrades unless full match reset
        if(fullReset && this.status==='lobby'){ /* handled in startMatch */ }
        p.alive=true; p.out=false;
        if(p.lives<=0) p.lives=1;  // revive out players on new level with 1 life
        p.bombType='normal';       // bomb type resets each level start (matches single-player death rule)
      }
    });
  }

  rebuildBombGrid(){
    this.bombGrid=[]; for(let y=0;y<ROWS;y++){ this.bombGrid[y]=[]; for(let x=0;x<COLS;x++) this.bombGrid[y][x]=null; }
    for(const b of this.bombs){ if(!b.exploded) this.bombGrid[b.cy][b.cx]=b; }
  }

  // ---- collision ----
  solidForPlayer(cx,cy,pid){
    if(!this.inBounds(cx,cy)) return true;
    const c=this.grid[cy][cx];
    if(c==='wall'||c==='soft') return true;
    const b=this.bombGrid[cy][cx];
    if(b){ if(!b.passFor || !b.passFor.has(pid)) return true; }
    return false;
  }
  solidForEnemy(cx,cy){
    if(!this.inBounds(cx,cy)) return true;
    const c=this.grid[cy][cx];
    if(c==='wall'||c==='soft') return true;
    if(this.bombGrid[cy][cx]) return true;
    return false;
  }
  boxHitsSolid(px,py,h,pid,enemy){
    const x0=Math.floor((px-h)/TILE), x1=Math.floor((px+h-0.001)/TILE);
    const y0=Math.floor((py-h)/TILE), y1=Math.floor((py+h-0.001)/TILE);
    for(let cy=y0;cy<=y1;cy++) for(let cx=x0;cx<=x1;cx++){
      if(enemy ? this.solidForEnemy(cx,cy) : this.solidForPlayer(cx,cy,pid)) return true;
    }
    return false;
  }
  moveEntity(e,dx,dy,dt,pid,enemy){
    const step=e.speed*dt; let moved=false;
    if(dx!==0){
      const nx=e.px+dx*step;
      if(!this.boxHitsSolid(nx,e.py,e.h,pid,enemy)){ e.px=nx; moved=true; }
      const cyc=Math.round((e.py-HALF)/TILE)*TILE+HALF; e.py += clamp(cyc-e.py,-step,step);
    } else if(dy!==0){
      const ny=e.py+dy*step;
      if(!this.boxHitsSolid(e.px,ny,e.h,pid,enemy)){ e.py=ny; moved=true; }
      const cxc=Math.round((e.px-HALF)/TILE)*TILE+HALF; e.px += clamp(cxc-e.px,-step,step);
    }
    return moved;
  }
  boxOverlapsCell(e,cx,cy){
    return (e.px+e.h > cx*TILE) && (e.px-e.h < (cx+1)*TILE) &&
           (e.py+e.h > cy*TILE) && (e.py-e.h < (cy+1)*TILE);
  }

  // ---- bombs ----
  placeBomb(p){
    if(!p.alive) return;
    const cx=Math.floor(p.px/TILE), cy=Math.floor(p.py/TILE);
    if(this.bombGrid[cy][cx]) return;
    const mine = this.bombs.filter(b=>b.owner===p.id && !b.exploded).length;
    if(mine >= p.maxBombs) return;
    const passFor=new Set();
    for(const q of this.players.values()){ if(this.boxOverlapsCell(q,cx,cy)) passFor.add(q.id); }
    passFor.add(p.id);
    const b={ id:this.bombSeq++, owner:p.id, cx,cy, px:cx*TILE+HALF, py:cy*TILE+HALF, vx:0,vy:0, sliding:false,
      timer:BOMB_TIME, range:p.range, remote:(p.bombType==='remote'), pierce:(p.bombType==='pierce'),
      exploded:false, passFor };
    this.bombs.push(b); this.bombGrid[cy][cx]=b;
  }
  detonateNext(p){
    const b=this.bombs.find(x=>x.owner===p.id && x.remote && !x.exploded);
    if(b) this.explode(b);
  }
  flameCell(cx,cy,owner){ this.flames.push({ cx,cy, life:FLAME_TIME, max:FLAME_TIME, owner }); }
  explode(start){
    const queue=[start];
    while(queue.length){
      const b=queue.shift(); if(b.exploded) continue;
      b.exploded=true; this.bombGrid[b.cy][b.cx]=null;
      this.flameCell(b.cx,b.cy,b.owner);
      for(const [dx,dy] of DIRS){
        for(let r=1;r<=b.range;r++){
          const cx=b.cx+dx*r, cy=b.cy+dy*r;
          if(!this.inBounds(cx,cy)) break;
          const cell=this.grid[cy][cx];
          const ob=this.bombGrid[cy][cx]; if(ob && !ob.exploded) queue.push(ob);
          if(cell==='wall'){ break; }                 // solid walls always stop the blast
          if(cell==='soft'){ this.destroyBlock(cx,cy); this.flameCell(cx,cy,b.owner); if(b.pierce) continue; else break; }
          this.flameCell(cx,cy,b.owner);
        }
      }
    }
    this.bombs = this.bombs.filter(x=>!x.exploded);
  }
  destroyBlock(cx,cy){
    this.grid[cy][cx]='floor';
    const k=key(cx,cy);
    if(this.mode==='coop' && cx===this.exit.x && cy===this.exit.y) this.exit.revealed=true;
    else if(this.hidden[k]){ this.powerups.set(k, this.hidden[k]); delete this.hidden[k]; }
  }
  updateSlidingBombs(dt){
    const speed=6*TILE;
    for(const b of this.bombs){
      if(!b.sliding||b.exploded) continue;
      const tx=(b.cx+b.vx)*TILE+HALF, ty=(b.cy+b.vy)*TILE+HALF;
      const dxp=tx-b.px, dyp=ty-b.py, dist=Math.hypot(dxp,dyp), st=speed*dt;
      if(dist===0||st>=dist){
        b.px=tx; b.py=ty; this.bombGrid[b.cy][b.cx]=null; b.cx+=b.vx; b.cy+=b.vy; this.bombGrid[b.cy][b.cx]=b;
        const ncx=b.cx+b.vx, ncy=b.cy+b.vy;
        const blocked = !this.inBounds(ncx,ncy) || this.grid[ncy][ncx]!=='floor' || (this.bombGrid[ncy][ncx]&&this.bombGrid[ncy][ncx]!==b);
        if(blocked){ b.sliding=false; b.vx=0; b.vy=0; }
      } else { b.px+=(dxp/dist)*st; b.py+=(dyp/dist)*st; }
    }
  }
  flameAt(cx,cy){ for(const f of this.flames) if(f.cx===cx&&f.cy===cy&&f.life>0) return f; return null; }

  // ---- powerups ----
  applyPower(p,type){
    if(type==='bomb') p.maxBombs=Math.min(16,p.maxBombs+1);
    else if(type==='fire') p.range=Math.min(16,p.range+1);
    else if(type==='speed') p.speed=Math.min(10.0*TILE,p.speed+0.4*TILE);
    else if(type==='life') p.lives++;
    else if(type==='kick') p.canKick=true;
    else if(type==='remote') p.bombType='remote';
    else if(type==='pierce') p.bombType='pierce';
    p.score+=50;
  }

  // ---- per-player update ----
  updatePlayer(p,dt){
    if(!p.alive) return;
    if(p.invuln>0) p.invuln-=dt;
    let dx=0,dy=0,axis=null;
    const k=p.keys;
    if(p.last && k[p.last]) axis=(p.last==='left'||p.last==='right')?'x':'y';
    else if(k.left||k.right) axis='x'; else if(k.up||k.down) axis='y';
    if(axis==='x') dx = k.right?1:(k.left?-1:0);
    else if(axis==='y') dy = k.down?1:(k.up?-1:0);
    const moved=(dx||dy)?this.moveEntity(p,dx,dy,dt,p.id,false):false;
    if(dx<0)p.dir='left'; else if(dx>0)p.dir='right'; else if(dy<0)p.dir='up'; else if(dy>0)p.dir='down';
    p.walkT = moved ? p.walkT+dt*10 : 0;
    // release bomb pass-through once stepped off
    for(const b of this.bombs){ if(b.passFor && b.passFor.has(p.id) && !this.boxOverlapsCell(p,b.cx,b.cy)) b.passFor.delete(p.id); }
    // kick
    if(p.canKick && (dx||dy)){
      const pcx=Math.floor(p.px/TILE), pcy=Math.floor(p.py/TILE);
      const tcx=pcx+dx, tcy=pcy+dy; const b=this.inBounds(tcx,tcy)?this.bombGrid[tcy][tcx]:null;
      if(b && !b.exploded && !b.sliding && (!b.passFor || !b.passFor.has(p.id))){
        const ncx=tcx+dx, ncy=tcy+dy;
        if(this.inBounds(ncx,ncy) && this.grid[ncy][ncx]==='floor' && !this.bombGrid[ncy][ncx]){ b.vx=dx; b.vy=dy; b.sliding=true; }
      }
    }
    // powerup pickup
    const cx=Math.floor(p.px/TILE), cy=Math.floor(p.py/TILE), kk=key(cx,cy);
    if(this.powerups.has(kk)){ this.applyPower(p, this.powerups.get(kk)); this.powerups.delete(kk); }
  }

  updateEnemy(e,dt){
    if(!e.alive) return;
    const atCenter = Math.abs((e.px-HALF)%TILE)<2 && Math.abs((e.py-HALF)%TILE)<2;
    const moved=this.moveEntity(e,e.dx,e.dy,dt,null,true);
    const dirOpen=(dx,dy)=>{ const cx=Math.floor(e.px/TILE)+dx, cy=Math.floor(e.py/TILE)+dy; return !this.solidForEnemy(cx,cy); };
    const chooseDir=(avoidRev)=>{ const opts=DIRS.filter(d=>dirOpen(d[0],d[1])&&!(avoidRev&&d[0]===-e.dx&&d[1]===-e.dy)); const pool=opts.length?opts:DIRS.filter(d=>dirOpen(d[0],d[1])); if(pool.length){ const d=pool[(Math.random()*pool.length)|0]; e.dx=d[0]; e.dy=d[1]; } };
    if(!moved) chooseDir(true);
    else if(atCenter){
      if(e.chaser && Math.random()<0.5){
        // steer toward the nearest alive player
        let best=null,bd=1e9; for(const p of this.players.values()){ if(!p.alive)continue; const d=Math.abs(p.px-e.px)+Math.abs(p.py-e.py); if(d<bd){bd=d;best=p;} }
        if(best){ const ddx=best.px-e.px, ddy=best.py-e.py;
          if(Math.abs(ddx)>Math.abs(ddy)){ const d=ddx<0?-1:1; if(dirOpen(d,0)){e.dx=d;e.dy=0;} }
          else { const d=ddy<0?-1:1; if(dirOpen(0,d)){e.dx=0;e.dy=d;} } }
      } else if(Math.random()<0.18) chooseDir(true);
    }
    e.bob += dt*6;
    const c={x:Math.floor(e.px/TILE),y:Math.floor(e.py/TILE)};
    const f=this.flameAt(c.x,c.y);
    if(f){ e.alive=false; const ow=this.players.get(f.owner); if(ow) ow.score+=100; }
  }

  killPlayer(p, byId){
    if(!p.alive || p.invuln>0) return;
    p.alive=false; p.lives--;
    if(byId && byId!==p.id){ const k=this.players.get(byId); if(k) k.score+=200; }
    if(this.mode==='versus'){ p.out=true; }      // one life per round
    else {
      if(p.lives<=0){ p.out=true; }
      p.respawnAt = 1.1;                          // coop: respawn timer
    }
  }

  // ---- main tick ----
  tick(dt){
    // decay flames + particles-free; advance timers regardless of status
    for(let i=this.flames.length-1;i>=0;i--){ this.flames[i].life-=dt; if(this.flames[i].life<=0) this.flames.splice(i,1); }

    if(this.status==='countdown'){ this.timer-=dt; if(this.timer<=0){ this.status='playing'; this.message=''; } return this; }
    if(this.status==='roundover'){ this.timer-=dt; if(this.timer<=0){ this.nextRound(); } return this; }
    if(this.status==='levelclear'){ this.timer-=dt; if(this.timer<=0){ this.level++; this.buildLevel(); this.beginCountdown('NIVEL '+this.level); } return this; }
    if(this.status!=='playing') return this;

    // apply queued actions
    for(const p of this.players.values()){
      while(p.queued.length){ const a=p.queued.shift();
        if(a==='bomb') this.placeBomb(p);
        else if(a==='detonate') this.detonateNext(p);
      }
    }

    // coop level timer
    if(this.mode==='coop'){
      this.timeLeft-=dt;
      if(this.timeLeft<=0 && !this.punisher){ this.punisher=true; this.spawnPunisher(3); this.message='¡SE ACABA EL TIEMPO!'; }
    }

    // players
    for(const p of this.players.values()){
      if(!p.alive){
        if(this.mode==='coop' && !p.out && p.respawnAt!==undefined){
          p.respawnAt-=dt;
          if(p.respawnAt<=0){ p.respawnAt=undefined; const sp=SPAWNS[p.slot%SPAWNS.length]; p.px=(sp[0]+0.5)*TILE; p.py=(sp[1]+0.5)*TILE; p.alive=true; p.invuln=2.0; p.bombType='normal'; }
        }
        continue;
      }
      this.updatePlayer(p,dt);
    }

    this.updateSlidingBombs(dt);

    // bomb timers
    for(const b of this.bombs){ if(!b.remote) b.timer-=dt; }
    this.bombs.filter(b=>!b.remote && b.timer<=0 && !b.exploded).forEach(b=>this.explode(b));

    // enemies (coop)
    if(this.mode==='coop'){ for(const e of this.enemies) this.updateEnemy(e,dt); this.enemies=this.enemies.filter(e=>e.alive); }

    // player deaths (flames + enemy contact)
    for(const p of this.players.values()){
      if(!p.alive || p.invuln>0) continue;
      const c={x:Math.floor(p.px/TILE),y:Math.floor(p.py/TILE)};
      const f=this.flameAt(c.x,c.y);
      if(f){ this.killPlayer(p, f.owner); continue; }
      if(this.mode==='coop'){
        for(const e of this.enemies){ if(e.alive && Math.abs(e.px-p.px)<TILE*0.5 && Math.abs(e.py-p.py)<TILE*0.5){ this.killPlayer(p, null); break; } }
      }
    }

    this.checkEnd();
    return this;
  }

  spawnPunisher(n){
    const corners=[[COLS-2,ROWS-2],[COLS-2,1],[1,ROWS-2]];
    for(let i=0;i<n;i++){ const c=corners[(Math.random()*corners.length)|0]; if(this.grid[c[1]][c[0]]!=='floor') this.grid[c[1]][c[0]]='floor';
      this.enemies.push({ px:c[0]*TILE+HALF, py:c[1]*TILE+HALF, dx:-1,dy:0, speed:2.8*TILE, h:TILE*0.34, alive:true, bob:Math.random()*6, color:'#ff3d8b', chaser:true }); }
  }

  alivePlayers(){ return [...this.players.values()].filter(p=>p.alive); }
  activePlayers(){ return [...this.players.values()].filter(p=>!p.out); }

  checkEnd(){
    if(this.mode==='versus'){
      const alive=this.alivePlayers();
      if(alive.length<=1 && this.players.size>=1){
        // round over
        if(alive.length===1){ alive[0].wins++; this.winnerId=alive[0].id; this.message=alive[0].name+' GANA LA RONDA'; }
        else { this.winnerId=null; this.message='EMPATE'; }
        // match end?
        const champ=[...this.players.values()].find(p=>p.wins>=WINS_TO_MATCH);
        if(champ){ this.status='gameover'; this.winnerId=champ.id; this.message='🏆 '+champ.name+' GANA LA PARTIDA'; }
        else { this.status='roundover'; this.timer=2.5; }
      }
    } else {
      // coop
      const active=this.activePlayers();
      if(active.length===0){ this.status='gameover'; this.message='GAME OVER'; this.winnerId=null; return; }
      // level clear: enemies cleared and an alive player on the exit
      if(this.exit.revealed && this.enemies.length===0){
        for(const p of this.alivePlayers()){
          if(Math.floor(p.px/TILE)===this.exit.x && Math.floor(p.py/TILE)===this.exit.y){
            for(const q of this.players.values()) q.score+=200;
            this.status='levelclear'; this.timer=1.6; this.message='¡NIVEL '+this.level+' SUPERADO!'; break;
          }
        }
      }
    }
  }
  nextRound(){
    this.round++; this.winnerId=null;
    this.buildLevel();
    this.beginCountdown('RONDA '+this.round);
  }

  // ---- snapshot for clients ----
  gridString(){
    let s=''; for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){ const c=this.grid[y][x]; s += c==='wall'?'#':(c==='soft'?'x':'.'); } return s;
  }
  snapshot(){
    return {
      mode:this.mode, status:this.status, level:this.level, round:this.round,
      message:this.message, winnerId:this.winnerId, timeLeft:Math.max(0,this.timeLeft),
      cols:COLS, rows:ROWS, tile:TILE,
      grid:this.gridString(),
      exit:this.mode==='coop'?{x:this.exit.x,y:this.exit.y,revealed:this.exit.revealed}:null,
      players:[...this.players.values()].map(p=>({ id:p.id, name:p.name, color:p.color, slot:p.slot,
        x:Math.round(p.px), y:Math.round(p.py), dir:p.dir, alive:p.alive, out:p.out, lives:p.lives,
        score:p.score, wins:p.wins, bombType:p.bombType, canKick:p.canKick, range:p.range, maxBombs:p.maxBombs,
        invuln:p.invuln>0 })),
      bombs:this.bombs.filter(b=>!b.exploded).map(b=>({ id:b.id, x:Math.round(b.px), y:Math.round(b.py), owner:b.owner,
        remote:b.remote, pierce:b.pierce, fuse: b.remote?0:clamp(1-b.timer/BOMB_TIME,0,1) })),
      flames:this.flames.map(f=>({ cx:f.cx, cy:f.cy, a:clamp(f.life/f.max,0,1) })),
      powerups:[...this.powerups.entries()].map(([k,t])=>{ const [x,y]=k.split(',').map(Number); return {cx:x,cy:y,type:t}; }),
      enemies:this.enemies.map(e=>({ x:Math.round(e.px), y:Math.round(e.py), color:e.color }))
    };
  }
}

module.exports = { Sim, COLS, ROWS, TILE, COLORS, SPAWNS, WINS_TO_MATCH };
