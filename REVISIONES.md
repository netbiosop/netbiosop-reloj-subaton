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
  `DATA_DIR`, `LOG_DIR`, `BACKUP_DIR` y `HOME` en una carpeta temporal.
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
- El repo no tiene pruebas automáticas: las correcciones se comprueban con scripts de node que simulan `fetch` y
  `WebSocket` (sin red) y con Chromium headless sobre el servidor arrancado con las variables de arriba.

## Pendientes
- `public/eventos.js` común para el `EventSource` de los cinco overlays (hoy repetido).
- Bajar `server.js` (~1.100 líneas): ciclo de vida (reinicio, apagado, PID) a `src/ciclo.js` y webhooks a
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
- **Automensajes y "nephallems"**: ya se puede vaciar la lista (`quitarQuien`, v2.12); siguen el valor por defecto
  `['nephallems']` en todas las instalaciones y la comparación por login. `agregarQuien` no tiene el tope de 30 de
  `setConfig` y `esLogin` acepta 3 caracteres (Twitch exige 4).
- Estructura: `src/datos.js` (DATA_DIR + leer/guardar JSON atómico, hoy copiado en 6 módulos) y un planificador común
  "cada X min" para `codigo.js`/`automensajes.js` (cada uno tiene su `num` con distinto redondeo); `public/comun.js` para
  lo duplicado entre `panel.js` y `mod.js` (`parseDur` existe 3 veces con reglas distintas); `public/modulo.js/.css` para
  los paneles de módulo; `podioRoute` → nombre genérico y async (las rutas de automensajes/respaldo repiten su try/catch).
- `src/multichat.js`: Kick, YouTube y TikTok repiten el mismo ciclo (estado, parar, conectar, reintento); una tabla de
  conectores con reintento común. `api()` está copiada en 10 archivos de `public/` (sumar a `public/comun.js`).

## Historial
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
