const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');
const extract = require('extract-zip');
const { exec } = require('child_process');
let MegaFile = null;
try { MegaFile = require('megajs').File; } catch (e) {
  console.warn('megajs no está instalado todavía — los links de Mega no van a funcionar hasta correr "npm install megajs".');
}

// Carpeta de datos FIJA (igual en desarrollo y en el programa instalado): así el progreso, las cuentas y la
// configuración no cambian de lugar ni se pierden al instalar o actualizar. Tiene que ir antes de leer cualquier ruta.
app.setPath('userData', path.join(app.getPath('appData'), 'pokemon-launcher'));
// Identificador de la app en Windows: lo necesitan las notificaciones y los accesos directos del programa instalado.
app.setAppUserModelId('com.pokemonlauncher.app');
// Una sola copia del launcher abierta a la vez (si se abre otra, trae la que ya está al frente).
const instanciaUnica = app.requestSingleInstanceLock();
if (!instanciaUnica) app.quit();
app.on('second-instance', () => {
  if (typeof ventanaPrincipal !== 'undefined' && ventanaPrincipal) {
    if (ventanaPrincipal.isMinimized()) ventanaPrincipal.restore();
    ventanaPrincipal.focus();
  }
});

const archivoDatos = path.join(app.getPath('userData'), 'biblioteca.json');
const archivoCatalogo = path.join(__dirname, 'catalogo.json');
const URL_CATALOGO_REMOTO = 'https://raw.githubusercontent.com/pereztheotalamona-creator/pokemon-launcher-catalogo/refs/heads/main/catalogo.json';

let ventanaPrincipal;

// Sistema de capturas (tecla global mientras hay un juego abierto). Ver capturas-main.js
require('./capturas-main').iniciar(ipcMain, () => ventanaPrincipal);
// Avisos de mensajes de amigos (notificación de Windows). Ver notificaciones-main.js
require('./notificaciones-main').iniciar(ipcMain, () => ventanaPrincipal);
let procesoJuegoActual = null;
let ultimaCarpetaDeInstalacion = null;

/* ===================== ALMACENAMIENTO PROTEGIDO (safeStorage) ===================== */
// Los archivos de datos del launcher se guardan cifrados con las credenciales de Windows
// del usuario (DPAPI, vía safeStorage de Electron). Editarlos a mano ya no es trivial.
// Formato: "PLENC1:" + base64(cifrado). Si el archivo es JSON plano (versión anterior),
// se lee igual y se re-guarda cifrado en la próxima escritura.
const PREFIJO_CIFRADO = 'PLENC1:';

function leerJsonProtegido(ruta, porDefecto) {
  if (!fs.existsSync(ruta)) return porDefecto;
  try {
    const contenido = fs.readFileSync(ruta, 'utf-8');
    if (contenido.startsWith(PREFIJO_CIFRADO)) {
      const buffer = Buffer.from(contenido.slice(PREFIJO_CIFRADO.length), 'base64');
      return JSON.parse(safeStorage.decryptString(buffer));
    }
    return JSON.parse(contenido); // archivo viejo sin cifrar
  } catch (error) {
    console.error('No se pudo leer ' + path.basename(ruta) + ' (corrupto, editado o de otro usuario de Windows). Se guarda copia .bak y se arranca de cero:', error.message);
    try { fs.copyFileSync(ruta, ruta + '.bak'); } catch (e) {}
    return porDefecto;
  }
}

function escribirJsonProtegido(ruta, datos) {
  const texto = JSON.stringify(datos);
  const salida = safeStorage.isEncryptionAvailable()
    ? PREFIJO_CIFRADO + safeStorage.encryptString(texto).toString('base64')
    : JSON.stringify(datos, null, 2);
  const temporal = ruta + '.tmp';
  fs.writeFileSync(temporal, salida);
  fs.renameSync(temporal, ruta); // escritura atómica: un corte de luz no deja el archivo a medias
}

/* ===================== CATÁLOGO ===================== */

function descargarTexto(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (respuesta) => {
      if (respuesta.statusCode === 302 || respuesta.statusCode === 301) {
        https.get(respuesta.headers.location, (respuestaFinal) => {
          let datos = '';
          respuestaFinal.on('data', (fragmento) => datos += fragmento);
          respuestaFinal.on('end', () => resolve(datos));
        });
        return;
      }
      let datos = '';
      respuesta.on('data', (fragmento) => datos += fragmento);
      respuesta.on('end', () => resolve(datos));
    }).on('error', reject);
  });
}

ipcMain.handle('cargar-catalogo', async () => {
  try {
    const contenidoRemoto = await descargarTexto(URL_CATALOGO_REMOTO);
    return JSON.parse(contenidoRemoto);
  } catch (error) {
    console.warn('No se pudo descargar el catálogo remoto, se usa la copia local guardada dentro del programa:', error.message);
    try {
      const contenidoLocal = fs.readFileSync(archivoCatalogo, 'utf-8');
      return JSON.parse(contenidoLocal);
    } catch (errorLocal) {
      console.error('La copia local del catálogo tampoco se pudo leer:', errorLocal);
      return [];
    }
  }
});

/* ===================== BIBLIOTECA (progreso guardado) ===================== */

function cargarBiblioteca() {
  const datos = leerJsonProtegido(archivoDatos, []);
  return Array.isArray(datos) ? datos : [];
}

function guardarBiblioteca(juegos) {
  escribirJsonProtegido(archivoDatos, juegos);
}

ipcMain.handle('cargar-biblioteca', () => cargarBiblioteca());
ipcMain.handle('guardar-biblioteca', (event, juegos) => guardarBiblioteca(juegos));

/* ===================== ALMACÉN POR CUENTA (cifrado) ===================== */
// Reemplaza al localStorage del renderer para lo que es progreso (horas, logros, maestrías,
// rankings, perfil...). Se mantiene en memoria y se escribe cifrado a disco.
const archivoAlmacen = path.join(app.getPath('userData'), 'almacen-cuentas.bin');
let almacenMemoria = null;
let temporizadorAlmacen = null;

function asegurarAlmacen() {
  if (almacenMemoria === null) {
    const datos = leerJsonProtegido(archivoAlmacen, {});
    almacenMemoria = (datos && typeof datos === 'object') ? datos : {};
  }
  return almacenMemoria;
}
function volcarAlmacenAhora() {
  if (temporizadorAlmacen) { clearTimeout(temporizadorAlmacen); temporizadorAlmacen = null; }
  if (almacenMemoria === null) return;
  try { escribirJsonProtegido(archivoAlmacen, almacenMemoria); }
  catch (e) { console.error('No se pudo guardar el almacén de cuentas:', e); }
}
function programarVolcadoAlmacen() {
  if (temporizadorAlmacen) return;
  temporizadorAlmacen = setTimeout(volcarAlmacenAhora, 300);
}
app.on('before-quit', volcarAlmacenAhora);

// Síncronos a propósito: el index.html los usa en lugares que no son async.
ipcMain.on('almacen-obtener', (event, clave) => {
  const v = asegurarAlmacen()[String(clave)];
  event.returnValue = (v === undefined) ? null : v;
});
ipcMain.on('almacen-guardar', (event, clave, valor) => {
  asegurarAlmacen()[String(clave)] = String(valor);
  programarVolcadoAlmacen();
  event.returnValue = true;
});
ipcMain.on('almacen-borrar', (event, clave) => {
  delete asegurarAlmacen()[String(clave)];
  programarVolcadoAlmacen();
  event.returnValue = true;
});
ipcMain.on('almacen-claves', (event) => {
  event.returnValue = Object.keys(asegurarAlmacen());
});

/* ===================== AVISO DE LOGRO (estilo Steam) ===================== */
// Ventana propia, chica, transparente y siempre encima, que no roba el foco ni bloquea los clics:
// así aparece abajo a la derecha por encima del juego (que corre en otro proceso).
const TOAST_ANCHO = 400;
const TOAST_ALTO = 112;
const TOAST_DURACION_MS = 5500;
let ventanaToast = null;
let toastCargado = null;
const colaToasts = [];
let mostrandoToast = false;

