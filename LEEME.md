# ⏱ Reloj de Subatón para Twitch — v2 (estilo BYTEDEMOND)

> **Novedades de la v2:** todos los overlays (reloj, metas, Top General, podio y reyes) tienen la estética del canal: rojo intenso sobre negro, hexágonos y tipografía condensada (Bebas Neue + Barlow Condensed), con una distribución simétrica pensada para tu cámara y el HUD de ARC Raiders. Los colores están en un solo archivo, `public/marca.css`: cambiándolos ahí se actualizan todos los overlays a la vez.
>
> **Cambiar entre la versión anterior y la v2:** apaga la que esté abierta (botón "Apagar por completo" en el menú o `detener.bat`) y abre la otra con su `iniciar.bat`. Las dos usan el mismo puerto, así que tus fuentes de OBS (`localhost:3000/...`) sirven para ambas. Cada carpeta tiene sus propios datos (`data/`): si seguiste usando la anterior, copia su carpeta `data` a esta antes de abrirla para traer el tiempo y el podio al día.

## 🎨 Distribución recomendada en OBS (lienzo 1920 × 1080)

Medidas tomadas de tu stream: la columna izquierda pegada al borde (metas arriba, reloj, Top General) y el podio debajo de la cámara.

| Fuente de navegador | URL | Ancho × Alto | Posición X, Y |
|---|---|---|---|
| Reloj | `http://localhost:3000/overlay?align=left&pops=right&size=84` | 900 × 150 | (como lo tienes) |
| Metas del mes | `http://localhost:3000/metas` | 306 × 200 | 8, 15 |
| Top General | `http://localhost:3000/top-general` | 306 × 195 | 8, 405 |
| Podio del mes (debajo de la cámara) | `http://localhost:3000/podio` | 306 × 205 | 1553, 385 |
| Reyes del mes pasado (abajo al centro) | `http://localhost:3000/reyes` | 640 × 112 | 640, 942 |
| Código de creador: tarjeta (en lugar del cuadro azul) | `http://localhost:3000/codigo-tarjeta` | 520 × 230 | 1025, 78 |
| Código de creador: cinta de noticias | `http://localhost:3000/codigo-cinta` | 1920 × 60 | 0, 1020 |
| Tren del hype (arriba de todo) | `http://localhost:3000/hype` | 1920 × 1080 | 0, 0 |

**Para que se vean nítidos (sin perder calidad):**
- En cada fuente pon el **Ancho × Alto exacto** de la tabla y deja la escala al 100%: clic derecho → **Transformar → Restablecer transformación**. No las estires ni las achiques arrastrando las esquinas: OBS reescala la imagen y el texto se pone borroso.
- Si alguna la quieres más grande, agrégale `?escala=1.2` a la URL y sube el Ancho × Alto en la misma proporción (ej. 306 × 200 → 368 × 240). Así se dibuja de nuevo a ese tamaño y sigue nítida.
- Los textos chicos (categorías, montos, porcentajes) tienen tamaño mínimo de 14–16 px y contorno negro duro, para que se lean aunque Twitch comprima la imagen. Los nombres largos se achican solos para verse completos.

- La posición se escribe en OBS con clic derecho en la fuente → **Transformar → Editar transformación**.
- La cámara queda como la tienes (x 1560, y 96, 306 px de ancho). Si la mueves, alinea el podio con su borde izquierdo y su ancho.
- En el reloj, `align=left` lo alinea a la izquierda y `pops=right` hace que los "+tiempo" salgan a la derecha, sin tapar las metas. El tema de la marca es el predeterminado; con `theme=default` vuelves al estilo anterior.



Suma tiempo **automáticamente** al reloj cuando recibes:

- 💜 **Bits** y **Subs** de Twitch (nuevas, resubs y regaladas, con tiempo distinto por Tier)
- 💳 Donaciones de **Mercado Pago**
- 💵 Donaciones de **PayPal**

Todo se configura en un panel: cuánto tiempo suma cada cosa, multiplicadores **x2 / x3** (ahora mismo o programados por horario, y eligiendo a qué fuentes aplican), tiempo inicial, tope máximo, y botones para sumar o quitar tiempo a mano.

---

## 1. Instalar (una sola vez)

1. Instala **Node.js 22 o más nuevo** desde <https://nodejs.org> (botón "LTS").
2. Descomprime esta carpeta donde quieras (ej. `Documentos\reloj-subaton`).

No hace falta instalar nada más.

## 2. Abrir y apagar

- **Abrir:** doble clic en **`iniciar.bat`**. Se abre una ventanita minimizada que se cierra sola en 1 o 2 segundos, el reloj queda funcionando en segundo plano y se abre el panel.
  - Si prefieres que no aparezca ni siquiera minimizada, usa **`iniciar-silencioso.vbs`** (hace lo mismo; algunos Windows nuevos o antivirus bloquean los .vbs, en ese caso usa `iniciar.bat`).
  - Si ya estaba encendido, solo abre el panel. Si estaba encendida una **versión anterior** (por ejemplo, después de actualizar), la apaga sola y arranca la nueva. El tiempo queda guardado.
  - Si algo impide que arranque, se abre automáticamente `logs\errores.txt` con el motivo.
