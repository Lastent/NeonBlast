'use strict';
// ============================================================================
// NEÓN BLAST — multiplayer server.
// Serves the client (public/) and runs the authoritative simulation per room.
// ============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Sim } = require('./sim');

const PORT = process.env.PORT || 8080;
const TICK_MS = 33;                 // ~30 Hz authoritative tick + broadcast
const PUBLIC = path.join(__dirname, 'public');

// ---------- tiny static file server ----------
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.ico':'image/x-icon' };
const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/' || url === '') url = '/index.html';
  const file = path.join(PUBLIC, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- rooms ----------
const rooms = new Map();            // code -> room
function makeCode(){
  const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c; do { c=''; for(let i=0;i<4;i++) c+=A[(Math.random()*A.length)|0]; } while(rooms.has(c));
  return c;
}
function newId(){ return Math.random().toString(36).slice(2,10); }

function makeRoom(mode){
  const sim = new Sim(); sim.setMode(mode==='versus'?'versus':'coop');
  return { code:makeCode(), sim, hostId:null, clients:new Map(), loop:null, started:false };
}
function roomOf(ws){ return ws._room ? rooms.get(ws._room) : null; }

function lobbyMsg(room){
  return JSON.stringify({ t:'lobby', code:room.code, mode:room.sim.mode, host:room.hostId, started:room.started,
    players:[...room.sim.players.values()].map(p=>({ id:p.id, name:p.name, slot:p.slot, color:p.color })) });
}
function broadcast(room, str){ for(const ws of room.clients.keys()){ if(ws.readyState===1) ws.send(str); } }
function sendLobby(room){ broadcast(room, lobbyMsg(room)); }

function startLoop(room){
  if(room.loop) return;
  room.started = true;
  room.loop = setInterval(()=>{
    room.sim.tick(TICK_MS/1000);
    const snap = room.sim.snapshot();
    broadcast(room, JSON.stringify({ t:'state', snap, host:room.hostId }));
  }, TICK_MS);
}
function stopLoop(room){ if(room.loop){ clearInterval(room.loop); room.loop=null; } room.started=false; }

function closeRoom(room){ stopLoop(room); rooms.delete(room.code); }

function leaveRoom(ws){
  const room = roomOf(ws); if(!room) return;
  const info = room.clients.get(ws);
  room.clients.delete(ws);
  if(info) room.sim.removePlayer(info.id);
  ws._room = null;
  if(room.clients.size === 0){ closeRoom(room); return; }
  // host migration
  if(room.hostId === (info && info.id)){
    const next = room.clients.values().next().value;
    room.hostId = next ? next.id : null;
  }
  // versus self-resolves when a player leaves (alive count drops); just refresh lobby/roster
  sendLobby(room);
}

// ---------- websockets ----------
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws._id = newId();
  ws.send(JSON.stringify({ t:'welcome', id: ws._id }));

  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    const room = roomOf(ws);

    switch(m.t){
      case 'create': {
        if(room) leaveRoom(ws);
        const r = makeRoom(m.mode);
        if(typeof m.lives === 'number') r.sim.setStartingLives(m.lives);
        if(m.solo && typeof m.solo === 'object') r.sim.setSoloProgress(m.solo);
        rooms.set(r.code, r);
        r.hostId = ws._id;
        ws._room = r.code;
        const p = r.sim.addPlayer(ws._id, m.name);
        r.clients.set(ws, { id: ws._id, name: p?p.name:m.name });
        sendLobby(r);
        break;
      }
      case 'join': {
        const r = rooms.get(String(m.code||'').toUpperCase());
        if(!r){ ws.send(JSON.stringify({ t:'error', msg:'No existe esa sala.' })); break; }
        if(r.started){ ws.send(JSON.stringify({ t:'error', msg:'La partida ya empezó.' })); break; }
        if(r.sim.players.size >= 4){ ws.send(JSON.stringify({ t:'error', msg:'La sala está llena.' })); break; }
        if(room) leaveRoom(ws);
        ws._room = r.code;
        const p = r.sim.addPlayer(ws._id, m.name);
        r.clients.set(ws, { id: ws._id, name: p?p.name:m.name });
        sendLobby(r);
        break;
      }
      case 'setmode': {
        if(!room || room.hostId!==ws._id || room.started) break;
        room.sim.setMode(m.mode==='versus'?'versus':'coop');
        sendLobby(room);
        break;
      }
      case 'start': {
        if(!room || room.hostId!==ws._id || room.started) break;
        if(room.sim.mode==='versus' && room.sim.players.size < 2){
          ws.send(JSON.stringify({ t:'error', msg:'El modo competitivo necesita al menos 2 jugadores.' })); break;
        }
        room.sim.startMatch();
        startLoop(room);
        break;
      }
      case 'restart': {
        if(!room || room.hostId!==ws._id) break;
        if(room.sim.mode==='versus' && room.sim.players.size < 2){
          stopLoop(room); room.sim.status='lobby'; sendLobby(room); break;
        }
        room.sim.startMatch();
        startLoop(room);
        break;
      }
      case 'tolobby': {
        if(!room || room.hostId!==ws._id) break;
        stopLoop(room); room.sim.status='lobby'; sendLobby(room);
        break;
      }
      case 'input': {
        if(!room) break;
        room.sim.input(ws._id, m.keys, m.last);
        break;
      }
      case 'action': {
        if(!room) break;
        room.sim.action(ws._id, m.a);
        break;
      }
      case 'leave': leaveRoom(ws); break;
    }
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log('NEÓN BLAST server escuchando en http://localhost:'+PORT);
});

module.exports = { server, wss, rooms };