function crearVentanaToast() {
  ventanaToast = new BrowserWindow({
    width: TOAST_ANCHO, height: TOAST_ALTO,
    frame: false, transparent: true, resizable: false, movable: false,
    focusable: false, skipTaskbar: true, show: false, hasShadow: false,
    fullscreenable: false, alwaysOnTop: true,
    webPreferences: { autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false }
  });
  ventanaToast.setAlwaysOnTop(true, 'screen-saver'); // por encima de juegos en ventana sin bordes
  ventanaToast.setIgnoreMouseEvents(true);
  // Resuelve true si cargó y false si falló (antes, si fallaba la carga la cola se quedaba esperando para siempre).
  toastCargado = new Promise(resolve => {
    ventanaToast.webContents.once('did-finish-load', () => resolve(true));
    ventanaToast.webContents.once('did-fail-load', (e, codigo, descripcion) => {
      console.error('[toast] No cargó toast.html:', codigo, descripcion);
      resolve(false);
    });
    setTimeout(() => resolve(false), 8000);
  });
  ventanaToast.loadFile(path.join(__dirname, 'toast.html'));
  ventanaToast.on('closed', () => { ventanaToast = null; toastCargado = null; });
}

function mostrarLogro(logro) {
  if (!logro) return;
  colaToasts.push({
    nombre: String(logro.nombre || ''),
    descripcion: String(logro.descripcion || ''),
    imagen: logro.imagen || null
  });
  procesarColaToasts();
}

async function procesarColaToasts() {
  if (mostrandoToast) return;
  mostrandoToast = true;
  try {
    while (colaToasts.length) {
      const logro = colaToasts.shift();
      try {
        if (!ventanaToast || ventanaToast.isDestroyed()) crearVentanaToast();
        if (!(await toastCargado)) {
          console.error('[toast] toast.html no está disponible (¿está al lado de main.js y incluido en el build?).');
          if (ventanaToast && !ventanaToast.isDestroyed()) ventanaToast.destroy();
          continue;
        }
        console.log('[toast] mostrando:', logro.nombre);

        // En la pantalla donde está el mouse (donde casi seguro está el juego), abajo a la derecha.
        const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
        ventanaToast.setBounds({
          x: area.x + area.width - TOAST_ANCHO - 8,
          y: area.y + area.height - TOAST_ALTO - 8,
          width: TOAST_ANCHO, height: TOAST_ALTO
        });
        ventanaToast.showInactive(); // sin robarle el foco al juego
        ventanaToast.setAlwaysOnTop(true, 'screen-saver');

        // Colores del diseño que tenga activo el launcher en este momento (el cartel se adapta).
        let tema = null;
        try {
          if (ventanaPrincipal && !ventanaPrincipal.isDestroyed()) {
            tema = await ventanaPrincipal.webContents.executeJavaScript('window.__temaToast ? window.__temaToast() : null');
          }
        } catch (e) { tema = null; }

        // mostrarLogro() de toast.html espera a que cargue la imagen y recién ahí entra el cartel.
        await ventanaToast.webContents.executeJavaScript(
          `mostrarLogro(${JSON.stringify({ ...logro, duracion: TOAST_DURACION_MS })}, ${JSON.stringify(tema)})`
        );
        await new Promise(r => setTimeout(r, TOAST_DURACION_MS));
        await ventanaToast.webContents.executeJavaScript('ocultarLogro()');
        await new Promise(r => setTimeout(r, 450));
        if (ventanaToast && !ventanaToast.isDestroyed()) ventanaToast.hide();
      } catch (error) {
        console.error('No se pudo mostrar el aviso de logro:', error);
        if (ventanaToast && !ventanaToast.isDestroyed()) ventanaToast.hide();
      }
    }
  } finally {
    mostrandoToast = false;
  }
}

// Botón "Ver un logro de ejemplo" de Configuración → Desarrollo.
ipcMain.handle('probar-logro', () => {
  mostrarLogro({
    nombre: '¡Logro de ejemplo!',
    descripcion: 'Así se ve el aviso cuando desbloqueás un logro, con el diseño que tengas activo.',
    imagen: null
  });
  return true;
});

/* ===================== VIGILANTE DE LOGROS EN VIVO ===================== */
// Mientras el juego está abierto, mira la carpeta de guardado cada pocos segundos. Cuando aparece
// (o cambia) un guardado escrito DURANTE esta sesión, lo lee, se lo pasa al index.html para que
// evalúe los logros, y muestra el aviso por cada logro nuevo.
// Ojo: RPG Maker solo escribe el archivo cuando guardás la partida, así que el aviso sale a los
// pocos segundos de guardar dentro del juego (no en el instante exacto del evento).
const INTERVALO_VIGILANTE_MS = 5000;
const ESPERA_ESCRITURA_MS = 1500; // si el archivo se modificó hace menos que esto, todavía se está escribiendo

let ultimoDiag = '';
function diag(msg) {
  if (msg === ultimoDiag) return; // el vigilante corre cada 5 s: no repetir lo mismo
  ultimoDiag = msg;
  console.log('[logros-en-vivo] ' + msg);
}

function iniciarVigilanteDeLogros(juego, inicio) {
  let detenido = false;
  let ocupado = false;
  let ultimaHuella = null;
  let fallos = 0;

  async function revisar() {
    if (detenido || ocupado) return;
    if (!ventanaPrincipal || ventanaPrincipal.isDestroyed()) return;
    ocupado = true;
    try {
      const carpeta = resolverCarpetaGuardado(juego);
      if (!carpeta) { diag('sin carpeta de guardado para ' + juego.id); return; }

      // Guardado más reciente escrito durante esta sesión (mismo criterio que la verificación al cerrar).
      let reciente = null;
      const vistos = [];
      for (const ruta of buscarArchivosDeGuardado(carpeta)) {
        let st;
        try { st = fs.statSync(ruta); } catch (e) { continue; }
        vistos.push(`${path.basename(ruta)} (modificado hace ${Math.round((Date.now() - st.mtimeMs) / 60000)} min, ${Math.round((Date.now() - inicio) / 60000)} min desde que abriste el juego)`);
        if (st.mtimeMs < inicio - MARGEN_MS) continue;
        if (!reciente || st.mtimeMs > reciente.mtimeMs) reciente = { ruta, mtimeMs: st.mtimeMs, size: st.size };
      }
      if (!reciente) {
        if (vistos.length) {
          diag('hay guardados en ' + carpeta + ' pero ninguno es de esta sesión: ' + vistos.join('; ') + ' -> guardá la partida DENTRO del juego');
        } else {
          let contenido = [];
          try { contenido = fs.readdirSync(carpeta).slice(0, 20); } catch (e) { contenido = ['(la carpeta no existe o no se puede leer: ' + (e && e.code) + ')']; }
          diag('no hay archivos .rxdata/.rvdata/.rvdata2 en ' + carpeta + '. Contenido: ' + (contenido.join(', ') || '(vacía)'));
        }
        return;
      }
      if (Date.now() - reciente.mtimeMs < ESPERA_ESCRITURA_MS) return;

      const huella = `${reciente.ruta}|${reciente.mtimeMs}|${reciente.size}`;
      if (huella === ultimaHuella) return; // no cambió desde la última revisión

      let partida;
      try {
        partida = await decodificarPartida(reciente.ruta);
      } catch (e) {
        diag('no se pudo leer el guardado: ' + (e && e.message));
        if (++fallos >= 3) { ultimaHuella = huella; fallos = 0; } // no insistir para siempre con un archivo ilegible
        return;
      }
      ultimaHuella = huella;
      fallos = 0;

      const minutosSesion = (Date.now() - inicio) / 1000 / 60;
      const plausible = tiempoDelGuardadoPlausible(juego, partida, minutosSesion);
      if (!plausible.ok) {
        diag(`guardado descartado por tiempo: el save dice ${Math.round(plausible.minutosGuardado)} min y el launcher solo vio ${Math.round(plausible.minutosLauncher)} min`);
        return;
      }

      const stats = calcularStatsDePartida(partida);
      const nuevos = await ventanaPrincipal.webContents.executeJavaScript(
        `window.__progresoEnVivo ? window.__progresoEnVivo(${JSON.stringify(juego.id)}, ${JSON.stringify(stats)}) : []`
      );
      diag('guardado leído; logros nuevos: ' + (Array.isArray(nuevos) ? nuevos.length : 'ninguno (¿falta __progresoEnVivo?)'));
      if (!detenido && Array.isArray(nuevos)) nuevos.forEach(mostrarLogro);
    } catch (error) {
      console.error('Vigilante de logros:', error);
    } finally {
      ocupado = false;
    }
  }

  const temporizador = setInterval(revisar, INTERVALO_VIGILANTE_MS);
  return { detener() { detenido = true; clearInterval(temporizador); } };
}

/* ===================== JUGAR ===================== */

