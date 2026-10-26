// Íconos animados compartidos por los overlays (Podio, Top General…), iguales a los de Metas del mes.
//   Iconos.svg('subs' | 'bits' | 'dinero')  → HTML del ícono
//   Iconos.abrir(el)   → el regalo gira, se desata el moño, salta la tapa y sale confeti
//   Iconos.contar(el)  → los billetes se pasan como contando plata
//   Iconos.auto(raiz)  → regalo cada 5 min (?regalo=segundos) y billetes cada 7 s, dentro de "raiz"
(function () {
  const css = `
  .ic{position:relative;display:inline-block;width:28px;height:28px;vertical-align:middle;filter:drop-shadow(0 1px 1px #000) drop-shadow(0 0 1px #000)}
  .ic svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
  .ic svg *{transform-box:fill-box}
  .ic .regalo .caja,.ic .regalo .tapa{transform-origin:50% 100%}
  .ic .regalo .lazoI{transform-origin:100% 100%} .ic .regalo .lazoD{transform-origin:0% 100%}
  .ic .regalo .nudo,.ic .regalo .colas{transform-origin:50% 50%}
  .ic .regalo.abrir{animation:ic-girar 3.2s ease both}
  .ic .regalo.abrir .caja{animation:ic-sacudir 3.2s ease both}
  .ic .regalo.abrir .tapa{animation:ic-tapa 3.2s cubic-bezier(.3,1.4,.5,1) both}
  .ic .regalo.abrir .lazoI{animation:ic-lazoI 3.2s ease both}
  .ic .regalo.abrir .lazoD{animation:ic-lazoD 3.2s ease both}
  .ic .regalo.abrir .nudo,.ic .regalo.abrir .colas{animation:ic-nudo 3.2s ease both}
  .ic .diamante{animation:ic-latido 2.4s ease-in-out infinite}
  .ic .diamante .reflejo{animation:ic-reflejo 3s ease-in-out infinite}
  .ic .diamante .chispa{transform-origin:50% 50%;animation:ic-chispa 2.1s ease-in-out infinite;opacity:0}
  .ic .diamante .k2{animation-delay:.5s} .ic .diamante .k3{animation-delay:1.05s} .ic .diamante .k4{animation-delay:1.55s}
  .ic .billetes .b{transform-origin:10% 100%}
  .ic .billetes.contar{animation:ic-mano 2.2s ease}
  .ic .billetes.contar .b3{animation:ic-pasar 1.6s ease both}
  .ic .billetes.contar .b2{animation:ic-pasar 1.6s .22s ease both}
  .ic .billetes.contar .b1{animation:ic-pasar 1.6s .44s ease both}
  .ic .billetes .moneda{opacity:0}
  .ic .billetes.contar .moneda{animation:ic-moneda 1.8s .5s ease-out both}
  .ic .ic-confeti{position:absolute;left:50%;top:50%;width:5px;height:8px;border-radius:2px;pointer-events:none;z-index:5}
  @keyframes ic-girar{0%{transform:perspective(80px) rotateY(0)}14%,100%{transform:perspective(80px) rotateY(360deg)}}
  @keyframes ic-sacudir{14%,100%{transform:none}17%{transform:rotate(-9deg)}20%{transform:rotate(8deg)}23%{transform:rotate(-6deg)}26%{transform:rotate(4deg)}29%{transform:none}}
  @keyframes ic-lazoI{0%,30%{transform:none;opacity:1}44%,86%{transform:translate(-5px,-3px) rotate(-70deg) scale(.6);opacity:0}100%{transform:none;opacity:1}}
  @keyframes ic-lazoD{0%,30%{transform:none;opacity:1}44%,86%{transform:translate(5px,-3px) rotate(70deg) scale(.6);opacity:0}100%{transform:none;opacity:1}}
  @keyframes ic-nudo{0%,32%{transform:none;opacity:1}42%,86%{transform:scale(0);opacity:0}100%{transform:none;opacity:1}}
  @keyframes ic-tapa{0%,42%{transform:none}54%{transform:translateY(-10px) rotate(-18deg)}74%{transform:translateY(-9px) rotate(-14deg)}88%{transform:none}92%{transform:translateY(-1px)}100%{transform:none}}
  @keyframes ic-latido{0%,100%{filter:drop-shadow(0 0 2px rgba(227,18,27,.45))}50%{filter:drop-shadow(0 0 8px rgba(255,74,82,1))}}
  @keyframes ic-reflejo{0%,40%{transform:translateX(-26px)}75%,100%{transform:translateX(26px)}}
  @keyframes ic-chispa{0%,100%{opacity:0;transform:scale(.2) rotate(0)}45%{opacity:1;transform:scale(1) rotate(45deg)}70%{opacity:0;transform:scale(.3) rotate(90deg)}}
  @keyframes ic-pasar{0%{transform:none}25%{transform:translateY(-3px) rotate(-14deg)}45%{transform:translate(9px,-5px) rotate(18deg);opacity:1}55%{opacity:0}75%{transform:none;opacity:0}100%{transform:none;opacity:1}}
  @keyframes ic-mano{0%,100%{transform:none}20%{transform:rotate(-6deg)}60%{transform:rotate(4deg)}}
  @keyframes ic-moneda{0%{opacity:0;transform:translateY(0)}20%{opacity:1}100%{opacity:0;transform:translateY(-16px)}}`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  let n = 0;
  const SVG = {
    subs: () => `<svg class="regalo" viewBox="0 0 32 32">
      <g class="caja"><rect x="5" y="14" width="22" height="15" rx="2" fill="#f1f1f3" stroke="#3a0003" stroke-width="1.2"/>
        <rect x="14.2" y="14" width="3.6" height="15" fill="#e3121b"/><rect x="5" y="14" width="22" height="3" fill="rgba(0,0,0,.18)"/></g>
      <g class="tapa"><rect x="3.5" y="9.5" width="25" height="5.5" rx="1.6" fill="#ffffff" stroke="#3a0003" stroke-width="1.2"/>
        <rect x="14.2" y="9.5" width="3.6" height="5.5" fill="#e3121b"/>
        <g class="colas"><path d="M15 9.6 L12.5 13.5 M17 9.6 L19.5 13.5" stroke="#8e0a10" stroke-width="1.6" stroke-linecap="round"/></g>
        <path class="lazoI" d="M16 9.4 C12 3.5 6.8 5.2 8.2 8.4 C9.2 10.6 13 10 16 9.4 Z" fill="#e3121b" stroke="#4a0408" stroke-width="1"/>
        <path class="lazoD" d="M16 9.4 C20 3.5 25.2 5.2 23.8 8.4 C22.8 10.6 19 10 16 9.4 Z" fill="#e3121b" stroke="#4a0408" stroke-width="1"/>
        <circle class="nudo" cx="16" cy="9.4" r="2.1" fill="#ff4a52" stroke="#4a0408" stroke-width="1"/></g>
    </svg>`,
    bits: () => {
      const id = 'gema' + ++n; // cada diamante con su propio recorte
      return `<svg class="diamante" viewBox="0 0 32 32">
      <defs><clipPath id="${id}"><path d="M9 7 H23 L28 13 L16 28 L4 13 Z"/></clipPath></defs>
      <path d="M9 7 H23 L28 13 L16 28 L4 13 Z" fill="#d0101a"/>
      <path d="M4 13 H28 L16 28 Z" fill="#b30d16"/>
      <path d="M9 7 L12 13 L16 7 Z M16 7 L20 13 L23 7 Z" fill="#ffb3b8"/>
      <path d="M12 13 L16 7 L20 13 Z" fill="#ff6a72"/>
      <path d="M4 13 L12 13 L16 28 Z" fill="#f0242e"/><path d="M20 13 L28 13 L16 28 Z" fill="#7a0a10"/>
      <path d="M12 13 H20 L16 28 Z" fill="#e3121b"/>
      <g clip-path="url(#${id})"><path class="reflejo" d="M15 2 H20 L13 32 H8 Z" fill="rgba(255,255,255,.75)"/></g>
      <path d="M9 7 H23 L28 13 L16 28 L4 13 Z" fill="none" stroke="#3a0003" stroke-width="1.2" stroke-linejoin="round"/>
      <path class="chispa" d="M3 4 L4 6.5 L6.5 7.5 L4 8.5 L3 11 L2 8.5 L-.5 7.5 L2 6.5 Z" fill="#fff"/>
      <path class="chispa k2" d="M29 1 L29.8 3 L32 3.8 L29.8 4.6 L29 6.6 L28.2 4.6 L26 3.8 L28.2 3 Z" fill="#fff"/>
      <path class="chispa k3" d="M30 20 L30.8 22 L33 22.8 L30.8 23.6 L30 25.6 L29.2 23.6 L27 22.8 L29.2 22 Z" fill="#ffd9db"/>
      <path class="chispa k4" d="M5 22 L5.7 23.8 L7.5 24.5 L5.7 25.2 L5 27 L4.3 25.2 L2.5 24.5 L4.3 23.8 Z" fill="#ffd9db"/>
    </svg>`;
    },
    dinero: () => `<svg class="billetes" viewBox="0 0 32 32">
      <g class="b b0"><rect x="3" y="15" width="25" height="13" rx="2" fill="#1f9e64" stroke="#0b4d2e" stroke-width="1.2"/></g>
      <g class="b b1"><rect x="3.5" y="13" width="25" height="13" rx="2" fill="#2bb673" stroke="#0b4d2e" stroke-width="1.2"/></g>
      <g class="b b2"><rect x="4" y="11" width="25" height="13" rx="2" fill="#34c784" stroke="#0b4d2e" stroke-width="1.2"/></g>
      <g class="b b3"><rect x="4.5" y="9" width="25" height="13" rx="2" fill="#4fe3a1" stroke="#0b4d2e" stroke-width="1.2"/>
        <rect x="6.5" y="11" width="21" height="9" rx="1.2" fill="none" stroke="#1f9e64" stroke-width="1"/>
        <circle cx="17" cy="15.5" r="3.6" fill="#2bb673" stroke="#0b4d2e" stroke-width=".8"/>
        <text x="17" y="17.9" text-anchor="middle" font-size="6.5" font-weight="900" font-family="Poppins,Arial" fill="#eafff4">$</text></g>
      <g class="moneda"><circle cx="26" cy="7" r="3.4" fill="#FFD54A" stroke="#a87400" stroke-width="1"/>
        <text x="26" y="9.2" text-anchor="middle" font-size="5.5" font-weight="900" font-family="Poppins,Arial" fill="#7a5200">$</text></g>
    </svg>`,
  };
  const replay = (el, cls) => { el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls); };

  function confeti(ic) {
    const colores = ['#e3121b', '#ff4a52', '#ffffff', '#ffc83a', '#8e0a10'];
    for (let i = 0; i < 24; i++) {
      const s = document.createElement('span');
      s.className = 'ic-confeti';
      s.style.background = colores[i % 5];
      ic.appendChild(s);
      const a = -Math.PI * 0.95 + Math.random() * Math.PI * 0.9, d = 18 + Math.random() * 34;
      s.animate([{ transform: 'translate(-50%,-50%)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d + 30}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }],
        { duration: 1200 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => s.remove();
    }
  }

  window.Iconos = {
    svg: (cat, extra = '') => `<span class="ic ic-${cat} ${extra}">${(SVG[cat] || SVG.dinero)()}</span>`,
    abrir(raiz) {
      (raiz || document).querySelectorAll('.ic-subs').forEach((ic) => {
        const r = ic.querySelector('.regalo'); if (!r) return;
        replay(r, 'abrir');
        setTimeout(() => confeti(ic), 1450);
      });
    },
    contar(raiz) {
      (raiz || document).querySelectorAll('.ic-dinero .billetes').forEach((b) => replay(b, 'contar'));
    },
    auto(raiz) {
      const p = new URLSearchParams(location.search);
      const cada = Math.max(10, parseFloat(p.get('regalo')) || 300);
      setTimeout(() => this.abrir(raiz), 2500);
      setInterval(() => this.abrir(raiz), cada * 1000);
      setTimeout(() => this.contar(raiz), 1800);
      setInterval(() => this.contar(raiz), 7000);
    },
  };
})();
