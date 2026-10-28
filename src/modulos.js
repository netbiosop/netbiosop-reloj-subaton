// Módulos que aparecen en el menú principal (/menu).
// Para agregar un módulo nuevo: suma un objeto a esta lista y reinicia el reloj.
//   id        identificador único (sin espacios)
//   nombre    título de la tarjeta
//   icono     un emoji
//   color     color de acento de la tarjeta
//   desc      una línea que explica para qué sirve
//   panel     página donde se configura (se abre al tocar la tarjeta)
//   overlays  fuentes de navegador para OBS: { nombre, url, tam }
//   proximamente: true  → tarjeta en gris, todavía sin panel
module.exports = [
  {
    id: 'reloj',
    nombre: 'Reloj Subatón',
    icono: '⏱️',
    color: '#a77bff',
    desc: 'El reloj, multiplicadores, tiempo que suma cada cosa, sonidos del overlay, historial y pruebas.',
    panel: '/panel',
    overlays: [{ nombre: 'Reloj (alineado a la izquierda)', url: '/overlay?align=left&pops=right&size=84', tam: '900 × 150' }],
  },
  {
    id: 'podio',
    nombre: 'Podio y Metas del mes',
    icono: '🏆',
    color: '#FFD54A',
    desc: 'Top donadores, subs regaladas y bits del mes, metas que se llenan solas y los reyes del mes pasado.',
    panel: '/podio-panel',
    overlays: [
      { nombre: 'Metas del mes', url: '/metas', tam: '306 × 210' },
      { nombre: 'Podio del mes', url: '/podio', tam: '306 × 215' },
      { nombre: 'Top General', url: '/top-general', tam: '306 × 215' },
      { nombre: 'Reyes del mes pasado', url: '/reyes', tam: '640 × 110' },
    ],
  },
  {
    id: 'patitos',
    nombre: 'Lluvia de patitos',
    icono: '🦆',
    color: '#FFD93B',
    desc: 'Cuando donan por Mercado Pago caen patitos amarillos y por PayPal verdes, y se apilan abajo mezclados (1 por dólar).',
    panel: '/podio-panel#patitos',
    overlays: [{ nombre: 'Lluvia de patitos (pantalla completa)', url: '/patitos', tam: '1920 × 1080' }],
  },
  {
    id: 'codigo',
    nombre: 'Código de creador',
    icono: '⭐',
    color: '#e3121b',
    desc: 'Tarjeta animada "Apoya a un creador" (Fortnite en Epic y otras plataformas) y cinta de noticias abajo, cada X minutos.',
    panel: '/codigo-panel',
    overlays: [
      { nombre: 'Tarjeta "Apoya a un creador"', url: '/codigo-tarjeta', tam: '520 × 230' },
      { nombre: 'Cinta de noticias (abajo, todo el ancho)', url: '/codigo-cinta', tam: '1920 × 60' },
    ],
  },
  {
    id: 'hype',
    nombre: 'Tren del hype',
    icono: '🚂',
    color: '#ff7a1a',
    desc: 'Cuando arranca el tren del hype en Twitch: entrada animada, barra con vagones, un festejo distinto y más música en cada nivel.',
    panel: '/hype-panel',
    overlays: [{ nombre: 'Tren del hype (pantalla completa)', url: '/hype', tam: '1920 × 1080' }],
  },
  {
    id: 'automensajes',
    nombre: 'Mensajes automáticos',
    icono: '💬',
    color: '#5ab0ff',
    desc: 'Mensajes con emotes que se escriben solos en tu chat cada X minutos. Se prenden y apagan con un botón.',
    panel: '/automensajes-panel',
    overlays: [],
    oculto: true, // no sale en el menú: se activa desde el chat ("activar bot") y el panel se abre en /automensajes-panel
  },
  {
    id: 'respaldo',
    nombre: 'Copias de seguridad',
    icono: '💾',
    color: '#3ddc97',
    desc: 'Copias automáticas de subs, bits, donaciones, podio y ajustes fuera de la carpeta del reloj. Si algo se borra, se recupera solo.',
    panel: '/respaldo-panel',
    overlays: [],
  },
  {
    id: 'config',
    nombre: 'Configuración',
    icono: '⚙️',
    color: '#9a96ab',
    desc: 'Stream y registros, acceso remoto y usuarios, conexiones (Twitch, PayPal, Mercado Pago) y comandos del chat.',
    panel: '/configuracion',
    overlays: [],
  },
  {
    id: 'mods',
    nombre: 'Panel de moderadores',
    icono: '🛡️',
    color: '#4aa3ff',
    desc: 'Lo que ven tus mods desde otra PC o el celular. Los usuarios y permisos se crean en Configuración → Acceso remoto.',
    panel: '/mod',
    overlays: [],
  },
];
