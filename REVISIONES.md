# Registro de revisiones (antislop + Thermos)

Lo lee y lo actualiza la revisión nocturna antes de revisar. Cada revisión agrega una entrada arriba del historial.
- **Decisiones vigentes**: cosas que se dejaron así a propósito. No se "corrigen" ni se reportan como hallazgo
  salvo que haya una razón nueva; si la hay, se explica.
- **Pendientes**: problemas conocidos que necesitan una decisión del dueño o un trabajo más grande.
- **Historial**: qué se encontró, cómo se corrigió y en qué rama o pull request.

## Decisiones vigentes
- Los relojes instalados se actualizan solos desde `main` cuando sube `version` en `package.json`. Las correcciones
  NO suben la versión: lo hace el dueño cuando quiere publicar.
- Nunca arrancar `server.js` o `iniciar.js` para probar sin `UPDATE_API=http://127.0.0.1:9`, `NO_OPEN=1` y
  `DATA_DIR`, `LOG_DIR`, `BACKUP_DIR` y `HOME` en una carpeta temporal. Ojo: `respaldo-config.json` y `respaldo-github.json` se escriben en la raíz
  del programa (no en `DATA_DIR`): borrarlos después de probar (están en `.gitignore`).
- `console.*` es el registro de la app (`src/logger.js` lo escribe en `logs/`): no es "print de depuración".
- Parámetros `req` sin usar en rutas `(req, res) =>` son la firma normal, no código muerto.
- Emojis en los mensajes del registro (🔴, ⏸, 💾…) son indicadores de estado que el dueño usa: se dejan.
- `.catch(() => {})` con comentario (audio bloqueado por el navegador, servidor que corta al apagarse) es esperado.
- `abrirCarpeta`/`abrirNavegador` ignoran el error a propósito: `explorer.exe` devuelve código 1 aunque abra bien.
- Automensajes: la rotación avanza aunque el envío falle (así un mensaje que Twitch rechaza siempre no bloquea a los
  demás). Las carpetas de respaldo se llaman exactamente como `sello()`.
- Copia en GitHub (`src/respaldo-github.js`): `multichat.json` no se sube a propósito (tiene `tiktok.apiKey`).
- Multichat YouTube: un texto de 11 letras sin `@` se toma como canal, no como id de video (el panel pide el @canal o
  el enlace del directo).
- Automensajes con cuenta vinculada: `ctx.enviar` (`server.js`) prueba la cuenta vinculada y si falla sale con la del
  canal; `cuentasTwitch.enviar` y `twitch.sendChat` nunca rechazan (por eso el aviso de `alChat` no lleva `.catch`).
- El repo no tiene pruebas automáticas: las correcciones se comprueban con scripts de node que simulan `fetch` y
  `WebSocket` (sin red) y con Chromium headless sobre el servidor arrancado con las variables de arriba.
- Automensajes (v2.16): un mensaje con `autor` (elegido desde el chat) no puede empezar con `!`, `/`, el prefijo de
  comandos ni ser una orden del bot (`esOrden`, al guardar y al enviar): si sale con la cuenta del canal, Twitch lo
  devuelve como escrito por el dueño y `commands.handle` lo ejecutaría. El seguro `enviando` va solo en `tick()` y los
  ecos de cuentas vinculadas no cuentan para `minChat`: al fusionar `main`, conservar las dos cosas (se perdieron una vez).
- `setConfig({mensajes})` no revive mensajes con autor que ya no están en el servidor (panel desactualizado).
- `public/pendientes.js` usa la conexión `/events` de la página (`window.__es`, que definen `menu.html`, `panel.js` y
  `podio-panel.html`) y espera cada 300 ms a que exista (el panel la abre tras cargar). Una página nueva que lo cargue debe
  definir `window.__es`. Alternativa más limpia anotada en Pendientes.
- "No es donación" + "no preguntar más" sin `payer` (PayPal, StreamElements) no recuerda nada: el nombre mostrado
  ("Juan P.") en la lista de Mercado Pago descartaba a otros. `/api/reset` descarta las donaciones sin confirmar y las
  anota en el registro.
- Mercado Pago: si falla pedir el pago completo y falta el cobrador, se reintenta en el próximo sondeo solo si el fallo
  es pasajero (red, 429, 5xx).
- Moneda: `otraMoneda(rate, ev)` (`engine.js`) decide si una donación está en otra moneda que la tarifa; esas no suman
  tiempo ni monto en `stats`/resumen del stream (sí entran al podio, que convierte a USD). Usarla en todo lo que sume o
  reste montos (`engine.js`, `trackSession` y "No era donación" en `server.js`).

## Pendientes
- `public/eventos.js` común para el `EventSource` de los cinco overlays (hoy repetido).
- Bajar `server.js` (1.274 líneas el 2026-11-04, sigue creciendo): ciclo de vida (reinicio, apagado, PID) a `src/ciclo.js` y webhooks a
  `src/webhooks.js` (los handlers de PayPal y PayPal IPN se parecen mucho).