// Dónde guarda cada juego sus partidas. El catálogo puede indicar:
//   carpetaGuardadoJuegosGuardados: "Pokemon Z"  -> C:\\Users\\<vos>\\Saved Games\\Pokemon Z   (en Windows en español se ve como "Juegos guardados")
//   carpetaGuardadoAppData:         "Pokemon Anil" -> %APPDATA%\\Pokemon Anil
// Si no indica ninguna, se busca al lado del .exe. Si la carpeta exacta no existe, se prueba una
// con el mismo nombre ignorando mayúsculas y acentos (por si el juego la nombró distinto).
function normalizarNombreCarpeta(n) {
  return String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function carpetaConSaves(carpeta) {
  try { return fs.statSync(carpeta).isDirectory() && buscarArchivosDeGuardado(carpeta).length > 0; } catch (e) { return false; }
}
function buscarCarpetaIgnorandoFormato(base, nombre) {
  const exacta = path.join(base, nombre);
  try { if (fs.statSync(exacta).isDirectory()) return exacta; } catch (e) {}
  try {
    const buscado = normalizarNombreCarpeta(nombre);
    const hallada = fs.readdirSync(base, { withFileTypes: true })
      .find(d => d.isDirectory() && normalizarNombreCarpeta(d.name) === buscado);
    if (hallada) return path.join(base, hallada.name);
  } catch (e) {}
  return exacta;
}
function resolverCarpetaGuardado(juego) {
  const candidatas = [];
  if (juego.carpetaGuardadoJuegosGuardados) {
    candidatas.push(buscarCarpetaIgnorandoFormato(path.join(os.homedir(), 'Saved Games'), juego.carpetaGuardadoJuegosGuardados));
  }
  if (juego.carpetaGuardadoAppData && process.env.APPDATA) {
    candidatas.push(buscarCarpetaIgnorandoFormato(process.env.APPDATA, juego.carpetaGuardadoAppData));
  }
  if (candidatas.length) return candidatas.find(carpetaConSaves) || candidatas[0];
  if (juego.rutaEjecutable) return path.dirname(juego.rutaEjecutable);
  return null;
}

function buscarArchivosDeGuardado(carpetaJuego) {
  const extensionesGuardado = ['rxdata', 'rvdata2', 'rvdata'];

  let items;
  try {
    items = fs.readdirSync(carpetaJuego, { withFileTypes: true });
  } catch (error) {
    return [];
  }

  return items
    .filter(item => item.isFile())
    .map(item => item.name)
    .filter(nombre => {
      // Sacamos los puntos para que "Partida 1.rx.data" también cuente como "rxdata"
      const nombreSinPuntos = nombre.toLowerCase().replace(/\./g, '');
      return extensionesGuardado.some(ext => nombreSinPuntos.endsWith(ext));
    })
    .map(nombre => path.join(carpetaJuego, nombre));
}

/* ===================== VERIFICACIÓN DE GUARDADOS (anti-trampa) ===================== */
// Solo cuentan para logros los guardados que el juego escribió DURANTE una sesión
// abierta desde el launcher. Un guardado pegado a mano o bajado de internet no tiene
// huella registrada (o su fecha/tamaño no coincide) y se ignora.
// OJO: no se usa la fecha de creación (birthtime): al copiar un archivo en Windows
// se resetea a "ahora" y dejaría pasar guardados pegados.
const MARGEN_MS = 2000;
const rutaVerificacion = () => path.join(app.getPath('userData'), 'verificacion-guardados.json');

function leerVerificacion() {
  const datos = leerJsonProtegido(rutaVerificacion(), {});
  return (datos && typeof datos === 'object') ? datos : {};
}
function guardarVerificacion(datos) {
  try { escribirJsonProtegido(rutaVerificacion(), datos); }
  catch (e) { console.error('No se pudo guardar la verificación de guardados:', e); }
}

// Se llama al cerrar el juego: registra solo los guardados escritos durante la sesión.
function registrarGuardadosDeSesion(juego, archivos, inicio, fin) {
  const verificacion = leerVerificacion();
  const entrada = verificacion[juego.id] || (verificacion[juego.id] = { guardados: {} });
  if (!entrada.guardados) entrada.guardados = {};
  let hubo = false;
  for (const ruta of archivos) {
    try {
      const st = fs.statSync(ruta);
      if (st.mtimeMs >= inicio - MARGEN_MS && st.mtimeMs <= fin + MARGEN_MS) {
        entrada.guardados[ruta] = { mtimeMs: st.mtimeMs, size: st.size };
        hubo = true;
      }
    } catch (e) {}
  }
  if (hubo) guardarVerificacion(verificacion);
}

// Minutos que el launcher vio el juego abierto (acumulado). La primera vez que ve un
// juego parte de las horas que ya tenía la biblioteca, así los usuarios actuales no pierden nada.
function sumarMinutosLauncher(juego, minutosSesion) {
  const verificacion = leerVerificacion();
  const entrada = verificacion[juego.id] || (verificacion[juego.id] = { guardados: {} });
  if (typeof entrada.minutosLauncher !== 'number') entrada.minutosLauncher = Number(juego.minutosJugados) || 0;
  entrada.minutosLauncher += Math.max(0, minutosSesion || 0);
  guardarVerificacion(verificacion);
}

// Essentials guarda frame_count (frames totales de juego). A 40 fps => minutos de juego del guardado.
// Si el guardado dice tener muchas más horas que las que el launcher vio jugar, es un guardado ajeno.
const FPS_JUEGO = 40;
const TOLERANCIA_FACTOR = 1.25;
const TOLERANCIA_MIN = 30;
function tiempoDelGuardadoPlausible(juego, partida, minutosExtra = 0) {
  const frames = leerCampo(partida, ['frame_count']);
  if (typeof frames !== 'number' || frames <= 0) return { ok: true, sinDato: true };
  const minutosGuardado = frames / FPS_JUEGO / 60;
  const minutosLauncher = leerVerificacion()[juego.id]?.minutosLauncher ?? (Number(juego.minutosJugados) || 0);
  const limite = (minutosLauncher + minutosExtra) * TOLERANCIA_FACTOR + TOLERANCIA_MIN;
  return { ok: minutosGuardado <= limite, minutosGuardado, minutosLauncher };
}

function esGuardadoVerificado(juegoId, ruta) {
  const reg = leerVerificacion()[juegoId]?.guardados?.[ruta];
  if (!reg) return false;
  try {
    const st = fs.statSync(ruta);
    return Math.abs(st.mtimeMs - reg.mtimeMs) < 1 && st.size === reg.size;
  } catch (e) { return false; }
}

ipcMain.handle('jugar-juego', (event, juego) => {
  return new Promise((resolve) => {
    const inicio = Date.now();

    // Si el juego tiene una ruta de ejecutable real, abrimos esa.
    // Si no (los juegos de ejemplo sin ruta todavía), seguimos simulando con Notepad.
    const opciones = juego.rutaEjecutable
      ? { cwd: path.dirname(juego.rutaEjecutable) }
      : {};
    const comando = juego.rutaEjecutable ? `"${juego.rutaEjecutable}"` : 'notepad.exe';

    const proceso = exec(comando, opciones, (error) => {
      if (error) {
        console.error('No se pudo abrir el juego:', error);
      }
    });

    procesoJuegoActual = proceso;

    // Logros en vivo: mientras el juego esté abierto, se revisan los guardados nuevos.
    const vigilante = iniciarVigilanteDeLogros(juego, inicio);

    proceso.on('exit', () => {
      vigilante.detener();
      procesoJuegoActual = null;
      const fin = Date.now();
      const minutos = (fin - inicio) / 1000 / 60;
      sumarMinutosLauncher(juego, minutos);

      let tieneSave = false;
      let tamanoSaveKB = 0;

      // Preferimos la carpeta de guardado en AppData si el juego la especifica
      // (algunos juegos guardan ahí en vez de al lado del .exe). Si no,
      // buscamos en la carpeta del propio juego.
      const carpetaDeGuardado = resolverCarpetaGuardado(juego);

      if (carpetaDeGuardado) {
        const archivosGuardado = buscarArchivosDeGuardado(carpetaDeGuardado);
        registrarGuardadosDeSesion(juego, archivosGuardado, inicio, fin);
        tieneSave = archivosGuardado.length > 0;
        const totalBytes = archivosGuardado.reduce((total, archivo) => {
          try {
            return total + fs.statSync(archivo).size;
          } catch (error) {
            return total;
          }
        }, 0);
        tamanoSaveKB = Math.round(totalBytes / 1024);
      }

      resolve({ minutos, tieneSave, tamanoSaveKB });
    });
  });
});

ipcMain.handle('cerrar-juego', () => {
  if (procesoJuegoActual && procesoJuegoActual.pid) {
    // exec() lanza el juego a través de un proceso "envoltorio" (cmd.exe).
    // taskkill con /T mata también a los procesos hijos (el juego real),
    // no solo al envoltorio — si no, el juego quedaría abierto igual.
    exec(`taskkill /PID ${procesoJuegoActual.pid} /T /F`);
  }
});

/* ===================== DESCARGA E INSTALACIÓN ===================== */

// Nombres de .exe que vienen junto al juego pero NO son el juego
// (instaladores de runtime, desinstaladores, crash handlers, etc.)
const EXE_A_IGNORAR = [
  /^unins/i, /vcredist/i, /vc_redist/i, /dxsetup/i, /directx/i, /dotnet/i,
  /dotnetfx/i, /oalinst/i, /crashpad/i, /crashhandler/i, /redist/i,
  /^vcruntime/i, /setup\.exe$/i, /^install/i
];

// Busca el .exe del juego dentro de la carpeta recién descomprimida.
// RPG Maker suele dejarlo en la raíz ("Game.exe"), pero algunos zips
// traen todo adentro de una subcarpeta extra — por eso se recorre.
function buscarEjecutablePrincipal(carpeta, profundidadMax = 4) {
  const candidatos = [];
  function recorrer(dir, profundidad) {
    if (profundidad > profundidadMax) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const item of items) {
      const rutaCompleta = path.join(dir, item.name);
      if (item.isDirectory()) {
        recorrer(rutaCompleta, profundidad + 1);
      } else if (item.isFile() && /\.exe$/i.test(item.name)) {
        if (EXE_A_IGNORAR.some(patron => patron.test(item.name))) continue;
        candidatos.push({ ruta: rutaCompleta, profundidad, nombre: item.name });
      }
    }
  }
  recorrer(carpeta, 0);
  if (candidatos.length === 0) return null;

  // Preferimos: el más "arriba" (menos profundidad) y, si hay empate,
  // "Game.exe" (nombre estándar de RPG Maker) antes que cualquier otro.
  candidatos.sort((a, b) => {
    if (a.profundidad !== b.profundidad) return a.profundidad - b.profundidad;
    const aEsGame = /^game\.exe$/i.test(a.nombre) ? 0 : 1;
    const bEsGame = /^game\.exe$/i.test(b.nombre) ? 0 : 1;
    return aEsGame - bEsGame;
  });
  return candidatos[0].ruta;
}

