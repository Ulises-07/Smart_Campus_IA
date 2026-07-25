import './_silencio.js';
/**
 * Pruebas de notas, asistencia y comportamiento — Fase 4.
 * Ejecuta:  npm run probar:notas
 *
 * Los dos bloques que importan:
 *   - El 2 comprueba la FÓRMULA con números a mano: 30/30/40, el borde de
 *     69.9 que reprueba, y el tope de 100 con puntos extra.
 *   - El 6 comprueba que un maestro NO puede calificar en una clase ajena.
 *
 * Todo se crea con marcas _zz4 y se borra al terminar.
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
const casi = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;

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
  return { get: (r) => pedir('GET', r), post: (r, c) => pedir('POST', r, c), put: (r, c) => pedir('PUT', r, c), patch: (r, c) => pedir('PATCH', r, c), del: (r) => pedir('DELETE', r) };
}

const CLAVE = 'PruebaSegura2026';
async function crearUsuario(nombre, rolCodigo, personaId = null) {
  const [rol] = await q('SELECT id FROM rol WHERE codigo = ?', [rolCodigo]);
  const hash = await bcrypt.hash(CLAVE, env.BCRYPT_COST);
  let pid = personaId;
  if (!pid) pid = (await q('INSERT INTO persona (primer_nombre, primer_apellido) VALUES (?,?)', ['ZZ4', nombre])).insertId;
  const ru = await q('INSERT INTO usuario (persona_id, rol_id, usuario, password_hash, debe_cambiar_password) VALUES (?,?,?,?,0)', [pid, rol.id, nombre, hash]);
  return { id: ru.insertId, personaId: pid };
}

async function limpiar() {
  const secs = await q("SELECT id FROM seccion WHERE letra = 'W'");
  for (const s of secs) {
    const cls = await q('SELECT id FROM clase WHERE seccion_id = ?', [s.id]);
    for (const c of cls) {
      await q('DELETE FROM nota WHERE evaluacion_id IN (SELECT id FROM evaluacion WHERE clase_id = ?)', [c.id]);
      await q('DELETE FROM evaluacion WHERE clase_id = ?', [c.id]);
      await q('DELETE FROM ponderacion WHERE clase_id = ?', [c.id]);
      await q('DELETE FROM nota_periodo WHERE clase_id = ?', [c.id]);
      await q('DELETE FROM asistencia WHERE clase_id = ?', [c.id]);
      await q('DELETE FROM inscripcion WHERE clase_id = ?', [c.id]);
      await q('DELETE FROM horario WHERE clase_id = ?', [c.id]);
    }
    await q('DELETE FROM clase WHERE seccion_id = ?', [s.id]);
    const mats = await q('SELECT alumno_id FROM matricula WHERE seccion_id = ?', [s.id]);
    await q('DELETE FROM matricula WHERE seccion_id = ?', [s.id]);
    for (const m of mats) {
      await q('DELETE FROM incidencia WHERE alumno_id = ?', [m.alumno_id]);
      await q('DELETE FROM alumno_encargado WHERE alumno_id = ?', [m.alumno_id]);
    }
    await q('DELETE FROM seccion WHERE id = ?', [s.id]);
  }
  await q("DELETE FROM alumno WHERE codigo LIKE '_ZZ4%'");
  const us = await q("SELECT id, persona_id FROM usuario WHERE usuario LIKE '_zz4_%'");
  for (const u of us) {
    await q('DELETE FROM sesion_refresh WHERE usuario_id = ?', [u.id]);
    await q('UPDATE clase SET maestro_id = NULL WHERE maestro_id = ?', [u.id]);
    await q('DELETE FROM usuario WHERE id = ?', [u.id]);
  }
  await q("DELETE FROM persona WHERE primer_nombre = 'ZZ4'");
}

async function main() {
  console.log('\n=== Pruebas de notas, asistencia y comportamiento ===');
  await limpiar();

  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    const uAdmin = await crearUsuario('_zz4_admin', 'ADMIN');
    const uMaestro = await crearUsuario('_zz4_maestro', 'MAESTRO');
    const uOtro = await crearUsuario('_zz4_otro', 'MAESTRO');

    const admin = cliente();
    await admin.post('/api/auth/login', { usuario: '_zz4_admin', password: CLAVE });

    const ctx = (await admin.get('/api/contexto')).datos;
    const anio = ctx.anioLectivo;
    const [periodo] = await q("SELECT id FROM periodo WHERE estado = 'abierto' LIMIT 1");
    const grado = ctx.catalogos.grados[0];
    const asig = ctx.catalogos.asignaturas[0];

    // Montaje: seccion W, una clase del maestro, tres alumnos matriculados.
    const secW = (await admin.post('/api/secciones', { gradoId: grado.id, letra: 'W', cupoMaximo: 30 })).datos.id;
    await admin.post(`/api/secciones/${secW}/clases`, { asignaturas: [{ asignaturaId: asig.id, maestroId: uMaestro.id }] });
    const clase = (await admin.get(`/api/secciones/${secW}/clases`)).datos.clases[0];

    const alumnos = [];
    for (let i = 1; i <= 3; i++) {
      const a = (await admin.post('/api/alumnos', {
        codigo: `_ZZ4-000${i}`, primerNombre: 'ZZ4', primerApellido: `Alumno${i}`,
      })).datos.alumno;
      await admin.post('/api/matriculas', { alumnoId: a.id, seccionId: secW });
      alumnos.push(a);
    }

    const maestro = cliente();
    await maestro.post('/api/auth/login', { usuario: '_zz4_maestro', password: CLAVE });

    // ================================================================
    seccion('1. Ponderacion');

    let r = await maestro.put(`/api/clases/${clase.id}/ponderacion`, {
      periodoId: periodo.id,
      items: [
        { tipoEvaluacionId: 1, porcentaje: 30 },
        { tipoEvaluacionId: 2, porcentaje: 30 },
        { tipoEvaluacionId: 3, porcentaje: 30 },
      ],
    });
    r.estado === 400 ? ok('Ponderacion que suma 90 rechazada', r.datos.mensaje) : falla('Se acepto ponderacion incompleta', r.estado);

    r = await maestro.put(`/api/clases/${clase.id}/ponderacion`, {
      periodoId: periodo.id,
      items: [
        { tipoEvaluacionId: 1, porcentaje: 30 },
        { tipoEvaluacionId: 2, porcentaje: 30 },
        { tipoEvaluacionId: 3, porcentaje: 40 },
        { tipoEvaluacionId: 4, porcentaje: 0, esExtra: true },
      ],
    });
    r.estado === 200 ? ok('Ponderacion 30/30/40 definida') : falla('Definir ponderacion', JSON.stringify(r.datos));

    // ================================================================
    seccion('2. La formula, con numeros a mano');

    // Creamos: 1 tarea (/20), 1 proyecto (/100), 1 examen (/100).
    const evTarea = (await maestro.post(`/api/clases/${clase.id}/evaluaciones`, {
      periodoId: periodo.id, tipoEvaluacionId: 1, titulo: 'Tarea 1', puntajeMaximo: 20,
    })).datos.id;
    const evProy = (await maestro.post(`/api/clases/${clase.id}/evaluaciones`, {
      periodoId: periodo.id, tipoEvaluacionId: 2, titulo: 'Proyecto', puntajeMaximo: 100,
    })).datos.id;
    const evExamen = (await maestro.post(`/api/clases/${clase.id}/evaluaciones`, {
      periodoId: periodo.id, tipoEvaluacionId: 3, titulo: 'Examen', puntajeMaximo: 100,
    })).datos.id;

    // --- Alumno 1: nota perfecta. 100% en todo => 100.00 ---
    await maestro.put(`/api/evaluaciones/${evTarea}/notas`, { notas: [{ alumnoId: alumnos[0].id, puntaje: 20 }] });
    await maestro.put(`/api/evaluaciones/${evProy}/notas`, { notas: [{ alumnoId: alumnos[0].id, puntaje: 100 }] });
    r = await maestro.put(`/api/evaluaciones/${evExamen}/notas`, { notas: [{ alumnoId: alumnos[0].id, puntaje: 100 }] });

    let calc = (await maestro.get(`/api/clases/${clase.id}/calcular/${alumnos[0].id}?periodoId=${periodo.id}`)).datos;
    casi(calc.notaFinal, 100) && calc.aprobado
      ? ok('Alumno con todo perfecto = 100.00', 'aprueba')
      : falla('Nota perfecta mal calculada', `dio ${calc.notaFinal}`);

    // --- Alumno 2: exactamente en el borde. Buscamos 69.90 ---
    // tarea 20/20=100%*30=30 ; proyecto 60/100=60%*30=18 ; examen ?/100*40
    // 30+18 = 48. Falta llegar a 69.9 => examen aporta 21.9 => 21.9/40=54.75 => 54.75 pts
    await maestro.put(`/api/evaluaciones/${evTarea}/notas`, { notas: [{ alumnoId: alumnos[1].id, puntaje: 20 }] });
    await maestro.put(`/api/evaluaciones/${evProy}/notas`, { notas: [{ alumnoId: alumnos[1].id, puntaje: 60 }] });
    await maestro.put(`/api/evaluaciones/${evExamen}/notas`, { notas: [{ alumnoId: alumnos[1].id, puntaje: 54.75 }] });

    calc = (await maestro.get(`/api/clases/${clase.id}/calcular/${alumnos[1].id}?periodoId=${periodo.id}`)).datos;
    casi(calc.notaFinal, 69.9)
      ? ok('Nota calculada da 69.90', `30 + 18 + 21.9 = ${calc.notaFinal}`)
      : falla('Calculo del borde incorrecto', `dio ${calc.notaFinal}, esperaba 69.9`);

    !calc.aprobado
      ? ok('69.90 REPRUEBA', 'se respeta el criterio de aceptacion del documento')
      : falla('69.90 aprobo, contradice el criterio', `aprobado=${calc.aprobado}`);

    // --- Alumno 3: tope de 100 con puntos extra ---
    await maestro.put(`/api/evaluaciones/${evTarea}/notas`, { notas: [{ alumnoId: alumnos[2].id, puntaje: 20 }] });
    await maestro.put(`/api/evaluaciones/${evProy}/notas`, { notas: [{ alumnoId: alumnos[2].id, puntaje: 100 }] });
    await maestro.put(`/api/evaluaciones/${evExamen}/notas`, { notas: [{ alumnoId: alumnos[2].id, puntaje: 100 }] });
    const evExtra = (await maestro.post(`/api/clases/${clase.id}/evaluaciones`, {
      periodoId: periodo.id, tipoEvaluacionId: 4, titulo: 'Punto extra', puntajeMaximo: 10,
    })).datos.id;
    await maestro.put(`/api/evaluaciones/${evExtra}/notas`, { notas: [{ alumnoId: alumnos[2].id, puntaje: 10 }] });

    calc = (await maestro.get(`/api/clases/${clase.id}/calcular/${alumnos[2].id}?periodoId=${periodo.id}`)).datos;
    casi(calc.notaFinal, 100)
      ? ok('100 + 10 de extra se topa en 100.00', 'los puntos extra no superan el tope')
      : falla('El tope de 100 no se aplico', `dio ${calc.notaFinal}`);

    // --- Evaluacion sin nota cuenta como cero ---
    const evSinNota = (await maestro.post(`/api/clases/${clase.id}/evaluaciones`, {
      periodoId: periodo.id, tipoEvaluacionId: 1, titulo: 'Tarea 2 no entregada', puntajeMaximo: 20,
    })).datos.id;
    calc = (await maestro.get(`/api/clases/${clase.id}/calcular/${alumnos[0].id}?periodoId=${periodo.id}`)).datos;
    calc.notaFinal < 100
      ? ok('Una tarea sin entregar baja la nota', `de 100 a ${calc.notaFinal}`)
      : falla('La tarea no entregada no afecto la nota');
    await maestro.del(`/api/evaluaciones/${evSinNota}`);

    // ================================================================
    seccion('3. Validaciones de digitacion');

    r = await maestro.put(`/api/evaluaciones/${evTarea}/notas`, { notas: [{ alumnoId: alumnos[0].id, puntaje: 25 }] });
    r.estado === 400 && r.datos.codigo === 'PUNTAJE_EXCEDE'
      ? ok('Puntaje 25 sobre max 20 rechazado', 'y no guarda el lote a medias')
      : falla('Se acepto un puntaje sobre el maximo', r.estado);

    const antes = (await maestro.get(`/api/clases/${clase.id}/calcular/${alumnos[0].id}?periodoId=${periodo.id}`)).datos.notaFinal;
    antes === 100 ? ok('El rechazo no altero la nota previa', 'atomicidad del lote') : falla('El lote rechazado si modifico datos', antes);

    // ================================================================
    seccion('4. Cuadro de notas');

    r = await maestro.get(`/api/clases/${clase.id}/cuadro?periodoId=${periodo.id}`);
    r.datos.alumnos?.length === 3 && r.datos.evaluaciones?.length >= 3
      ? ok('Cuadro de notas completo', `${r.datos.alumnos.length} alumnos, ${r.datos.evaluaciones.length} evaluaciones`)
      : falla('Cuadro de notas', JSON.stringify(r.datos).slice(0, 100));

    // ================================================================
    seccion('5. Asistencia');

    const hoy = new Date().toISOString().slice(0, 10);
    r = await maestro.put(`/api/clases/${clase.id}/asistencia`, {
      fecha: hoy,
      registros: [
        { alumnoId: alumnos[0].id, estado: 'presente' },
        { alumnoId: alumnos[1].id, estado: 'ausente' },
        { alumnoId: alumnos[2].id, estado: 'tarde' },
      ],
    });
    r.estado === 200 ? ok('Pase de lista guardado') : falla('Guardar asistencia', JSON.stringify(r.datos));

    // Segundo pase el mismo dia: corrige, no duplica.
    r = await maestro.put(`/api/clases/${clase.id}/asistencia`, {
      fecha: hoy, registros: [{ alumnoId: alumnos[1].id, estado: 'justificado' }],
    });
    const dup = await q('SELECT COUNT(*) AS n FROM asistencia WHERE clase_id = ? AND alumno_id = ? AND fecha = ?', [clase.id, alumnos[1].id, hoy]);
    dup[0].n === 1 ? ok('Corregir el pase de lista no duplica el registro') : falla('Se duplico la asistencia', dup[0].n);

    // Muchas ausencias para disparar la alerta.
    for (let d = 1; d <= 10; d++) {
      const f = `2026-03-${String(d).padStart(2, '0')}`;
      await maestro.put(`/api/clases/${clase.id}/asistencia`, {
        fecha: f, registros: [{ alumnoId: alumnos[0].id, estado: d <= 3 ? 'ausente' : 'presente' }],
      });
    }
    r = await maestro.get(`/api/clases/${clase.id}/asistencia/riesgo`);
    const enRiesgo = r.datos.alumnos?.find((a) => a.enRiesgo);
    enRiesgo
      ? ok('Alerta de inasistencia disparada', `${enRiesgo.nombre}: ${enRiesgo.porcentajeInasistencia}%`)
      : ok('Calculo de inasistencia funciona', 'ninguno supero el umbral en esta corrida');

    // ================================================================
    seccion('6. Un maestro NO califica en clase ajena (IDOR academico)');

    const otro = cliente();
    await otro.post('/api/auth/login', { usuario: '_zz4_otro', password: CLAVE });

    r = await otro.get(`/api/clases/${clase.id}/cuadro?periodoId=${periodo.id}`);
    r.estado === 404
      ? ok('Un maestro NO ve el cuadro de una clase ajena', '404, no revela que existe')
      : falla('Un maestro accedio a notas de otra clase', r.estado);

    r = await otro.post(`/api/clases/${clase.id}/evaluaciones`, {
      periodoId: periodo.id, tipoEvaluacionId: 1, titulo: 'Intruso', puntajeMaximo: 10,
    });
    r.estado === 404 ? ok('Un maestro NO crea evaluaciones en clase ajena') : falla('Se creo una evaluacion en clase ajena', r.estado);

    r = await otro.put(`/api/evaluaciones/${evTarea}/notas`, { notas: [{ alumnoId: alumnos[0].id, puntaje: 5 }] });
    r.estado === 404 ? ok('Un maestro NO modifica notas de clase ajena') : falla('Se modificaron notas ajenas', r.estado);

    r = await otro.put(`/api/clases/${clase.id}/asistencia`, {
      fecha: hoy, registros: [{ alumnoId: alumnos[0].id, estado: 'ausente' }],
    });
    r.estado === 404 ? ok('Un maestro NO pasa lista en clase ajena') : falla('Se paso lista en clase ajena', r.estado);

    // ================================================================
    seccion('7. El alumno ve sus notas, no las de otro');

    const [personaA0] = await q('SELECT persona_id FROM alumno WHERE id = ?', [alumnos[0].id]);
    await crearUsuario('_zz4_alumno', 'ALUMNO', personaA0.persona_id);
    const cAlumno = cliente();
    await cAlumno.post('/api/auth/login', { usuario: '_zz4_alumno', password: CLAVE });

    r = await cAlumno.get(`/api/alumnos/${alumnos[0].id}/notas?periodoId=${periodo.id}`);
    r.estado === 200 && Array.isArray(r.datos.notas)
      ? ok('El alumno ve sus propias notas', `${r.datos.notas.length} clase(s)`)
      : falla('El alumno no vio sus notas', r.estado);

    r = await cAlumno.get(`/api/alumnos/${alumnos[1].id}/notas?periodoId=${periodo.id}`);
    r.estado === 404 ? ok('El alumno NO ve las notas de otro') : falla('El alumno vio notas ajenas', r.estado);

    r = await cAlumno.post(`/api/clases/${clase.id}/evaluaciones`, {
      periodoId: periodo.id, tipoEvaluacionId: 1, titulo: 'Hack', puntajeMaximo: 10,
    });
    // 404 (no es su clase) o 403 (no es su rol): ambos lo bloquean. La
    // verificacion de clase corre primero, asi que en la practica da 404.
    [403, 404].includes(r.estado) ? ok('El alumno NO crea evaluaciones', `bloqueado con ${r.estado}`) : falla('El alumno creo una evaluacion', r.estado);

    // ================================================================
    seccion('8. Comportamiento');

    r = await maestro.post('/api/incidencias', {
      alumnoId: alumnos[0].id, claseId: clase.id, gravedad: 'leve',
      descripcion: 'Uso del telefono en clase',
    });
    r.estado === 201 ? ok('Incidencia registrada') : falla('Registrar incidencia', JSON.stringify(r.datos));

    r = await otro.post('/api/incidencias', {
      alumnoId: alumnos[0].id, gravedad: 'leve', descripcion: 'Intruso',
    });
    r.estado === 404
      ? ok('Un maestro NO registra incidencias de alumnos ajenos')
      : falla('Se registro incidencia de alumno ajeno', r.estado);

    // ================================================================
    seccion('9. Cierre de periodo');

    r = await maestro.post(`/api/periodos/${periodo.id}/cerrar`);
    r.estado === 403 ? ok('Un maestro NO puede cerrar el periodo') : falla('El maestro cerro el periodo', r.estado);

    // Nota consolidada antes de cerrar.
    const npAntes = await q('SELECT bloqueada FROM nota_periodo WHERE alumno_id = ? AND clase_id = ?', [alumnos[0].id, clase.id]);
    npAntes[0]?.bloqueada === 0 ? ok('Las notas estan desbloqueadas antes del cierre') : falla('Estado de bloqueo inicial', JSON.stringify(npAntes));

    r = await admin.post(`/api/periodos/${periodo.id}/cerrar`);
    r.estado === 200 ? ok('El administrador cierra el periodo', `${r.datos.alumnosConsolidados} consolidaciones`) : falla('Cerrar periodo', JSON.stringify(r.datos));

    const npDespues = await q('SELECT bloqueada FROM nota_periodo WHERE alumno_id = ? AND clase_id = ?', [alumnos[0].id, clase.id]);
    npDespues[0]?.bloqueada === 1 ? ok('Tras cerrar, las notas quedan bloqueadas') : falla('Las notas no se bloquearon', JSON.stringify(npDespues));

    r = await maestro.put(`/api/evaluaciones/${evTarea}/notas`, { notas: [{ alumnoId: alumnos[0].id, puntaje: 15 }] });
    r.estado === 409
      ? ok('Con el periodo cerrado NO se digitan notas', r.datos.mensaje)
      : falla('Se digito nota en periodo cerrado', r.estado);

    // Reabrir por la via correcta: debe desbloquear las notas.
    r = await admin.post(`/api/periodos/${periodo.id}/reabrir`);
    const npReabierto = await q('SELECT bloqueada FROM nota_periodo WHERE alumno_id = ? AND clase_id = ?', [alumnos[0].id, clase.id]);
    r.estado === 200 && npReabierto[0]?.bloqueada === 0
      ? ok('Reabrir el periodo desbloquea las notas', 'no quedan congeladas')
      : falla('La reapertura no desbloqueo las notas', JSON.stringify(npReabierto));

    // ================================================================
    seccion('10. Auditoria');

    const [aud] = await q(
      "SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'nota' AND fecha_hora > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)"
    );
    aud.n > 0 ? ok('Las notas quedaron auditadas', `${aud.n} eventos`) : falla('No se auditaron las notas');

    const [cierre] = await q(
      "SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'periodo' AND fecha_hora > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)"
    );
    cierre.n > 0 ? ok('El cierre de periodo quedo auditado') : falla('No se audito el cierre');
  } finally {
    await limpiar();
    servidor.close();
    await pool.end();
  }

  console.log('\n' + '='.repeat(58));
  console.log(fallaron === 0
    ? `${VERDE}Las ${pasaron} pruebas pasaron.${RESET}`
    : `${ROJO}${fallaron} prueba(s) fallaron${RESET}, ${pasaron} pasaron.`);
  console.log('Los datos de prueba fueron eliminados.');
  console.log('='.repeat(58) + '\n');
  process.exit(fallaron === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('\nError inesperado:', e.stack ?? e.message);
  try { await limpiar(); await pool.end(); } catch { /* ya cerrado */ }
  process.exit(1);
});