- **IPN de PayPal sin "email receptor" (seguridad)**: `src/paypal.js:72-74` solo filtra por email si está cargado e
  `ipnReady` es siempre true (`server.js:~276`). Un IPN auténtico de un pago entre dos cuentas del atacante, reenviado al
  túnel, PayPal lo da por `VERIFIED` y suma tiempo y podio. Corrección propuesta: rechazar IPN sin `receiverEmail` y
  `ipnReady: !!receiverEmail`. Afecta a relojes instalados que reciben IPN sin email configurado: decide el dueño.
- **Token de GitHub filtrado (urgente)**: el commit `8142296` de `main` ("Add files via upload") subió
  `respaldo-github.json` con un `github_pat_…` al repo público; borrarlo en `5536df6` no lo saca de la historia.
  Revocarlo en GitHub y crear otro. Para que no se repita: `respaldo-github.json` y `respaldo-config.json` viven en la
  raíz del programa y la subida por la web de GitHub no respeta `.gitignore`; moverlos a `DATA_DIR` o a la carpeta del
  usuario (afecta a relojes instalados: decide el dueño).
- **Copia oculta en GitHub y privacidad**: sube sin aviso visible `podio.json`/`subaton.json` (log, `mpNombres`,
  mensajes de donantes). El `pk` de Mercado Pago es `sha256(id)` sin sal: si el id es un DNI/CUIT se revierte por fuerza
  bruta. Decidir: quitar `pk`/`mpNombres` antes de subir o usar HMAC con sal local, y mencionarlo en LEEME/Respaldos.
- **Límite de 6 conexiones de Chromium**: ahora 9 overlays abren `EventSource` (`podio.html`, `metas.html`,
  `top-general.html` son nuevos); con más de 6 overlays del reloj en el mismo perfil de OBS los siguientes se quedan
  esperando. Sin comprobar en OBS real. Opción: consultar `version` cada 2-3 s en esos tres.
- Podio: `removeEvent` deja borrar el aporte positivo después de una resta y el saldo negativo queda escondido.
- Copia en GitHub: "Subir una copia ahora" muestra "✔ Listo" si había otra subida en curso o nada cambió; al cerrar, si
  hay una subida en curso, la final no sale (`subir()` devuelve `null` sin motivo).
- **Automensajes y "nephallems"** (empeoró con la v2.16): ya se puede vaciar la lista (`quitarQuien`, v2.12); siguen el
  valor por defecto `['nephallems']` en todas las instalaciones y la comparación por login. Desde la v2.16 esa persona
  escribe sus propios textos con la cuenta del canal si no vinculó la suya (los comandos ya se filtran). `agregarQuien` no tiene el tope de 30 de
  `setConfig` y `esLogin` acepta 3 caracteres (Twitch exige 4).
- Estructura: `src/datos.js` (DATA_DIR + leer/guardar JSON atómico, hoy copiado en 6 módulos) y un planificador común
  "cada X min" para `codigo.js`/`automensajes.js` (cada uno tiene su `num` con distinto redondeo); `public/comun.js` para
  lo duplicado entre `panel.js` y `mod.js` (`parseDur` existe 3 veces con reglas distintas); `public/modulo.js/.css` para
  los paneles de módulo; `podioRoute` → nombre genérico y async (las rutas de automensajes/respaldo repiten su try/catch).
- **Login remoto (seguridad)**: `auth.js:~179` `ipOf` toma primero `cf-connecting-ip`; detrás de ngrok (lo que recomienda
  LEEME) la escribe el atacante: 1000 intentos con IP inventada, 0 bloqueos, y el `Map` de fallos crece sin tope. Usar
  la última IP de `x-forwarded-for` y un tope global (p. ej. 30 fallos/min → 429). Cambia la lógica de acceso: decide el dueño.
- **Cuentas vinculadas (v2.15)**: "Desvincular"/"Quitar" borran el token solo en esta PC y no lo revocan en Twitch
  (`POST id.twitch.tv/oauth2/revoke`); el token sigue en las copias locales y vuelve al restaurar una. Una cuenta con
  permiso vencido sigue como "✔ vinculada" (marcarla para volver a vincular). "Desconectar" Twitch no borra las
  cuentas vinculadas: con otro canal se usarían ahí. `setConfig({quienes})` por la API no limpia cuentas ni `m.como`.
  Si el envío con la cuenta vinculada pasa los 15 s, se reenvía con la del canal (puede salir dos veces) y el registro
  dice "(como X)" aunque salió con la del canal.
- Automensajes v2.16, decide el dueño: (1) ¿los mensajes de quien no vinculó su cuenta salen con la del canal? (2) los
  comandos "bot …" no tienen pausa por persona: 50 "bot ayuda" son 50 mensajes del canal (límite de Twitch); (3) el panel
  ya no muestra "Sin permiso para escribir en el chat" (`motivo()` lo quitó; quedan 3 ramas muertas en
  `automensajes-panel.html:~214`); (4) guardar desde el panel mientras alguien hace "bot mensaje"/"bot cambiar" en el
  chat todavía borra lo nuevo o revierte el cambio (hace falta versión o guardar por id); (5) el script de pruebas sin
  red de esta revisión podría vivir en el repo (p. ej. `pruebas/automensajes.js`), pero los relojes lo descargarían.
