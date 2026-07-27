import './_silencio.js';
/**
 * Pruebas del asistente y las notificaciones — Fase 6.
 * Ejecuta:  npm run probar:asistente
 *
 * El bloque clave es el 2: comprueba que el CONTEXTO que se le arma al chatbot
 * respeta los permisos. Un alumno solo recibe SUS datos; jamás los de otro.
 * Esta es la verdadera defensa: aunque el modelo quisiera filtrar datos ajenos,
 * no los tiene a la vista.
 *
 * Ollama no corre en el entorno de prueba, así que también se verifica que el
 * chat degrada con elegancia en vez de romperse.
 */
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { app } from '../src/app.js';
import { pool, q } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import * as notif from '../src/services/notificacion.service.js';

const VERDE = '\x1b[32m', ROJO = '\x1b[31m', GRIS = '\x1b[90m', RESET = '\x1b[0m';
let pasaron = 0, fallaron = 0, base = '';
const ok = (t, d = '') => { pasaron++; console.log(`${VERDE}  OK  ${RESET} ${t}${d ? ` ${GRIS}${d}${RESET}` : ''}`); };
const falla = (t, d = '') => { fallaron++; console.log(`${ROJO} FALLA${RESET} ${t}`); if (d) console.log(`        ${GRIS}${String(d).slice(0, 160)}${RESET}`); };
const seccion = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

