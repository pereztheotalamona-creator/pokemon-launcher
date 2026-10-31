// capturas-main.js — sistema de capturas del launcher (proceso principal de Electron)
// Registra una tecla global mientras hay un juego abierto y guarda una captura SOLO de la ventana del
// juego como .jpg en  <userData>/capturas/<uid>/  (una carpeta por cuenta). Los nombres personalizados
// de las capturas viven en nombres.json, en esa misma carpeta.
const { globalShortcut, desktopCapturer, screen, app, shell, Notification, nativeImage } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let activo = null;      // { tecla, uid, juego, exe } mientras hay un juego abierto
let tomando = false;    // evita capturas dobles si se mantiene apretada la tecla

const limpiar = t => String(t || 'Juego').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
const uidSeguro = u => String(u || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
const carpeta = uid => {
  const d = path.join(app.getPath('userData'), 'capturas', uidSeguro(uid));
  fs.mkdirSync(d, { recursive: true });
  return d;
};
// Solo nombres de archivo planos generados por este módulo (evita rutas tipo ../../algo).
const archivoValido = a => typeof a === 'string' && a === path.basename(a) && /^[\w\-.]+__.+\.jpg$/.test(a);

/* ---------- Nombres personalizados ---------- */
const archNombres = uid => path.join(carpeta(uid), 'nombres.json');
function leerNombres(uid) {
  try { const o = JSON.parse(fs.readFileSync(archNombres(uid), 'utf8')); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
}
function guardarNombres(uid, o) { try { fs.writeFileSync(archNombres(uid), JSON.stringify(o)); } catch (e) { console.error('Nombres de capturas:', e); } }
const limpiarNombre = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

/* ---------- Ayudante de PowerShell: ubica la ventana del juego ----------
   Un solo PowerShell queda abierto mientras dura el juego (compilar el código de Windows tarda ~1 s;
   así cada captura solo cuesta unos milisegundos). Recibe el nombre del .exe por línea y contesta con
   el rectángulo del área de juego (sin barra de título ni bordes), en píxeles reales de pantalla. */
const SCRIPT_PS = String.raw`$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref PT p);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@
[W]::SetProcessDPIAware() | Out-Null
while (($n = [Console]::In.ReadLine()) -ne $null) {
  $n = $n.Trim()
  $res = 'null'
  if ($n) {
    $p = Get-Process -Name $n | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($p) {
      $h = $p.MainWindowHandle
      $r = New-Object W+RECT
      $pt = New-Object W+PT
      if ([W]::GetClientRect($h, [ref]$r) -and -not [W]::IsIconic($h)) {
        [W]::ClientToScreen($h, [ref]$pt) | Out-Null
        $res = '{"x":' + $pt.X + ',"y":' + $pt.Y + ',"w":' + ($r.R - $r.L) + ',"h":' + ($r.B - $r.T) + '}'
      }
    }
  }
  [Console]::Out.WriteLine($res)
  [Console]::Out.Flush()
}
`;

let ayudante = null;
let cola = [];          // respuestas pendientes, en orden
let bufer = '';

function detenerAyudante() {
  if (ayudante) { try { ayudante.kill(); } catch (e) {} }
  ayudante = null;
}

function iniciarAyudante() {
  if (ayudante || process.platform !== 'win32') return;
  try {
    const cod = Buffer.from(SCRIPT_PS, 'utf16le').toString('base64');
    const h = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', cod],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    ayudante = h; bufer = '';
    h.on('error', () => { if (ayudante === h) ayudante = null; });
    h.on('exit', () => {
      if (ayudante === h) ayudante = null;
      cola.splice(0).forEach(p => { clearTimeout(p.t); p.resolve(null); });
    });
    h.stdin.on('error', () => {});
    h.stdout.setEncoding('utf8');
    h.stdout.on('data', d => {
      bufer += d;
      let i;
      while ((i = bufer.indexOf('\n')) >= 0) {
        const linea = bufer.slice(0, i).trim(); bufer = bufer.slice(i + 1);
        if (linea !== 'null' && linea[0] !== '{') continue;           // ruido: lo ignoramos
        const p = cola.shift(); if (!p) continue;
        clearTimeout(p.t);
        let r = null; try { r = JSON.parse(linea); } catch (e) {}
        p.resolve(r);
      }
    });
  } catch (e) { ayudante = null; }
}

function rectVentanaJuego(exe) {
  return new Promise(resolve => {
    if (!ayudante || !exe) return resolve(null);
    // Si vence el tiempo, la entrada queda en la cola (su respuesta tardía se descarta sin desfasar las demás).
    const p = { resolve, t: setTimeout(() => resolve(null), 4000) };
    cola.push(p);
    try { ayudante.stdin.write(exe + '\n'); } catch (e) { resolve(null); }
  });
}

/* ---------- Captura ---------- */
// r = rectángulo del juego en píxeles reales; devuelve la imagen recortada o null si no se puede.
function recortarVentana(r, fuentes) {
  try {
    const dip = screen.screenToDipRect(null, { x: r.x, y: r.y, width: r.w, height: r.h });
    const disp = screen.getDisplayMatching(dip);
    const fisico = screen.dipToScreenRect(null, disp.bounds);           // la pantalla, en píxeles reales
    let f = fuentes.find(s => String(s.display_id) === String(disp.id));
    if (!f) { const i = screen.getAllDisplays().findIndex(d => d.id === disp.id); f = fuentes[i] || (fuentes.length === 1 ? fuentes[0] : null); }
    if (!f || f.thumbnail.isEmpty()) return null;
    const tam = f.thumbnail.getSize();
    const k = tam.width / fisico.width;                                  // por si la miniatura no vino a tamaño real
    const x = Math.max(0, Math.round((r.x - fisico.x) * k));
    const y = Math.max(0, Math.round((r.y - fisico.y) * k));
    const w = Math.min(tam.width - x, Math.round(r.w * k));
    const h = Math.min(tam.height - y, Math.round(r.h * k));
    if (w < 50 || h < 50) return null;
    return f.thumbnail.crop({ x, y, width: w, height: h });
  } catch (e) { console.error('Recorte:', e); return null; }
}

async function tomarCaptura(getVentana) {
  if (!activo || tomando) return;
  tomando = true;
  try {
    // Pantalla completa de cada monitor + posición de la ventana del juego, al mismo tiempo.
    const displays = screen.getAllDisplays();
    const anchoMax = Math.max(...displays.map(d => Math.round(d.bounds.width * (d.scaleFactor || 1))));
    const altoMax = Math.max(...displays.map(d => Math.round(d.bounds.height * (d.scaleFactor || 1))));
    const [fuentes, rect] = await Promise.all([
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: anchoMax, height: altoMax } }),
      rectVentanaJuego(activo.exe)
    ]);

    let img = rect ? recortarVentana(rect, fuentes) : null;
    let soloJuego = !!img;
    if (!img) {                                                          // plan B: pantalla donde está el mouse
      const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const f = fuentes.find(s => String(s.display_id) === String(disp.id)) || fuentes[0];
      if (!f || f.thumbnail.isEmpty()) throw new Error('Pantalla vacía');
      img = f.thumbnail;
    }
    if (img.getSize().width > 1920) img = img.resize({ width: 1920, quality: 'best' });

    const fecha = new Date();
    const nombre = fecha.toISOString().replace(/[:.]/g, '-') + '__' + limpiar(activo.juego) + '.jpg';
    fs.writeFileSync(path.join(carpeta(activo.uid), nombre), img.toJPEG(90));

    try {
      new Notification({
        title: 'Captura guardada', silent: true,
        body: activo.juego + (soloJuego ? '' : ' · no encontré la ventana del juego, se guardó la pantalla entera')
      }).show();
    } catch (e) {}
    const v = getVentana && getVentana();
    if (v && !v.isDestroyed()) v.webContents.send('capturas:nueva', { archivo: nombre, fecha: fecha.toISOString(), juego: activo.juego, soloJuego });
  } catch (e) {
    console.error('Captura:', e);
  } finally {
    tomando = false;
  }
}