- Limpieza menor de automensajes: `nombres` falta en `DEFAULTS` (defensas `config.nombres || {}` en 4 sitios del módulo
  y 5 del panel); `nombreDe(DUENO)` y `estado()` arman el nombre del dueño distinto ('tú'/'Tú'); `ctx?.` mezclado con
  `ctx.` en `alChat`; `catch {}` sin comentario en `multichat.js:96,118,238`, `respaldo-github.js:19`, `multichat.html:67`.
- `src/twitch-cuentas.js` repite `sendChat`/`refresh` de `TwitchClient` y lee `twitch.s` por fuera; las 7 rutas de
  automensajes en `server.js` (1.183 líneas, sigue creciendo) podrían ir a `automensajes.rutas(app, …)`. El 450 de
  Twitch está en 4 sitios.
- `src/multichat.js`: Kick, YouTube y TikTok repiten el mismo ciclo (estado, parar, conectar, reintento); una tabla de
  conectores con reintento común. `api()` está copiada en 10 archivos de `public/` (sumar a `public/comun.js`).
- **Nombres del dueño por defecto en todas las instalaciones (urgente, v2.18)**: `src/store.js:27` trae
  `mpIgnorar.nombres = ['Luis Maria Villa','Luis Villa','Luis V']`; `merge()` lo aplica a todos los relojes que se
  actualizan y con la regla de inicial "Luis V" descarta en silencio a cualquier "Luis Valdez/Vargas/Vega" de cualquier
  streamer (probado: pago de 5000 ARS → 0 contados). Además publica un nombre real. Poner `nombres: []` (los relojes que
  ya guardaron la lista la conservan: hace falta una migración que la quite si es exactamente la de fábrica).
  Igual `preguntarDonaciones: {mercadopago: true, paypal: true}`: al actualizarse a mitad de un subatón ninguna
  donación de MP/PayPal suma hasta que alguien toca el aviso. ¿`false` por defecto para relojes ya instalados?
- Donaciones por confirmar (v2.17/2.18), estructura: `recibirDinero`/`decidirDonacion` y sus 6 rutas a
  `src/donaciones.js`; `/api/podio/no-es-donacion` reescribe a mano `d.stats` y `log.anulado` (inversa de
  `engine.contribute`, debería ser `engine.anular(logId)` y devolver los segundos realmente quitados); `dineroDecidido`
  repite el control de duplicados `processed` del motor (con otro tope, 1000); defensas `||=`/`?.` sobre claves que ya
  están en `DEFAULTS` (`server.js:859` repite el valor por defecto de `preguntarDonaciones`); `nombresDe` copia las 7
  fuentes de `nombreDe` sin el mismo filtro; la clave de un evento sin `id` lleva `Date.now()` y nunca deduplica.
  "No es donación" no descuenta los patitos que sumó el pago.
- `pendientes.js`: en vez de `window.__es` + espera, que exponga `window.pendientes = pintar` y cada página lo llame desde
  su `onmessage` (sin bucle ni global compartida).
- Encontrados el 2026-11-08 (deciden el dueño o necesitan Twitch/Windows real):
  - Si el stream termina o empieza durante un corte de EventSub, el reloj no se entera (`twitch.js:322`, `checkedLive` una sola vez). Consultar `/streams` en cada reconexión es fácil, pero `/streams` tarda en reflejar un inicio reciente y podría pausar un directo recién empezado: probar con Twitch real.
  - Actualizador: tras un fallo a mitad quedan archivos nuevos y viejos mezclados hasta el reintento; restaurar desde `.version-anterior` (hoy nadie la lee).
  - Copias locales con credenciales en OneDrive: la carpeta por defecto puede ser `OneDrive/Documentos` y la copia lleva `secrets` y `tiktok.apiKey` (`respaldo.js:17,24,110`, LEEME dice "solo en tu PC"). Sin secretos, restaurar en otra PC obliga a reconectar: decide el dueño.
  - El reloj se apaga con paneles de módulo abiertos (automensajes, código, hype, respaldos no abren `/events`; `server.js:1223`). Abrir `/events` choca con el límite de 6 conexiones anotado arriba.
  - Multiplicador desde el chat sin tope: `!x1000 60` de un mod activa x1000 (panel de mods: tope x5, `commands.js:149`). ¿Tope también en el chat?
  - Menor: un fallo en una suscripción EventSub no se reintenta (`twitch.js:283`); `/api/menu` en verde con cualquier POST a PayPal (`server.js:806`, el panel filtra con `panel.js:318`).
  - Limpieza: POST EventSub 4 veces (`twitch.js`), `acumular` (`engine.js:163`, `server.js:78`), mínimo de contraseña 3 veces (`auth.js`, `server.js`), `'dueño (esta PC)'` entre módulos, `PERFILES[1515791]` copiado en `DEFAULTS` y tiempos duplicados en `hype.js`.