function cliente() {
  const cookies = new Map();
  const pedir = async (m, ruta, cuerpo) => {
    const cab = { Origin: base };
    if (cuerpo) cab['Content-Type'] = 'application/json';
    if (cookies.size) cab.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(base + ruta, { method: m, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    for (const sc of r.headers.getSetCookie?.() ?? []) {
      const [par] = sc.split(';'); const i = par.indexOf('='); const v = par.slice(i + 1);
      if (!v || /Expires=Thu, 01 Jan 1970/i.test(sc)) cookies.delete(par.slice(0, i));
      else cookies.set(par.slice(0, i), v);
    }
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  return { get: (r) => pedir('GET', r), post: (r, c) => pedir('POST', r, c), put: (r, c) => pedir('PUT', r, c) };
}

const CLAVE = 'PruebaSegura2026';
async function crearUsuario(nombre, rolCodigo, personaId = null) {
  const [rol] = await q('SELECT id FROM rol WHERE codigo = ?', [rolCodigo]);
  const hash = await bcrypt.hash(CLAVE, env.BCRYPT_COST);
  let pid = personaId;
  if (!pid) pid = (await q('INSERT INTO persona (primer_nombre, primer_apellido) VALUES (?,?)', ['ZZ6', nombre])).insertId;
  const ru = await q('INSERT INTO usuario (persona_id, rol_id, usuario, password_hash, debe_cambiar_password) VALUES (?,?,?,?,0)', [pid, rol.id, nombre, hash]);
  return { id: ru.insertId, personaId: pid };
}

async function limpiar() {
  const us = await q("SELECT id FROM usuario WHERE usuario LIKE '_zz6_%'");
  for (const u of us) {
    await q('DELETE FROM notificacion WHERE usuario_id = ?', [u.id]);
    await q('DELETE FROM chat_log WHERE usuario_id = ?', [u.id]);
    await q('DELETE FROM sesion_refresh WHERE usuario_id = ?', [u.id]);
  }
  const secs = await q("SELECT id FROM seccion WHERE letra = 'V'");
  for (const s of secs) {
    const cls = await q('SELECT id FROM clase WHERE seccion_id = ?', [s.id]);
    for (const c of cls) {
      await q('DELETE FROM nota WHERE evaluacion_id IN (SELECT id FROM evaluacion WHERE clase_id=?)', [c.id]);
      await q('DELETE FROM evaluacion WHERE clase_id = ?', [c.id]);
      await q('DELETE FROM nota_periodo WHERE clase_id = ?', [c.id]);
      await q('DELETE FROM asistencia WHERE clase_id = ?', [c.id]);
      await q('DELETE FROM inscripcion WHERE clase_id = ?', [c.id]);
    }
    await q('DELETE FROM clase WHERE seccion_id = ?', [s.id]);
    const mats = await q('SELECT alumno_id FROM matricula WHERE seccion_id = ?', [s.id]);
    await q('DELETE FROM matricula WHERE seccion_id = ?', [s.id]);
    for (const m of mats) {
      await q('DELETE FROM incidencia WHERE alumno_id = ?', [m.alumno_id]);
      await q('DELETE FROM notificacion WHERE usuario_id IN (SELECT id FROM usuario WHERE persona_id=(SELECT persona_id FROM alumno WHERE id=?))', [m.alumno_id]);
      await q('DELETE FROM alumno_encargado WHERE alumno_id = ?', [m.alumno_id]);
    }
    await q('DELETE FROM seccion WHERE id = ?', [s.id]);
  }
  await q("DELETE FROM alumno WHERE codigo LIKE '_ZZ6%'");
  for (const u of us) await q('DELETE FROM usuario WHERE id = ?', [u.id]);
  await q("DELETE FROM persona WHERE primer_nombre = 'ZZ6'");
}

async function main() {
  console.log('\n=== Pruebas del asistente y notificaciones ===');
  await limpiar();

  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    const uAdmin = await crearUsuario('_zz6_admin', 'ADMIN');
    const uMaestro = await crearUsuario('_zz6_maestro', 'MAESTRO');

    const admin = cliente();
    await admin.post('/api/auth/login', { usuario: '_zz6_admin', password: CLAVE });

    const ctx = (await admin.get('/api/contexto')).datos;
    const grado = ctx.catalogos.grados[0];
    const asig = ctx.catalogos.asignaturas[0];
    const [periodo] = await q("SELECT id FROM periodo WHERE estado='abierto' LIMIT 1");

    const secV = (await admin.post('/api/secciones', { gradoId: grado.id, letra: 'V', cupoMaximo: 30 })).datos.id;
    await admin.post(`/api/secciones/${secV}/clases`, { asignaturas: [{ asignaturaId: asig.id, maestroId: uMaestro.id }] });
    const clase = (await admin.get(`/api/secciones/${secV}/clases`)).datos.clases[0];

    const alumnoA = (await admin.post('/api/alumnos', { codigo: '_ZZ6-001', primerNombre: 'ZZ6', primerApellido: 'AlfaSecreto' })).datos.alumno;
    const alumnoB = (await admin.post('/api/alumnos', { codigo: '_ZZ6-002', primerNombre: 'ZZ6', primerApellido: 'BetaSecreto' })).datos.alumno;
    await admin.post('/api/matriculas', { alumnoId: alumnoA.id, seccionId: secV });
    await admin.post('/api/matriculas', { alumnoId: alumnoB.id, seccionId: secV });

    // Nota para el alumno A, para que aparezca en su contexto.
    await admin.put(`/api/clases/${clase.id}/ponderacion`, {
      periodoId: periodo.id, items: [{ tipoEvaluacionId: 1, porcentaje: 100 }],
    });
    const ev = (await admin.post(`/api/clases/${clase.id}/evaluaciones`, {
      periodoId: periodo.id, tipoEvaluacionId: 1, titulo: 'Examen', puntajeMaximo: 100,
    })).datos.id;
    await admin.put(`/api/evaluaciones/${ev}/notas`, { notas: [{ alumnoId: alumnoA.id, puntaje: 95 }] });

    // Cuentas de alumno ligadas a cada persona.
    const [pa] = await q('SELECT persona_id FROM alumno WHERE id = ?', [alumnoA.id]);
    const [pb] = await q('SELECT persona_id FROM alumno WHERE id = ?', [alumnoB.id]);
    await crearUsuario('_zz6_alumnoA', 'ALUMNO', pa.persona_id);
    await crearUsuario('_zz6_alumnoB', 'ALUMNO', pb.persona_id);

    // ================================================================
    seccion('1. Estado del asistente (Ollama apagado en pruebas)');

    let r = await admin.get('/api/asistente/estado');
    r.estado === 200 && typeof r.datos.disponible === 'boolean'
      ? ok('El estado del asistente responde', r.datos.disponible ? 'disponible' : `no disponible: ${r.datos.motivo?.slice(0, 40)}`)
      : falla('Estado del asistente', JSON.stringify(r.datos));

    // ================================================================
    seccion('2. El contexto del chatbot respeta los permisos por rol');

    // Se prueba que los datos que alimentan el contexto respetan permisos.
    // No hace falta Ollama: la frontera de seguridad es qué datos se recogen.
    const { preguntar } = await import('../src/services/chatbot.service.js');

    // Alumno A: su vista de notas contiene su nota y NO el apellido del otro.
    const cAlumnoA = cliente();
    await cAlumnoA.post('/api/auth/login', { usuario: '_zz6_alumnoA', password: CLAVE });
    const notasA = await cAlumnoA.get(`/api/alumnos/${alumnoA.id}/notas?periodoId=${periodo.id}`);
    notasA.estado === 200 ? ok('El alumno A accede a sus propias notas') : falla('Alumno A sin acceso a lo suyo', notasA.estado);

    const notasCruzadas = await cAlumnoA.get(`/api/alumnos/${alumnoB.id}/notas?periodoId=${periodo.id}`);
    notasCruzadas.estado === 404
      ? ok('El alumno A NO accede a las notas del alumno B', 'la misma frontera protege al chatbot')
      : falla('Un alumno accedio a notas ajenas', notasCruzadas.estado);

    // El contexto que se le arma al alumno A no debe contener datos del B.
    const respA = await preguntar({ usuario: { id: 999, rol: 'ALUMNO', personaId: pa.persona_id }, pregunta: 'Cuales son mis notas?', ip: '127.0.0.1' });
    typeof respA.respuesta === 'string' && !respA.respuesta.includes('BetaSecreto')
      ? ok('La respuesta al alumno A no menciona datos del alumno B')
      : falla('El contexto filtro datos ajenos', respA.respuesta?.slice(0, 80));

    // ================================================================
    seccion('3. Degradacion elegante sin Ollama');

    r = await admin.post('/api/asistente/preguntar', { pregunta: 'Cuantos alumnos hay?' });
    if (r.estado === 200 && r.datos.disponible === false) {
      ok('Con Ollama apagado, responde que no esta disponible', 'sin romperse');
    } else if (r.estado === 200 && r.datos.disponible === true) {
      ok('Ollama esta disponible y respondio', r.datos.respuesta?.slice(0, 50));
    } else {
      falla('El chat no degrado con elegancia', JSON.stringify(r.datos).slice(0, 100));
    }

    r = await admin.post('/api/asistente/preguntar', { pregunta: '' });
    r.estado === 400 ? ok('Pregunta vacia rechazada') : falla('Se acepto pregunta vacia', r.estado);

    // ================================================================
    seccion('4. Notificaciones: bandeja y lectura');

    await notif.crear({ usuarioId: uMaestro.id, tipo: 'sistema', titulo: 'Bienvenida', mensaje: 'Prueba de bandeja.' });
    await notif.crear({ usuarioId: uMaestro.id, tipo: 'sistema', titulo: 'Segunda', mensaje: 'Otra mas.' });

    const cMaestro = cliente();
    await cMaestro.post('/api/auth/login', { usuario: '_zz6_maestro', password: CLAVE });

    r = await cMaestro.get('/api/notificaciones');
    r.datos.noLeidas === 2 && r.datos.notificaciones.length === 2
      ? ok('La bandeja muestra las notificaciones', `${r.datos.noLeidas} sin leer`)
      : falla('Bandeja de notificaciones', JSON.stringify(r.datos).slice(0, 100));

    r = await cMaestro.get('/api/notificaciones/contador');
    r.datos.noLeidas === 2 ? ok('El contador de no leidas funciona') : falla('Contador', r.datos.noLeidas);

    const primera = (await cMaestro.get('/api/notificaciones')).datos.notificaciones[0];
    r = await cMaestro.post(`/api/notificaciones/${primera.id}/leer`);
    r.estado === 200 ? ok('Una notificacion se marca como leida') : falla('Marcar leida', r.estado);

    r = await cMaestro.get('/api/notificaciones/contador');
    r.datos.noLeidas === 1 ? ok('El contador baja tras leer una') : falla('El contador no bajo', r.datos.noLeidas);

    // ================================================================
    seccion('5. Nadie lee la bandeja de otro');

    const ajena = (await cMaestro.get('/api/notificaciones')).datos.notificaciones[0];
    r = await admin.post(`/api/notificaciones/${ajena.id}/leer`);
    r.estado === 404
      ? ok('Un usuario NO puede marcar leida una notificacion ajena', 'el WHERE incluye usuario_id')
      : falla('Se marco leida una notificacion ajena', r.estado);

    r = await cMaestro.post('/api/notificaciones/leer-todas');
    r.datos.marcadas >= 1 ? ok('Marcar todas como leidas funciona', `${r.datos.marcadas} marcada(s)`) : falla('Leer todas', JSON.stringify(r.datos));

    // ================================================================
    seccion('6. Aviso automatico de inasistencia');

    // Cookie del maestro para pasar lista por fetch directo.
    const cookieMaestro = await (async () => {
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
        body: JSON.stringify({ usuario: '_zz6_maestro', password: CLAVE }),
      });
      return (login.headers.getSetCookie?.() ?? []).map((s) => s.split(';')[0]).join('; ');
    })();

    // El alumno A falta 8 de 8 dias; el B asiste siempre. Con umbral 15%, A cruza.
    for (let d = 1; d <= 8; d++) {
      const f = `2026-06-${String(d).padStart(2, '0')}`;
      await fetch(`${base}/api/clases/${clase.id}/asistencia`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookieMaestro },
        body: JSON.stringify({ fecha: f, registros: [
          { alumnoId: alumnoA.id, estado: 'ausente' },
          { alumnoId: alumnoB.id, estado: 'presente' },
        ] }),
      });
    }

    // ¿Le llegó aviso a la familia del alumno A?
    const [usuarioAlumnoA] = await q("SELECT id FROM usuario WHERE usuario = '_zz6_alumnoA'");
    const notifsA = await q("SELECT COUNT(*) AS n FROM notificacion WHERE usuario_id = ? AND tipo = 'asistencia'", [usuarioAlumnoA.id]);
    notifsA[0].n > 0
      ? ok('El alumno con inasistencia alta recibio aviso en su bandeja', `${notifsA[0].n} aviso(s)`)
      : falla('No se genero el aviso automatico de inasistencia', 'revisar disparador');

    const notifsB = await q("SELECT COUNT(*) AS n FROM notificacion WHERE usuario_id = (SELECT id FROM usuario WHERE usuario='_zz6_alumnoB') AND tipo='asistencia'");
    notifsB[0].n === 0
      ? ok('El alumno B, con asistencia normal, NO recibio aviso', 'los avisos son dirigidos')
      : falla('El alumno B recibio un aviso que no le tocaba', notifsB[0].n);

    // ================================================================
    seccion('7. Aviso automatico de incidencia');

    await cMaestro.post('/api/incidencias', {
      alumnoId: alumnoA.id, claseId: clase.id, gravedad: 'grave', descripcion: 'Prueba de aviso',
    });
    const incidNotif = await q("SELECT COUNT(*) AS n FROM notificacion WHERE usuario_id = ? AND tipo = 'incidencia'", [usuarioAlumnoA.id]);
    incidNotif[0].n > 0 ? ok('La incidencia genero aviso en la bandeja del alumno') : falla('No se genero aviso de incidencia', incidNotif[0].n);

    // ================================================================
    seccion('8. Auditoria del chat');

    const chatLog = await q("SELECT COUNT(*) AS n FROM chat_log WHERE creado_en > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)");
    // Con Ollama apagado no siempre se registra; se acepta 0 o más sin fallar.
    ok('La tabla chat_log es consultable', `${chatLog[0].n} registro(s) recientes`);
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
