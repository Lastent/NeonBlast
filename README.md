# NEÓN BLAST — Multijugador en red

Versión en red de NEÓN BLAST para **hasta 4 jugadores**, con modos **cooperativo** (contra enemigos) y **competitivo** (último en pie). El servidor de Node corre la simulación de verdad (es *autoritativo*); los navegadores solo envían tus teclas y dibujan lo que el servidor manda. Esto evita trampas y desincronización.

```
neon-blast-multiplayer/
├─ server.js        # servidor: sirve el cliente + WebSockets + corre las partidas
├─ sim.js           # motor de juego autoritativo (sin pantalla)
├─ public/
│  └─ index.html    # el cliente (lo abren los jugadores en el navegador)
├─ package.json
├─ sim.test.js / server.test.js / client.test.js   # pruebas
└─ README.md
```

## 1) Requisitos

- **Node.js 18 o superior** (trae todo lo necesario; la única dependencia es `ws`).

## 2) Instalar y arrancar

Desde la carpeta del proyecto:

```bash
npm install      # instala la dependencia (ws)
npm start        # arranca el servidor en el puerto 8080
```

Verás: `NEÓN BLAST server escuchando en http://localhost:8080`

Abre **http://localhost:8080** en el navegador. Eso ya te sirve para probar en tu propia máquina o con otras computadoras de **tu misma red local** (ellas entran a `http://TU_IP_LOCAL:8080`, por ejemplo `http://192.168.1.40:8080`).

> ¿Otro puerto? `PORT=3000 npm start`

## 3) Cómo juegan 4 personas

1. Una persona escribe su nombre, elige el modo y pulsa **Crear sala** → aparece un **código de 4 letras**.
2. Comparte ese código. Los demás escriben su nombre, ponen el código y pulsan **Unirse**.
3. El **anfitrión** (quien creó la sala) puede cambiar el modo y pulsa **Empezar**.
4. Al terminar, el anfitrión puede pulsar **Otra vez** para una nueva partida.

El servidor es autoritativo, así que **si el anfitrión se desconecta la partida sigue** y el rol de anfitrión pasa a otro jugador.

## 4) Abrir la partida a internet (jugadores en lugares distintos)

Tu servidor corre en tu PC; para que entren desde fuera, esa dirección tiene que ser *alcanzable* desde internet. Dos caminos:

### Opción A — Túnel (lo más fácil, sin tocar el router)

Un túnel te da una URL pública temporal que reenvía a tu servidor local. Con el servidor ya corriendo (`npm start`), en otra terminal:

**Cloudflare Tunnel** (gratis, no requiere cuenta para pruebas rápidas):
```bash
cloudflared tunnel --url http://localhost:8080
```

**o ngrok** (requiere cuenta gratuita):
```bash
ngrok http 8080
```

Cualquiera de los dos te dará una URL tipo `https://algo-aleatorio.trycloudflare.com`. **Comparte esa URL**: cada jugador la abre y listo. El cliente detecta el `https://` y usa `wss://` (WebSocket seguro) automáticamente, así que funciona sin configurar nada más.

### Opción B — Reenvío de puertos (port forwarding)

En tu router, reenvía el **puerto 8080 (TCP)** hacia la IP local de tu PC. Luego los jugadores entran a `http://TU_IP_PUBLICA:8080`. Es más permanente, pero expone el puerto y depende de tu router/ISP (y muchas conexiones domésticas usan CGNAT, donde esto no funciona). Por eso, para algo rápido, **el túnel suele ser mejor**.

> Nota de seguridad: el servidor no pide login. Mientras la URL/puerto esté abierta, cualquiera con el enlace podría crear salas. Para jugar entre amigos está bien; ciérralo (corta `cloudflared`/`ngrok` o el servidor) cuando termines.

## 5) Modos

- **Cooperativo:** hay enemigos y bloques destructibles; comparten el avance de niveles. Cada quien tiene vidas; si las pierdes todas, reapareces al pasar de nivel. El nivel se supera cuando **no quedan enemigos** y **un jugador llega a la salida** (oculta bajo un bloque). Las explosiones dañan a cualquiera, ¡incluidos tus compañeros!
- **Competitivo:** sin enemigos, todos contra todos. Una vida por ronda; el **último en pie gana la ronda**. El **primero en llegar a 3 rondas** gana la partida. Necesita **mínimo 2 jugadores** para empezar.

Los power-ups (más bombas, más alcance, velocidad, vida, patada, bomba remota y bomba perforante) salen de los bloques en ambos modos.

## 6) Controles

- **Mover:** flechas o WASD
- **Poner bomba:** barra espaciadora (o Enter)
- **Detonar bomba remota:** Shift (detona la más antigua primero)
- **Táctil:** D-pad + botón BOMBA; el botón 💥 aparece cuando tienes bombas remotas

## 7) Notas técnicas

- Tick autoritativo a ~30 Hz; el cliente **interpola** el movimiento de los demás (~90 ms de retraso de render) para que se vea fluido.
- Tu propio personaje también se dibuja a partir del estado del servidor, así que el retardo de tus movimientos será ~ tu *ping* al servidor. En red local es imperceptible; por internet depende de la latencia.
- Probado con pruebas automáticas del motor, del servidor (clientes WebSocket reales) y del cliente (jsdom). Para correrlas: `npm test` (motor + servidor) y `node client.test.js`.

## 8) Ideas para más adelante

- Predicción del lado del cliente para tu propio personaje (mover sin esperar al servidor).
- Entrar como espectador a una partida en curso.
- Rondas configurables, fuego amigo opcional en cooperativo, y limitar el ancho de banda enviando menos de 30 Hz.

¡A reventar bloques! 💥