function esLinkDeMega(url) {
  return /https?:\/\/(www\.)?mega\.(nz|co\.nz)\//i.test(url);
}

function descargarDeMega(url, rutaDestino, onProgreso) {
  return new Promise((resolve, reject) => {
    if (!MegaFile) {
      reject(new Error('Falta instalar la librería "megajs" (npm install megajs) para poder descargar desde Mega.'));
      return;
    }
    let archivoMega;
    try {
      archivoMega = MegaFile.fromURL(url);
    } catch (error) {
      reject(new Error('Ese link de Mega no parece válido.'));
      return;
    }

    archivoMega.loadAttributes((error, archivo) => {
      if (error) {
        // Mega devuelve errores propios (ENOENT = no existe, EBLOCKED = bajado/bloqueado, etc.)
        reject(new Error('No se pudo abrir el archivo de Mega: ' + (error.message || error)));
        return;
      }

      const total = archivo.size || 0;
      let recibidos = 0;
      const destino = fs.createWriteStream(rutaDestino);
      const stream = archivo.download();

      stream.on('data', (fragmento) => {
        recibidos += fragmento.length;
        if (onProgreso) onProgreso(recibidos, total);
      });
      stream.on('error', (e) => { destino.destroy(); reject(e); });
      destino.on('error', reject);
      destino.on('finish', () => resolve());

      stream.pipe(destino);
    });
  });
}

function descargarArchivo(url, rutaDestino, onProgreso) {
  return new Promise((resolve, reject) => {
    const intentar = (urlActual, redirecciones) => {
      if (redirecciones > 5) { reject(new Error('Demasiadas redirecciones al descargar.')); return; }

      https.get(urlActual, (respuesta) => {
        if ([301, 302, 303, 307, 308].includes(respuesta.statusCode)) {
          respuesta.resume(); // descarta el cuerpo de la redirección
          intentar(respuesta.headers.location, redirecciones + 1);
          return;
        }
        if (respuesta.statusCode !== 200) {
          respuesta.resume();
          reject(new Error(`El servidor respondió ${respuesta.statusCode} al descargar el juego.`));
          return;
        }

        const totalBytes = Number(respuesta.headers['content-length']) || 0;
        let bytesRecibidos = 0;
        const archivo = fs.createWriteStream(rutaDestino);

        respuesta.on('data', (fragmento) => {
          bytesRecibidos += fragmento.length;
          if (onProgreso) onProgreso(bytesRecibidos, totalBytes);
        });

        respuesta.pipe(archivo);
        archivo.on('finish', () => archivo.close(() => resolve()));
        archivo.on('error', reject);
        respuesta.on('error', reject);
      }).on('error', reject);
    };
    intentar(url, 0);
  });
}

// Descomprime en paralelo (varios archivos a la vez). Con miles de archivos chicos, que es lo
// típico de un juego de RPG Maker, esto es bastante más rápido que extraer de a uno, porque gran
// parte del tiempo se va en crear cada archivo (y en que el antivirus lo revise).
// Reporta el avance real (archivos extraídos / total). Si falta la librería yauzl,
// cae en extract-zip, que también informa el avance.
async function extraerZipConProgreso(rutaZip, destino, onProgreso) {
  let yauzl = null;
  try { yauzl = require('yauzl'); } catch (e) { yauzl = null; }

  if (!yauzl) {
    let hechos = 0;
    await extract(rutaZip, {
      dir: destino,
      onEntry: (entry, zipfile) => {
        hechos++;
        if (onProgreso) onProgreso(hechos, zipfile.entryCount);
      }
    });
    return;
  }

  const { pipeline } = require('stream/promises');
  const CONCURRENCIA = 12;
  const destinoReal = path.resolve(destino);

  return new Promise((resolve, reject) => {
    yauzl.open(rutaZip, { lazyEntries: true, autoClose: false }, (errorAbrir, zipfile) => {
      if (errorAbrir) { reject(errorAbrir); return; }

      const total = zipfile.entryCount;
      let hechos = 0;
      let activos = 0;
      let leyendo = false;        // hay un readEntry() pendiente de respuesta
      let terminoLectura = false; // ya se leyeron todas las entradas del zip
      let errorGuardado = null;

      const terminarSiCorresponde = () => {
        if (activos > 0 || leyendo) return;
        if (!terminoLectura && !errorGuardado) return;
        try { zipfile.close(); } catch (e) {}
        if (errorGuardado) reject(errorGuardado); else resolve();
      };
      const fallar = (e) => { if (!errorGuardado) errorGuardado = e; terminarSiCorresponde(); };
      const pedirMas = () => {
        if (errorGuardado || terminoLectura || leyendo || activos >= CONCURRENCIA) return;
        leyendo = true;
        zipfile.readEntry();
      };
      const entradaLista = () => {
        activos--;
        hechos++;
        if (onProgreso) onProgreso(hechos, total);
        pedirMas();
        terminarSiCorresponde();
      };

      zipfile.on('error', (e) => { leyendo = false; fallar(e); });
      zipfile.on('end', () => { leyendo = false; terminoLectura = true; terminarSiCorresponde(); });

      zipfile.on('entry', (entry) => {
        leyendo = false;
        if (errorGuardado) { terminarSiCorresponde(); return; }

        const destinoEntrada = path.resolve(destinoReal, entry.fileName);
        if (destinoEntrada !== destinoReal && !destinoEntrada.startsWith(destinoReal + path.sep)) {
          fallar(new Error(`El zip trae una ruta fuera de la carpeta de instalación: ${entry.fileName}`));
          return;
        }

        activos++;
        const esCarpeta = /\/$/.test(entry.fileName);

        if (esCarpeta) {
          fs.promises.mkdir(destinoEntrada, { recursive: true })
            .then(entradaLista, (e) => { activos--; fallar(e); });
        } else {
          fs.promises.mkdir(path.dirname(destinoEntrada), { recursive: true })
            .then(() => new Promise((res, rej) => {
              zipfile.openReadStream(entry, (e, lectura) => e ? rej(e) : res(lectura));
            }))
            .then((lectura) => pipeline(lectura, fs.createWriteStream(destinoEntrada)))
            .then(entradaLista, (e) => { activos--; fallar(e); });
        }
        pedirMas(); // seguimos leyendo entradas mientras estas se escriben
      });

      fs.mkdirSync(destinoReal, { recursive: true });
      pedirMas();
    });
  });
}