- Encontrados el 2026-11-05 (deciden el dueño o cambian datos guardados):
  - **Reglas al aprobar (v2.17/2.18)**: "Es donación" aplica el multiplicador, el fin del reloj y el mes del podio del
    momento en que se toca, no de cuando llegó el pago (`server.js` `decidirDonacion` → `onContribution(p.ev)`,
    `engine.js:125`). PayPal $10 durante un x2 aprobado tras el x2: +10:00 en vez de +20:00; aprobado con el reloj en 0:
    "no se sumó". Propuesta: `at: p.at` en el evento y `multiplierFor(source, ev.at)`. ¿Qué hacer si ya terminó?
  - **Código de creador del dueño por defecto**: `src/codigo.js:13` trae `codigo: 'BYTEDEMOND'` con tarjeta y cinta
    encendidas: otro streamer que agrega `/codigo-tarjeta` sin configurarla muestra el código de Epic del dueño. Igual que
    `mpIgnorar.nombres`: vaciar y migrar si la config guardada es la de fábrica.
  - "Siempre es donación" sin `payer` recuerda solo `nombre:<nombre>` y vale entre plataformas y para nombres genéricos
    ("Anónimo", "Donación PayPal") (`server.js` `quienEs`). Agregar la fuente a la clave cambia las ya guardadas.
  - `public/pendientes.js:37,65`: `pintar()` reemplaza todo el aviso cada 30 s y en cada evento: desmarca "no preguntar
    más" y vuelve a habilitar botones de una decisión en curso. Actualizar por `data-key` (probar en navegador).
  - Los mods sin "montos" igual ven importes: `/events?overlay=1` no pide contraseña y recibe `added` con "Juan donó 50
    USD" (`http.js:146`, `auth.js:222`). ¿El overlay debe llevar montos? (es lo que se muestra en pantalla).
  - `mpNombres` ya guardados con el dominio de un correo ("gmail", ver Historial) no se corrigen solos.
  - Limpieza: `fmtDuration(timer.remainingMs / 1000)` 11 veces y `require('./package.json').version` 4 veces en
    `server.js`; `esLogin` + mensaje y `normalizar` repetidos en `server.js:956,968` y `automensajes.js:288,295`; "6 horas"
    de `vincularMP` 3 veces y `31 * 86400 * 1000` (`podio.js`); 60000/15000 de YouTube 3 veces (`multichat.js`); CSS sin
    uso (`.prim` en `hype-panel.html`, `.card.ancho` en `multichat-panel.html`, `.src-light` en `overlay.html`); export
    `_test` de `multichat.js` sin uso en el repo; `esc()` sin comilla simple en `automensajes-panel.html:138` y
    `overlay.html:294` (hoy no explotable).

- Encontrados el 2026-11-09 (decide el dueño):
  - Apagar "Hacer copias automáticas" no las apaga: `src/respaldo.js:102` deja pasar `forzar`, y lo usan `respaldo.js:158` (al abrir), `server.js:~288` (fin del stream) y `:~1190` (al cerrar). ¿La copia al cerrar debe respetar el interruptor? Cambia relojes instalados.
  - Restaurar una copia revive mods y contraseñas revocadas (`respaldo.js:85` también restaura `secrets.panel`). Conservar el `secrets.panel` actual impide recuperar una contraseña olvidada.
  - `/events?overlay=1` anónimo sin tope de conexiones con acceso remoto (`auth.js:222`, `http.js:132`). ¿Tope de ~100?
  - Limpieza: ruta `POST /api/podio/vincular-mp` sin cliente en el repo (`server.js:904`); `ipnReady` sin lector (`server.js:323`, ver pendiente de IPN); backoff 2000/1000 y tope 60000 repetidos en `streamelements.js` y `twitch.js`.

