// El overlay se agranda o achica solo para llenar el Ancho × Alto que le pongas a la fuente en OBS
// (sin deformarse: usa el lado que limite). Con ?escala=1.2 en la URL queda fijo a esa escala, como antes.
window.ajustarAlTamano = function (el, fija, alCambiar) {
  // la página ocupa toda la fuente: si no, lo agrandado se cortaba al alto original
  if (el !== document.body) document.body.style.minHeight = '100vh';
  if (fija > 0) { el.style.transform = `scale(${fija})`; return; }
  document.documentElement.style.overflow = 'hidden';
  let ultima = 0;
  const ajustar = () => {
    const w = el.offsetWidth, h = el.offsetHeight; // medidas sin la escala aplicada
    if (!w || !h) return;
    const s = Math.max(0.2, Math.min(innerWidth / w, innerHeight / h));
    if (Math.abs(s - ultima) < 0.005) return;
    ultima = s;
    el.style.transform = `scale(${s})`;
    alCambiar && alCambiar(s);
  };
  addEventListener('resize', ajustar);
  addEventListener('load', ajustar);
  document.fonts && document.fonts.ready.then(ajustar);
  if ('ResizeObserver' in window) new ResizeObserver(ajustar).observe(el);
  ajustar();
};
