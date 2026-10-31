/* ============================================================
   rangos-especiales.js
   Rangos otorgados a mano (Donador, Creador, Famoso, Moderador, Propietario).
   - Muestra los rangos como chips debajo del nombre, en tu perfil y en el de otros.
   - Si sos el propietario, agrega un "Panel de rangos" al final de tu Perfil.
   Se carga con <script src="rangos-especiales.js"></script> al FINAL del index.html
   (después del último <script>), porque envuelve renderizarPerfilLauncher y renderizarPerfilAjeno.
   ============================================================ */
(function () {
  'use strict';

  const api = () => window.amigosAPI;
  const esc = (t) => (typeof escaparHTML === 'function' ? escaparHTML(String(t == null ? '' : t)) : String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const attr = (t) => (typeof attrSeguro === 'function' ? attrSeguro(t) : esc(t));

  /* ---------- Estilos ---------- */
  const css = `
  /* ---- Bajamos nombre y rango del perfil para que no choquen con el banner (el banner no cambia de tamaño) ---- */
  #vista-perfil .perfil-launcher-identidad,
  #vista-perfil-ajeno .perfil-launcher-identidad { margin-top: 34px; }
  #vista-perfil .perfil-nivel-caja,
  #vista-perfil-ajeno .perfil-nivel-caja { margin-top: 34px; }

  /* ---- Chips de rango ---- */
  @property --rg-ang { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
  .rg-fila { display: flex; flex-wrap: wrap; gap: 10px; margin: 6px 0 12px; }
  .rg-chip {
    --rg: #9fb4cc;
    --rg-sheen: linear-gradient(110deg, transparent 35%, rgba(255,255,255,.42) 50%, transparent 65%);
    position: relative; display: inline-flex; align-items: center; gap: 7px;
    padding: 6px 15px 6px 11px; border-radius: 999px;
    font-size: 12.5px; font-weight: 900; letter-spacing: .07em; text-transform: uppercase; line-height: 1.15;
    color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.55);
    border: 1px solid color-mix(in srgb, var(--rg) 75%, #fff);
    background: var(--rg-sheen), linear-gradient(120deg, color-mix(in srgb, var(--rg) 70%, #000), color-mix(in srgb, var(--rg) 38%, #000));
    background-size: 250% 100%, 100% 100%; background-repeat: no-repeat;
    box-shadow: 0 0 14px color-mix(in srgb, var(--rg) 55%, transparent), inset 0 1px 0 rgba(255,255,255,.28);
    animation: rg-brillo 3.8s linear infinite;
  }
  .rg-chip .rg-emoji { font-size: 15px; line-height: 1; filter: drop-shadow(0 0 4px color-mix(in srgb, var(--rg) 80%, transparent)); }
  @keyframes rg-brillo { 0% { background-position: 170% 0, 0 0; } 100% { background-position: -70% 0, 0 0; } }
  @keyframes rg-latido-glow {
    0%,100% { box-shadow: 0 0 12px color-mix(in srgb, var(--rg) 50%, transparent), inset 0 1px 0 rgba(255,255,255,.28); }
    50%     { box-shadow: 0 0 26px color-mix(in srgb, var(--rg) 90%, transparent), 0 0 4px #fff3, inset 0 1px 0 rgba(255,255,255,.4); }
  }

  /* Moderador / Famoso / Creador: degradado propio + glow que late */
  .rg-chip-moderador { background: var(--rg-sheen), linear-gradient(120deg, #1d4ed8, #3b82f6 60%, #7cc4ff); background-size: 250% 100%, 100% 100%; background-repeat: no-repeat; animation: rg-brillo 3.4s linear infinite, rg-latido-glow 2.6s ease-in-out infinite; }
  .rg-chip-famoso    { background: var(--rg-sheen), linear-gradient(120deg, #6d28d9, #c026d3 55%, #f472b6); background-size: 250% 100%, 100% 100%; background-repeat: no-repeat; animation: rg-brillo 3.2s linear infinite, rg-latido-glow 2.4s ease-in-out infinite; }
  .rg-chip-creador   { background: var(--rg-sheen), linear-gradient(120deg, #047857, #10b981 60%, #6ee7b7); background-size: 250% 100%, 100% 100%; background-repeat: no-repeat; animation: rg-brillo 3.6s linear infinite, rg-latido-glow 2.8s ease-in-out infinite; }

  /* Propietario: oro líquido */
  .rg-chip-propietario {
    color: #2a1600; text-shadow: 0 1px 0 rgba(255,255,255,.35); border-color: #fff0b3;
    background: var(--rg-sheen), linear-gradient(110deg, #ff9f0a, #ffe28a 40%, #ffb703 65%, #ff9f0a);
    background-size: 250% 100%, 100% 100%; background-repeat: no-repeat;
    animation: rg-brillo 2.6s linear infinite, rg-latido-glow 2.2s ease-in-out infinite;
    box-shadow: 0 0 18px rgba(255,183,3,.65), 0 0 38px rgba(255,150,0,.3), inset 0 1px 0 rgba(255,255,255,.55);
  }
  .rg-chip-propietario .rg-emoji { animation: rg-flota 2.2s ease-in-out infinite; }

  /* Donador Tier 1: rosa */
  .rg-chip-donador1 {
    border-color: #ffc2dc;
    background: var(--rg-sheen), linear-gradient(120deg, #c2185b, #ff5fa2 60%, #ff9ccb);
    background-size: 250% 100%, 100% 100%; background-repeat: no-repeat;
    animation: rg-brillo 3.6s linear infinite, rg-latido-glow 3s ease-in-out infinite;
  }

  /* Donador Tier 3: épico — degradado fluyendo rosa → magenta → violeta, con chispas */
  .rg-chip-donador3 {
    padding: 7px 17px 7px 12px; font-size: 13px; border: 2px solid #ffd0ec;
    background: var(--rg-sheen), linear-gradient(115deg, #ff2d95, #c026d3 28%, #7c3aed 50%, #c026d3 72%, #ff2d95);
    background-size: 250% 100%, 300% 100%; background-repeat: no-repeat, repeat-x;
    animation: rg-epico3 4s linear infinite, rg-latido-glow 2.2s ease-in-out infinite;
    box-shadow: 0 0 20px rgba(255,45,149,.75), 0 0 40px rgba(124,58,237,.45), inset 0 0 10px rgba(255,255,255,.3);
  }
  @keyframes rg-epico3 { 0% { background-position: 170% 0, 0% 0; } 100% { background-position: -70% 0, 300% 0; } }

  /* Donador Tier 5: lo máximo — borde giratorio, oro + rosa, latido y chispas */
  .rg-chip-donador5 {
    padding: 8px 19px 8px 13px; font-size: 13.5px; border: 0;
    background: var(--rg-sheen), linear-gradient(115deg, #ff1f84, #ff7ac0 22%, #ffd86b 50%, #ff7ac0 78%, #ff1f84);
    background-size: 250% 100%, 300% 100%; background-repeat: no-repeat, repeat-x;
    text-shadow: 0 1px 4px rgba(120,0,50,.8), 0 0 8px rgba(255,255,255,.35);
    animation: rg-epico3 3.2s linear infinite, rg-latido5 1.8s ease-in-out infinite;
    box-shadow: 0 0 24px rgba(255,31,132,.85), 0 0 50px rgba(255,216,107,.5), inset 0 0 12px rgba(255,255,255,.4);
  }
  .rg-chip-donador5::before {
    content: ''; position: absolute; inset: -3px; border-radius: inherit; padding: 3px; pointer-events: none;
    background: conic-gradient(from var(--rg-ang), #ffd86b, #ff1f84, #fff6cf, #ff7ac0, #ffd86b);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
    animation: rg-gira 2.6s linear infinite;
  }
  .rg-chip-donador5 .rg-emoji { animation: rg-flota 1.6s ease-in-out infinite; filter: drop-shadow(0 0 6px #fff) drop-shadow(0 0 10px #ff7ac0); }
  @keyframes rg-gira { to { --rg-ang: 360deg; } }
  @keyframes rg-latido5 {
    0%,100% { transform: scale(1);    box-shadow: 0 0 22px rgba(255,31,132,.8), 0 0 46px rgba(255,216,107,.45), inset 0 0 12px rgba(255,255,255,.4); }
    50%     { transform: scale(1.05); box-shadow: 0 0 34px rgba(255,31,132,1),  0 0 70px rgba(255,216,107,.75), inset 0 0 14px rgba(255,255,255,.55); }
  }
  @keyframes rg-flota { 0%,100% { transform: translateY(0) rotate(-4deg); } 50% { transform: translateY(-2px) rotate(6deg); } }

  /* Chispas (Propietario, Donador 3 y 5) */
  .rg-st { position: absolute; font-style: normal; font-size: 11px; line-height: 1; color: #fff; pointer-events: none; z-index: 2;
    text-shadow: 0 0 6px #fff, 0 0 12px currentColor; opacity: 0; animation: rg-chispa 2.6s ease-in-out infinite; }
  .rg-st1 { top: -8px; left: 16%; }
  .rg-st2 { top: -6px; right: 10%; animation-delay: .9s; font-size: 9px; }
  .rg-st3 { bottom: -8px; left: 52%; animation-delay: 1.7s; }
  .rg-st4 { top: 40%; right: -8px; animation-delay: 1.3s; font-size: 10px; }
  .rg-chip-propietario .rg-st { color: #fff7d1; }
  .rg-chip-donador3 .rg-st { color: #ffd6f0; }
  .rg-chip-donador5 .rg-st { color: #fff2b8; font-size: 13px; }
  @keyframes rg-chispa {
    0%   { opacity: 0; transform: translateY(4px) scale(.3) rotate(0deg); }
    40%  { opacity: 1; transform: translateY(-1px) scale(1) rotate(45deg); }
    100% { opacity: 0; transform: translateY(-8px) scale(.4) rotate(120deg); }
  }

  /* Versión compacta (Comunidad) */
  .rg-mini { display: inline-flex; flex-wrap: wrap; gap: 5px; margin: 0 6px; vertical-align: middle; }
  .rg-mini .rg-chip { padding: 2px 9px 2px 6px; font-size: 9.5px; gap: 4px; border-width: 1px; }
  .rg-mini .rg-chip .rg-emoji { font-size: 11px; }
  .rg-mini .rg-chip-donador3, .rg-mini .rg-chip-donador5 { padding: 3px 10px 3px 7px; font-size: 10px; }
  .rg-mini .rg-chip-donador5::before { inset: -2px; padding: 2px; }
  .rg-mini .rg-st { display: none; }
  .rg-mini .rg-chip-donador5 { animation: rg-epico3 3.2s linear infinite, rg-latido-glow 2s ease-in-out infinite; }

  @media (prefers-reduced-motion: reduce) {
    .rg-chip, .rg-chip::before, .rg-chip .rg-emoji, .rg-st { animation: none !important; }
  }

  .rg-dev-lista { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; margin: 10px 0; }
  .rg-dev-opcion { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; cursor: pointer;
    border: 1px solid var(--border-soft, rgba(255,255,255,.15)); background: var(--bg-panel-claro, rgba(255,255,255,.05)); }
  .rg-dev-opcion input { accent-color: var(--accent-gold, #f4b400); }
  .rg-chip-x { all: unset; cursor: pointer; color: inherit; margin-left: 2px; padding: 0 3px; font-size: 14px; opacity: .75; }
  .rg-chip-x:hover { opacity: 1; }

  .rg-admin { margin-top: 18px; }
  .rg-admin h2 { display: flex; align-items: center; gap: 8px; }
  .rg-admin-buscar { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px; font: inherit; font-size: 14px;
    color: var(--text-white, #fff); background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.15); outline: none; }
  .rg-admin-buscar:focus { border-color: var(--accent-gold, #f4b400); }
  .rg-admin-sub { margin: 16px 0 6px; font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; opacity: .7; }
  .rg-admin-lista { display: flex; flex-direction: column; gap: 8px; }
  .rg-usuario { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px;
    background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09); }
  .rg-usuario-nombre { font-weight: 800; min-width: 120px; flex: 1 1 140px; }
  .rg-usuario .rg-fila { margin: 0; flex: 2 1 200px; }
  .rg-usuario-acc { display: flex; gap: 6px; flex: 1 1 100%; }
  .rg-usuario-acc select, .rg-usuario-acc button { font: inherit; font-size: 13px; border-radius: 8px; padding: 6px 10px; }
  .rg-usuario-acc select { flex: 1; color: var(--text-white, #fff); background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.18); }
  .rg-usuario-acc button { cursor: pointer; font-weight: 800; color: #1a1200; background: var(--accent-gold, #f4b400); border: 0; }
  .rg-usuario-acc button:disabled { opacity: .5; cursor: default; }
  .rg-msg { font-size: 12px; opacity: .8; min-height: 16px; margin-top: 6px; }
  .rg-vacio { font-size: 13px; opacity: .6; padding: 6px 2px; }
  `;
  const estilo = document.createElement('style');
  estilo.textContent = css;
  document.head.appendChild(estilo);

  /* ---------- Simulación local (Configuración → Desarrollo) ---------- */
  // Solo cambia lo que VOS ves en tu pantalla: no escribe nada en Firebase, nadie más lo ve.
  const CLAVE_SIM = 'rangosPruebaDev';
  function leerSimulacion() {
    try {
      const v = JSON.parse(localStorage.getItem(CLAVE_SIM) || 'null');
      return Array.isArray(v) ? v : null;
    } catch (e) { return null; }
  }
  function guardarSimulacion(lista) {
    try {
      if (lista === null) localStorage.removeItem(CLAVE_SIM);
      else localStorage.setItem(CLAVE_SIM, JSON.stringify(lista));
    } catch (e) {}
  }
  function miUid() { const yo = api().obtenerUsuarioActual(); return yo ? yo.uid : null; }

  // Rangos que se muestran para un usuario (con la simulación aplicada si es tu cuenta).
  function rangosDe(uid) {
    const sim = leerSimulacion();
    if (sim && uid && uid === miUid()) {
      const orden = api().RANGOS_ESPECIALES.map(r => r.id);
      return orden.filter(id => sim.includes(id));
    }
    return api().rangosEspecialesDe(uid);
  }

  /* ---------- Chips ---------- */
  function defDe(id) { return api().RANGOS_ESPECIALES.find(r => r.id === id); }

  // Colores de los chips (así no hace falta tocar firebase-init.js)
  const COLORES_CHIP = { propietario: '#ffb703', moderador: '#3b82f6', famoso: '#c026d3', creador: '#10b981', donador1: '#ff5fa2', donador3: '#ff2d95', donador5: '#ff1f84' };
  const CON_CHISPAS = { propietario: 3, donador3: 3, donador5: 4 };

  function chipHTML(id, conX, uid) {
    const d = defDe(id);
    if (!d) return '';
    const color = COLORES_CHIP[id] || d.color;
    const chispas = Array.from({ length: CON_CHISPAS[id] || 0 }, (_, i) => `<i class="rg-st rg-st${i + 1}">✦</i>`).join('');
    const quitar = (conX && d.asignable)
      ? `<button type="button" class="rg-chip-x" data-rg-quitar="${attr(id)}" data-rg-uid="${attr(uid)}" title="Quitar rango" aria-label="Quitar ${attr(d.nombre)}">×</button>` : '';
    return `<span class="rg-chip rg-chip-${attr(id)}" style="--rg:${color}" title="${attr(d.descripcion)}">${chispas}<span class="rg-emoji">${d.emoji}</span>${esc(d.nombre)}${quitar}</span>`;
  }

  function filaHTML(uid, conX) {
    const lista = rangosDe(uid);
    if (!lista.length) return '';
    return `<div class="rg-fila">${lista.map(id => chipHTML(id, conX, uid)).join('')}</div>`;
  }

  /* ---------- Chips en el perfil (propio y ajeno) ---------- */
  async function inyectarRangos(idCont, uid) {
    if (!uid || !api() || !api().cargarRangosEspeciales) return;
    await api().cargarRangosEspeciales([uid]);
    const cont = document.getElementById(idCont);
    const ident = cont && cont.querySelector('.perfil-launcher-identidad');
    if (!ident) return;
    ident.querySelectorAll('.rg-fila').forEach(x => x.remove());
    const html = filaHTML(uid, false);
    if (!html) return;
    const h1 = ident.querySelector('h1');
    if (h1) h1.insertAdjacentHTML('afterend', html); else ident.insertAdjacentHTML('afterbegin', html);
  }

  /* ---------- Panel del propietario ---------- */
  function filaUsuarioHTML(u) {
    const opciones = api().RANGOS_ESPECIALES.filter(r => r.asignable)
      .map(r => `<option value="${attr(r.id)}">${r.emoji} ${esc(r.nombre)}</option>`).join('');
    return `
      <div class="rg-usuario" data-rg-fila-uid="${attr(u.uid)}">
        <span class="rg-usuario-nombre">${esc(u.nombreUsuario || '')}</span>
        ${filaHTML(u.uid, true) || '<span class="rg-vacio">Sin rangos</span>'}
        <div class="rg-usuario-acc">
          <select data-rg-select>${opciones}</select>
          <button type="button" data-rg-dar="${attr(u.uid)}">Dar rango</button>
        </div>
      </div>`;
  }

  async function montarPanelAdmin() {
    const a = api();
    if (!a || !a.soyPropietario || !a.soyPropietario()) return;
    const cont = document.getElementById('perfil-launcher-contenido');
    if (!cont) return;
    cont.querySelectorAll('.rg-admin').forEach(x => x.remove());

    const panel = document.createElement('div');
    panel.className = 'perfil-seccion rg-admin';
    panel.innerHTML = `
      <h2>${typeof icono === 'function' ? icono('star', 'sm') : '👑'}Panel de rangos</h2>
      <p class="perfil-seccion-nota">Buscá un entrenador por su nombre y dale (o quitale) un rango especial. Solo vos ves este panel.</p>
      <input type="text" class="rg-admin-buscar" placeholder="Buscar entrenador..." autocomplete="off" maxlength="30">
      <div class="rg-msg" data-rg-msg></div>
      <div class="rg-admin-lista" data-rg-resultados></div>
      <div class="rg-admin-sub">Entrenadores con rango</div>
      <div class="rg-admin-lista" data-rg-con-rangos><span class="rg-vacio">Cargando...</span></div>`;
    cont.appendChild(panel);

    const msg = panel.querySelector('[data-rg-msg]');
    const resultados = panel.querySelector('[data-rg-resultados]');
    const conRangos = panel.querySelector('[data-rg-con-rangos]');
    const buscar = panel.querySelector('.rg-admin-buscar');
    const mapaUsuarios = {}; // uid -> usuario (para repintar filas)

    const decir = (t) => { msg.textContent = t || ''; };

    async function pintarConRangos() {
      try {
        const lista = await a.listarUsuariosConRangos();
        lista.forEach(u => { mapaUsuarios[u.uid] = u; });
        const sinPropietario = lista.filter(u => u.uid !== (a.obtenerUsuarioActual() || {}).uid);
        conRangos.innerHTML = sinPropietario.length
          ? sinPropietario.map(filaUsuarioHTML).join('')
          : '<span class="rg-vacio">Todavía no le diste rangos a nadie.</span>';
      } catch (e) {
        conRangos.innerHTML = '<span class="rg-vacio">No se pudo cargar la lista (revisá las reglas de Firestore).</span>';
        console.warn(e);
      }
    }

    let temporizador = null;
    buscar.addEventListener('input', () => {
      clearTimeout(temporizador);
      const texto = buscar.value.trim();
      if (!texto) { resultados.innerHTML = ''; decir(''); return; }
      temporizador = setTimeout(async () => {
        try {
          decir('Buscando...');
          const lista = await a.buscarUsuarios(texto);
          await a.cargarRangosEspeciales(lista.map(u => u.uid));
          lista.forEach(u => { mapaUsuarios[u.uid] = u; });
          resultados.innerHTML = lista.length ? lista.map(filaUsuarioHTML).join('') : '<span class="rg-vacio">No encontré a nadie con ese nombre.</span>';
          decir('');
        } catch (e) { decir('Error al buscar: ' + e.message); }
      }, 300);
    });

    // Repinta la fila de un usuario en las dos listas
    function repintarUsuario(uid) {
      const u = mapaUsuarios[uid];
      if (!u) return;
      panel.querySelectorAll(`[data-rg-fila-uid="${CSS.escape(uid)}"]`).forEach(el => {
        el.outerHTML = filaUsuarioHTML(u);
      });
    }

    panel.addEventListener('click', async (e) => {
      const dar = e.target.closest('[data-rg-dar]');
      if (dar) {
        const uid = dar.dataset.rgDar;
        const fila = dar.closest('[data-rg-fila-uid]');
        const rangoId = fila.querySelector('[data-rg-select]').value;
        dar.disabled = true;
        try {
          await a.asignarRangoEspecial(uid, rangoId);
          decir(`Listo: ${defDe(rangoId).nombre} para ${(mapaUsuarios[uid] || {}).nombreUsuario || 'el entrenador'}.`);
          repintarUsuario(uid);
          pintarConRangos();
        } catch (err) { decir('No se pudo: ' + err.message); dar.disabled = false; }
        return;
      }
      const quitar = e.target.closest('[data-rg-quitar]');
      if (quitar) {
        const uid = quitar.dataset.rgUid, rangoId = quitar.dataset.rgQuitar;
        try {
          await a.quitarRangoEspecial(uid, rangoId);
          decir(`Quitado: ${defDe(rangoId).nombre}.`);
          repintarUsuario(uid);
          pintarConRangos();
        } catch (err) { decir('No se pudo: ' + err.message); }
      }
    });

    pintarConRangos();
  }

  /* ---------- Rangos en Comunidad (posts, comentarios, búsqueda de personas, perfiles) ---------- */
  const cargadosCom = new Set();
  let escaneando = false;

  function pintarMini(btn) {
    const uid = btn.dataset.perfil;
    btn.dataset.rg = '1';
    if (btn.nextElementSibling && btn.nextElementSibling.classList.contains('rg-mini')) btn.nextElementSibling.remove();
    const lista = rangosDe(uid);
    if (!lista.length) return;
    btn.insertAdjacentHTML('afterend', `<span class="rg-mini">${lista.map(id => chipHTML(id, false, uid)).join('')}</span>`);
  }

  async function escanearNombres() {
    if (escaneando || !api() || !api().cargarRangosEspeciales) return;
    const botones = [...document.querySelectorAll('#content .cx-nombre[data-perfil]:not([data-rg])')];
    if (!botones.length) return;
    escaneando = true;
    try {
      const faltan = [...new Set(botones.map(b => b.dataset.perfil))].filter(u => !cargadosCom.has(u));
      if (faltan.length) {
        await api().cargarRangosEspeciales(faltan);
        faltan.forEach(u => cargadosCom.add(u));
      }
      botones.forEach(b => { if (b.isConnected) pintarMini(b); });
    } catch (e) { console.warn('Rangos especiales (comunidad):', e); }
    escaneando = false;
  }

  // Vuelve a pintar todo (después de cambiar la simulación)
  function repintarTodo() {
    document.querySelectorAll('.rg-mini').forEach(x => x.remove());
    document.querySelectorAll('#content .cx-nombre[data-rg]').forEach(b => b.removeAttribute('data-rg'));
    escanearNombres();
    const yo = miUid();
    if (yo && document.getElementById('perfil-launcher-contenido')) inyectarRangos('perfil-launcher-contenido', yo);
  }

  (function observarComunidad() {
    const raiz = document.getElementById('content');
    if (!raiz) return;
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(escanearNombres, 200); })
      .observe(raiz, { childList: true, subtree: true });
  })();

  /* ---------- Configuración → Desarrollo: probarte cada rango ---------- */
  function bloqueDevHTML() {
    const sim = leerSimulacion();
    const activos = sim || [];
    const opciones = api().RANGOS_ESPECIALES.map(r => `
      <label class="rg-dev-opcion">
        <input type="checkbox" data-rg-dev="${attr(r.id)}" ${activos.includes(r.id) ? 'checked' : ''}>
        ${chipHTML(r.id, false, '')}
      </label>`).join('');
    return `
      <h3>Probar rangos especiales</h3>
      <p class="config-descripcion">Marcá los rangos que querés ponerte y apretá "Ponerme estos rangos" para ver cómo quedan en tu perfil y en Comunidad. Es solo una prueba en tu pantalla: no se guarda en Firebase y nadie más lo ve. (Los tres Donador son excluyentes: queda uno solo.)</p>
      <div class="rg-dev-lista">${opciones}</div>
      <div class="dev-rango-fila">
        <button type="button" class="btn-outline" data-rg-dev-aplicar style="background: rgba(244,180,0,0.1); border-color: var(--accent-gold); color: var(--accent-gold);">Ponerme estos rangos</button>
        <button type="button" class="btn-outline" data-rg-dev-quitar>Volver a mis rangos reales</button>
      </div>
      <p class="dev-rango-estado" data-rg-dev-estado>${sim ? 'Simulación activa: ' + (sim.length ? sim.map(id => defDe(id).nombre).join(', ') : 'sin rangos') : 'Mostrando tus rangos reales.'}</p>`;
  }

  function montarBloqueDev() {
    const seccion = document.getElementById('seccion-desarrollo');
    if (!seccion || !api() || !api().RANGOS_ESPECIALES) return;
    seccion.querySelectorAll('.rg-dev-bloque').forEach(x => x.remove());
    const bloque = document.createElement('div');
    bloque.className = 'config-bloque rg-dev-bloque';
    bloque.innerHTML = bloqueDevHTML();
    seccion.appendChild(bloque);

    const estado = bloque.querySelector('[data-rg-dev-estado]');
    const marcados = () => [...bloque.querySelectorAll('[data-rg-dev]:checked')].map(i => i.dataset.rgDev);

    // Los Donador son excluyentes entre sí
    bloque.addEventListener('change', (e) => {
      const chk = e.target.closest('[data-rg-dev]');
      if (!chk || !chk.checked) return;
      const def = defDe(chk.dataset.rgDev);
      if (!def || !def.grupo) return;
      bloque.querySelectorAll('[data-rg-dev]').forEach(o => {
        const d = defDe(o.dataset.rgDev);
        if (o !== chk && d && d.grupo === def.grupo) o.checked = false;
      });
    });

    bloque.querySelector('[data-rg-dev-aplicar]').onclick = () => {
      const lista = marcados();
      guardarSimulacion(lista);
      estado.textContent = 'Simulación activa: ' + (lista.length ? lista.map(id => defDe(id).nombre).join(', ') : 'sin rangos');
      repintarTodo();
    };
    bloque.querySelector('[data-rg-dev-quitar]').onclick = () => {
      guardarSimulacion(null);
      bloque.querySelectorAll('[data-rg-dev]').forEach(i => { i.checked = false; });
      estado.textContent = 'Mostrando tus rangos reales.';
      repintarTodo();
    };
  }

  if (typeof renderizarConfiguracion === 'function') {
    const original = renderizarConfiguracion;
    renderizarConfiguracion = async function () {
      const r = await original.apply(this, arguments);
      try { montarBloqueDev(); } catch (e) { console.warn('Rangos especiales (desarrollo):', e); }
      return r;
    };
  }

  escanearNombres();

  /* ---------- Enganche a los renders existentes ---------- */
  if (typeof renderizarPerfilLauncher === 'function') {
    const original = renderizarPerfilLauncher;
    renderizarPerfilLauncher = function () {
      const r = original.apply(this, arguments);
      try {
        const yo = api().obtenerUsuarioActual();
        if (yo) { inyectarRangos('perfil-launcher-contenido', yo.uid); montarPanelAdmin(); }
      } catch (e) { console.warn('Rangos especiales (perfil propio):', e); }
      return r;
    };
  }
  if (typeof renderizarPerfilAjeno === 'function') {
    const original = renderizarPerfilAjeno;
    renderizarPerfilAjeno = function () {
      const r = original.apply(this, arguments);
      try { inyectarRangos('perfil-ajeno-contenido', perfilAjenoUid); } catch (e) { console.warn('Rangos especiales (perfil ajeno):', e); }
      return r;
    };
  }
})();