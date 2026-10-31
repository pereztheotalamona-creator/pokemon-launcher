const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  cargarCatalogo: () => ipcRenderer.invoke('cargar-catalogo'),
  cargarBiblioteca: () => ipcRenderer.invoke('cargar-biblioteca'),
  guardarBiblioteca: (juegos) => ipcRenderer.invoke('guardar-biblioteca', juegos),
  jugarJuego: (juego) => ipcRenderer.invoke('jugar-juego', juego),
  cerrarJuego: () => ipcRenderer.invoke('cerrar-juego'),
  descargarJuego: (juego) => ipcRenderer.invoke('descargar-juego', juego),
  desinstalarJuego: (juego) => ipcRenderer.invoke('desinstalar-juego', juego),
  minimizarVentana: () => ipcRenderer.invoke('minimizar-ventana'),
  maximizarVentana: () => ipcRenderer.invoke('maximizar-ventana'),
  cerrarVentana: () => ipcRenderer.invoke('cerrar-ventana'),
  cargarConfiguracion: () => ipcRenderer.invoke('cargar-configuracion'),
  guardarConfiguracion: (config) => ipcRenderer.invoke('guardar-configuracion', config),
  obtenerCarpetaDatos: () => ipcRenderer.invoke('obtener-carpeta-datos'),
  abrirCarpetaDatos: () => ipcRenderer.invoke('abrir-carpeta-datos'),
  restablecerBiblioteca: () => ipcRenderer.invoke('restablecer-biblioteca'),
  leerProgresoReal: (juego) => ipcRenderer.invoke('leer-progreso-real', juego),
  volcarDiagnosticoPartida: (juego) => ipcRenderer.invoke('volcar-diagnostico-partida', juego),
  leerNombresSwitches: (juego) => ipcRenderer.invoke('leer-nombres-switches', juego),
  abrirExterno: (url) => ipcRenderer.invoke('abrir-externo', url),
  probarLogro: () => ipcRenderer.invoke('probar-logro'),

  // Avisos de mensajes (notificación de Windows cuando el launcher no está en primer plano)
  notificarMensaje: (o) => ipcRenderer.invoke('notif:mensaje', o),
  onAbrirChat: (cb) => {
    const h = (e, uid) => cb(uid);
    ipcRenderer.on('notif:abrir-chat', h);
    return () => ipcRenderer.removeListener('notif:abrir-chat', h);
  },

  // Capturas de pantalla
  capturasActivar: (o) => ipcRenderer.invoke('capturas:activar', o),
  capturasProbarTecla: (tecla) => ipcRenderer.invoke('capturas:probar-tecla', tecla),
  capturasDesactivar: () => ipcRenderer.invoke('capturas:desactivar'),
  capturasListar: (uid) => ipcRenderer.invoke('capturas:listar', uid),
  capturasLeer: (uid, archivo, modo) => ipcRenderer.invoke('capturas:leer', uid, archivo, modo),
  capturasRenombrar: (uid, archivo, nombre) => ipcRenderer.invoke('capturas:renombrar', uid, archivo, nombre),
  capturasBorrar: (uid, archivo) => ipcRenderer.invoke('capturas:borrar', uid, archivo),
  capturasAbrirCarpeta: (uid) => ipcRenderer.invoke('capturas:abrir-carpeta', uid),
  onCapturaNueva: (cb) => {
    const h = (e, c) => cb(c);
    ipcRenderer.on('capturas:nueva', h);
    return () => ipcRenderer.removeListener('capturas:nueva', h);
  },

  // Almacén cifrado por cuenta (síncrono, reemplaza al localStorage para el progreso)
  almacenObtener: (clave) => ipcRenderer.sendSync('almacen-obtener', clave),
  almacenGuardar: (clave, valor) => ipcRenderer.sendSync('almacen-guardar', clave, valor),
  almacenBorrar: (clave) => ipcRenderer.sendSync('almacen-borrar', clave),
  almacenClaves: () => ipcRenderer.sendSync('almacen-claves'),

  // Progreso de descarga/instalación. Devuelve una función para dejar de escuchar.
  onProgresoDescarga: (callback) => {
    const manejador = (event, datos) => callback(datos);
    ipcRenderer.on('progreso-descarga', manejador);
    return () => ipcRenderer.removeListener('progreso-descarga', manejador);
  }
});