- Encontrados el 2026-11-10 (deciden el dueño o necesitan Windows):
  - **`iniciar.js:34-53,68-75` puede cerrar otro programa**: `killStale` mata el PID de `data/reloj.pid` si existe y el
    puerto está ocupado, sin comprobar que sea el reloj (PID reutilizado tras un corte de luz); `probe()` toma cualquier
    respuesta no 2xx como "reloj viejo" y le manda `POST /api/shutdown`. Probado en Linux (`sleep` cualquiera + otro
    servidor en el 3000 → muerto). Propuesta: `probe()` exige `app: 'reloj-subaton'`; `killStale` comprueba la imagen
    (`tasklist /FI "PID eq N"` = node.exe). Sin Windows para probar.
  - `src/actualizador.js:98-101` copia de `.bat` con `spawn('cmd.exe', ['/c', '… copy /y "a" "b"'])` sin
    `windowsVerbatimArguments: true`: Node escapa las comillas como `\"` y `copy` recibe rutas inválidas; falla en silencio
    (`>nul`) la primera vez que cambie un lanzador. Agregar la opción y probar en Windows antes de subir versión.
  - Mercado Pago (`mercadopago.js:180-182`): la primera `@palabra` del motivo se toma como donante y se recuerda en
    `mpNombres`: "Fuerza @micanal" deja al propio canal como Top donador. ¿Ignorar `secrets.twitch.login` / no recordarlo solo?
  - "Horas diarias una vez por día" (`server.js:298-311`) anota el día en que termina el stream: un stream de 21:00 a 00:30
    bloquea el del día siguiente. ¿Usar el día de inicio?
  - Podio (`podio.js:281-301`): "Anónimo", "Donación PayPal" y "Donación Mercado Pago" se suman como una sola persona y
    pueden salir #1. ¿Agrupar por evento o dejarlos fuera del podio?
  - Copias locales: desde 2026-11-10 una racha hace una copia cada 5 s; `limpiar` guarda 100 + una por día anterior, así
    que un tren de ~8 min borra las de hoy anteriores (incluida "al abrir"). ¿Conservar también la más vieja de hoy?
  - Menores: `hype.html:475` el overlay en OBS de otra PC recibe 401 al guardar la medición; `vincularMP` lee "1500.50"
    como 150050; `btnDailyNow` (`panel.js:222`) cancela un guardado de tarifas pendiente.
  - Limpieza: campos de la canción 4 veces en `hype-panel.html:153,206,207,237`; `commands.js:90` (`!podio` nunca),
    `:160` (repite `SOURCES`), `:70-72` (`permission(e)` dos veces, 15000); `esc()` en 13 archivos con 4 variantes y
    `nota()` 5 veces (sumar a `public/comun.js`).

- Encontrados el 2026-11-11 (decide el dueño):
  - "⚫ Simular fin de stream" (`server.js:773` → `onStream(false)`) suma las horas diarias de verdad, anota `ultimoDia` (el fin
    real de ese día ya no suma) y, en vivo con Twitch, deja `stream.live=false`: el `stream.offline` real se ignora y el reloj se
    apaga al cerrar el panel. ¿Un modo prueba que no sume horas ni toque `stream.live`?
  - `!fijar` (`commands.js:111`) se salta "Máximo por comando" y el tiempo máximo (`!fijar 999:00:00` de un mod → 999 h).
    ¿Respetar topes o solo dueño/lista?
  - `session` solo en memoria (`server.js:68`): un reinicio en pleno stream (acceso remoto, restaurar, actualizar) deja en 0 "La
    comunidad sumó" y el resumen. Guardarla cambia los datos guardados.
  - "La comunidad sumó" (`addedThisStream`, `server.js:110`) sigue contando una donación anulada (el recorte de recientes ya se
    corrigió); descontarla de `session.bySource` solo si es de esta sesión.
  - `hypeCancion()` (`server.js:983`) guarda `hype.json` y escribe el registro en cada `GET /api/hype` (ruta abierta del overlay).
    Reconocer la canción al elegirla no reconocería un archivo copiado a mano.
  - Limpieza: `message` de los bits sin lector (`twitch.js:344,348`); tope 2000/1000 de `seen`/`vistos` repetido.

- **Seguridad (urgente, decide el dueño):** el repo es público y este archivo describe con detalle fallos aún sin
  corregir (IPN de PayPal sin email receptor, `cf-connecting-ip` inventado en el login remoto, token de GitHub). Pasarlos a
  un aviso privado (GitHub Security Advisory) o corregirlos antes; si este archivo llega a `main`, el actualizador también
  lo baja a cada reloj (`protegido()` no excluye `.md`).
- `src/streamelements.js:136`: un tip sin `_id`/`transactionId`/`id` queda como `se:undefined` y bloquearía como duplicados
  los siguientes sin id (no confirmado que Astro los mande así).
- Duplicación menor: cuatro formateadores de fecha local (`logger.stamp`, `respaldo.sello`, `server.hoyLocal`,
  `podio.monthKey`); juntarlos con el pendiente de `src/datos.js` sin cambiar el formato de `sello`.
- Al mover `shutdown`/`restart` a `src/ciclo.js`: programar el `process.exit` de seguridad antes de cualquier otro paso.

## Historial
### 2026-11-12 — revisión nocturna (PR #2, rama `revision-nocturna`; `main` sin cambios desde la v2.18.0)
- `src/logger.js:37,57`: `open()`/`close()` sin try; sin la carpeta `logs`, `logger.close()` lanzaba en `shutdown()`/`restart()`
  y el reloj quedaba vivo con el puerto ocupado → `_append()` recrea la carpeta ante ENOENT y nunca lanza.
- `src/multichat.js:146`: "https://youtube.com/@Canal?si=…" (Compartir de la app) pedía `.../@Canal?si=…/live` y nunca
  conectaba → se corta en `?`/`#`.
- `src/engine.js:164`, `server.js:79,898`: una donación en otra moneda sumaba al monto de las estadísticas ("5010 USD") →
  `otraMoneda()` (ver Decisiones); "No era donación" ya no resta lo que no se sumó.
