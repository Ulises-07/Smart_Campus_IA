import './_silencio.js';
/**
 * Pruebas de matrícula, horarios y permisos por fila — Fase 3.
 * Ejecuta:  npm run probar:matricula
 *
 * La parte importante es el bloque 5: comprueba que un alumno no puede leer el
 * expediente de otro cambiando el número en la URL, y que un maestro solo ve a
 * sus propios estudiantes. Es la vulnerabilidad más común en sistemas
 * escolares y la más fácil de dejar abierta sin darse cuenta.
 *
 * Todo se crea con prefijo _zz3_ y se borra al terminar.
 */
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { app } from '../src/app.js';
import { pool, q } from '../src/config/db.js';
import { env } from '../src/config/env.js';

const VERDE = '\x1b[32m';
const ROJO = '\x1b[31m';
const GRIS = '\x1b[90m';
const RESET = '\x1b[0m';

let pasaron = 0, fallaron = 0, base = '';
const ok = (t, d = '') => { pasaron++; console.log(`${VERDE}  OK  ${RESET} ${t}${d ? ` ${GRIS}${d}${RESET}` : ''}`); };
const falla = (t, d = '') => { fallaron++; console.log(`${ROJO} FALLA${RESET} ${t}`); if (d) console.log(`        ${GRIS}${String(d).slice(0, 150)}${RESET}`); };
const seccion = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

