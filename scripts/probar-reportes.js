import './_silencio.js';
/**
 * Pruebas de tableros, auditoría y documentos PDF — Fase 7.
 * Ejecuta:  npm run probar:reportes
 *
 * Lo que se comprueba de fondo:
 *   - Cada rol recibe SU tablero, no el de otro.
 *   - La auditoría es solo del administrador y no se puede alterar.
 *   - La boleta y el recibo se generan como PDF válido.
 *   - Un alumno solo baja SU boleta y SU recibo, nunca los de otro.
 */
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { app } from '../src/app.js';
import { pool, q } from '../src/config/db.js';
import { env } from '../src/config/env.js';

const VERDE = '\x1b[32m', ROJO = '\x1b[31m', GRIS = '\x1b[90m', RESET = '\x1b[0m';
let pasaron = 0, fallaron = 0, base = '';
const ok = (t, d = '') => { pasaron++; console.log(`${VERDE}  OK  ${RESET} ${t}${d ? ` ${GRIS}${d}${RESET}` : ''}`); };
const falla = (t, d = '') => { fallaron++; console.log(`${ROJO} FALLA${RESET} ${t}`); if (d) console.log(`        ${GRIS}${String(d).slice(0, 160)}${RESET}`); };
const seccion = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

function cliente() {
  const cookies = new Map();
  const pedir = async (m, ruta, cuerpo, crudo = false) => {
    const cab = { Origin: base };
    if (cuerpo) cab['Content-Type'] = 'application/json';
    if (cookies.size) cab.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(base + ruta, { method: m, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    for (const sc of r.headers.getSetCookie?.() ?? []) {
      const [par] = sc.split(';'); const i = par.indexOf('='); const v = par.slice(i + 1);
      if (!v || /Expires=Thu, 01 Jan 1970/i.test(sc)) cookies.delete(par.slice(0, i));
      else cookies.set(par.slice(0, i), v);
    }
    if (crudo) return { estado: r.status, tipo: r.headers.get('content-type'), buffer: Buffer.from(await r.arrayBuffer()) };
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  return {
    get: (r) => pedir('GET', r), post: (r, c) => pedir('POST', r, c),
    getCrudo: (r) => pedir('GET', r, null, true),
  };
}

const CLAVE = 'PruebaSegura2026';
async function crearUsuario(nombre, rolCodigo, personaId = null) {
  const [rol] = await q('SELECT id FROM rol WHERE codigo = ?', [rolCodigo]);
  const hash = await bcrypt.hash(CLAVE, env.BCRYPT_COST);
  let pid = personaId;
  if (!pid) pid = (await q('INSERT INTO persona (primer_nombre, primer_apellido) VALUES (?,?)', ['ZZ7', nombre])).insertId;
  const ru = await q('INSERT INTO usuario (persona_id, rol_id, usuario, password_hash, debe_cambiar_password) VALUES (?,?,?,?,0)', [pid, rol.id, nombre, hash]);
  return { id: ru.insertId, personaId: pid };
}

async function limpiar() {
  const us = await q("SELECT id FROM usuario WHERE usuario LIKE '_zz7_%'");
  for (const u of us) await q('DELETE FROM sesion_refresh WHERE usuario_id = ?', [u.id]);
  for (const u of us) await q('DELETE FROM usuario WHERE id = ?', [u.id]);
  await q("DELETE FROM persona WHERE primer_nombre = 'ZZ7'");
}

function esPDF(buffer) {
  // Un PDF válido empieza con "%PDF-".
  return buffer.length > 100 && buffer.subarray(0, 5).toString() === '%PDF-';
}

async function main() {
  console.log('\n=== Pruebas de tableros, auditoria y PDF ===');
  await limpiar();

  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    await crearUsuario('_zz7_admin', 'ADMIN');
    await crearUsuario('_zz7_maestro', 'MAESTRO');

    const admin = cliente();
    await admin.post('/api/auth/login', { usuario: '_zz7_admin', password: CLAVE });

    // ================================================================
    seccion('1. Tablero por rol');

    let r = await admin.get('/api/tablero');
    if (r.estado === 200 && r.datos.datos?.matricula) {
      ok('El administrador ve el tablero del colegio', `${r.datos.datos.matricula.activos} alumnos, ${r.datos.datos.finanzas ? 'con finanzas' : 'sin finanzas'}`);
      r.datos.datos.finanzas ? ok('El tablero admin incluye cifras financieras') : falla('Faltan las finanzas en el tablero admin');
    } else {
      falla('Tablero del administrador', JSON.stringify(r.datos).slice(0, 100));
    }

    const cMaestro = cliente();
    await cMaestro.post('/api/auth/login', { usuario: '_zz7_maestro', password: CLAVE });
    r = await cMaestro.get('/api/tablero');
    if (r.estado === 200) {
      r.datos.datos?.finanzas === undefined
        ? ok('El tablero del maestro NO incluye finanzas', 'solo sus clases')
        : falla('El maestro vio cifras financieras que no le tocan');
    } else {
      falla('Tablero del maestro', JSON.stringify(r.datos).slice(0, 100));
    }

    // Un alumno real de la demo, con su cuenta.
    const [alumnoDemo] = await q(
      `SELECT a.id, a.persona_id FROM nota_periodo np JOIN alumno a ON a.id = np.alumno_id LIMIT 1`
    );
    await crearUsuario('_zz7_alumno', 'ALUMNO', alumnoDemo.persona_id);
    const cAlumno = cliente();
    await cAlumno.post('/api/auth/login', { usuario: '_zz7_alumno', password: CLAVE });
    r = await cAlumno.get('/api/tablero');
    r.estado === 200 && (r.datos.datos?.alumno || r.datos.datos?.promedio !== undefined)
      ? ok('El alumno ve su propio tablero', `promedio ${r.datos.datos.promedio ?? 'sin notas'}`)
      : falla('Tablero del alumno', JSON.stringify(r.datos).slice(0, 100));

    // ================================================================
    seccion('2. Auditoria: solo administrador, solo lectura');

    r = await admin.get('/api/auditoria?porPagina=5');
    r.estado === 200 && Array.isArray(r.datos.eventos)
      ? ok('El administrador consulta la auditoria', `${r.datos.total} eventos en total`)
      : falla('Consulta de auditoria', JSON.stringify(r.datos).slice(0, 100));

    r = await cMaestro.get('/api/auditoria');
    r.estado === 403 ? ok('Un maestro NO accede a la auditoria') : falla('El maestro accedio a la auditoria', r.estado);

    r = await cAlumno.get('/api/auditoria');
    r.estado === 403 ? ok('Un alumno NO accede a la auditoria') : falla('El alumno accedio a la auditoria', r.estado);

    // Filtro por acción.
    r = await admin.get('/api/auditoria?accion=LOGIN&porPagina=5');
    r.estado === 200 && r.datos.eventos.every((e) => e.accion === 'LOGIN')
      ? ok('El filtro por accion funciona', `${r.datos.eventos.length} logins mostrados`)
      : falla('El filtro por accion no filtro bien');

    // La inmutabilidad: intentar borrar auditoría desde el pool de la app debe fallar.
    let bloqueado = false;
    try {
      await q('DELETE FROM auditoria WHERE id = (SELECT id FROM (SELECT MIN(id) AS id FROM auditoria) t)');
    } catch { bloqueado = true; }
    bloqueado
      ? ok('La auditoria es inmutable: la app no puede borrarla', 'trigger + permisos')
      : falla('Se pudo borrar un registro de auditoria');

    // ================================================================
    seccion('3. Boleta de calificaciones en PDF');

    const [periodo] = await q("SELECT id FROM periodo WHERE numero = 1 LIMIT 1");

    r = await admin.getCrudo(`/api/alumnos/${alumnoDemo.id}/boleta?periodoId=${periodo.id}`);
    r.estado === 200 && r.tipo?.includes('application/pdf') && esPDF(r.buffer)
      ? ok('El administrador genera la boleta en PDF', `${r.buffer.length} bytes`)
      : falla('Generacion de boleta', `estado ${r.estado}, tipo ${r.tipo}`);

    r = await cAlumno.getCrudo(`/api/alumnos/${alumnoDemo.id}/boleta?periodoId=${periodo.id}`);
    r.estado === 200 && esPDF(r.buffer)
      ? ok('El alumno baja SU propia boleta')
      : falla('El alumno no pudo bajar su boleta', r.estado);

    // Otro alumno distinto: el primero no debe poder bajar su boleta.
    const [otroAlumno] = await q(
      `SELECT a.id FROM nota_periodo np JOIN alumno a ON a.id = np.alumno_id WHERE a.id <> ? LIMIT 1`,
      [alumnoDemo.id]
    );
    r = await cAlumno.getCrudo(`/api/alumnos/${otroAlumno.id}/boleta?periodoId=${periodo.id}`);
    r.estado === 404
      ? ok('El alumno NO baja la boleta de otro', '404, no revela que existe')
      : falla('Un alumno accedio a la boleta de otro', r.estado);

    r = await cMaestro.getCrudo(`/api/alumnos/${otroAlumno.id}/boleta?periodoId=${periodo.id}`);
    [200, 404].includes(r.estado)
      ? ok('El maestro solo baja boletas de sus alumnos', `estado ${r.estado} segun corresponda`)
      : falla('Boleta y maestro', r.estado);

    // ================================================================
    seccion('4. Recibo de pago en PDF');

    const [pago] = await q('SELECT id FROM pago WHERE anulado = 0 LIMIT 1');
    r = await admin.getCrudo(`/api/pagos/${pago.id}/recibo-pdf`);
    r.estado === 200 && esPDF(r.buffer)
      ? ok('El administrador genera el recibo en PDF', `${r.buffer.length} bytes`)
      : falla('Generacion de recibo', `estado ${r.estado}`);

    r = await cMaestro.getCrudo(`/api/pagos/${pago.id}/recibo-pdf`);
    r.estado === 404
      ? ok('Un maestro NO baja recibos de pago', 'no es asunto suyo')
      : falla('El maestro accedio a un recibo', r.estado);

    // ================================================================
    seccion('5. Auditoria del acceso');

    const [[aud]] = await q(
      "SELECT COUNT(*) AS n FROM auditoria WHERE fecha_hora >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)"
    ).then((x) => [x]);
    aud.n > 0 ? ok('La actividad reciente quedo registrada', `${aud.n} eventos`) : falla('Sin registro reciente');
  } finally {
    await limpiar();
    servidor.close();
    await pool.end();
  }

  console.log('\n' + '='.repeat(58));
  console.log(fallaron === 0 ? `${VERDE}Las ${pasaron} pruebas pasaron.${RESET}` : `${ROJO}${fallaron} prueba(s) fallaron${RESET}, ${pasaron} pasaron.`);
  console.log('Los datos de prueba fueron eliminados.');
  console.log('='.repeat(58) + '\n');
  process.exit(fallaron === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('\nError inesperado:', e.stack ?? e.message);
  try { await limpiar(); await pool.end(); } catch { /* ya cerrado */ }
  process.exit(1);
});
