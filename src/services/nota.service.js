/**
 * Notas: ponderación, evaluaciones y digitación.
 *
 * Reglas de autoridad que este servicio hace cumplir:
 *  - Solo el maestro de la clase (o un admin) digita sus notas.
 *  - No se digita en un periodo que no está abierto.
 *  - Al guardar una nota se recalcula la consolidada del periodo, para que el
 *    alumno y la boleta vean siempre el número vigente sin un paso manual.
 */
import { q, transaccion } from '../config/db.js';
import { AppError } from '../middleware/error.js';
import { configNotas, calcular, consolidar } from './calculo-notas.service.js';

async function periodoAbierto(periodoId) {
  const [p] = await q('SELECT id, nombre, estado FROM periodo WHERE id = ?', [periodoId]);
  if (!p) throw new AppError('El periodo no existe.', 404, 'PERIODO_NO_ENCONTRADO');
  if (p.estado !== 'abierto') {
    throw new AppError(`El periodo "${p.nombre}" no esta abierto para digitar notas.`, 409, 'PERIODO_CERRADO');
  }
  return p;
}

/** Ponderación vigente de una clase y periodo. */
export async function obtenerPonderacion(claseId, periodoId) {
  const filas = await q(
    `SELECT p.id, p.tipo_evaluacion_id, p.porcentaje, t.codigo, t.nombre, t.es_extra
       FROM ponderacion p JOIN tipo_evaluacion t ON t.id = p.tipo_evaluacion_id
      WHERE p.clase_id = ? AND p.periodo_id = ?
      ORDER BY t.es_extra, t.id`,
    [claseId, periodoId]
  );
  const suma = filas.filter((f) => !f.es_extra).reduce((s, f) => s + Number(f.porcentaje), 0);
  return { ponderaciones: filas, suma, completa: Math.abs(suma - 100) < 0.01 };
}

/**
 * Define la ponderación de una clase y periodo.
 * La suma de los tipos ponderables debe dar exactamente 100: si no, cualquier
 * nota calculada sería incorrecta.
 */
export async function definirPonderacion({ claseId, periodoId, items }, ctx) {
  await periodoAbierto(periodoId);

  const ponderables = items.filter((i) => !i.esExtra);
  const suma = ponderables.reduce((s, i) => s + Number(i.porcentaje), 0);
  if (Math.abs(suma - 100) > 0.01) {
    throw new AppError(`Los porcentajes deben sumar 100. Suman ${suma}.`, 400, 'PONDERACION_INVALIDA');
  }

  return transaccion(async (conn) => {
    await conn.query('DELETE FROM ponderacion WHERE clase_id = ? AND periodo_id = ?', [claseId, periodoId]);
    for (const i of items) {
      await conn.query(
        'INSERT INTO ponderacion (clase_id, periodo_id, tipo_evaluacion_id, porcentaje, definido_por) VALUES (?,?,?,?,?)',
        [claseId, periodoId, i.tipoEvaluacionId, i.porcentaje, ctx?.usuarioId ?? null]
      );
    }
    return { definidas: items.length };
  }, ctx);
}

/** Evaluaciones de una clase y periodo, con cuántos alumnos tienen nota. */
export async function listarEvaluaciones(claseId, periodoId) {
  return q(
    `SELECT e.id, e.titulo, e.descripcion, e.puntaje_maximo, e.fecha, e.activa,
            e.tipo_evaluacion_id, t.nombre AS tipo, t.codigo AS tipo_codigo, t.es_extra,
            (SELECT COUNT(*) FROM nota n WHERE n.evaluacion_id = e.id) AS calificados
       FROM evaluacion e JOIN tipo_evaluacion t ON t.id = e.tipo_evaluacion_id
      WHERE e.clase_id = ? AND e.periodo_id = ?
      ORDER BY t.es_extra, e.fecha, e.id`,
    [claseId, periodoId]
  );
}

