// notificaciones-main.js — notificación de Windows cuando un amigo te escribe y el launcher no está en primer plano.
// (Con el launcher a la vista, el aviso se dibuja dentro del propio launcher.)
const { Notification } = require('electron');

const vivas = new Set();   // mantiene las notificaciones referenciadas para que no se pierda el clic

function iniciar(ipcMain, getVentana) {
  ipcMain.handle('notif:mensaje', (_e, o) => {
    if (!o || !Notification.isSupported()) return { ok: false };
    const n = new Notification({
      title: String(o.titulo || 'Mensaje nuevo').slice(0, 80),
      body: String(o.cuerpo || '').slice(0, 200),
      silent: true      // el sonido lo reproduce el launcher (con su volumen en Configuración → Sonidos)
    });
    vivas.add(n);
    const soltar = () => vivas.delete(n);
    n.on('close', soltar); n.on('failed', soltar);
    n.on('click', () => {
      soltar();
      const v = getVentana && getVentana();
      if (v && !v.isDestroyed()) {
        if (v.isMinimized()) v.restore();
        v.show(); v.focus();
        v.webContents.send('notif:abrir-chat', String(o.uid || ''));   // abre el chat de ese amigo
      }
    });
    n.show();
    return { ok: true };
  });
}

module.exports = { iniciar };