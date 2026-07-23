/**
 * Verificacion del entorno - Fase 0.
 * Ejecuta:  npm run verificar
 *
 * Comprueba una por una las piezas que el sistema necesita y dice
 * exactamente que hacer si algo falla. No modifica nada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const VERDE = '\x1b[32m';
const ROJO = '\x1b[31m';
const AMARILLO = '\x1b[33m';
const GRIS = '\x1b[90m';
const RESET = '\x1b[0m';

let fallos = 0;
let avisos = 0;

function ok(titulo, detalle = '') {
  console.log(`${VERDE}  OK  ${RESET} ${titulo}${detalle ? ` ${GRIS}${detalle}${RESET}` : ''}`);
}
function error(titulo, comoArreglar) {
  fallos++;
  console.log(`${ROJO} FALLA${RESET} ${titulo}`);
  console.log(`        ${GRIS}-> ${comoArreglar}${RESET}`);
}
function aviso(titulo, nota) {
  avisos++;
  console.log(`${AMARILLO} AVISO${RESET} ${titulo}`);
  console.log(`        ${GRIS}-> ${nota}${RESET}`);
}
function seccion(titulo) {
  console.log(`\n${titulo}\n${'-'.repeat(titulo.length)}`);
}

console.log('\n=== Verificacion de entorno: Smart Campus IA ===');

// 1. Node.js -----------------------------------------------------------------
seccion('1. Node.js');
const mayor = Number(process.versions.node.split('.')[0]);
if (mayor >= 20) ok('Version de Node.js', `v${process.versions.node}`);
else error(`Node.js v${process.versions.node} es muy antigua`, 'Instala Node.js 20 LTS o superior desde nodejs.org');

// 2. Archivo .env ------------------------------------------------------------
seccion('2. Configuracion (.env)');
const rutaEnv = path.join(raiz, '.env');
if (!fs.existsSync(rutaEnv)) {
  error('No existe el archivo .env', 'Copia .env.example a .env y rellena los valores');
  resumen();
  process.exit(1);
}
ok('Archivo .env encontrado');

const { env } = await import('../src/config/env.js');
const { logger } = await import('../src/config/logger.js');
logger.level = 'silent'; // este script imprime su propio informe

for (const clave of ['DB_PASSWORD', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
  if (String(env[clave]).startsWith('CAMBIA')) {
    error(`${clave} conserva el valor de ejemplo`, 'Genera un valor real antes de continuar');
  }
}
if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
  error('JWT_ACCESS_SECRET y JWT_REFRESH_SECRET son iguales', 'Deben ser dos secretos distintos');
}
if (fallos === 0) ok('Secretos configurados');
ok('Zona horaria', env.TZ);

// 3. Carpetas ----------------------------------------------------------------
seccion('3. Carpetas de trabajo');
for (const dir of [env.UPLOAD_DIR, env.BACKUP_DIR, env.LOG_DIR]) {
  const ruta = path.resolve(raiz, dir);
  try {
    fs.mkdirSync(ruta, { recursive: true });
    fs.accessSync(ruta, fs.constants.W_OK);
    ok(`Escritura permitida`, dir);
  } catch {
    error(`No se puede escribir en ${dir}`, 'Revisa los permisos de la carpeta');
  }
}

// 4. Base de datos -----------------------------------------------------------
seccion('4. Base de datos (MariaDB / XAMPP)');
try {
  const { probarConexion, q } = await import('../src/config/db.js');
  const info = await probarConexion();
  ok('Conexion establecida', `${info.bd} @ MySQL/MariaDB ${info.version}`);

  const tablas = await q(
    'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ?',
    [env.DB_NAME]
  );
  const total = tablas[0].total;
  if (total === 0) {
    aviso('La base de datos esta vacia', 'Normal en Fase 0. El esquema se crea en la Fase 1.');
  } else {
    ok('Tablas existentes', String(total));
  }

  const juego = await q(
    'SELECT default_character_set_name AS cs, default_collation_name AS col FROM information_schema.schemata WHERE schema_name = ?',
    [env.DB_NAME]
  );
  if (juego[0]?.cs === 'utf8mb4') ok('Juego de caracteres', `${juego[0].cs} / ${juego[0].col}`);
  else error(`Juego de caracteres ${juego[0]?.cs}`, 'Debe ser utf8mb4 para acentos y enies');
} catch (e) {
  error(`No se pudo conectar a MySQL: ${e.message}`, 'Enciende MySQL en el panel de XAMPP y revisa DB_USER/DB_PASSWORD en .env');
}

// 5. Ollama ------------------------------------------------------------------
seccion('5. IA local (Ollama)');
try {
  const { estado } = await import('../src/services/ollama.service.js');
  const info = await estado();
  if (info.disponible) {
    ok('Ollama responde', env.OLLAMA_URL);
    if (info.modeloDescargado) ok('Modelo disponible', env.OLLAMA_MODEL);
    else aviso(`El modelo ${env.OLLAMA_MODEL} no esta descargado`, `Ejecuta: ollama pull ${env.OLLAMA_MODEL}`);
  } else {
    aviso(`Ollama no disponible (${info.motivo})`, 'No bloquea el sistema. Se usa desde la Fase 6.');
  }
} catch (e) {
  aviso(`No se pudo consultar Ollama: ${e.message}`, 'Opcional en esta fase');
}

// 6. Certificados ------------------------------------------------------------
seccion('6. HTTPS');
if (env.HTTPS_ENABLED) {
  const tieneKey = fs.existsSync(path.resolve(raiz, env.HTTPS_KEY_PATH));
  const tieneCert = fs.existsSync(path.resolve(raiz, env.HTTPS_CERT_PATH));
  if (tieneKey && tieneCert) ok('Certificado autofirmado presente');
  else error('Faltan los certificados', 'Ejecuta: npm run cert');
} else {
  aviso('HTTPS deshabilitado', 'Correcto en desarrollo. Actívalo antes de desplegar en la red del colegio.');
}

// 7. mysqldump ---------------------------------------------------------------
seccion('7. Respaldos');
if (env.MYSQLDUMP_PATH === 'mysqldump' || fs.existsSync(env.MYSQLDUMP_PATH)) {
  ok('Ruta de mysqldump', env.MYSQLDUMP_PATH);
} else {
  aviso('No se encontro mysqldump en la ruta indicada', 'Ajusta MYSQLDUMP_PATH en .env (en XAMPP suele ser C:/xampp/mysql/bin/mysqldump.exe)');
}

resumen();

function resumen() {
  console.log('\n' + '='.repeat(50));
  if (fallos === 0) {
    console.log(`${VERDE}Entorno listo.${RESET} ${avisos} aviso(s) sin bloqueo.`);
    console.log('Siguiente paso: iniciar el servidor con  npm run dev');
  } else {
    console.log(`${ROJO}${fallos} problema(s) que debes resolver.${RESET} ${avisos} aviso(s).`);
  }
  console.log('='.repeat(50) + '\n');
  process.exit(fallos === 0 ? 0 : 1);
}