- `src/respaldo.js:178`: `/api/respaldo` (cada 15 s con el panel abierto) parseaba hasta 80 `podio.json` (~1 s con 20.000
  eventos) → resumen en caché por carpeta (se olvida al borrar o reescribir la copia; una lectura fallida no se guarda).
  `alInicio`: restaurar una copia que ya no existe ahora deja aviso en el registro.
- Limpieza: `merge()` de `podio.js` era copia de la de `store.js` → `store.merge`.
- Revisión del propio cambio (ponytail-review + Thermos): "No era donación" en otra moneda, caché y mkdir por línea.
- Comprobado: `node --check` de todos los .js y scripts sin red sobre logger, motor, respaldo, podio y `urlYouTube`.
### 2026-11-11 — revisión nocturna (PR #2, rama `revision-nocturna`; `main` sin cambios desde la v2.18.0)
- `server.js:/api/reset`: con tiempo inicial 0 tras terminar, `timer.set()` guardaba `ended:true` y `timer.ended = false` solo
  cambiaba la memoria → al reabrir, "Terminado" y sin sumar donaciones → se limpia antes de `set()`.
- `src/respaldo.js:123`, `server.js:1034`: "Guardar copia ahora" decía "✔ Copia guardada" sin haber escrito ninguna (carpeta
  imposible) → `respaldar()` devuelve `null` y la ruta responde con error.
- `server.js:108`: el overlay seguía mostrando una donación marcada "No era donación" → filtro `!e.anulado`.
- `public/podio-panel.html:289,293`: monedas sin escapar en `innerHTML`; `podio.addManual` aceptaba cualquier texto → `esc()` y
  3 letras.
- Limpieza: `DEFAULTS` copiado solo en el primer nivel (`hype.js`, `codigo.js`; `setConfig` modificaba los de fábrica);
  `podio.version` sin uso; `vistos` de Mercado Pago sin tope (como `twitch.js`).
- Revisión del propio cambio: clon de más en `codigo.js`.
- Probado con el reloj aislado (antes/después: reset, copia imposible, moneda) y `node --check`. Pendientes nuevos arriba.
### 2026-11-10 — revisión nocturna (PR #2, rama `revision-nocturna`; `main` sin cambios desde la v2.18.0)
- `src/respaldo.js:161` y `src/respaldo-github.js:95`: cada aporte reiniciaba la espera; en un tren del hype no salía
  ninguna copia hasta que paraban (11 aportes cada 2 s → 0 copias) → la espera no se reinicia (ahora 3 copias). Lo pedido
  durante una subida a GitHub se reprograma al terminar para respetar el mínimo de 5 min.
- Limpieza: `antes` de `/api/hype/probar`, `repo`/`live` de `/api/actualizar` y export `REPO`, filtro `oculto` de
  módulos, `hookServer` con `?.`, `#notaG` y `ahora` en `hype-panel.html`, `Math.max` en `fmtDuration`.
- Probado con el reloj aislado (probar, actualizar, menú, apagado), Chromium sin errores de JS y scripts con `fetch`
  simulado. Revisión del propio cambio: el mínimo entre subidas (arriba). Pendientes nuevos arriba.
### 2026-11-09 — revisión nocturna (PR #2, rama `revision-nocturna`; `main` sin cambios desde la v2.18.0)
- `server.js:610` `currency` sin validar + `innerHTML` (`panel.js:257,770`, `mod.js:194`, `podio-panel.html:343`): un mod con "tarifas" ejecutaba JS como dueño → 3 letras o vacío, y `esc()` (lo ya guardado queda escapado).
- `server.js:52` `abrirCarpeta` por shell: ruta elegida en el panel con `$(…)` ejecutaba comandos (Linux/Mac) → `execFile`.
- `src/http.js:71` 40 MB sin autenticar en cualquier POST (webhooks, login) → solo `/api/hype/subir`.
- `server.js` "No era donación" mostraba el monto a mods sin permiso → solo el nombre. `/api/reset` sin `newSession()`: overlay con el total anterior.
- `src/store.js` y otros 5: JSON dañado sin copia se pisaba al primer guardado → `src/danado.js` (`.danado-<fecha>`, solo `SyntaxError`).
- `src/mercadopago.js` dos `start()` dejaban un sondeo sin referencia → `gen`.
- Limpieza: `renderTo`/`unlock`, `multiplier.sources`, `mpCurrency`, `MAX_PROCESADOS`, comentarios en catch.
- Probado con reloj aislado (simulate, currency, reset, subir, webhook), `fetch` simulado y Chromium (menu, panel, podio-panel, overlay sin errores).
### 2026-11-08 — revisión nocturna (PR #2, rama `revision-nocturna`; `main` sin cambios desde la v2.18.0)
- `server.js:97,101` un subatón terminado revivía al reiniciar → `ended` se guarda y restaura (los ya terminados antes de esto siguen igual hasta el próximo final).
- `src/respaldo.js:62` la recuperación tomaba la copia de la última carpeta → la más nueva por nombre.
- `src/actualizador.js:89` fallo a mitad dejaba `package.json` nuevo y no reintentaba → `package.json` al final. Falta restaurar desde `.version-anterior` (ver Pendientes).
- `server.js` webhooks PayPal/MP respondían 200 antes de procesar → 500 si falla y el emisor reintenta (el IPN sigue con 200 inmediato). `src/mercadopago.js:78` un fallo de red al arrancar decía "token inválido" y no reintentaba → reintenta cada 60 s.
- `src/http.js` `X-Frame-Options: SAMEORIGIN` (clickjacking; las vistas previas de `codigo-panel` son iframes propios).
- Limpieza: `MONEY` = `DINERO`, `SOURCE_LABEL` = `LABELS`, miembros sin uso del motor y `store.defaults`, condiciones que no cambiaban nada.
- Probado con scripts de node sin red y el reloj aislado (simulate con `ended`, encabezado y webhooks).
### 2026-11-05 — revisión nocturna (PR #2, rama `revision-nocturna`; `main` sin cambios desde la v2.18.0)
- `server.js` `recibirDinero`: un pago ya contado (antes de activar "preguntar", p. ej. al actualizar a la 2.18) volvía
  en el sondeo tras reiniciar como "¿Es donación?"; aprobar no hacía nada y "No es donación" mentía → `engine.procesado`.