- **Apagar:** botón **Apagar el reloj** en el panel, o doble clic en **`detener.bat`**. El tiempo queda guardado y se cierra todo: conexiones con Twitch, StreamElements y Mercado Pago, puertos y el proceso en segundo plano. El panel intenta cerrar su pestaña y el overlay queda congelado (no sigue bajando solo).
- **Apagar al cerrar el panel** (activado por defecto, en la sección *Stream → Registros y programa*): si cierras todas las pestañas del panel en esta PC, el reloj se apaga solo a los 20 segundos (si solo recargas la página no pasa nada). Con *"…pero no mientras estoy en vivo"*, si lo cierras durante el stream sigue funcionando y se apaga solo cuando termina el stream.
- **Al volver a encenderlo** no hay que hacer nada especial: si quedó abierta la pestaña del panel se reconecta sola (no se abre otra), el overlay de OBS también se reconecta solo, y si el reloj anterior se hubiera quedado colgado, `iniciar.bat` lo cierra antes de arrancar.
- **Para ver todo en una consola** (diagnóstico): `iniciar-con-consola.bat`.
- **Mac / Linux:** `node iniciar.js` (y `node iniciar.js --detener` para apagar).

### Stream en vivo y tiempo guardado

Con Twitch conectado, el reloj sabe cuándo empieza y termina tu stream:

- **Termina el stream** → el reloj se pausa solo y el tiempo que sobra queda **guardado para el próximo stream** (el panel lo muestra en naranja).
- **Empieza el stream** → el reloj se reanuda solo con el tiempo guardado.
- Entre streams puedes **editar el tiempo guardado** con **Fijar en** o los botones ± del panel (o con `!fijar` en el chat).

Ambas cosas se pueden apagar en la sección **Stream** del panel. Con los botones *Simular inicio/fin de stream* puedes probarlo.

### Registros (logs)

En la carpeta **`logs`** se crea un archivo por stream (`stream_AAAA-MM-DD_HH-MM-SS.log`) con todo lo que pasó: donaciones, bits, subs, comandos de mods, pausas y ajustes. Al terminar el stream se escribe un **resumen** (duración, cuánto entró por cada fuente y el tiempo que quedó guardado). Desde el panel: **Ver registro actual** y **Abrir carpeta de logs**. Si el programa falla al arrancar, el error queda en `logs/errores.txt`.

### Usar el panel desde otra PC o el celular (dueño y moderadores)

Hay dos paneles:

| Panel | Quién | Qué ve |
|---|---|---|
| **Panel completo** (`/panel`) | Tú en la PC del reloj (sin contraseña), o el usuario `admin` desde otra PC | Todo: conexiones, tokens, tarifas, montos, logs, usuarios, ajustes |
| **Panel de mods** (`/mod`) | Los moderadores que crees | El reloj, los multiplicadores y el historial (sin montos de dinero), con los permisos que les des. Tarifas, montos y comandos del chat solo si les das esos permisos 🔒 |

Para activarlo, en el panel completo → **Acceso remoto y usuarios**:

1. **Crea moderadores**: usuario, contraseña y permisos.
   - Básicos: iniciar/pausar, sumar/quitar, fijar tiempo, multiplicadores (hasta x5).
   - Sensibles 🔒 (apagados por defecto): ver y cambiar tarifas, ver montos de dinero, configurar comandos del chat.
   - Opcional: **Máximo que un mod puede sumar o quitar por acción**.
   - Conexiones, tokens, logs, usuarios, ajustes generales, reiniciar y apagar son siempre solo del dueño.
2. (Opcional) Pon la contraseña de **admin** si tú quieres entrar al panel completo desde otra PC.
3. Marca **Permitir entrar desde otra PC o el celular** → **Reiniciar ahora**.
4. Pasa a cada mod la dirección que aparece (ej. `http://192.168.1.20:3000`) y su usuario y contraseña. Al entrar, cada uno ve solo su panel.

