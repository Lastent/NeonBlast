# NEÓN BLAST — Multijugador

Juego estilo Bomberman (IP original, estética synthwave/neón) para **hasta 4 jugadores** en red, con modos **cooperativo** (contra enemigos) y **competitivo** (último en pie). UI en **español**.

## Arquitectura

**Servidor autoritativo.** El servidor corre la única simulación; los clientes solo envían input y dibujan los *snapshots* que reciben.

- `sim.js` — motor headless (CommonJS). Toda la lógica: laberinto, movimiento con colisión por eje + snapping, bombas (normal/remota/perforante + patada), explosiones encadenadas, llamas con dueño, power-ups, enemigos (solo coop), reglas de cada modo. Exporta `{ Sim, COLS, ROWS, TILE, COLORS, SPAWNS, WINS_TO_MATCH }`.
- `server.js` — servidor HTTP (sirve `public/`) + `WebSocketServer` (misma `PORT`, default 8080). Salas por código de 4 letras, lobby, selección de modo, tick autoritativo ~30 Hz (`TICK_MS=33`) que hace `sim.tick()` y difunde `sim.snapshot()`. Migración de anfitrión al desconectarse. Exporta `{ server, wss, rooms }`.
- `public/index.html` — cliente de un solo archivo: lobby, WebSocket, render con **interpolación** (`RENDER_DELAY≈90ms`) de jugadores/bombas/enemigos, HUD, banners y controles táctiles. Misma paleta neón.

### Flujo de estados del Sim
`lobby → countdown (2s) → playing → (versus) roundover → countdown … / (coop) levelclear → countdown …`, y `gameover` al final. `snapshot()` manda `grid` como string (`#` muro, `x` blando, `.` piso) más jugadores/bombas/llamas/power-ups/enemigos en píxeles.

### Reglas por modo
- **Coop:** enemigos + salida oculta bajo un bloque; nivel superado al limpiar enemigos y pisar la salida. Vidas individuales; fuego amigo activo (las llamas dañan a cualquiera).
- **Versus:** sin enemigos, 1 vida por ronda, último vivo gana; **primero a `WINS_TO_MATCH` (3)** gana la partida. **Requiere ≥2 jugadores** para empezar.

## Comandos

```bash
npm install          # única dependencia de runtime: ws
npm start            # servidor en http://localhost:8080  (PORT=3000 npm start para cambiarlo)
npm test             # corre sim.test.js + server.test.js
node client.test.js  # prueba del cliente (usa jsdom, devDependency)
```

Para jugar por internet: con el server arriba, `cloudflared tunnel --url http://localhost:8080` (o `ngrok http 8080`) y comparte la URL pública; el cliente usa `wss://` solo si la URL es `https://`.

## Convenciones / paleta
Fuentes Chakra Petch + Space Mono. Colores: cyan `#38f0ff`, magenta `#ff3d8b`, lima `#b6ff3d`, ámbar `#ffb23d`, violeta `#b06bff`. Validar JS con `node --check` antes de dar por bueno un cambio.

## Trampas de testing (ya pisadas — evítalas)
- En pruebas de explosión **horizontal/vertical usar filas IMPARES**: las filas pares tienen pilares en columnas pares (`x%2==0 && y%2==0`) que cortan el blast. Nunca poner una bomba en una celda de pilar.
- Para llegar a `playing` hay que avanzar **~2.2 s** (pasar la cuenta regresiva) antes de montar el escenario.
- **Versus con 1 solo jugador termina la ronda al instante** (queda ≤1 vivo). Para probar mecánicas aisladas usar **modo coop** con `sim.enemies.length=0` y `sim.exit.revealed=false` (así nada termina la partida).
- Las pruebas son white-box: manipulan `sim.grid`, `sim.players` (Map), `sim.bombs` directamente y llaman `sim.tick(dt)`.

## Pendientes / ideas
Predicción del lado del cliente para el jugador local (hoy tu personaje se dibuja desde el server → input lag ≈ ping); espectadores / entrada tardía; rondas configurables; fuego amigo opcional en coop; throttle de ancho de banda (<30 Hz).