- `src/podio.js` `vincularMP`: `!mp.add @juan` con una donación de Mercado Pago esperando renombraba (y recordaba) la
  anterior ya contada → se rechaza sin monto o con el monto de la pendiente.
- `src/mercadopago.js:172` "avisame a ana@gmail.com" → la donante salía como "gmail" y se guardaba → la `@` no puede ir
  pegada a letra, número o punto.
- `server.js:184,751` el evento `aporte` llevaba `usd` a los mods sin "montos" (patitos no lo usa) → quitado.
- Limpieza: catch vacíos y `try` inútil en `metas.html`, `podio.html`, `top-general.html`, `podio-panel.html`;
  `IMPORTANTES` y 4 exports sin uso de `actualizador.js`; `actualizador.js`/`iniciar.js` ignoraban `LOG_DIR`.
- Probado con scripts de node sin red (`fetch` simulado, podio real en carpeta temporal), el reloj aislado con
  `/api/simulate` y Chromium sobre las 4 páginas. Revisión del propio cambio: `!mp.add` con otro monto ya no se bloquea.
### 2026-11-04 — revisión nocturna (PR #2, rama `revision-nocturna`, + `main` v2.17.0 y v2.18.0)
- Merge de `main` con conflicto en `src/mercadopago.js`: lógica nueva de main + el aviso del catch de la rama.
- `public/pendientes.js:64` abría una segunda conexión `/events` por pestaña: con menú + panel + podio Chrome llega a 6 y
  los botones se cuelgan → usa `window.__es`. También: `appendChild` duplicado y `catch {}`.
- `server.js:231` "No es donación" + "siempre" en PayPal metía "Juan P." en la lista de Mercado Pago → sin `payer` no se
  recuerda; la casilla lo dice. `/api/reset` no vaciaba `d.pendientes` → se vacían y se anotan en el registro.
- `src/mercadopago.js:152` un fallo al pedir el pago completo lo perdía hasta reiniciar → se reintenta si es pasajero.
- `public/panel.js:392-412` catch vacíos de "no contar"/"preguntar" (la casilla quedaba marcada sin guardar).
  `coincideNombre` exportado sin uso.
- Probado con el reloj en carpetas temporales y Chromium (4 pestañas, una petición en 10 ms; fallo de guardado con
  500) y Mercado Pago con `fetch` simulado. Revisión del propio cambio: reintentos sin fin con 4xx fijo y reset sin rastro.
- Sin corregir (decide el dueño): nombres del dueño por defecto en `store.js` (urgente) y `preguntarDonaciones` en true.

### 2026-11-03 — revisión nocturna (PR #2, rama `revision-nocturna`, + `main` v2.16.0)
- Se fusionó `main` v2.16.0 (un bot por persona). Conflicto en `src/automensajes.js`: se tomó el de `main` y se
  volvieron a poner el seguro `enviando` en `tick()`, los `ecos` y el filtro de mensajes nulos (se habían perdido).
- `automensajes.js` `comando`: "bot mensaje !fijar 0" de alguien de la lista salía con la cuenta del canal y el reloj lo
  ejecutaba como del dueño (también "desactivar bot todos", `!sumar`, `!mp.add`) → `esOrden` (ver Decisiones),
  `ctx.prefijo` en `server.js`, sin caracteres invisibles en `limpiar()`. Sinónimos del dueño ("bot agregar") guardaban
  un mensaje con autor `_dueno` → tabla `SINONIMOS`.
- Migración desde la 2.15: el bot activado por el dueño desde el chat quedaba como `activos['micanal']` (no se podía
  apagar con "Tu bot") → `_dueno`. Panel desactualizado revivía mensajes borrados desde el chat o de alguien quitado.