- Si desactivas, eliminas o cambias la contraseña de un mod, su sesión se cierra al instante.
- Todo lo que hace un mod queda en el historial y en el log con su nombre.
- Fuera de tu casa, dos opciones:
  - **Tailscale** (gratis, privado): cada dispositivo instala [Tailscale](https://tailscale.com/download) y usa la dirección `100.x.x.x`. Ideal para ti.
  - **Link público con túnel** (lo más fácil para tus mods, no instalan nada): con el acceso remoto activado, ejecuta `cloudflared tunnel --url http://localhost:3000` ([Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), gratis) o `ngrok http 3000 --url=tu-dominio.ngrok-free.app` y comparte el link `https://…`. Todo lo que entra por el túnel pide usuario y contraseña. Usa contraseñas largas.
  - No abras puertos en el router.
- La primera vez Windows puede preguntar si Node.js puede usar la red: acepta solo en **redes privadas**.
- **OBS en otra PC**: `http://IP-de-la-PC-del-reloj:3000/overlay` (no pide contraseña, solo muestra el reloj).

## 3. Poner el reloj en OBS

1. En OBS: **Fuentes → + → Navegador**.
2. URL: `http://localhost:3000/overlay` · Ancho `900` · Alto `400`.

Ya viene animado: los números suben "rodando" cuando entra tiempo, cada tipo de aporte tiene su color e ícono (subs rosa, bits violeta, PayPal azul, Mercado Pago celeste), los aportes grandes (10 min o más) traen confeti y sacudón, con multiplicador activo el reloj brilla y el "x2" muestra un anillo con el tiempo que le queda, los últimos 10 minutos se ponen rojos y el último minuto late, y en pausa aparece **EN PAUSA** (o **VOLVEMOS PRONTO** con el stream apagado).

Puedes personalizarlo agregando opciones a la URL:

| Opción | Qué hace | Ejemplo |
|---|---|---|
| `theme` | Estilo: `default`, `glass` (tarjeta translúcida), `neon`, `minimal` | `theme=glass` |
| `color` | Color de los números | `color=ffcc00` |
| `accent` | Color del multiplicador, brillos y popups | `accent=ff4fa3` |
| `size` | Tamaño de los números (px) | `size=180` |
| `font` | Cualquier fuente de Google Fonts | `font=Anton` |
| `bg` | Fondo (por defecto transparente) | `bg=000000` |
| `recent=1` | Muestra los últimos 3 aportes debajo del reloj | |
| `total=1` | "La comunidad sumó X en este stream" | |
| `bar=1` | Barra de progreso hasta el tiempo máximo (si configuraste uno) | |
| `big` | Desde cuántos segundos un aporte es "grande" (confeti) | `big=900` |
| `warn` | Últimos N segundos en rojo (0 = nunca) | `warn=300` |
| `roll=0`, `popups=0`, `names=0`, `confetti=0`, `mult=0`, `status=0` | Apagan cada animación o cartel | |
| `end` | Texto cuando llega a 0 | `end=GRACIAS CHAT` |

Si activas `recent`, `total` o `bar`, sube el alto de la fuente de navegador en OBS a `500`.

### Sonidos

El overlay trae sonidos para cada evento: sub, bits, PayPal, Mercado Pago, aporte grande (fanfarria), multiplicador activado, tic-tac de los últimos 10 segundos, fin del subatón y (opcional) tiempo agregado a mano. Están generados por el propio reloj, así que no tienen derechos de autor.

- En el panel → **Sonidos del overlay**: activa o desactiva cada uno, cambia el volumen y usa **Probar** (suena en el panel) o **En OBS** (suena en el overlay).
- En OBS, en las propiedades de la fuente del overlay, marca **"Controlar audio mediante OBS"**: aparece en el mezclador como cualquier otra fuente y se escucha en el stream.
- **Sonidos propios:** pon archivos `mp3`, `wav`, `ogg` o `m4a` en la carpeta `sonidos` con estos nombres: `sub`, `bits`, `paypal`, `mercadopago`, `grande`, `multiplicador`, `final`, `fin`, `manual` (ej. `grande.mp3`). El panel marca cuáles son "propios".
- Si usas dos copias del overlay en OBS, agrega `?sound=0` a una para que no suene doble.

Ejemplo: `http://localhost:3000/overlay?theme=glass&accent=00e0a4&recent=1&total=1`

## 🎛️ Menú principal y "Pausar todo"

Al abrir el reloj (o en `http://localhost:3000/menu`) aparece el **Centro de control**: el estado del reloj, las conexiones, las metas del mes, los últimos aportes y una tarjeta por cada módulo con su botón **Abrir** (cada uno en su propia pestaña) y las URLs de sus overlays para copiar:

- **Reloj Subatón** (`/panel`): el reloj, multiplicadores, tiempo que suma cada cosa, sonidos del overlay, historial y **🧪 Probar** (plegable: tócalo para mostrarlo u ocultarlo; recuerda cómo lo dejaste).
- **Podio y Metas del mes** (`/podio-panel`).
- **⚙️ Configuración** (`/configuracion`): Stream y registros, Acceso remoto y usuarios, Conexiones y Comandos del chat. En esta guía, donde dice "en el panel → Conexiones / Comandos del chat / Acceso remoto / Stream", ahora está aquí.
- **Panel de moderadores** (`/mod`).

- **⏸ Pausar todo:** detiene el reloj, pero **sigue escuchando** Twitch, PayPal y Mercado Pago. Cada sub, bit o donación que llegue cuenta para el podio y las metas, y con la casilla marcada también suma tiempo, que queda guardado para el próximo stream. En pausa puedes cerrar el menú y el panel: el reloj queda trabajando en segundo plano.
- **▶ Reanudar:** vuelve todo a como estaba. También se reanuda solo cuando empiezas un stream o si alguien inicia el reloj (panel, mods o `!iniciar`).
- **Apagar por completo:** cierra el reloj y deja de escuchar hasta que lo abras otra vez con `iniciar.bat`.

Para seguir escuchando, la PC tiene que estar prendida. Si la apagas, al volver a abrir el reloj Mercado Pago recupera los pagos aprobados mientras tanto (revisa los últimos 50 pagos y no cuenta ninguno dos veces), pero los subs, bits y propinas de StreamElements que llegaron con la PC apagada no se recuperan.

**Agregar un módulo nuevo:** se suma una entrada en `src/modulos.js` (nombre, ícono, color, descripción, página del panel y overlays) y aparece sola en el menú.

## 🦆 Lluvia de patitos

Cuando donan por **Mercado Pago** caen patitos **amarillos** y por **PayPal** patitos **verdes**, repartidos por toda la pantalla. Rebotan y se apilan abajo, mezclados.

- En OBS: Fuente → Navegador → `http://localhost:3000/patitos`, tamaño **1920 × 1080** (pantalla completa, encima del juego).
- Todo se configura en el panel del podio, sección 🦆:
  - **Por cada X USD caen Y patitos** (proporcional; Mercado Pago se convierte a USD). Ej.: 5 USD → 10 patitos, entonces 10 USD → 20 y 2,50 USD → 5.
  - **Duración en pantalla (min):** si pasa ese tiempo sin donaciones, los patitos se van. Con la próxima donación vuelven a caer **todos los acumulados** más los nuevos. Con 0 no se van nunca.
  - **Tope por donación** y **máximo en pantalla** (si hay más, los más viejos se desvanecen).
  - **Acumulados:** cuántos amarillos y verdes se juntaron. **Vaciar acumulados** los pone en cero.
  - **Empezar de cero en cada stream nuevo** (activado): los acumulados vuelven a cero cuando empiezas un stream. Si el stream **se corta y vuelve** antes del margen (30 min por defecto), o el programa se cae en medio del stream, **siguen los mismos patitos**.
- Los botones **Probar** tiran patitos (como una donación de 5 USD) pero no se acumulan, no suman tiempo ni cuentan para el podio. Las pruebas del simulador del reloj tampoco se acumulan.
- Si recargas la fuente o reinicias OBS antes de que pase la duración, los patitos siguen en pantalla.
- Opciones en la URL: `desde=420&hasta=1500` (que caigan solo en esa franja) y `tam=24` (tamaño).

## 💬 Mensajes automáticos en el chat (bot)

No aparece en el menú. Se prende y se apaga **desde el chat de Twitch**:

- `activar bot` → empieza a mandar un mensaje **cada 10 minutos**, de a uno y en orden (rotando).
- `desactivar bot` → deja de mandarlos.
- Solo pueden hacerlo **Nephallems** y tú (el dueño del canal). El bot responde en el chat para confirmar.
- Solo manda mensajes con el stream en vivo y nunca durante el descanso.
- Los mensajes salen desde tu cuenta de Twitch. Si no escribe nada, en Configuración pulsa Desconectar y vuelve a Conectar con Twitch.

**Editar los mensajes:** abre a mano la dirección `http://localhost:3000/automensajes-panel` (con el puerto de tu reloj). Ahí agregas, editas o borras mensajes, pones emotes y `{tiempo}` (lo que queda en el reloj), cambias los 10 minutos y quiénes pueden activarlo.

## 🔄 Actualizaciones automáticas

El reloj se actualiza solo desde GitHub: [github.com/netbiosop/netbiosop-reloj-subaton](https://github.com/netbiosop/netbiosop-reloj-subaton).

- **Cuándo:** solo **al abrir** el reloj con `iniciar.bat`, si no estaba funcionando. Nunca en medio de un stream. Si no hay internet o GitHub no responde, arranca igual con la versión que tienes.
- **Qué toca:** solo los archivos del programa. **Nunca toca** `data` (subs, bits, donaciones, podio, metas, ajustes, conexiones), `logs`, `sonidos`, `videos` ni las copias de seguridad. Antes de actualizar hace una copia de seguridad de tus datos por las dudas.
- **Cómo:** baja la versión nueva a una carpeta aparte, revisa que llegó completa y recién ahí reemplaza el programa. La versión anterior queda en la carpeta `.version-anterior`.
- **Menú → 🔄 Actualizaciones:** ves tu versión, puedes **Buscar ahora**, **Instalar ahora** (el reloj se cierra unos segundos y vuelve solo) y apagar la actualización automática. Después de actualizar te muestra qué cambió.

## 💾 Copias de seguridad automáticas

Tus subs, bits, donaciones, el podio, las metas y los ajustes se copian solos **fuera de la carpeta del reloj**, en `Documentos\Reloj Subaton - Respaldos`. Si tus Documentos están en OneDrive, las copias además quedan en la nube.

- **Cuándo copia:** cada vez que entra una donación, sub o bits (si llegan varios juntos, por ejemplo una lluvia de subs regaladas, espera 5 segundos y hace una sola copia con todo). También al abrir el reloj, al terminar cada stream y al cerrar. Copia además los registros (`logs`) de cada stream. Las pruebas del panel no generan copias.
- **Cuántas guarda:** las últimas 100 copias y una por día de los últimos 60 días. Las viejas se borran solas.
- **Recuperación automática:** si al abrir el reloj falta un archivo o está dañado, lo recupera solo de la última copia buena. Si instalas una versión nueva en otra carpeta, también recupera todo solo.
- **Panel:** menú → **Copias de seguridad**. Ahí puedes hacer una copia en el momento, abrir la carpeta, elegir otra carpeta, sumar una **segunda carpeta** (un pendrive, otro disco o Google Drive) y **volver a una copia anterior**. Restaurar reinicia el reloj y antes guarda cómo estaba, por si te arrepientes.

## 🚂 Tren del hype

Cuando arranca un tren del hype en Twitch, cruza la pantalla una locomotora con bocina y confeti. Después queda una barra con el tren, el nivel, el progreso, el tiempo que falta y los 3 que más aportan.

- **Cada nivel** suma un vagón, cambia el color, la música sube de ritmo y tono, y el festejo crece: nivel 2 chispas, 3 confeti, 4 fuegos artificiales, 5 destello con pantalla que tiembla y monedas, 6+ todo junto en arcoíris. Si superas el récord del canal sale **¡NUEVO RÉCORD!**
- **El tiempo del tren** es el mismo que muestra Twitch: el reloj se calibra solo con la hora de Twitch, aunque la hora de Windows esté corrida (si lo está, la ventana del reloj te avisa). Los espectadores ven el video con unos segundos de retraso respecto del chat, así que una diferencia de pocos segundos con el cartel de Twitch es normal.
- **Al terminar** sale "¡Tren completado!" con el nivel, los puntos y el podio de los 3 que más aportaron.
- **Panel:** menú → **Tren del hype** (`/hype-panel`). Botones para probar (empieza, suma puntos, sube de nivel, termina), volumen, música y efectos por separado, barra arriba o abajo, título.
- **OBS:** fuente de navegador `http://localhost:3000/hype`, 1920 × 1080, **arriba de todo**, con **"Controlar audio a través de OBS"** marcado para que la música salga en el stream.
- **Twitch:** necesita un permiso nuevo. Si ya estabas conectado, en **Configuración → Conexiones** pulsa **Desconectar** y vuelve a **Conectar con Twitch**.
- **Tren futurista con tu canción:** el tren es un maglev de neón que levita sobre un riel de luz, con barra holográfica, celdas de energía y ecualizador. Con tu `hype-inicio.mp3` (128 BPM) suena desde el principio: el tren entra en el golpe fuerte (2 s), la barra aparece en el siguiente (9,5 s), todo late a cada golpe, los festejos de nivel caen justo en el golpe y en el drop (32 s) sale **⚡ OVERDRIVE ⚡**. Mientras dura el tren, la canción repite la parte de 17 s a 47 s sin cortes y, al terminar, salta a los 47 s para cerrar. Se activa y se ajusta en el panel → *Canción sincronizada*. **Puedes usar cualquier canción:** en el panel → *Canción del tren* elígela de tu carpeta `sonidos` o tócala en **⬆️ Subir canción**. El reloj la mide sola en unos segundos (ritmo, golpes fuertes, drops, la parte que se repite y el final) y te muestra los tiempos. Si algo no te convence, **🔄 Volver a medir** o ajústalo a mano en *Ajustar los tiempos a mano*.
- **Sonidos uno por uno:** en el panel puedes apagar por separado el sonido de inicio, la fanfarria de nivel, los sonidos chicos, el final y la música. Si tu `hype-inicio.mp3` es largo, deja marcado **"Mientras suena mi sonido de inicio, que no suene nada más"**: nada lo pisa y la música de fondo arranca cuando termina. Si el tren termina antes, el inicio se apaga suave y suena el final.
- **Música propia (opcional):** pon en la carpeta `sonidos` archivos llamados `hype-musica.mp3` (de fondo, se repite y se acelera con el nivel), `hype-inicio.mp3`, `hype-nivel.mp3` o uno por nivel (`hype-nivel2.mp3`, `hype-nivel3.mp3`…) y `hype-fin.mp3`. Los que no estén se generan solos.

## ⭐ Código de creador (tarjeta y cinta de noticias)

Reemplaza el cuadro azul de Fortnite por una tarjeta animada con tu estilo. Entra deslizándose, el código se escribe solo, un puntero aprieta **ACEPTAR**, sale "¡Gracias por apoyarme!" y vuelan monedas. Abajo pasa una **cinta de noticias** con el código de cada plataforma y tus mensajes.

- Se configura en el menú → **Código de creador** (o `http://localhost:3000/codigo-panel`).
- **Plataformas:** agrega, edita, ordena o desactiva las que quieras (juego, dónde se usa, código y un aviso chico). La tarjeta y la cinta rotan entre las activas. Epic pide aclarar que recibes una comisión: déjalo en el aviso.
- **Cada cuánto:** la tarjeta y la cinta tienen cada una su "cada X minutos" y "cuántos segundos queda". Nunca salen las dos juntas. Con 0 minutos solo salen con **▶ Mostrar ahora**.
- **Cinta estilo noticiero:** a la izquierda dice **URGENTE** con una luz que titila (cámbialo por NEWS o lo que quieras en *Etiqueta*). La **velocidad** viene en 55: más bajo es más lento.
- **Mensajes de la cinta:** agrega los que quieras. Lo que pongas entre `*asteriscos*` sale resaltado en rojo.
- Mientras pasa la cinta, "Reyes del mes pasado" se esconde para no taparse, y vuelve después (se puede apagar).
- Por defecto solo salen **en vivo** y nunca con **Pausar todo**.

## 🏆 Podio mensual (Top donadores, subs regaladas y bits)

El reloj arma solo un **podio del mes** con los aportes que registra; no hay que cargar nada a mano.

- **Donaciones:** PayPal y Mercado Pago se suman en **un solo ranking en dólares**. Mercado Pago se convierte con la cotización del momento en que llegó cada donación (automática, o la que pongas tú en el panel del podio, por ejemplo el dólar blue).
- **Subs regaladas:** cuenta cuántas regaló cada persona. Las subs propias y los resubs no entran.
- **Bits:** total de bits de cada persona.
- Las **pruebas** del simulador no cuentan.
- Va del **día 1 al último día de cada mes** (hora de tu PC). Al empezar un mes nuevo el podio queda en cero solo, y los #1 del mes que terminó pasan al overlay **Reyes del mes pasado**.

Panel: botón **🏆 Podio** arriba en el panel del reloj, o `http://localhost:3000/podio-panel`. Ahí ves el ranking de cada mes, los reyes, la conversión a dólares y los títulos. También puedes **agregar a mano** una transferencia que el reloj no detectó, **cambiar el nombre** de un aporte (si Mercado Pago lo trajo como "Juan" y en Twitch es "juancho99", así se suman juntos) o **quitarlo** del podio. Nada de esto cambia el tiempo del reloj. En el **ranking**, el botón ✏️ de cada fila le cambia el nombre a esa persona en todos sus aportes del mes (por ejemplo "Donación Mercado Pago" → su usuario de Twitch); si pones un nombre que ya está, se suman juntos. Los **reyes del mes pasado** se calculan solos, pero con **Editar** / **Agregar** puedes ponerlos a mano y con **Automático** vuelven al cálculo normal.

Overlays para OBS (Fuente → Navegador). Todos tienen **fondo transparente** y el mismo estilo:

| Overlay | URL | Tamaño |
|---|---|---|
| Metas del mes | `http://localhost:3000/metas` | 320 × 190 |
| Podio del mes (rota Donadores → Subs → Bits) | `http://localhost:3000/podio` | 320 × 200 |
| Top General del mes (el #1 de cada categoría) | `http://localhost:3000/top-general` | 360 × 200 |
| Reyes del mes pasado | `http://localhost:3000/reyes` | 380 × 140 |

**Metas del mes:** se llenan solas. *Subs* cuenta todas las subs del mes (nuevas, resubs y regaladas), *Bits* los bits y *Donado* PayPal + Mercado Pago en USD. En el panel del podio pones la meta de cada una, el nombre que se ve, y en "Ya tenías" lo que llevabas este mes antes de usar el reloj (solo cuenta para ese mes). Cuando una meta se cumple, la barra se pone dorada con confeti.

Opciones: `?escala=1.3` para agrandar, `?repetir=60` para repetir la animación de entrada cada 60 s, y en el podio `?cat=dinero`, `?cat=subs` o `?cat=bits` para fijar una categoría. Los datos se guardan en `data/podio.json`.

## 4. Configurar tiempos y multiplicadores

En el panel, sección **"Tiempo que suma cada cosa"**:

- **Por cada X monto suma Y tiempo.** Ej: por cada `1 USD` suma `1:00`, por cada `1000 ARS` suma `1:00`, por cada `100 bits` suma `1:00`.
- **Proporcional:** 2.5 USD suman 2:30. Si lo apagas, solo cuentan bloques completos (2:00).
- **Mínimo:** donaciones por debajo no suman.
- **Subs:** tiempo distinto para Tier 1 (incluye Prime), Tier 2 y Tier 3. Las subs regaladas suman por cada sub.
- Los tiempos se escriben como `5` (5 minutos), `1:30` (1 min 30 s) o `1:00:00` (1 hora).

**Multiplicador:** elige x2, x3, x4, x5 u otro valor, marca a qué aplica (PayPal, Mercado Pago, Bits, Subs) y:
- **Activar ahora** por 10 / 15 / 30 / 60 / 120 minutos o hasta que lo apagues, o
- **Programar** con fecha y hora de inicio y fin (ej. "x2 en subs el sábado de 20:00 a 22:00").

El overlay muestra "x2 BITS · SUBS 14:59" mientras está activo.

**Horas diarias automáticas:** si haces streams de horas fijas por día (ej. 4 horas), activa la opción y escribe las horas. Cada vez que termina el stream, el reloj suma solo esas horas al tiempo que haya quedado, aunque esté en 0, y arrancas el próximo stream con todo junto. Con **Solo una vez por día** (activado por defecto), si el stream se corta y vuelves el mismo día no se suman de nuevo. El botón **+ Sumar ahora** las suma a mano en cualquier momento. Queda anotado en el historial y en el log.

**Tiempo máximo restante:** si lo pones (ej. `24:00:00`), el reloj nunca pasa de ese tiempo restante.

Usa **Probar** para simular donaciones y ver cómo queda en OBS antes del directo.

---

## 5. Conectar Twitch (Bits y Subs)

No necesita abrir puertos ni túneles.

1. Entra a <https://dev.twitch.tv/console/apps> → **Registrar aplicación**.
2. Nombre: lo que quieras (ej. `Reloj subaton TuCanal`).
3. URL de redireccionamiento OAuth: `http://localhost:3000/auth/twitch/callback`
4. Categoría: **Broadcaster Suite** · Tipo de cliente: **Confidencial**.
5. Copia el **Client ID**, pulsa **Nuevo secreto** y copia el **Client Secret**.
6. En el panel → Conexiones → Twitch: pégalos, **Guardar**, y luego **Conectar con Twitch** (inicia sesión con la cuenta del canal).

Cuando el chip "Twitch" se pone verde, ya escucha Bits, subs nuevas, resubs y subs regaladas.

> Bits y Subs solo existen en canales afiliados o partner.

### Comandos del chat (tú, mods y supermods)

En el panel, sección **Comandos del chat**, eliges quién puede controlar el reloj: moderadores líderes (supermods), todos los mods, VIPs y/o una lista de usuarios. Tú, como dueño del canal, siempre puedes.

| Comando | Qué hace |
|---|---|
| `!tiempo` o `!reloj` | Muestra el tiempo que queda (puede usarlo cualquiera, si lo activas) |
| `!sumar 10` | Suma 10 minutos (acepta `1:30`, `2h`, `45s`, `1h30m`) |
| `!quitar 5` | Quita 5 minutos |
| `!fijar 3:00:00` | Deja el reloj en un tiempo exacto |
| `!pausa` / `!iniciar` | Pausa o reanuda el reloj |
| `!x2 30` | x2 en todo durante 30 minutos (sin minutos: hasta apagarlo) |
| `!x3 15 subs bits` | x3 solo en subs y bits por 15 min (también `paypal`, `mp`) |
| `!multioff` o `!x1` | Apaga el multiplicador |
| `!mp.add @usuario` | La última donación de Mercado Pago pasa a ser de ese usuario de Twitch en el podio. Las próximas de esa misma persona ya llegan con su nombre. Con monto (`!mp.add @usuario 1500`) elige la de ese monto. |
| `!comandos` | Lista los comandos en el chat |

Todo lo que hacen los mods queda en el historial con su nombre. Con **Máximo por comando** limitas cuánto pueden sumar o quitar de una vez. El reloj responde en el chat con tu cuenta.

> Si conectaste Twitch antes de tener los comandos: pulsa **Desconectar** y **Conectar con Twitch** de nuevo para dar el permiso de leer y escribir en el chat.

## 6. Conectar Mercado Pago

1. Entra a <https://www.mercadopago.com/developers/panel/app> → **Crear aplicación** (tipo "Pagos online").
2. Ve a **Credenciales de producción** y copia el **Access Token** (`APP_USR-…`).
3. En el panel → Mercado Pago: pega el token, deja el modo **"Revisar pagos"** y pulsa **Guardar y conectar**.

En modo "Revisar pagos" el reloj consulta tus pagos recibidos cada 15 segundos — **no necesitas túnel**. Solo cuenta pagos **aprobados**, que **recibes tú**, y hechos **después** de conectar o de "Reiniciar subatón".

Para que te donen, comparte un **link de pago** o tu QR de Mercado Pago.

> ⚠️ Haz una prueba real con un monto chico antes del subatón. Según el país, algunas transferencias bancarias directas (CVU/alias) pueden no aparecer como "pagos" en la API de Mercado Pago. Si una donación no aparece, súmala a mano con los botones +.

**Moneda:** pon en la tarifa la moneda de tu cuenta (`ARS`, `MXN`, `CLP`, `COP`, `BRL`, `PEN`, `UYU`…).

### Nombre de quien dona por Mercado Pago

El reloj busca el nombre en todos los lugares donde Mercado Pago lo pone (transferencias, dinero en cuenta, tarjeta) y, si la lista de pagos viene sin nombre, pide el pago completo.

- **Cómo se muestra:** en *Configuración → Conexiones → Mercado Pago → Nombre de quien dona* eliges **Nombre e inicial** ("Juan P.", por defecto, cuida la privacidad), **Solo el nombre** o **Nombre completo**.
- **Vincular con el usuario de Twitch:** escribe en el chat `!mp.add @usuario` (tú o tus mods) y la última donación de Mercado Pago pasa a ser de ese usuario. Desde ahí, las próximas donaciones de esa misma persona ya entran con su nombre de Twitch. También funciona si quien dona escribe su `@usuario` en el motivo de la transferencia.
- **Si igual llega como "Donación Mercado Pago"** (Mercado Pago no mandó el nombre): ponle el nombre en el podio con ✏️ y **se recuerda**. La próxima donación de esa misma persona ya entra con ese nombre.

## 7. Conectar PayPal

### Opción recomendada: con StreamElements (si tu PayPal ya está en tu página de propinas de StreamElements)

No necesita túnel ni configurar nada en PayPal.

1. Entra a <https://streamelements.com/dashboard>.
2. Clic en tu **foto de perfil** (arriba a la derecha) → **tu nombre de canal** → **Show secrets** (Mostrar secretos).
3. Copia el **JWT Token**.
4. En el panel → Conexiones → PayPal → pégalo en **JWT Token de StreamElements** → **Guardar y conectar**.

Cuando el chip "PayPal" diga *Conectado vía StreamElements*, cada propina aprobada suma tiempo con la tarifa de **PayPal** (pon en la tarifa la misma moneda que usa tu página de StreamElements, por ejemplo `USD`). En el historial aparecen como "Lucía donó 5 USD (vía StreamElements)".

> El JWT Token da acceso a tu cuenta de StreamElements: no lo muestres en stream. Si lo regeneras en StreamElements, pégalo de nuevo en el panel.
> Las "alertas de prueba" del panel de StreamElements pueden no llegar al reloj; para probar usa el simulador del panel o una propina real chica.

### Otras opciones: PayPal directo (sin StreamElements)


PayPal solo avisa a una dirección de internet, así que necesitas un **túnel** que conecte internet con tu PC. Solo se expone el puerto **3001** (los webhooks); el panel queda privado en tu PC.

### Crear el túnel (ngrok, gratis)

1. Crea una cuenta en <https://ngrok.com>, instala ngrok y conecta tu cuenta (`ngrok config add-authtoken …`).
2. En el panel de ngrok, reclama tu **dominio estático gratis** (así la URL no cambia cada vez).
3. Antes de cada directo ejecuta: `ngrok http 3001 --url=tu-dominio.ngrok-free.app`
4. Pega `https://tu-dominio.ngrok-free.app` en el panel → PayPal → **URL pública del túnel**.

(También sirve Cloudflare Tunnel apuntando a `http://localhost:3001`.)

### Opción A — IPN (botón "Donar" de PayPal) · la más simple

1. En PayPal: **Configuración de la cuenta → Notificaciones → Notificaciones de pago instantáneas → Actualizar**.
2. URL: `https://tu-dominio.ngrok-free.app/webhooks/paypal-ipn` → **Recibir mensajes IPN (habilitado)**.
3. En el panel escribe **tu email de PayPal** (para ignorar avisos de otras cuentas) y pulsa Guardar.

Cada aviso se confirma con PayPal antes de sumar tiempo, así nadie puede falsificarlo.

### Opción B — Webhooks REST (si cobras con PayPal Checkout)

1. En <https://developer.paypal.com/dashboard/applications/live> crea una app.
2. Añade un webhook con la URL `https://tu-dominio.ngrok-free.app/webhooks/paypal` y los eventos **Payment capture completed** y **Payment sale completed**.
3. Copia **Client ID**, **Secret** y **Webhook ID** al panel.

> ⚠️ Prueba con una donación real chica. Según el tipo de cuenta y cómo te paguen, algunos envíos "entre amigos" pueden no generar aviso; si una donación no aparece, súmala a mano.

---

## Preguntas frecuentes

**¿Qué pasa si se corta la luz o cierro el programa?** El tiempo restante se guarda cada 5 s. Al abrir de nuevo queda en pausa con ese tiempo. Si en ese momento ya estás en vivo, se reanuda solo (si tienes activada la reanudación automática); si no, pulsa ▶ Iniciar.

**¿Se cuenta dos veces una donación?** No: cada pago/evento tiene un ID y se ignora si ya se contó.

**¿Las pruebas cuentan?** Suman tiempo al reloj (para verlas en OBS) pero no entran en los totales. Después usa "Fijar en" para dejar el tiempo como estaba.

**¿Dónde se guarda todo?** En `data/subaton.json`, solo en tu PC. Ahí también están tus tokens: **no compartas esa carpeta**.

**¿Puedo abrir el panel desde el celular?** Por seguridad el panel solo funciona en tu PC. Si lo necesitas en la red de tu casa, abre con `HOST=0.0.0.0` (cualquiera en tu wifi podrá controlarlo).

**¿Cambiar los puertos?** Variables `PORT` (panel, 3000) y `WEBHOOK_PORT` (webhooks, 3001). Si cambias `PORT`, cambia también la URL de redirección en Twitch.
