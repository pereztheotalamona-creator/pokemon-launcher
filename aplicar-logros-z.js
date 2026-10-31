// Uso: poné este archivo y logros-pokemon-z.json en la carpeta de tu launcher
// (donde están index.html, main.js y catalogo.json) y ejecutá:  node aplicar-logros-z.js
// Hace copias de seguridad (.bak) antes de tocar nada y se puede correr más de una vez sin romper nada.
const fs = require('fs');
const path = require('path');
const carpeta = __dirname;

function leer(nombre) { return fs.readFileSync(path.join(carpeta, nombre), 'utf8'); }
function respaldar(nombre) {
  const bak = path.join(carpeta, nombre + '.bak');
  if (!fs.existsSync(bak)) fs.copyFileSync(path.join(carpeta, nombre), bak);
}
function guardar(nombre, texto) { fs.writeFileSync(path.join(carpeta, nombre), texto, 'utf8'); }

// 1) index.html: nuevo tipo de logro "switchAlguno" (se cumple si CUALQUIERA de varios interruptores está activo)
{
  let html = leer('index.html');
  if (html.includes("case 'switchAlguno':")) {
    console.log('index.html: ya estaba parcheado.');
  } else {
    const marca = "case 'variable':";
    const i = html.indexOf(marca);
    if (i === -1) throw new Error("index.html: no encontré el lugar donde insertar el parche.");
    const nuevo =
      "case 'switchAlguno':\r\n" +
      "          cumple = !!(juego.progresoReal && (logro.requisitoSwitches || []).some(s => (juego.progresoReal.switchesActivos || []).includes(s)));\r\n" +
      "          break;\r\n" +
      "        ";
    respaldar('index.html');
    html = html.slice(0, i) + nuevo + html.slice(i);
    guardar('index.html', html);
    console.log('index.html: parche aplicado.');
  }
}

// 2) main.js: la Pokédex de Pokémon Z es una lista por número nacional (no un diccionario de nombres)
{
  let js = leer('main.js');
  if (js.includes('PARCHE_POKEDEX_NUMERICA')) {
    console.log('main.js: ya estaba parcheado.');
  } else {
    const re = /function especiesCapturadas\(valor\) \{\s*if \(!valor \|\| typeof valor !== 'object'\) return \[\];/;
    const m = js.match(re);
    if (!m) throw new Error('main.js: no encontré especiesCapturadas.');
    const reemplazo = m[0] +
      "\r\n      // PARCHE_POKEDEX_NUMERICA: si la Pokédex es una lista (Pokémon Z), devolvemos los números nacionales como texto\r\n" +
      "      if (Array.isArray(valor)) {\r\n" +
      "        const numeros = [];\r\n" +
      "        valor.forEach((v, i) => { if (v === true) numeros.push(String(i)); });\r\n" +
      "        return numeros;\r\n" +
      "      }";
    respaldar('main.js');
    js = js.replace(re, () => reemplazo);
    guardar('main.js', js);
    console.log('main.js: parche aplicado.');
  }
}

// 3) catalogo.json: logros de Pokémon Z (id 5)
{
  const logros = JSON.parse(leer('logros-pokemon-z.json').replace(/^\uFEFF/, ''));
  const catalogo = JSON.parse(leer('catalogo.json').replace(/^\uFEFF/, ''));
  const z = catalogo.find(j => j.id === 5);
  if (!z) throw new Error('catalogo.json: no encontré Pokémon Z (id 5).');
  respaldar('catalogo.json');
  z.logros = logros;
  guardar('catalogo.json', JSON.stringify(catalogo, null, 2));
  console.log('catalogo.json: ' + logros.length + ' logros cargados en Pokémon Z.');
}
console.log('Listo. Subí catalogo.json a tu repositorio de GitHub y reiniciá el launcher.');
