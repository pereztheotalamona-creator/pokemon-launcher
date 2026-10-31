/* ============================================================
   firebase-init.js
   Módulo de Amigos y Comunidad — cuentas online con Firebase.
   Se carga como <script> normal en index.html, DESPUÉS de los
   SDK de Firebase (ver INTEGRACION.md). Expone todo en window.amigosAPI
   ============================================================ */

// ⚠️ PEGÁ ACÁ TU CONFIG (Firebase console → Configuración del proyecto → Tus apps)
const firebaseConfig = {
  apiKey: "AIzaSyALszzwKzAFr4wryjAsjXqfkOxvn92K7Xs",
  authDomain: "pokemon-launcher.firebaseapp.com",
  projectId: "pokemon-launcher",
  storageBucket: "pokemon-launcher.firebasestorage.app",
  messagingSenderId: "35244186114",
  appId: "1:35244186114:web:29b007cd61d6272cafe51b"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let usuarioActual = null; // { uid, nombreUsuario }

// Si la sesión se restaura sola (al abrir el launcher con "Recuérdame"), Firebase ya sabe quién sos
// pero usuarioActual todavía está vacío: acá lo completamos con tu perfil de Firestore.
auth.onAuthStateChanged(async (user) => {
  if (!user) { usuarioActual = null; return; }
  if (usuarioActual && usuarioActual.uid === user.uid) return;
  try {
    const doc = await db.collection('usuarios').doc(user.uid).get();
    if (!doc.exists) return; // registro en curso: registrarUsuario lo completa cuando termina
    if (usuarioActual && usuarioActual.uid === user.uid) return;
    const d = doc.data();
    usuarioActual = {
      uid: user.uid,
      nombreUsuario: d.nombreUsuario,
      avatarColor: d.avatarColor || null,
      estadisticas: d.estadisticas || { totalMinutos: 0, totalLogros: 0, juegosInstalados: 0 }
    };
    db.collection('usuarios').doc(user.uid).update({
      ultimaConexion: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
  } catch (e) {
    console.warn('No se pudo restaurar el perfil de la sesión:', e);
  }
});

/* ===================== CUENTA ===================== */

async function registrarUsuario(email, password, nombreUsuario) {
  const nombreLower = nombreUsuario.trim().toLowerCase();

  // Creamos la cuenta primero: esto nos autentica, y recién autenticados
  // podemos leer/escribir en Firestore (así están armadas las reglas).
  const credencial = await auth.createUserWithEmailAndPassword(email, password);
  const uid = credencial.user.uid;

  try {
    // Chequeamos que el nombre de usuario no esté tomado
    const existe = await db.collection('usuarios').where('nombreUsuarioLower', '==', nombreLower).get();
    if (!existe.empty) {
      throw new Error('Ese nombre de entrenador ya está en uso.');
    }

    await db.collection('usuarios').doc(uid).set({
      nombreUsuario: nombreUsuario.trim(),
      nombreUsuarioLower: nombreLower,
      avatarColor: null,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      ultimaConexion: firebase.firestore.FieldValue.serverTimestamp(),
      jugandoAhora: null,
      estadisticas: { totalMinutos: 0, totalLogros: 0, juegosInstalados: 0 }
    });

    usuarioActual = { uid, nombreUsuario: nombreUsuario.trim(), avatarColor: null, estadisticas: { totalMinutos: 0, totalLogros: 0, juegosInstalados: 0 } };
    return usuarioActual;
  } catch (error) {
    // Algo falló (nombre tomado, permisos, etc.) — deshacemos la cuenta
    // creada para que la persona pueda reintentar con el mismo email.
    await credencial.user.delete().catch(() => {});
    await auth.signOut().catch(() => {});
    usuarioActual = null;
    throw error;
  }
}

async function iniciarSesion(email, password) {
  const credencial = await auth.signInWithEmailAndPassword(email, password);
  const uid = credencial.user.uid;
  const doc = await db.collection('usuarios').doc(uid).get();
  usuarioActual = {
    uid,
    nombreUsuario: doc.data().nombreUsuario,
    avatarColor: doc.data().avatarColor || null,
    estadisticas: doc.data().estadisticas || { totalMinutos: 0, totalLogros: 0, juegosInstalados: 0 }
  };

  await db.collection('usuarios').doc(uid).update({
    ultimaConexion: firebase.firestore.FieldValue.serverTimestamp()
  });

  return usuarioActual;
}

async function cerrarSesion() {
  if (usuarioActual) {
    await db.collection('usuarios').doc(usuarioActual.uid).update({
      ultimaConexion: firebase.firestore.FieldValue.serverTimestamp(),
      jugandoAhora: null
    });
  }
  await auth.signOut();
  usuarioActual = null;
}

async function actualizarNombreUsuario(nuevoNombre) {
  if (!usuarioActual) throw new Error('Necesitás iniciar sesión.');

  const nombreLimpio = (nuevoNombre || '').trim();
  if (nombreLimpio.length < 3) throw new Error('El nombre tiene que tener al menos 3 letras.');

  const nombreLower = nombreLimpio.toLowerCase();
  if (nombreLower === (usuarioActual.nombreUsuario || '').toLowerCase()) {
    return usuarioActual.nombreUsuario; // no cambió nada
  }

  const existe = await db.collection('usuarios').where('nombreUsuarioLower', '==', nombreLower).get();
  if (!existe.empty) throw new Error('Ese nombre de entrenador ya está en uso.');

  await db.collection('usuarios').doc(usuarioActual.uid).update({
    nombreUsuario: nombreLimpio,
    nombreUsuarioLower: nombreLower
  });

  usuarioActual.nombreUsuario = nombreLimpio;
  return nombreLimpio;
}

function obtenerUsuarioActual() {
  return usuarioActual;
}

/* ===================== AVATAR (colores, sin costo — no usa Storage) ===================== */

const COLORES_AVATAR = ['rojo', 'azul', 'verde', 'amarillo', 'morado', 'rosa', 'cian', 'naranja'];

async function elegirColorAvatar(color) {
  if (!usuarioActual) throw new Error('Necesitás iniciar sesión.');
  if (!COLORES_AVATAR.includes(color)) throw new Error('Color de avatar inválido.');

  await db.collection('usuarios').doc(usuarioActual.uid).update({ avatarColor: color });
  usuarioActual.avatarColor = color;
  return color;
}

/* ===================== ESTADÍSTICAS (sincronizar biblioteca local) ===================== */

// Llamar esto cada vez que persistir() guarda la biblioteca local (ver INTEGRACION.md)
// `ranking` (opcional) trae los platinos/maestrías/minutos de la semana y del mes para la pestaña Rankings.
// `perfilPublico` (opcional) es el resumen que ven los demás al tocar "Ver perfil": rango, foto, banner,
// logros destacados, medallas, juegos platinados, etc.
async function sincronizarEstadisticas({ totalMinutos, totalLogros, juegosInstalados, ranking, perfilPublico }) {
  if (!usuarioActual) return;
  const estadisticas = { totalMinutos, totalLogros, juegosInstalados };
  if (ranking) estadisticas.ranking = ranking;
  const cambios = { estadisticas };
  if (perfilPublico) cambios.perfilPublico = perfilPublico;
  await db.collection('usuarios').doc(usuarioActual.uid).update(cambios);
  usuarioActual.estadisticas = estadisticas;
}

// Llamar cuando arranca/cierra un juego, para que los amigos vean "jugando a X"
async function actualizarJugandoAhora(nombreJuegoOnull) {
  if (!usuarioActual) return;
  await db.collection('usuarios').doc(usuarioActual.uid).update({
    jugandoAhora: nombreJuegoOnull,
    ultimaConexion: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/* ===================== BÚSQUEDA DE USUARIOS ===================== */

async function buscarUsuarios(textoBusqueda) {
  const textoLower = textoBusqueda.trim().toLowerCase();
  if (!textoLower) return [];

  const resultado = await db.collection('usuarios')
    .where('nombreUsuarioLower', '>=', textoLower)
    .where('nombreUsuarioLower', '<=', textoLower + '\uf8ff')
    .limit(15)
    .get();

  return resultado.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(u => u.uid !== usuarioActual?.uid);
}

/* ===================== SOLICITUDES DE AMISTAD ===================== */

async function enviarSolicitudAmistad(uidDestino, nombreDestino) {
  if (!usuarioActual) throw new Error('Necesitás iniciar sesión.');

  // Evitar duplicados: buscamos si ya existe una solicitud pendiente entre ambos
  const yaExiste = await db.collection('solicitudesAmistad')
    .where('de', '==', usuarioActual.uid)
    .where('para', '==', uidDestino)
    .where('estado', '==', 'pendiente')
    .get();
  if (!yaExiste.empty) return;

  await db.collection('solicitudesAmistad').add({
    de: usuarioActual.uid,
    deNombre: usuarioActual.nombreUsuario,
    deAvatarColor: usuarioActual.avatarColor || null,
    para: uidDestino,
    paraNombre: nombreDestino,
    estado: 'pendiente',
    creadaEn: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function listarSolicitudesRecibidas() {
  if (!usuarioActual) return [];
  const resultado = await db.collection('solicitudesAmistad')
    .where('para', '==', usuarioActual.uid)
    .where('estado', '==', 'pendiente')
    .get();
  return resultado.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function aceptarSolicitud(solicitud) {
  if (!usuarioActual) return;

  // 1) Creamos la amistad (documento con ambos participantes)
  await db.collection('amistades').add({
    participantes: [solicitud.de, usuarioActual.uid],
    creadaEn: firebase.firestore.FieldValue.serverTimestamp()
  });

  // 2) Marcamos la solicitud como aceptada
  await db.collection('solicitudesAmistad').doc(solicitud.id).update({ estado: 'aceptada' });
}

async function rechazarSolicitud(solicitudId) {
  await db.collection('solicitudesAmistad').doc(solicitudId).delete();
}

/* ===================== LISTA DE AMIGOS ===================== */

async function listarAmigos() {
  if (!usuarioActual) return [];

  const resultado = await db.collection('amistades')
    .where('participantes', 'array-contains', usuarioActual.uid)
    .get();

  const uidsAmigos = resultado.docs.map(d => {
    const [a, b] = d.data().participantes;
    return a === usuarioActual.uid ? b : a;
  });

  if (uidsAmigos.length === 0) return [];

  // Firestore permite hasta 30 valores en un 'in' — de sobra para una lista de amigos
  const perfiles = await db.collection('usuarios')
    .where(firebase.firestore.FieldPath.documentId(), 'in', uidsAmigos.slice(0, 30))
    .get();

  return perfiles.docs.map(d => ({ uid: d.id, ...d.data() }));
}

/* ===================== RANKING GLOBAL ===================== */

// Trae los usuarios que ya sincronizaron sus números del período vigente (semanaId / mesId).
// Solo usa un filtro de igualdad, así que Firestore no pide índices compuestos.
// Se ordena en el cliente. Tope de 300 usuarios por consulta.
async function obtenerRankingGlobal(tipo, periodoId) {
  if (!usuarioActual) return [];
  // Histórico: sin período; trae a quienes ya subieron su total, los que más horas tienen primero.
  if (tipo === 'total') {
    const r = await db.collection('usuarios').orderBy('estadisticas.ranking.minTotal', 'desc').limit(300).get();
    return r.docs.map(d => ({ uid: d.id, ...d.data() }));
  }
  const campo = tipo === 'mes' ? 'estadisticas.ranking.mesId' : 'estadisticas.ranking.semanaId';
  const resultado = await db.collection('usuarios').where(campo, '==', periodoId).limit(300).get();
  return resultado.docs.map(d => ({ uid: d.id, ...d.data() }));
}

/* ===================== ACTIVIDAD (logros de amigos) ===================== */

// Llamar cuando se desbloquea un logro localmente (ver INTEGRACION.md)
async function registrarActividadLogro(nombreJuego, nombreLogro) {
  if (!usuarioActual) return;
  await db.collection('actividad').add({
    uid: usuarioActual.uid,
    nombreUsuario: usuarioActual.nombreUsuario,
    tipo: 'logro',
    juego: nombreJuego,
    logro: nombreLogro,
    fecha: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function obtenerActividadDeAmigos(uidsAmigos) {
  if (!uidsAmigos || uidsAmigos.length === 0) return [];
  const resultado = await db.collection('actividad')
    .where('uid', 'in', uidsAmigos.slice(0, 30))
    .orderBy('fecha', 'desc')
    .limit(30)
    .get();
  return resultado.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ===================== RESPALDO DEL PROGRESO (sobrevive a reinstalar Windows) ===================== */

// Un solo documento por cuenta: respaldos/{uid}. Se guarda como texto JSON para evitar
// las restricciones de Firestore con nombres de campo. Límite de Firestore: ~1 MB por documento.
// Se pasa el uid que espera la app para no escribir nunca en la cuenta equivocada.
async function guardarRespaldo(uidEsperado, datos) {
  const user = auth.currentUser;
  if (!user || user.uid !== uidEsperado) throw new Error('La sesión cambió; no se guarda el respaldo.');
  await db.collection('respaldos').doc(user.uid).set({
    version: 1,
    actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
    datos: JSON.stringify(datos)
  });
}

// Devuelve el respaldo ({ progreso, claves }), o null si todavía no hay uno.
// Si no se puede consultar (sin internet, permisos) LANZA error: así quien llama no confunde
// "no hay respaldo" con "no pude mirar" y no pisa uno existente.
async function obtenerRespaldo(uidEsperado) {
  const user = auth.currentUser;
  if (!user || user.uid !== uidEsperado) throw new Error('La sesión cambió.');
  const doc = await db.collection('respaldos').doc(user.uid).get();
  if (!doc.exists) return null;
  try { return JSON.parse(doc.data().datos); } catch (e) { return null; }
}

/* ===================== RANGOS ESPECIALES (otorgados a mano por el propietario) ===================== */

// ⚠️ PEGÁ ACÁ EL UID DE TU CUENTA "Dexado"
// (Firebase console → Authentication → Usuarios → columna "UID de usuario" de Dexado).
// Es lo que te identifica como propietario: solo esa cuenta puede dar/quitar rangos y tener el rango Propietario.
const UID_PROPIETARIO = 'PEGA_ACA_EL_UID_DE_DEXADO';

// Orden = orden en que se muestran en el perfil. `grupo`: dentro de un mismo grupo solo se tiene uno
// (un donador tiene UN solo tier: al darle otro, reemplaza al anterior).
const RANGOS_ESPECIALES = [
  { id: 'propietario', nombre: 'Propietario',  emoji: '👑', color: '#ffb703', asignable: false, descripcion: 'Dueño del launcher.' },
  { id: 'moderador',   nombre: 'Moderador',    emoji: '🛡️', color: '#3b82f6', asignable: true,  descripcion: 'Tiene permisos para moderar en el launcher.' },
  { id: 'famoso',      nombre: 'Famoso',       emoji: '⭐', color: '#ec4899', asignable: true,  descripcion: 'Creador de contenido en otras plataformas.' },
  { id: 'creador',     nombre: 'Creador',      emoji: '🎮', color: '#10b981', asignable: true,  descripcion: 'Creador de fangames.' },
  { id: 'donador5',    nombre: 'Donador Tier 5', emoji: '💎', color: '#ffd24a', asignable: true, grupo: 'donador', descripcion: 'Donó 5 meses seguidos.' },
  { id: 'donador3',    nombre: 'Donador Tier 3', emoji: '💎', color: '#c4ccd8', asignable: true, grupo: 'donador', descripcion: 'Donó 3 meses.' },
  { id: 'donador1',    nombre: 'Donador Tier 1', emoji: '💎', color: '#cd7f32', asignable: true, grupo: 'donador', descripcion: 'Donó 1 mes.' }
];

const cacheRangos = {}; // uid -> [ids de rango]

function soyPropietario() {
  const u = auth.currentUser;
  return !!u && u.uid === UID_PROPIETARIO;
}

// Limpia la lista que viene de Firestore: solo ids válidos, y "propietario" únicamente para el propietario.
function limpiarRangos(lista, uid) {
  const validos = RANGOS_ESPECIALES.map(r => r.id);
  let r = (Array.isArray(lista) ? lista : []).filter(id => validos.includes(id) && id !== 'propietario');
  if (uid === UID_PROPIETARIO) r.unshift('propietario');
  // ordenados como en RANGOS_ESPECIALES
  return validos.filter(id => r.includes(id));
}

// Carga (en lotes) los rangos de varios usuarios y los deja en memoria.
async function cargarRangosEspeciales(uids) {
  const pedir = [...new Set((uids || []).filter(Boolean))];
  for (let i = 0; i < pedir.length; i += 10) {
    const lote = pedir.slice(i, i + 10);
    try {
      const r = await db.collection('rangosEspeciales')
        .where(firebase.firestore.FieldPath.documentId(), 'in', lote).get();
      const vistos = {};
      r.docs.forEach(d => { vistos[d.id] = d.data().rangos; });
      lote.forEach(uid => { cacheRangos[uid] = limpiarRangos(vistos[uid], uid); });
    } catch (e) {
      console.warn('No se pudieron cargar los rangos especiales:', e);
      lote.forEach(uid => { if (!cacheRangos[uid]) cacheRangos[uid] = limpiarRangos([], uid); });
    }
  }
}

// Versión síncrona: lo que ya está cargado en memoria (usar después de cargarRangosEspeciales).
function rangosEspecialesDe(uid) {
  return cacheRangos[uid] || limpiarRangos([], uid);
}

async function asignarRangoEspecial(uid, rangoId) {
  if (!soyPropietario()) throw new Error('Solo el propietario puede dar rangos.');
  const def = RANGOS_ESPECIALES.find(r => r.id === rangoId);
  if (!def || !def.asignable) throw new Error('Ese rango no se puede asignar.');
  const ref = db.collection('rangosEspeciales').doc(uid);
  const snap = await ref.get();
  let rangos = snap.exists ? (snap.data().rangos || []) : [];
  rangos = rangos.filter(id => id !== rangoId);
  if (def.grupo) rangos = rangos.filter(id => { const d = RANGOS_ESPECIALES.find(x => x.id === id); return !d || d.grupo !== def.grupo; });
  rangos.push(rangoId);
  await ref.set({ rangos, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() });
  cacheRangos[uid] = limpiarRangos(rangos, uid);
  return cacheRangos[uid];
}

async function quitarRangoEspecial(uid, rangoId) {
  if (!soyPropietario()) throw new Error('Solo el propietario puede quitar rangos.');
  const ref = db.collection('rangosEspeciales').doc(uid);
  const snap = await ref.get();
  const rangos = (snap.exists ? (snap.data().rangos || []) : []).filter(id => id !== rangoId);
  await ref.set({ rangos, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() });
  cacheRangos[uid] = limpiarRangos(rangos, uid);
  return cacheRangos[uid];
}

// Para el panel del propietario: todos los usuarios que tienen algún rango asignado, con su perfil.
async function listarUsuariosConRangos() {
  if (!soyPropietario()) return [];
  const r = await db.collection('rangosEspeciales').limit(200).get();
  const conRangos = r.docs.filter(d => (d.data().rangos || []).length > 0).map(d => d.id);
  const usuarios = [];
  for (let i = 0; i < conRangos.length; i += 10) {
    const p = await db.collection('usuarios')
      .where(firebase.firestore.FieldPath.documentId(), 'in', conRangos.slice(i, i + 10)).get();
    p.docs.forEach(d => usuarios.push({ uid: d.id, ...d.data() }));
  }
  r.docs.forEach(d => { cacheRangos[d.id] = limpiarRangos(d.data().rangos, d.id); });
  return usuarios;
}

/* ===================== EXPONER API AL RESTO DE LA APP ===================== */

window.amigosAPI = {
  registrarUsuario,
  iniciarSesion,
  cerrarSesion,
  actualizarNombreUsuario,
  obtenerUsuarioActual,
  elegirColorAvatar,
  COLORES_AVATAR,
  sincronizarEstadisticas,
  actualizarJugandoAhora,
  buscarUsuarios,
  enviarSolicitudAmistad,
  listarSolicitudesRecibidas,
  aceptarSolicitud,
  rechazarSolicitud,
  listarAmigos,
  registrarActividadLogro,
  obtenerActividadDeAmigos,
  obtenerRankingGlobal,
  guardarRespaldo,
  obtenerRespaldo,
  RANGOS_ESPECIALES,
  soyPropietario,
  cargarRangosEspeciales,
  rangosEspecialesDe,
  asignarRangoEspecial,
  quitarRangoEspecial,
  listarUsuariosConRangos
};