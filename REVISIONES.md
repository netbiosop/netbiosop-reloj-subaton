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

## Pendientes
- `public/eventos.js` común para el `EventSource` de los cinco overlays (hoy repetido).
- Bajar `server.js` (~1.100 líneas): ciclo de vida (reinicio, apagado, PID) a `src/ciclo.js` y webhooks a
  `src/webhooks.js` (los handlers de PayPal y PayPal IPN se parecen mucho).

## Historial
### 2026-10-27 — revisión inicial (PR #1, rama `antislop`)
- Reiniciar el reloj solo guardaba `store`; se podía perder el último guardado del podio → reiniciar y apagar
  comparten `prepararCierre()`.
- Si `restaurar.json` no se podía borrar, la copia se restauraba en cada arranque sin avisar → ahora se avisa.
- Errores silenciosos en guardar, respaldos, actualizador, Twitch/StreamElements y overlays → al log o a la consola.
- `intentar()`, `guardarTodo()`, `listarSonidos()`, `abrirCarpeta()`/`abrirNavegador()`; `respaldar()` escribe lo
  pendiente antes de copiar. Código muerto eliminado.