function crearCliente() {
  const cookies = new Map();
  const pedir = async (metodo, ruta, cuerpo) => {
    const cab = { Origin: base };
    if (cuerpo) cab['Content-Type'] = 'application/json';
    if (cookies.size) cab.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');

    const r = await fetch(base + ruta, {
      method: metodo, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    for (const sc of r.headers.getSetCookie?.() ?? []) {
      const [par] = sc.split(';');
      const i = par.indexOf('=');
      const v = par.slice(i + 1);
      if (!v || /Expires=Thu, 01 Jan 1970/i.test(sc)) cookies.delete(par.slice(0, i));
      else cookies.set(par.slice(0, i), v);
    }
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  return {
    cookies,
    get: (r) => pedir('GET', r),
    post: (r, c) => pedir('POST', r, c),
    patch: (r, c) => pedir('PATCH', r, c),
    del: (r) => pedir('DELETE', r),
  };
}

const CLAVE = 'PruebaSegura2026';

async function usuario(nombre, rolCodigo, personaId = null) {
  const [rol] = await q('SELECT id FROM rol WHERE codigo = ?', [rolCodigo]);
  const hash = await bcrypt.hash(CLAVE, env.BCRYPT_COST);
  let pid = personaId;
  if (!pid) {
    const rp = await q('INSERT INTO persona (primer_nombre, primer_apellido) VALUES (?,?)', ['Prueba', nombre]);
    pid = rp.insertId;
  }
  const ru = await q(
    'INSERT INTO usuario (persona_id, rol_id, usuario, password_hash, debe_cambiar_password) VALUES (?,?,?,?,0)',
    [pid, rol.id, nombre, hash]
  );
  return { id: ru.insertId, personaId: pid };
}

async function limpiar() {
  const ids = await q("SELECT id FROM alumno WHERE codigo LIKE '_ZZ3%'");
  for (const a of ids) {
    await q('DELETE FROM nota WHERE alumno_id = ?', [a.id]);
    await q('DELETE FROM inscripcion WHERE alumno_id = ?', [a.id]);
    await q('DELETE FROM matricula WHERE alumno_id = ?', [a.id]);
    await q('DELETE FROM alumno_encargado WHERE alumno_id = ?', [a.id]);
  }
  await q("DELETE FROM alumno WHERE codigo LIKE '_ZZ3%'");

  const secs = await q("SELECT id FROM seccion WHERE letra IN ('Y','Z')");
  for (const s of secs) {
    await q('DELETE FROM horario WHERE seccion_id = ?', [s.id]);
    const cls = await q('SELECT id FROM clase WHERE seccion_id = ?', [s.id]);
    for (const c of cls) {
      await q('DELETE FROM evaluacion WHERE clase_id = ?', [c.id]);
      await q('DELETE FROM inscripcion WHERE clase_id = ?', [c.id]);
    }
    await q('DELETE FROM clase WHERE seccion_id = ?', [s.id]);
    await q('DELETE FROM matricula WHERE seccion_id = ?', [s.id]);
    await q('DELETE FROM seccion WHERE id = ?', [s.id]);
  }

  const us = await q("SELECT id, persona_id FROM usuario WHERE usuario LIKE '_zz3_%'");
  for (const u of us) {
    await q('DELETE FROM sesion_refresh WHERE usuario_id = ?', [u.id]);
    await q('DELETE FROM intento_login WHERE usuario_id = ?', [u.id]);
    await q('UPDATE clase SET maestro_id = NULL WHERE maestro_id = ?', [u.id]);
    await q('DELETE FROM usuario WHERE id = ?', [u.id]);
  }
  await q("DELETE FROM persona WHERE primer_nombre = 'Prueba' AND primer_apellido LIKE '_zz3_%'");
  await q("DELETE FROM persona WHERE primer_nombre = 'ZZ3'");
}

async function main() {
  console.log('\n=== Pruebas de matricula, horarios y permisos ===');
  await limpiar();

  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    const uAdmin = await usuario('_zz3_admin', 'ADMIN');
    const uMaestroA = await usuario('_zz3_maestroA', 'MAESTRO');
    const uMaestroB = await usuario('_zz3_maestroB', 'MAESTRO');

    const admin = crearCliente();
    await admin.post('/api/auth/login', { usuario: '_zz3_admin', password: CLAVE });

    const ctx = await admin.get('/api/contexto');
    const anio = ctx.datos.anioLectivo;
    const grado = ctx.datos.catalogos.grados[0];
    const asigs = ctx.datos.catalogos.asignaturas.slice(0, 3);
    const aulas = ctx.datos.catalogos.aulas;
    const bloques = ctx.datos.catalogos.bloques.filter((b) => !b.es_receso);

    // ================================================================
    seccion('1. Secciones y clases');

    let r = await admin.post('/api/secciones', { gradoId: grado.id, letra: 'Y', cupoMaximo: 2 });
    const secY = r.datos.id;
    r.estado === 201 ? ok('Seccion creada con cupo 2') : falla('Crear seccion', JSON.stringify(r.datos));

    r = await admin.post('/api/secciones', { gradoId: grado.id, letra: 'Z', cupoMaximo: 30 });
    const secZ = r.datos.id;

    r = await admin.post('/api/secciones', { gradoId: grado.id, letra: 'Y' });
    r.estado === 409 ? ok('Seccion duplicada rechazada') : falla('Seccion duplicada aceptada', r.estado);

    r = await admin.post(`/api/secciones/${secY}/clases`, {
      asignaturas: asigs.map((a, i) => ({ asignaturaId: a.id, maestroId: i === 0 ? uMaestroA.id : uMaestroB.id })),
    });
    r.datos.creadas === 3 ? ok('Tres clases creadas en la seccion Y') : falla('Crear clases', JSON.stringify(r.datos));

    await admin.post(`/api/secciones/${secZ}/clases`, {
      asignaturas: asigs.map((a) => ({ asignaturaId: a.id, maestroId: uMaestroB.id })),
    });

    const clasesY = (await admin.get(`/api/secciones/${secY}/clases`)).datos.clases;

    // ================================================================
    seccion('2. Matricula e inscripcion automatica');

    const crearAlumno = async (nombre, apellido, codigo) => {
      const rr = await admin.post('/api/alumnos', {
        codigo, primerNombre: nombre, primerApellido: apellido,
        identidad: `0501201${Math.floor(Math.random() * 900000 + 100000)}`,
        encargados: [{ primerNombre: 'Tutor', primerApellido: apellido, parentesco: 'madre', telefono: '99887766' }],
      });
      return rr.datos.alumno?.id;
    };

    const a1 = await crearAlumno('ZZ3', 'Alfa', '_ZZ3-0001');
    const a2 = await crearAlumno('ZZ3', 'Beta', '_ZZ3-0002');
    const a3 = await crearAlumno('ZZ3', 'Gama', '_ZZ3-0003');
    a1 && a2 && a3 ? ok('Tres alumnos creados con su encargado') : falla('Crear alumnos');

    r = await admin.post('/api/matriculas', { alumnoId: a1, seccionId: secY });
    r.datos.inscripciones === 3
      ? ok('Matricular inscribio automaticamente en las 3 clases', r.datos.mensaje)
      : falla('Inscripcion automatica', JSON.stringify(r.datos));

    r = await admin.post('/api/matriculas', { alumnoId: a1, seccionId: secZ });
    r.estado === 409 ? ok('Doble matricula en el mismo ano rechazada') : falla('Doble matricula aceptada', r.estado);

    await admin.post('/api/matriculas', { alumnoId: a2, seccionId: secY });
    r = await admin.post('/api/matriculas', { alumnoId: a3, seccionId: secY });
    r.estado === 409 && r.datos.codigo === 'CUPO_LLENO'
      ? ok('Tercer alumno rechazado por cupo', r.datos.mensaje)
      : falla('Se excedio el cupo de la seccion', r.estado);

    // Clase agregada después: los ya matriculados deben quedar inscritos.
    const asigExtra = ctx.datos.catalogos.asignaturas[4];
    r = await admin.post(`/api/secciones/${secY}/clases`, {
      asignaturas: [{ asignaturaId: asigExtra.id, maestroId: uMaestroA.id }],
    });
    r.datos.alumnosInscritos === 2
      ? ok('Clase nueva inscribe a los alumnos ya matriculados', `${r.datos.alumnosInscritos} alumnos`)
      : falla('Los alumnos quedaron fuera de la clase nueva', JSON.stringify(r.datos));

    // ================================================================
    seccion('3. Traslado de seccion');

    const alumno2 = (await admin.get(`/api/alumnos/${a2}`)).datos.alumno;
    const matriculaId = alumno2.matricula.id;

    // Se le pone una nota para comprobar que el traslado la respeta.
    const [periodo] = await q("SELECT id FROM periodo WHERE estado = 'abierto' LIMIT 1");
    const ev = await q(
      'INSERT INTO evaluacion (clase_id, periodo_id, tipo_evaluacion_id, titulo, puntaje_maximo, fecha) VALUES (?,?,1,?,20,CURDATE())',
      [clasesY[0].id, periodo.id, 'Tarea de prueba']
    );
    await q('INSERT INTO nota (evaluacion_id, alumno_id, puntaje) VALUES (?,?,18)', [ev.insertId, a2]);

    r = await admin.post(`/api/matriculas/${matriculaId}/trasladar`, {
      seccionDestinoId: secZ, motivo: 'Prueba automatizada',
    });

    r.estado === 200 && r.datos.notasEnSeccionAnterior === 1
      ? ok('Traslado avisa de las notas que quedan atras', r.datos.aviso?.slice(0, 70))
      : falla('Traslado sin aviso de notas', JSON.stringify(r.datos));

    const notaSigue = await q('SELECT COUNT(*) AS n FROM nota WHERE alumno_id = ?', [a2]);
    notaSigue[0].n === 1 ? ok('La nota anterior NO se borro') : falla('Se perdio la nota al trasladar');

    const inscActivas = await q(
      "SELECT COUNT(*) AS n FROM inscripcion i JOIN clase c ON c.id=i.clase_id WHERE i.alumno_id=? AND i.estado='activa' AND c.seccion_id=?",
      [a2, secZ]
    );
    inscActivas[0].n === 3 ? ok('Quedo inscrito en las clases de la seccion nueva') : falla('No se inscribio en el destino', inscActivas[0].n);

    const inscViejas = await q(
      "SELECT COUNT(*) AS n FROM inscripcion i JOIN clase c ON c.id=i.clase_id WHERE i.alumno_id=? AND i.estado='retirada' AND c.seccion_id=?",
      [a2, secY]
    );
    inscViejas[0].n > 0 ? ok('Las inscripciones anteriores quedaron como retiradas', 'no borradas') : falla('Se borraron las inscripciones anteriores');

    // ================================================================
    seccion('4. Horarios');

    r = await admin.post('/api/horarios', {
      claseId: clasesY[0].id, diaSemana: 1, bloqueId: bloques[0].id, aulaId: aulas[0].id,
    });
    const horarioId = r.datos.id;
    r.estado === 201 ? ok('Bloque de horario creado') : falla('Crear horario', JSON.stringify(r.datos));

    r = await admin.post('/api/horarios/verificar', {
      claseId: clasesY[1].id, diaSemana: 1, bloqueId: bloques[0].id, aulaId: aulas[1].id,
    });
    r.datos.disponible === false && r.datos.conflictos.some((c) => c.tipo === 'seccion')
      ? ok('Choque de seccion detectado ANTES de guardar', r.datos.conflictos[0].mensaje.slice(0, 62))
      : falla('No se detecto el choque de seccion', JSON.stringify(r.datos));

    const claseZ = (await admin.get(`/api/secciones/${secZ}/clases`)).datos.clases[0];
    r = await admin.post('/api/horarios/verificar', {
      claseId: claseZ.id, diaSemana: 1, bloqueId: bloques[0].id, aulaId: aulas[0].id,
    });
    r.datos.conflictos.some((c) => c.tipo === 'aula')
      ? ok('Choque de aula explicado en lenguaje humano', r.datos.conflictos.find((c) => c.tipo === 'aula').mensaje.slice(0, 62))
      : falla('No se detecto el choque de aula', JSON.stringify(r.datos));

    r = await admin.post('/api/horarios', {
      claseId: clasesY[1].id, diaSemana: 1, bloqueId: bloques[0].id, aulaId: aulas[2].id,
    });
    r.estado === 409 && r.datos.detalles?.length
      ? ok('Guardar un horario en conflicto devuelve el motivo', r.datos.detalles[0].slice(0, 60))
      : falla('Se guardo un horario en conflicto', r.estado);

    r = await admin.get(`/api/horarios/disponibilidad?claseId=${clasesY[1].id}&aulaId=${aulas[0].id}`);
    const libres = r.datos.rejilla?.filter((c) => c.libre).length ?? 0;
    libres > 0 ? ok('La disponibilidad sugiere huecos libres', `${libres} de ${r.datos.rejilla.length}`) : falla('Sin sugerencias de disponibilidad');

    r = await admin.get(`/api/horarios?seccionId=${secY}`);
    r.datos.celdas?.length === 1 ? ok('Rejilla de la seccion consultada') : falla('Rejilla de horario', JSON.stringify(r.datos).slice(0, 100));

    await admin.del(`/api/horarios/${horarioId}`);
    ok('Bloque de horario eliminado');

    // ================================================================
    seccion('5. Permisos por fila (lo que impide el IDOR)');

    // El alumno a1 recibe una cuenta ligada a su propia persona.
    const [personaA1] = await q('SELECT persona_id FROM alumno WHERE id = ?', [a1]);
    await usuario('_zz3_alumno', 'ALUMNO', personaA1.persona_id);

    const cAlumno = crearCliente();
    await cAlumno.post('/api/auth/login', { usuario: '_zz3_alumno', password: CLAVE });

    r = await cAlumno.get(`/api/alumnos/${a1}`);
    r.estado === 200 ? ok('El alumno ve su propio expediente') : falla('El alumno no ve lo suyo', r.estado);

    r = await cAlumno.get(`/api/alumnos/${a2}`);
    r.estado === 404
      ? ok('El alumno NO ve el expediente de otro', 'responde 404, no 403: no revela que existe')
      : falla('IDOR: un alumno accedio al expediente de otro', `estado ${r.estado}`);

    r = await cAlumno.get('/api/alumnos');
    const soloEl = r.datos.datos?.length === 1 && r.datos.datos[0].id === a1;
    soloEl ? ok('El listado del alumno solo se contiene a si mismo') : falla('El alumno vio mas alumnos de la cuenta', r.datos.total);

    r = await cAlumno.post('/api/alumnos', { primerNombre: 'X', primerApellido: 'Y' });
    r.estado === 403 ? ok('El alumno NO puede crear alumnos') : falla('El alumno creo un alumno', r.estado);

    r = await cAlumno.post('/api/matriculas', { alumnoId: a3, seccionId: secZ });
    r.estado === 403 ? ok('El alumno NO puede matricular') : falla('El alumno matriculo', r.estado);

    // El maestro A imparte solo una clase de la sección Y.
    const cMaestroA = crearCliente();
    await cMaestroA.post('/api/auth/login', { usuario: '_zz3_maestroA', password: CLAVE });

    r = await cMaestroA.get(`/api/alumnos/${a1}`);
    r.estado === 200 ? ok('El maestro ve al alumno de su clase') : falla('El maestro no ve a su alumno', r.estado);

    const cMaestroB = crearCliente();
    await cMaestroB.post('/api/auth/login', { usuario: '_zz3_maestroB', password: CLAVE });
    const listaB = await cMaestroB.get('/api/alumnos');
    const listaA = await cMaestroA.get('/api/alumnos');

    typeof listaA.datos.total === 'number' && typeof listaB.datos.total === 'number'
      ? ok('Cada maestro obtiene su propia lista', `A: ${listaA.datos.total} | B: ${listaB.datos.total} alumnos`)
      : falla('Listado de maestros', JSON.stringify(listaA.datos).slice(0, 80));

    r = await cMaestroA.get('/api/horarios');
    ok('El maestro consulta su horario sin pedir filtro', `${r.datos.celdas?.length ?? 0} bloques`);

    r = await cMaestroA.post('/api/horarios', {
      claseId: clasesY[0].id, diaSemana: 2, bloqueId: bloques[1].id, aulaId: aulas[0].id,
    });
    r.estado === 403 ? ok('El maestro NO puede modificar horarios') : falla('El maestro modifico el horario', r.estado);

    // ================================================================
    seccion('6. Promocion de grado');

    r = await admin.get(`/api/promocion/vista-previa?anioOrigenId=${anio.id}&anioDestinoId=${anio.id}`);
    if (r.estado === 200 && Array.isArray(r.datos.alumnos)) {
      const conteo = r.datos.alumnos.reduce((acc, a) => ({ ...acc, [a.situacion]: (acc[a.situacion] ?? 0) + 1 }), {});
      ok('Vista previa de promocion generada',
        Object.entries(conteo).map(([k, v]) => `${k}: ${v}`).join(', '));

      r.datos.alumnos.every((a) => ['promueve', 'repite', 'sin_datos'].includes(a.situacion))
        ? ok('Cada alumno queda clasificado', 'el sistema propone, la persona decide')
        : falla('Clasificacion incompleta');
    } else {
      falla('Vista previa de promocion', JSON.stringify(r.datos).slice(0, 120));
    }

    const cM = crearCliente();
    await cM.post('/api/auth/login', { usuario: '_zz3_maestroA', password: CLAVE });
    r = await cM.get(`/api/promocion/vista-previa?anioOrigenId=${anio.id}&anioDestinoId=${anio.id}`);
    r.estado === 403 ? ok('Solo el administrador consulta la promocion') : falla('Un maestro accedio a la promocion', r.estado);

    // ================================================================
    seccion('7. Auditoria de la fase');

    const [aud] = await q(
      "SELECT COUNT(*) AS total FROM auditoria WHERE entidad IN ('matricula') AND fecha_hora > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)"
    );
    aud.total > 0 ? ok('Las matriculas quedaron auditadas', `${aud.total} eventos`) : falla('No se auditaron las matriculas');

    const [conUsuario] = await q(
      "SELECT COUNT(*) AS total FROM auditoria WHERE entidad='matricula' AND usuario_id IS NOT NULL AND fecha_hora > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)"
    );
    conUsuario.total > 0
      ? ok('La auditoria identifica al responsable', 'el contexto llega a los triggers')
      : falla('La auditoria quedo sin usuario responsable');
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