- Comprobado con un script de node sin red (12 casos, los nuevos fallaban antes) y el servidor arrancado aislado.
- Pendiente: decisiones de la v2.16 y "nephallems" (ver Pendientes).
### 2026-11-02 — revisión nocturna (PR #2, rama `revision-nocturna`, + `main` v2.15.0)
- Se fusionó `main` (v2.14/2.15: cuentas de Twitch vinculadas para automensajes). Conflicto en `src/automensajes.js`:
  el seguro `enviando` queda solo en `tick()`; sin `.catch` vacío en el aviso.
- `server.js:~674` `/auth/twitch/callback`: `error_description` sin escapar → XSS con un enlace (como dueño local).
- `src/http.js:~41`: `new URL()` y `decodeURIComponent` fuera del try → `GET //[x]` quedaba sin respuesta (también en
  el túnel de webhooks) → 400/500.
- `automensajes.js`: `activadoPor` quedaba viejo al prender desde el panel (salía con la cuenta de otro); el eco del
  bot con cuenta vinculada contaba para `minChat` → `ecos` (últimos 10, recortados a 450).
- `twitch-cuentas.js`: fallo en `/helix/users` volvía a canjear el device_code y perdía la autorización; sin timeout;
  `tiene('constructor')` daba true → `cuenta()` con `Object.hasOwn`. Panel: `seguirVinculo` y Cancelar con catch vacío.
- Pendiente: login remoto, revocar tokens, cuentas vencidas (ver Pendientes).
### 2026-11-01 — revisión nocturna (PR #2, rama `revision-nocturna`, + `main` v2.13.0)
- Se fusionó `main` (v2.11–2.13: multichat, copia en GitHub, podio en vivo). Conflictos en `server.js` (apagado con
  `prepararCierre` + espera de la subida a GitHub; `multichat` en `guardarTodo`/`prepararCierre`, así también al
  reiniciar), `automensajes.js`, `respaldo.js`, `modulos.js`, `reyes.html`.
- `multichat.js:97`: Kick sin control tras el `await` → dos sockets al cambiar de canal o conectado estando apagado;
  `leerYT` igual tras `r.json()` → contador `gen`. URLs sin `https://` (`youtube.com/@x`, `kick.com/x`, `tiktok.com/@u`)
  se leían mal → esquema y subdominio opcionales.
- `podio.js:206`: el tope de "Restar" subs contaba new/resub → saldo negativo escondido → `valorPodio()` común.
- `twitch.js` `stop()`: `chatOk` quedaba en true tras desconectar (multichat en verde).
- `respaldo-github.js`: pedido perdido si llegaba durante una subida (`otraVez`); lecturas fallidas en silencio;
  parámetro `ya` muerto. `respaldo.js`: `try/catch {}` alrededor de `pedir()`.
- `multichat-panel.html`, `multichat-comun.js`, `multichat.html`, `podio.js`: catch vacíos → aviso visible; la página del
  multichat arma columnas y muestra los mensajes previos al abrir.
- Pendiente: token filtrado (revocar), privacidad de la copia en GitHub, límite de conexiones, ver Pendientes.
### 2026-10-28 — revisión nocturna (rama `revision-nocturna`, sobre `antislop` + `main` v2.10.1)
- Se fusionó `main` (v2.10.0/2.10.1, mensajes automáticos) en la rama: conflictos en `server.js` (se dejó el cierre
  unificado de `antislop` y se agregó `automensajes.save()` a `guardarTodo()`) y `src/respaldo.js` (`automensajes.json`
  en `ARCHIVOS`).
- `src/automensajes.js`: "Enviar ahora" soltaba el seguro `enviando` del envío automático; un `null` en `mensajes` rompía
  cada tick y la API; `.catch` sin efecto y `getConfig` sin uso.
- `src/respaldo.js:43` + `public/respaldo-panel.html:104`: nombre de carpeta sin anclar e insertado sin escapar → XSS en
  el panel desde la carpeta de respaldos; ahora `$` y `esc()`.
- `automensajes-panel.html` y `menu.html`: catch vacíos → aviso visible; CSS sin uso; descripción de `modulos.js`.
- Código muerto: `require('./src/engine')` duplicado, `logger.currentText`, exports `parseDur`/`COOKIE`.
- Pendiente: IPN sin email receptor, permiso fijo de "nephallems" (ver Pendientes).
### 2026-10-27 — revisión inicial (PR #1, rama `antislop`)
- Reiniciar el reloj solo guardaba `store`; se podía perder el último guardado del podio → reiniciar y apagar
  comparten `prepararCierre()`.
- Si `restaurar.json` no se podía borrar, la copia se restauraba en cada arranque sin avisar → ahora se avisa.
- Errores silenciosos en guardar, respaldos, actualizador, Twitch/StreamElements y overlays → al log o a la consola.
- `intentar()`, `guardarTodo()`, `listarSonidos()`, `abrirCarpeta()`/`abrirNavegador()`; `respaldar()` escribe lo
  pendiente antes de copiar. Código muerto eliminado.
