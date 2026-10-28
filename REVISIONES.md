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

## Pendientes
- `public/eventos.js` común para el `EventSource` de los cinco overlays (hoy repetido).
- Bajar `server.js` (~1.100 líneas): ciclo de vida (reinicio, apagado, PID) a `src/ciclo.js` y webhooks a
  `src/webhooks.js` (los handlers de PayPal y PayPal IPN se parecen mucho).

- **IPN de PayPal sin "email receptor" (seguridad)**: `src/paypal.js:72-74` solo filtra por email si está cargado e
  `ipnReady` es siempre true (`server.js:~276`). Un IPN auténtico de un pago entre dos cuentas del atacante, reenviado al
  túnel, PayPal lo da por `VERIFIED` y suma tiempo y podio. Corrección propuesta: rechazar IPN sin `receiverEmail` y
  `ipnReady: !!receiverEmail`. Afecta a relojes instalados que reciben IPN sin email configurado: decide el dueño.
- **Automensajes y "nephallems"**: `quienes` trae `['nephallems']` por defecto en todas las instalaciones (módulo oculto
  del menú) y no se puede vaciar (`automensajes.js:36,64` ignoran la lista vacía); se compara por login, no por user_id.
  Decidir si va por defecto para todos y permitir lista vacía.
- Estructura: `src/datos.js` (DATA_DIR + leer/guardar JSON atómico, hoy copiado en 6 módulos) y un planificador común
  "cada X min" para `codigo.js`/`automensajes.js` (cada uno tiene su `num` con distinto redondeo); `public/comun.js` para
  lo duplicado entre `panel.js` y `mod.js` (`parseDur` existe 3 veces con reglas distintas); `public/modulo.js/.css` para
  los paneles de módulo; `podioRoute` → nombre genérico y async (las rutas de automensajes/respaldo repiten su try/catch).

## Historial
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