function desactivar() {
  if (activo) { try { globalShortcut.unregister(activo.tecla); } catch (e) {} }
  activo = null;
  detenerAyudante();
}

// ipcMain: el de Electron. getVentana: () => la ventana principal del launcher.
function iniciar(ipcMain, getVentana) {
  ipcMain.handle('capturas:activar', (_e, o) => {
    if (!o || typeof o.tecla !== 'string' || !o.uid) return { ok: false, error: 'Datos inválidos' };
    desactivar();
    let ok = false;
    try { ok = globalShortcut.register(o.tecla, () => tomarCaptura(getVentana)); } catch (e) { ok = false; }
    if (!ok) return { ok: false, error: 'No se pudo registrar la tecla (¿la usa otra aplicación?)' };
    // Nombre del proceso del juego, sin ".exe" ni comodines (se usa para ubicar su ventana).
    const exe = String(o.exe || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').replace(/[^\w .\-()]/g, '').slice(0, 100);
    activo = { tecla: o.tecla, uid: o.uid, juego: String(o.juego || 'Juego'), exe };
    iniciarAyudante();
    return { ok: true };
  });

  // Prueba si Windows deja registrar una tecla (sin dejarla registrada). Lo usa Configuración al elegirla.
  ipcMain.handle('capturas:probar-tecla', (_e, tecla) => {
    if (typeof tecla !== 'string' || !tecla) return { ok: false };
    if (activo && activo.tecla === tecla) return { ok: true };
    let ok = false;
    try { ok = globalShortcut.register(tecla, () => {}); if (ok) globalShortcut.unregister(tecla); } catch (e) { ok = false; }
    return { ok };
  });

  ipcMain.handle('capturas:desactivar', () => { desactivar(); return { ok: true }; });

  ipcMain.handle('capturas:listar', (_e, uid) => {
    if (!uid) return [];
    try {
      const nombres = leerNombres(uid);
      return fs.readdirSync(carpeta(uid)).filter(archivoValido).sort().reverse().map(archivo => {
        const [f, ...resto] = archivo.slice(0, -4).split('__');
        // 2026-10-03T14-22-05-123Z  ->  2026-10-03T14:22:05.123Z
        const iso = f.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, 'T$1:$2:$3.$4Z');
        return { archivo, fecha: iso, juego: resto.join('__'), nombre: nombres[archivo] || '' };
      });
    } catch (e) { return []; }
  });

  // modo: 'completa' (como se guardó) | 'mini' (miniatura para la galería) | 'enviar' (liviana, para el chat)
  ipcMain.handle('capturas:leer', (_e, uid, archivo, modo) => {
    if (!uid || !archivoValido(archivo)) return null;
    try {
      const buf = fs.readFileSync(path.join(carpeta(uid), archivo));
      let out = buf;
      if (modo === 'mini' || modo === 'enviar') {
        const ancho = modo === 'mini' ? 480 : 960;
        let img = nativeImage.createFromBuffer(buf);
        if (img.getSize().width > ancho) img = img.resize({ width: ancho, quality: 'good' });
        out = img.toJPEG(modo === 'mini' ? 70 : 60);
      }
      return 'data:image/jpeg;base64,' + out.toString('base64');
    } catch (e) { return null; }
  });

  // Nombre vacío = volver al nombre por defecto (el del juego).
  ipcMain.handle('capturas:renombrar', (_e, uid, archivo, nombre) => {
    if (!uid || !archivoValido(archivo)) return { ok: false };
    const n = limpiarNombre(nombre), o = leerNombres(uid);
    if (n) o[archivo] = n; else delete o[archivo];
    guardarNombres(uid, o);
    return { ok: true, nombre: n };
  });

  ipcMain.handle('capturas:borrar', (_e, uid, archivo) => {
    if (!uid || !archivoValido(archivo)) return { ok: false };
    try {
      fs.unlinkSync(path.join(carpeta(uid), archivo));
      const o = leerNombres(uid); if (o[archivo]) { delete o[archivo]; guardarNombres(uid, o); }
      return { ok: true };
    } catch (e) { return { ok: false }; }
  });

  ipcMain.handle('capturas:abrir-carpeta', (_e, uid) => { if (uid) shell.openPath(carpeta(uid)); return { ok: true }; });

  app.on('will-quit', () => { desactivar(); });
}

module.exports = { iniciar };