ipcMain.handle('descargar-juego', async (event, juego) => {
  const carpetaJuegos = path.join(app.getPath('userData'), 'juegos');
  if (!fs.existsSync(carpetaJuegos)) fs.mkdirSync(carpetaJuegos, { recursive: true });

  const rutaZip = path.join(carpetaJuegos, `${juego.id}.zip`);
  let carpetaDestino = null;

  if (!juego.urlDescarga) {
    throw new Error('Este juego todavía no tiene un link de descarga configurado.');
  }

  // Siempre preguntamos dónde instalar. Dentro de la carpeta elegida se crea una
  // subcarpeta propia del juego, así al desinstalar solo se borra esa subcarpeta
  // y nunca la carpeta que elegiste (que puede tener otras cosas).
  const eleccion = await dialog.showOpenDialog(ventanaPrincipal, {
    title: `¿Dónde querés instalar ${juego.nombre}?`,
    buttonLabel: 'Instalar acá',
    defaultPath: ultimaCarpetaDeInstalacion || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (eleccion.canceled || !eleccion.filePaths || eleccion.filePaths.length === 0) {
    return { ok: false, cancelado: true };
  }
  const carpetaElegida = eleccion.filePaths[0];
  ultimaCarpetaDeInstalacion = carpetaElegida;

  const nombreBase = String(juego.nombre || `juego-${juego.id}`)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim() || `juego-${juego.id}`;
  let candidata = path.join(carpetaElegida, nombreBase);
  for (let n = 2; fs.existsSync(candidata); n++) {
    candidata = path.join(carpetaElegida, `${nombreBase} (${n})`);
  }
  carpetaDestino = candidata;

  const enviarProgreso = (etapa, porcentaje) => {
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('progreso-descarga', { id: juego.id, etapa, porcentaje });
    }
  };

  try {
    enviarProgreso('descargando', 0);
    const descargar = esLinkDeMega(juego.urlDescarga) ? descargarDeMega : descargarArchivo;
    await descargar(juego.urlDescarga, rutaZip, (recibidos, total) => {
      const porcentaje = total > 0 ? Math.min(99, Math.round((recibidos / total) * 100)) : null;
      enviarProgreso('descargando', porcentaje);
    });

    enviarProgreso('instalando', 0);
    let ultimoPorcentajeInstalacion = 0;
    await extraerZipConProgreso(rutaZip, carpetaDestino, (hechos, total) => {
      const porcentaje = total > 0 ? Math.min(99, Math.floor((hechos / total) * 100)) : null;
      if (porcentaje !== ultimoPorcentajeInstalacion) {
        ultimoPorcentajeInstalacion = porcentaje;
        enviarProgreso('instalando', porcentaje);
      }
    });
    fs.unlinkSync(rutaZip);

    const rutaEjecutable = buscarEjecutablePrincipal(carpetaDestino);
    enviarProgreso('listo', 100);

    return { ok: true, carpetaInstalada: carpetaDestino, rutaEjecutable };
  } catch (error) {
    // Limpiamos lo que haya quedado a medio bajar/instalar para no dejar basura.
    try { if (fs.existsSync(rutaZip)) fs.unlinkSync(rutaZip); } catch (e) {}
    // carpetaDestino siempre es una carpeta nueva creada por esta instalación, así que es seguro borrarla.
    try { if (carpetaDestino && fs.existsSync(carpetaDestino)) fs.rmSync(carpetaDestino, { recursive: true, force: true }); } catch (e) {}
    console.error('No se pudo descargar/instalar el juego:', error);
    throw new Error(error.message || 'No se pudo descargar el juego.');
  }
});

// Carpetas que NUNCA se borran, pase lo que pase (protección contra rutas mal registradas).
function esCarpetaProtegida(ruta, creadaPorElLauncher) {
  const r = path.resolve(ruta);
  if (path.parse(r).root === r) return true; // raíz de un disco (C:\, D:\)
  const partes = r.slice(path.parse(r).root.length).split(path.sep).filter(Boolean);
  if (partes.length < 2 && !creadaPorElLauncher) return true; // ej: D:\JUEGOS — demasiado arriba para ser "la carpeta de un juego"
  const protegidas = [os.homedir(), app.getPath('desktop'), app.getPath('documents'), app.getPath('downloads'),
    app.getPath('userData'), path.join(app.getPath('userData'), 'juegos'),
    process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.SystemRoot, process.env.APPDATA]
    .filter(Boolean).map(p => path.resolve(p).toLowerCase());
  return protegidas.includes(r.toLowerCase());
}

// Borra la carpeta COMPLETA del juego: la instalada por el launcher o, si el juego
// se registró con una ruta propia, la carpeta donde vive su .exe.
ipcMain.handle('desinstalar-juego', (event, juego) => {
  try {
    let carpeta = juego.carpetaInstalada || (juego.rutaEjecutable ? path.dirname(juego.rutaEjecutable) : null);
    if (!carpeta) return { ok: true, carpetaBorrada: null };

    carpeta = path.resolve(carpeta);
    if (esCarpetaProtegida(carpeta, !!juego.carpetaInstalada)) {
      return { ok: false, error: `Por seguridad no borro "${carpeta}" (es una carpeta demasiado general). Borrala a mano si de verdad querés eliminarla.` };
    }

    if (fs.existsSync(carpeta)) {
      // maxRetries: en Windows el borrado falla a veces unos instantes después de cerrar el juego.
      fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
    }
    return { ok: true, carpetaBorrada: carpeta };
  } catch (error) {
    console.error('No se pudo desinstalar el juego:', error);
    const ocupado = ['EBUSY', 'EPERM', 'EACCES'].includes(error.code);
    return {
      ok: false,
      error: ocupado
        ? 'Hay archivos en uso. Cerrá el juego (y cualquier ventana de esa carpeta) y probá de nuevo.'
        : (error.message || 'No se pudo borrar la carpeta.')
    };
  }
});

/* ===================== LOGROS REALES (leer Game.rxdata) ===================== */

// Misma lógica que usa jugar-juego para encontrar la carpeta de guardado de un juego.
function carpetaDeGuardadoDe(juego) {
  return resolverCarpetaGuardado(juego);
}

function buscarArchivoDeGuardadoMasReciente(carpetaJuego, juegoId = null) {
  let candidatos = buscarArchivosDeGuardado(carpetaJuego);
  if (juegoId !== null && juegoId !== undefined) {
    candidatos = candidatos.filter(ruta => esGuardadoVerificado(juegoId, ruta));
  }
  if (candidatos.length === 0) return null;

  let masReciente = candidatos[0];
  let fechaMasReciente = fs.statSync(masReciente).mtimeMs;
  for (const archivo of candidatos) {
    const fecha = fs.statSync(archivo).mtimeMs;
    if (fecha > fechaMasReciente) {
      masReciente = archivo;
      fechaMasReciente = fecha;
    }
  }
  return masReciente;
}

// Game.rxdata de Essentials NO es un solo objeto Marshal: son varios Marshal.dump uno detrás de otro
// ($Trainer, frame_count, $game_system, $PokemonSystem, mapa, $game_switches, $game_variables, ...).
// Esta función recorre el buffer sin decodificar nada y devuelve cuántos bytes ocupa cada objeto.
function separarObjetosMarshal(buf) {
  const trozos = [];
  let pos = 0;
  while (pos + 2 <= buf.length && buf[pos] === 4 && buf[pos + 1] === 8) {
    let i = pos + 2;
    const leerLong = () => {
      const c = buf.readInt8(i++);
      if (c === 0) return 0;
      if (c > 4) return c - 5;
      if (c < -4) return c + 5;
      if (c > 0) { let x = 0; for (let k = 0; k < c; k++) x += buf[i++] * 2 ** (8 * k); return x; }
      i += -c; return -1;
    };
    const saltar = () => {
      const t = String.fromCharCode(buf[i++]);
      switch (t) {
        case '0': case 'T': case 'F': return;
        case 'i': leerLong(); return;
        case ';': case '@': leerLong(); return;
        case ':': case '"': case 'f': case 'c': case 'm': case 'M': { const n = leerLong(); i += n; } return;
        case 'l': { i++; const n = leerLong(); i += n * 2; } return;
        case '/': { const n = leerLong(); i += n + 1; } return;
        case 'I': { saltar(); const n = leerLong(); for (let k = 0; k < n; k++) { saltar(); saltar(); } return; }
        case '[': { const n = leerLong(); for (let k = 0; k < n; k++) saltar(); return; }
        case '{': case '}': { const n = leerLong(); for (let k = 0; k < n * 2; k++) saltar(); if (t === '}') saltar(); return; }
        case 'o': case 'S': { saltar(); const n = leerLong(); for (let k = 0; k < n; k++) { saltar(); saltar(); } return; }
        case 'u': { saltar(); const n = leerLong(); i += n; } return;
        case 'U': case 'C': case 'e': case 'd': saltar(); saltar(); return;
        default: throw new Error('Tipo Marshal desconocido: ' + t);
      }
    };
    try { saltar(); } catch (e) { break; }
    if (i > buf.length) break;
    trozos.push(buf.subarray(pos, i));
    pos = i;
  }
  return trozos;
}

// Un guardado de Essentials trae varios objetos Marshal seguidos. Los decodificamos todos y los
// devolvemos en un array, así buscarPorClase encuentra Game_Switches, Game_Variables, etc.
// Si el archivo trae un solo objeto (otros juegos), se devuelve tal cual, como antes.
async function decodificarPartida(rutaArchivo) {
  const { load } = await import('@hyrious/marshal');
  const buffer = fs.readFileSync(rutaArchivo);
  const trozos = separarObjetosMarshal(buffer);
  if (trozos.length <= 1) return load(buffer);
  const objetos = [];
  for (const trozo of trozos) {
    try { objetos.push(load(trozo)); } catch (e) { /* un objeto ilegible (ej: gráficos) no debe tirar el resto */ }
  }
  return objetos;
}

// Ruby guarda las claves de Hash y las variables de instancia como símbolos,
// que en JS son claves Symbol (no aparecen en Object.keys). Este helper
// devuelve TODAS las claves de un nodo, sean de texto o símbolo.
function todasLasClaves(nodo) {
  return [...Object.keys(nodo), ...Object.getOwnPropertySymbols(nodo)];
}

function nombreDeClave(clave) {
  return typeof clave === 'symbol' ? clave.description : String(clave);
}

// Recorre el árbol decodificado buscando el primer objeto Ruby cuya clase
// coincida con el patrón (ej: /Player|Trainer/i), sin importar cuán anidado esté.
function buscarPorClase(nodo, patronClase, visitados = new Set(), profundidad = 0) {
  if (nodo === null || typeof nodo !== 'object' || profundidad > 14) return null;
  if (visitados.has(nodo)) return null;
  visitados.add(nodo);

  const nombreClase = nodo.class && (nodo.class.description || String(nodo.class));
  if (nombreClase && patronClase.test(nombreClase)) return nodo;

  if (Array.isArray(nodo)) {
    for (const item of nodo) {
      const resultado = buscarPorClase(item, patronClase, visitados, profundidad + 1);
      if (resultado) return resultado;
    }
    return null;
  }

  for (const clave of todasLasClaves(nodo)) {
    const resultado = buscarPorClase(nodo[clave], patronClase, visitados, profundidad + 1);
    if (resultado) return resultado;
  }
  return null;
}

// Busca un valor por varios nombres posibles (de clave normal, símbolo,
// o variable de instancia con '@'), comparando por texto.
function leerCampo(nodo, nombresPosibles) {
  if (!nodo || typeof nodo !== 'object') return undefined;

  for (const clave of todasLasClaves(nodo)) {
    const nombreClave = nombreDeClave(clave);
    const coincide = nombresPosibles.some(nombre =>
      nombreClave === nombre || nombreClave === '@' + nombre
    );
    if (coincide) return nodo[clave];
  }
  return undefined;
}

// Busca yo la lista de índices en TRUE dentro del array de switches del juego
// (Game_Switches#@data). La usan tanto el diagnóstico como la lectura de
// logros reales, así los switches funcionan también durante el juego normal.
function listarSwitchesActivosDe(partida) {
  const nodo = buscarPorClase(partida, /Game_Switches/i);
  const datos = nodo ? leerCampo(nodo, ['data']) : null;
  if (!Array.isArray(datos)) return [];
  const activos = [];
  datos.forEach((valor, indice) => { if (valor === true) activos.push(indice); });
  return activos;
}

// Devuelve el array completo de $game_variables (números, texto, etc.),
// para logros tipo "contador de X >= N" (ej: derrotas al Alto Mando).
function listarVariablesDe(partida) {
  const nodo = buscarPorClase(partida, /Game_Variables/i);
  const datos = nodo ? leerCampo(nodo, ['data']) : null;
  if (!Array.isArray(datos)) return [];
  return datos.map(valor => (typeof valor === 'number' || typeof valor === 'string') ? valor : null);
}


// Data/System.rxdata vive al lado del .exe del juego (no es un guardado —
// es parte del propio juego) y trae los nombres que el desarrollador le
// puso a cada switch/variable en su editor de RPG Maker. Si el juego no
// empaquetó sus datos en un .rgss2a encriptado, podemos leerlos directo.
ipcMain.handle('leer-nombres-switches', async (event, juego) => {
  try {
    if (!juego.rutaEjecutable) {
      return { ok: false, error: 'Este juego no tiene ruta de ejecutable configurada.' };
    }

    const rutaSystem = path.join(path.dirname(juego.rutaEjecutable), 'Data', 'System.rxdata');
    if (!fs.existsSync(rutaSystem)) {
      return {
        ok: false,
        error: `No encontré "${rutaSystem}". Probablemente el juego empaquetó su carpeta Data dentro de un archivo .rgss2a encriptado — en ese caso hay que sacarlo de ahí, que es otra historia.`
      };
    }

    const sistema = await decodificarPartida(rutaSystem);
    const switches = leerCampo(sistema, ['switches']);
    const variables = leerCampo(sistema, ['variables']);

    function formatearLista(lista) {
      if (!Array.isArray(lista)) return '(no se encontró la lista)';
      const lineas = [];
      lista.forEach((nombre, indice) => {
        if (typeof nombre === 'string' && nombre.trim() !== '') {
          lineas.push(`  [${indice}] ${nombre}`);
        }
      });
      return lineas.length ? lineas.join('\n') : '(todos sin nombre)';
    }

    let texto = '===== NOMBRES DE SWITCHES (puestos por el desarrollador en su editor) =====\n\n';
    texto += formatearLista(switches) + '\n\n';
    texto += '===== NOMBRES DE VARIABLES =====\n\n';
    texto += formatearLista(variables) + '\n';

    const rutaSalida = path.join(app.getPath('userData'), `switches-nombrados-${juego.id}.txt`);
    fs.writeFileSync(rutaSalida, texto, 'utf-8');

    return { ok: true, ruta: rutaSalida };
  } catch (error) {
    console.error('No se pudo leer Data/System.rxdata:', error);
    return { ok: false, error: error.message };
  }
});

// Saca de una partida ya decodificada todo lo que usan los logros (equipo, medallas, Pokédex,
// switches, variables...). La usan tanto leer-progreso-real (al cerrar el juego) como el
// vigilante en vivo (mientras el juego está abierto).
function calcularStatsDePartida(partida) {
  const jugador = buscarPorClase(partida, /Player|Trainer/i);
  const equipo = jugador ? leerCampo(jugador, ['party', 'pokemonParty', 'pokemon_party']) : null;
  const medallasRaw = jugador ? leerCampo(jugador, ['badges']) : null;
  const dinero = jugador ? leerCampo(jugador, ['money']) : null;

  const pokedexNodo = buscarPorClase(partida, /Pokedex/i) || jugador;
  const vistos = pokedexNodo ? leerCampo(pokedexNodo, ['seen', 'pokedexSeen']) : null;
  const capturados = pokedexNodo ? leerCampo(pokedexNodo, ['owned', 'pokedexOwned']) : null;

  // @seen y @owned de la Pokédex vienen como Hash (ej: {CHARMANDER: true, ...}),
  // no como array — así que contamos valores "true" sirva Array o Hash.
  function contarTrue(valor) {
    if (Array.isArray(valor)) return valor.filter(Boolean).length;
    if (valor && typeof valor === 'object') {
      return todasLasClaves(valor).filter(clave => valor[clave] === true).length;
    }
    return null;
  }

  // Nombres de especie con owned=true (para logros de legendarios puntuales).
  function especiesCapturadas(valor) {
    if (!valor || typeof valor !== 'object') return [];
    return todasLasClaves(valor)
      .filter(clave => valor[clave] === true)
      .map(clave => nombreDeClave(clave));
  }

  // Junta el equipo + las 50 cajas del PC en una sola lista de Pokémon,
  // para poder buscar shinys en cualquier lado (no solo en el equipo).
  function recolectarTodosLosPokemon() {
    const todos = [];
    if (Array.isArray(equipo)) todos.push(...equipo);

    const almacen = buscarPorClase(partida, /PokemonStorage/i);
    const cajas = almacen ? leerCampo(almacen, ['boxes']) : null;
    if (Array.isArray(cajas)) {
      cajas.forEach(caja => {
        const pokemonDeCaja = leerCampo(caja, ['pokemon']);
        if (Array.isArray(pokemonDeCaja)) {
          pokemonDeCaja.forEach(p => { if (p) todos.push(p); });
        }
      });
    }
    return todos;
  }

  const nivelesEquipo = Array.isArray(equipo)
    ? equipo.map(p => leerCampo(p, ['level'])).filter(n => typeof n === 'number')
    : [];

  const todosLosPokemon = recolectarTodosLosPokemon();
  const shinysActuales = todosLosPokemon.filter(p => leerCampo(p, ['shiny']) === true).length;

  // Don Prodigio (Pokémon Iberia) no activa ningún switch: el intercambio lo hace un script
  // (TradeExpert). El Pokémon que te da queda con entrenador original "C. Prodigioso" y
  // trainerID 1204, así que se detecta buscándolo en el equipo y en las cajas del PC.
  function textoDe(valor) {
    if (valor == null) return '';
    if (typeof valor === 'string') return valor;
    if (Buffer.isBuffer(valor) || valor instanceof Uint8Array) return Buffer.from(valor).toString('utf8');
    return String(valor);
  }
  const tradeConProdigio = todosLosPokemon.some(p => {
    const ot = textoDe(leerCampo(p, ['ot', 'OT'])).toLowerCase();
    const idEntrenador = leerCampo(p, ['trainerID', 'trainerId', 'trainer_id']);
    return ot.includes('prodigioso') || idEntrenador === 1204;
  });

  // --- Datos extra para logros de Pokémon Realidea (y cualquier juego que los use) ---
  // Mapas pisados: $PokemonGlobal.visitedMaps es un array indexado por ID de mapa (true = visitado).
  const globalNodo = buscarPorClase(partida, /PokemonGlobal/i);
  const mapasRaw = globalNodo ? leerCampo(globalNodo, ['visitedMaps']) : null;
  const mapasVisitados = [];
  if (Array.isArray(mapasRaw)) mapasRaw.forEach((v, idx) => { if (v === true) mapasVisitados.push(idx); });

  // Misiones: $Trainer.quests es un array de Quest con @id y @completed.
  const questsRaw = jugador ? leerCampo(jugador, ['quests']) : null;
  const misionesCompletadas = [];
  if (Array.isArray(questsRaw)) {
    questsRaw.forEach(q => {
      if (q && leerCampo(q, ['completed']) === true) {
        const idQ = leerCampo(q, ['id']);
        if (typeof idQ === 'number' && !misionesCompletadas.includes(idQ)) misionesCompletadas.push(idQ);
      }
    });
  }

  // Amistad (@happiness): la más alta de todos los Pokémon, y la más baja del equipo si está completo.
  const amistades = todosLosPokemon.map(p => leerCampo(p, ['happiness'])).filter(n => typeof n === 'number');
  const amistadesEquipo = Array.isArray(equipo)
    ? equipo.map(p => leerCampo(p, ['happiness'])).filter(n => typeof n === 'number')
    : [];
  const amistadMaxima = amistades.length ? Math.max(...amistades) : null;
  const amistadMinimaEquipo = amistadesEquipo.length ? Math.min(...amistadesEquipo) : null;

  // Pokémon que vino de un huevo (obtainMode 1 = huevo/eclosionado en Essentials).
  const hayPokemonDeHuevo = todosLosPokemon.some(p => leerCampo(p, ['obtainMode']) === 1 || (leerCampo(p, ['eggsteps']) || 0) > 0);

  const switchesActivos = listarSwitchesActivosDe(partida);
  const variables = listarVariablesDe(partida);

  return {
    tienePrimerPokemon: Array.isArray(equipo) && equipo.length > 0,
    tamanoEquipo: Array.isArray(equipo) ? equipo.length : null,
    medallas: Array.isArray(medallasRaw) ? medallasRaw.map(b => b === true) : null,
    dinero: typeof dinero === 'number' ? dinero : null,
    pokedexVistos: contarTrue(vistos),
    pokedexCapturados: contarTrue(capturados),
    pokedexEspeciesCapturadas: especiesCapturadas(capturados),
    pokedexEspeciesVistas: especiesCapturadas(vistos),
    mapasVisitados,
    misionesCompletadas,
    amistadMaxima,
    amistadMinimaEquipo,
    hayPokemonDeHuevo,
    nivelMaximoEquipo: nivelesEquipo.length > 0 ? Math.max(...nivelesEquipo) : null,
    nivelMinimoEquipo: nivelesEquipo.length > 0 ? Math.min(...nivelesEquipo) : null,
    shinysActuales,
    tradeConProdigio,
    switchesActivos,
    variables
  };
}

ipcMain.handle('leer-progreso-real', async (event, juego) => {
  try {
    const carpeta = carpetaDeGuardadoDe(juego);
    if (!carpeta) return { ok: false, error: 'Este juego no tiene carpeta de guardado configurada.' };

    const archivo = buscarArchivoDeGuardadoMasReciente(carpeta, juego.id);
    if (!archivo) {
      let detalle;
      if (!fs.existsSync(carpeta)) {
        detalle = 'La carpeta de guardado no existe: "' + carpeta + '". Revisá carpetaGuardadoJuegosGuardados / carpetaGuardadoAppData en el catálogo.';
      } else {
        const hay = buscarArchivosDeGuardado(carpeta).length;
        detalle = hay === 0
          ? 'No hay archivos de guardado en "' + carpeta + '". ¿Guardaste la partida dentro del juego antes de cerrarlo?'
          : 'Hay ' + hay + ' guardado(s) en "' + carpeta + '", pero ninguno se escribió durante una sesión abierta desde el launcher. Guardá dentro del juego y cerralo.';
      }
      return { ok: false, error: detalle, noVerificado: true };
    }

    const partida = await decodificarPartida(archivo);

    const plausible = tiempoDelGuardadoPlausible(juego, partida);
    if (!plausible.ok) {
      return {
        ok: false,
        noVerificado: true,
        sospechoso: true,
        error: 'Este guardado tiene muchas más horas de juego (' + Math.round(plausible.minutosGuardado / 60 * 10) / 10 +
               ' h) de las que el launcher vio jugar (' + Math.round(plausible.minutosLauncher / 60 * 10) / 10 +
               ' h). Los logros solo cuentan partidas jugadas desde el launcher.'
      };
    }

    return { ok: true, stats: calcularStatsDePartida(partida) };
  } catch (error) {
    console.error('No se pudo leer el progreso real:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('volcar-diagnostico-partida', async (event, juego) => {
  try {
    const carpeta = carpetaDeGuardadoDe(juego);
    if (!carpeta) return { ok: false, error: 'Este juego no tiene carpeta de guardado configurada.' };

    const archivo = buscarArchivoDeGuardadoMasReciente(carpeta);
    if (!archivo) return { ok: false, error: 'Todavía no encontramos un archivo de guardado.' };

    const partida = await decodificarPartida(archivo);

    const vistos = new Set();
    function volcar(nodo, profundidad) {
      const sangria = '  '.repeat(profundidad);
      if (profundidad > 8) return sangria + '...(demasiado profundo)\n';
      if (nodo === null || nodo === undefined) return sangria + 'nil\n';
      if (typeof nodo === 'symbol') return sangria + ':' + nodo.description + '\n';

      if (typeof nodo !== 'object') {
        return sangria + JSON.stringify(nodo) + '\n';
      }
      if (vistos.has(nodo)) return sangria + '(referencia repetida)\n';
      vistos.add(nodo);

      if (Array.isArray(nodo)) {
        let texto = sangria + `Array (${nodo.length} elementos)\n`;
        nodo.slice(0, 15).forEach((item, i) => {
          texto += sangria + `  [${i}]\n` + volcar(item, profundidad + 2);
        });
        if (nodo.length > 15) texto += sangria + `  ...y ${nodo.length - 15} más\n`;
        return texto;
      }

      const nombreClase = nodo.class && (nodo.class.description || String(nodo.class));
      let texto = sangria + (nombreClase ? `<${nombreClase}>\n` : 'Hash/Objeto\n');
      const claves = todasLasClaves(nodo).slice(0, 40);
      claves.forEach(clave => {
        const etiqueta = typeof clave === 'symbol' ? ':' + clave.description : clave;
        texto += sangria + `  ${etiqueta}:\n` + volcar(nodo[clave], profundidad + 2);
      });
      return texto;
    }

    const textoFinal = volcar(partida, 0);

    // Resumen SIN recortar de switches/variables — el árbol de arriba corta
    // los arrays largos en 15 elementos, y los switches de eventos de
    // historia suelen estar mucho más adelante que eso.
    function listarVariablesNoVacias() {
      const nodo = buscarPorClase(partida, /Game_Variables/i);
      const datos = nodo ? leerCampo(nodo, ['data']) : null;
      if (!Array.isArray(datos)) return [];
      const resultado = [];
      datos.forEach((valor, indice) => {
        if (valor !== null && valor !== undefined && valor !== 0 && valor !== '') {
          resultado.push(`  [${indice}] = ${JSON.stringify(valor)}`);
        }
      });
      return resultado;
    }

    const switchesActivos = listarSwitchesActivosDe(partida);
    const variablesNoVacias = listarVariablesNoVacias();

    let resumen = '===== RESUMEN — SWITCHES Y VARIABLES (completo, sin recortar) =====\n\n';
    resumen += `Switches en TRUE (${switchesActivos.length} activos):\n`;
    resumen += (switchesActivos.length ? switchesActivos.join(', ') : '(ninguno)') + '\n\n';
    resumen += `Variables con valor (${variablesNoVacias.length} de 235):\n`;
    resumen += (variablesNoVacias.length ? variablesNoVacias.join('\n') : '  (ninguna)') + '\n\n';
    resumen += '===== ÁRBOL COMPLETO (este sí recorta arrays largos a 15 items) =====\n\n';

    const rutaSalida = path.join(app.getPath('userData'), `diagnostico-${juego.id}.txt`);
    fs.writeFileSync(rutaSalida, resumen + textoFinal, 'utf-8');

    return { ok: true, ruta: rutaSalida };
  } catch (error) {
    console.error('No se pudo diagnosticar la partida:', error);
    return { ok: false, error: error.message };
  }
});

/* ===================== CONFIGURACIÓN ===================== */

const archivoConfiguracion = path.join(app.getPath('userData'), 'configuracion.json');
const configuracionPorDefecto = { volumen: 70 };

ipcMain.handle('cargar-configuracion', () => {
  if (fs.existsSync(archivoConfiguracion)) {
    try {
      const contenido = fs.readFileSync(archivoConfiguracion, 'utf-8');
      return { ...configuracionPorDefecto, ...JSON.parse(contenido) };
    } catch (error) {
      console.error('configuracion.json está corrupto, se usan los valores por defecto:', error);
      return configuracionPorDefecto;
    }
  }
  return configuracionPorDefecto;
});

ipcMain.handle('guardar-configuracion', (event, config) => {
  fs.writeFileSync(archivoConfiguracion, JSON.stringify(config, null, 2));
});

ipcMain.handle('obtener-carpeta-datos', () => {
  return app.getPath('userData');
});

ipcMain.handle('abrir-carpeta-datos', () => {
  shell.openPath(app.getPath('userData'));
});

ipcMain.handle('abrir-externo', (event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
});

ipcMain.handle('restablecer-biblioteca', () => {
  if (fs.existsSync(archivoDatos)) {
    fs.unlinkSync(archivoDatos);
  }
  almacenMemoria = {};
  volcarAlmacenAhora();
  const carpetaJuegos = path.join(app.getPath('userData'), 'juegos');
  if (fs.existsSync(carpetaJuegos)) {
    fs.rmSync(carpetaJuegos, { recursive: true, force: true });
  }
  return true;
});

/* ===================== CONTROLES DE VENTANA ===================== */

ipcMain.handle('minimizar-ventana', () => {
  ventanaPrincipal.minimize();
});

ipcMain.handle('maximizar-ventana', () => {
  if (ventanaPrincipal.isMaximized()) {
    ventanaPrincipal.unmaximize();
  } else {
    ventanaPrincipal.maximize();
  }
});

ipcMain.handle('cerrar-ventana', () => {
  ventanaPrincipal.close();
});

/* ===================== VENTANA PRINCIPAL ===================== */

function createWindow() {
  ventanaPrincipal = new BrowserWindow({
    width: 1300,
    height: 800,
    frame: false,
    transparent: true,
    // Ícono de la ventana y de la barra de tareas (icon.ico va al lado del main.js)
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  ventanaPrincipal.loadFile('index.html');
  // Deja la versión del programa disponible para la pantalla "Acerca de": window.__VERSION_APP
  ventanaPrincipal.webContents.on('did-finish-load', () => {
    ventanaPrincipal.webContents.executeJavaScript('window.__VERSION_APP = ' + JSON.stringify(app.getVersion()) + ';').catch(() => {});
  });

  // La ventana del aviso de logros es una ventana más: si no se cierra, la app no termina al cerrar el launcher.
  ventanaPrincipal.on('closed', () => {
    if (ventanaToast && !ventanaToast.isDestroyed()) ventanaToast.destroy();
  });
}

/* ===================== ACTUALIZACIONES AUTOMÁTICAS ===================== */
// Cuando publicás una versión nueva en GitHub Releases, el launcher instalado la detecta, la descarga sola y,
// cuando está lista, avisa con una ventana. Sólo funciona en el programa instalado (no con "npm start").
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) {
  console.warn('electron-updater no está instalado: las actualizaciones automáticas están desactivadas.');
}

function iniciarActualizador() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;   // si elige "Más tarde", se instala al cerrar el launcher

  // Actualización FORZADA: no se puede elegir "más tarde". Apenas se baja la versión nueva se instala y el launcher se reabre solo.
  autoUpdater.on('update-available', () => {
    if (ventanaPrincipal && !ventanaPrincipal.isDestroyed()) ventanaPrincipal.setProgressBar(2); // barra indeterminada en la barra de tareas
  });
  autoUpdater.on('download-progress', (p) => {
    if (ventanaPrincipal && !ventanaPrincipal.isDestroyed()) ventanaPrincipal.setProgressBar((p.percent || 0) / 100);
  });
  autoUpdater.on('update-downloaded', async (info) => {
    if (ventanaPrincipal && !ventanaPrincipal.isDestroyed()) ventanaPrincipal.setProgressBar(-1);
    await dialog.showMessageBox(ventanaPrincipal && !ventanaPrincipal.isDestroyed() ? ventanaPrincipal : undefined, {
      type: 'info',
      buttons: ['Actualizar ahora'],
      defaultId: 0,
      noLink: true,
      title: 'Actualización obligatoria',
      message: 'Hay una versión nueva del launcher (' + info.version + ').',
      detail: 'Se va a instalar ahora y el launcher se abrirá solo cuando termine.'
    });
    autoUpdater.quitAndInstall(true, true);   // instalación silenciosa y vuelve a abrirse sola
  });
  autoUpdater.on('error', (error) => console.warn('Actualizador:', error && error.message));

  const buscar = () => autoUpdater.checkForUpdates().catch((error) => console.warn('No se pudo buscar actualizaciones:', error && error.message));
  buscar();
  setInterval(buscar, 4 * 60 * 60 * 1000);   // y cada 4 horas mientras esté abierto
}

app.whenReady().then(() => {
  if (!instanciaUnica) return;
  createWindow();
  iniciarActualizador();

  // Para probar el aviso sin jugar:  npx electron . --probar-toast
  if (process.argv.includes('--probar-toast')) {
    setTimeout(() => {
      mostrarLogro({ nombre: '🏆 Logro de prueba', descripcion: 'Así se va a ver el aviso cuando desbloquees un logro.', imagen: null });
      mostrarLogro({ nombre: '🌟 Segundo aviso', descripcion: 'Si se desbloquean varios, salen uno después del otro.', imagen: null });
    }, 2500);
  }
});