export async function crearEvaluacion({ claseId, periodoId, tipoEvaluacionId, titulo, descripcion, puntajeMaximo, fecha }, ctx) {
  await periodoAbierto(periodoId);

  return transaccion(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO evaluacion (clase_id, periodo_id, tipo_evaluacion_id, titulo, descripcion, puntaje_maximo, fecha, creado_por)
       VALUES (?,?,?,?,?,?,?,?)`,
      [claseId, periodoId, tipoEvaluacionId, titulo, descripcion ?? null, puntajeMaximo ?? 100,
        fecha ?? new Date().toISOString().slice(0, 10), ctx?.usuarioId ?? null]
    );
    return { id: r.insertId };
  }, ctx);
}

export async function eliminarEvaluacion(evaluacionId, ctx) {
  const [e] = await q(
    `SELECT e.id, e.clase_id, e.periodo_id, p.estado FROM evaluacion e JOIN periodo p ON p.id = e.periodo_id WHERE e.id = ?`,
    [evaluacionId]
  );
  if (!e) throw new AppError('La evaluacion no existe.', 404, 'NO_ENCONTRADO');
  if (e.estado !== 'abierto') throw new AppError('No se puede eliminar en un periodo cerrado.', 409, 'PERIODO_CERRADO');

  const cfg = await configNotas();
  return transaccion(async (conn) => {
    // Al borrar la evaluación se van sus notas (CASCADE). Hay que recalcular a
    // los alumnos afectados: su nota consolidada ya no debe contarla.
    const [alumnos] = await conn.query('SELECT DISTINCT alumno_id FROM nota WHERE evaluacion_id = ?', [evaluacionId]);
    await conn.query('DELETE FROM evaluacion WHERE id = ?', [evaluacionId]);
    for (const a of alumnos) {
      await consolidar(conn, { alumnoId: a.alumno_id, claseId: e.clase_id, periodoId: e.periodo_id }, cfg);
    }
    return { ok: true, alumnosRecalculados: alumnos.length };
  }, ctx);
}

/**
 * Planilla para digitar: la lista de alumnos de la clase con su nota en una
 * evaluación. Los que no tienen nota aparecen vacíos, listos para llenar.
 */
export async function planillaEvaluacion(evaluacionId) {
  const [ev] = await q(
    `SELECT e.id, e.titulo, e.puntaje_maximo, e.clase_id, e.periodo_id,
            asg.nombre AS asignatura, g.numero AS grado, s.letra AS seccion
       FROM evaluacion e
       JOIN clase c ON c.id = e.clase_id
       JOIN asignatura asg ON asg.id = c.asignatura_id
       JOIN seccion s ON s.id = c.seccion_id
       JOIN grado g ON g.id = s.grado_id
      WHERE e.id = ?`,
    [evaluacionId]
  );
  if (!ev) throw new AppError('La evaluacion no existe.', 404, 'NO_ENCONTRADO');

  const alumnos = await q(
    `SELECT a.id AS alumno_id, a.codigo,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido, p.segundo_apellido)) AS nombre,
            n.puntaje, n.observacion
       FROM inscripcion i
       JOIN alumno a ON a.id = i.alumno_id
       JOIN persona p ON p.id = a.persona_id
       LEFT JOIN nota n ON n.evaluacion_id = ? AND n.alumno_id = a.id
      WHERE i.clase_id = ? AND i.estado = 'activa'
      ORDER BY p.primer_apellido, p.primer_nombre`,
    [evaluacionId, ev.clase_id]
  );

  return { evaluacion: ev, alumnos };
}

/**
 * Guarda varias notas de una evaluación de golpe (la planilla completa).
 * Recalcula la consolidada de cada alumno tocado.
 */
export async function guardarNotas({ evaluacionId, notas }, ctx) {
  const [ev] = await q(
    `SELECT e.id, e.clase_id, e.periodo_id, e.puntaje_maximo, p.estado
       FROM evaluacion e JOIN periodo p ON p.id = e.periodo_id WHERE e.id = ?`,
    [evaluacionId]
  );
  if (!ev) throw new AppError('La evaluacion no existe.', 404, 'NO_ENCONTRADO');
  if (ev.estado !== 'abierto') throw new AppError('El periodo esta cerrado.', 409, 'PERIODO_CERRADO');

  // Validación previa: si UNA nota excede el máximo, se rechaza TODO el lote.
  // Guardar la mitad dejaría la planilla en un estado incoherente.
  for (const n of notas) {
    if (n.puntaje === null || n.puntaje === undefined || n.puntaje === '') continue;
    const val = Number(n.puntaje);
    if (Number.isNaN(val) || val < 0) {
      throw new AppError(`Puntaje invalido para el alumno ${n.alumnoId}.`, 400, 'PUNTAJE_INVALIDO');
    }
    if (val > Number(ev.puntaje_maximo)) {
      throw new AppError(
        `El puntaje ${val} excede el maximo de ${ev.puntaje_maximo} de esta evaluacion.`,
        400, 'PUNTAJE_EXCEDE'
      );
    }
  }

  const cfg = await configNotas();

  return transaccion(async (conn) => {
    const afectados = new Set();

    for (const n of notas) {
      const vacia = n.puntaje === null || n.puntaje === undefined || n.puntaje === '';

      if (vacia) {
        // Borrar la nota: el alumno pasa a "no calificado" en esa evaluación.
        await conn.query('DELETE FROM nota WHERE evaluacion_id = ? AND alumno_id = ?', [evaluacionId, n.alumnoId]);
      } else {
        await conn.query(
          `INSERT INTO nota (evaluacion_id, alumno_id, puntaje, observacion, registrado_por)
           VALUES (?,?,?,?,?)
           ON DUPLICATE KEY UPDATE puntaje = VALUES(puntaje), observacion = VALUES(observacion), registrado_por = VALUES(registrado_por)`,
          [evaluacionId, n.alumnoId, Number(n.puntaje), n.observacion ?? null, ctx?.usuarioId ?? null]
        );
      }
      afectados.add(n.alumnoId);
    }

    // Recalcular la nota consolidada de cada alumno tocado.
    for (const alumnoId of afectados) {
      await consolidar(conn, { alumnoId, claseId: ev.clase_id, periodoId: ev.periodo_id }, cfg);
    }

    return { guardadas: afectados.size };
  }, ctx);
}

/**
 * Cuadro de notas de una clase y periodo: cada alumno con su nota en cada
 * evaluación y su consolidada. Es lo que el maestro revisa antes de cerrar.
 */
export async function cuadroNotas(claseId, periodoId) {
  // Orden fijo de columnas: primero por tipo (Tarea, Proyecto, Examen) y dentro
  // del tipo por título, para que salga Tarea 1, Tarea 2, Tarea 3, Proyecto,
  // Examen — y no en orden aleatorio por fecha.
  const evaluaciones = await q(
    `SELECT e.id, e.titulo, e.puntaje_maximo, e.tipo_evaluacion_id, t.nombre AS tipo, t.es_extra
       FROM evaluacion e JOIN tipo_evaluacion t ON t.id = e.tipo_evaluacion_id
      WHERE e.clase_id = ? AND e.periodo_id = ? AND e.activa = 1
      ORDER BY t.es_extra, e.tipo_evaluacion_id, e.titulo, e.id`,
    [claseId, periodoId]
  );

  const alumnos = await q(
    `SELECT a.id AS alumno_id, a.codigo,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS nombre,
            np.nota_final, np.aprobado, np.bloqueada
       FROM inscripcion i
       JOIN alumno a ON a.id = i.alumno_id
       JOIN persona p ON p.id = a.persona_id
       LEFT JOIN nota_periodo np ON np.alumno_id = a.id AND np.clase_id = ? AND np.periodo_id = ?
      WHERE i.clase_id = ? AND i.estado = 'activa'
      ORDER BY p.primer_apellido, p.primer_nombre`,
    [claseId, periodoId, claseId]
  );

  // Matriz de notas puntuales.
  const idsEval = evaluaciones.map((e) => e.id);
  let matriz = [];
  if (idsEval.length) {
    matriz = await q(
      `SELECT n.evaluacion_id, n.alumno_id, n.puntaje
         FROM nota n WHERE n.evaluacion_id IN (${idsEval.map(() => '?').join(',')})`,
      idsEval
    );
  }

  const notaDe = new Map(matriz.map((m) => [`${m.alumno_id}-${m.evaluacion_id}`, m.puntaje]));
  const pond = await obtenerPonderacion(claseId, periodoId);

  // Evaluaciones que cuentan para la nota final (no las de puntos extra).
  const evalNormales = evaluaciones.filter((e) => !e.es_extra);
  const notaMinima = (await configNotas()).minima;

  return {
    ponderacion: pond,
    evaluaciones,
    alumnos: alumnos.map((a) => {
      const notas = Object.fromEntries(evaluaciones.map((e) => [e.id, notaDe.get(`${a.alumno_id}-${e.id}`) ?? null]));

      // Nota final = SUMA DIRECTA de los puntos obtenidos en cada evaluación.
      // Se calcula al vuelo para que aparezca siempre, aunque no se haya
      // consolidado. Una evaluación sin nota cuenta como 0.
      let suma = 0;
      let algunaNota = false;
      for (const e of evalNormales) {
        const v = notas[e.id];
        if (v !== null && v !== undefined) { suma += Number(v); algunaNota = true; }
      }
      const notaFinalCalculada = algunaNota ? Math.round(suma) : null;

      return {
        alumnoId: a.alumno_id,
        codigo: a.codigo,
        nombre: a.nombre,
        // Si hay nota consolidada guardada, se respeta; si no, la calculada.
        notaFinal: a.nota_final !== null && a.nota_final !== undefined ? a.nota_final : notaFinalCalculada,
        aprobado: notaFinalCalculada === null ? null : notaFinalCalculada >= notaMinima,
        bloqueada: !!a.bloqueada,
        notas,
      };
    }),
  };
}

/**
 * Cierra un periodo: recalcula y bloquea todas las notas consolidadas.
 * A partir de aquí, corregir una nota exige autorización del administrador.
 */
export async function cerrarPeriodo(periodoId, ctx) {
  const [p] = await q('SELECT id, nombre, estado, anio_lectivo_id FROM periodo WHERE id = ?', [periodoId]);
  if (!p) throw new AppError('El periodo no existe.', 404, 'NO_ENCONTRADO');
  if (p.estado === 'cerrado') throw new AppError('El periodo ya esta cerrado.', 409, 'YA_CERRADO');

  const cfg = await configNotas();

  return transaccion(async (conn) => {
    // Recalcula la consolidada de cada alumno en cada clase del año, para que
    // el cierre capture el estado final y no queden notas sin consolidar.
    const [pares] = await conn.query(
      `SELECT DISTINCT i.alumno_id, i.clase_id
         FROM inscripcion i JOIN clase c ON c.id = i.clase_id
        WHERE c.anio_lectivo_id = ? AND i.estado = 'activa'`,
      [p.anio_lectivo_id]
    );

    for (const par of pares) {
      await consolidar(conn, { alumnoId: par.alumno_id, claseId: par.clase_id, periodoId }, cfg);
    }

    await conn.query(
      'UPDATE nota_periodo SET bloqueada = 1 WHERE periodo_id = ?', [periodoId]
    );
    await conn.query(
      "UPDATE periodo SET estado = 'cerrado', cerrado_en = UTC_TIMESTAMP(), cerrado_por = ? WHERE id = ?",
      [ctx?.usuarioId ?? null, periodoId]
    );

    return { ok: true, alumnosConsolidados: pares.length };
  }, ctx);
}

/**
 * Reabre un periodo cerrado.
 *
 * Desbloquear las notas es imprescindible: si se reabre sin hacerlo, quedan
 * congeladas y ni el maestro ni un nuevo cierre pueden tocarlas. El trigger
 * que exige @permitir_periodo_cerrado protege contra ediciones accidentales,
 * pero una reapertura autorizada por el administrador debe levantar el candado.
 *
 * Es una acción sensible: solo el administrador, y queda en auditoría por el
 * propio trigger de la tabla periodo.
 */
export async function reabrirPeriodo(periodoId, ctx) {
  const [p] = await q('SELECT id, estado FROM periodo WHERE id = ?', [periodoId]);
  if (!p) throw new AppError('El periodo no existe.', 404, 'NO_ENCONTRADO');
  if (p.estado !== 'cerrado') throw new AppError('El periodo no esta cerrado.', 409, 'NO_CERRADO');

  return transaccion(async (conn) => {
    // El trigger exige esta bandera para permitir tocar una nota bloqueada.
    await conn.query('SET @permitir_periodo_cerrado = 1');
    await conn.query('UPDATE nota_periodo SET bloqueada = 0 WHERE periodo_id = ?', [periodoId]);
    await conn.query('SET @permitir_periodo_cerrado = 0');
    await conn.query(
      "UPDATE periodo SET estado = 'abierto', cerrado_en = NULL, cerrado_por = NULL WHERE id = ?",
      [periodoId]
    );
    return { ok: true };
  }, ctx);
}

/** Vista de un alumno: sus notas por clase en un periodo (o el consolidado anual). */
export async function notasDeAlumno(alumnoId, { periodoId, anioLectivoId }) {
  if (periodoId) {
    return q(
      `SELECT c.id AS clase_id, asg.nombre AS asignatura,
              TRIM(CONCAT_WS(' ', pm.primer_nombre, pm.primer_apellido)) AS maestro,
              COALESCE(np.nota_final, sub.suma) AS nota_final, np.aprobado, np.bloqueada, np.detalle_calculo
         FROM inscripcion i
         JOIN clase c ON c.id = i.clase_id
         JOIN asignatura asg ON asg.id = c.asignatura_id
         LEFT JOIN usuario u ON u.id = c.maestro_id
         LEFT JOIN persona pm ON pm.id = u.persona_id
         LEFT JOIN nota_periodo np ON np.alumno_id = i.alumno_id AND np.clase_id = c.id AND np.periodo_id = ?
         LEFT JOIN (
           SELECT e.clase_id, n.alumno_id, ROUND(SUM(n.puntaje)) AS suma
             FROM evaluacion e
             JOIN nota n ON n.evaluacion_id = e.id
             JOIN tipo_evaluacion t ON t.id = e.tipo_evaluacion_id
            WHERE e.periodo_id = ? AND e.activa = 1 AND t.es_extra = 0
            GROUP BY e.clase_id, n.alumno_id
         ) sub ON sub.clase_id = c.id AND sub.alumno_id = i.alumno_id
        WHERE i.alumno_id = ? AND i.estado = 'activa'
        ORDER BY asg.nombre`,
      [periodoId, periodoId, alumnoId]
    );
  }

  // Consolidado anual: una fila por clase con la nota de cada parcial.
  return q(
    `SELECT c.id AS clase_id, asg.nombre AS asignatura,
            per.numero AS parcial, np.nota_final, np.aprobado
       FROM inscripcion i
       JOIN clase c ON c.id = i.clase_id
       JOIN asignatura asg ON asg.id = c.asignatura_id
       LEFT JOIN nota_periodo np ON np.alumno_id = i.alumno_id AND np.clase_id = c.id
       LEFT JOIN periodo per ON per.id = np.periodo_id
      WHERE i.alumno_id = ? AND i.estado = 'activa' AND c.anio_lectivo_id = ?
      ORDER BY asg.nombre, per.numero`,
    [alumnoId, anioLectivoId]
  );
}

export { calcular };
