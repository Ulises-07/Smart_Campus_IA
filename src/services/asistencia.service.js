/**
 * Asistencia y comportamiento.
 *
 * La asistencia se toma por clase y día. El estado 'tarde' cuenta como fracción
 * de ausencia según config, porque en la práctica no es lo mismo faltar que
 * llegar tarde, pero tampoco es lo mismo que estar presente.
 */
import { q, transaccion } from '../config/db.js';
import { AppError } from '../middleware/error.js';
import { avisarInasistencia, avisarIncidencia } from './notificacion.service.js';

async function configAsistencia() {
  const filas = await q(
    "SELECT clave, valor FROM config_sistema WHERE clave IN ('asistencia.umbral_alerta','asistencia.tarde_equivale')"
  );
  const m = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  return {
    umbral: Number(m['asistencia.umbral_alerta'] ?? 15),
    tardeEquivale: Number(m['asistencia.tarde_equivale'] ?? 0.5),
  };
}

/**
 * Planilla de pase de lista: los alumnos de la clase con su estado del día.
 * Si ya se pasó lista ese día, trae lo registrado para poder corregir.
 */
export async function planilla(claseId, fecha) {
  const alumnos = await q(
    `SELECT a.id AS alumno_id, a.codigo,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido, p.segundo_apellido)) AS nombre,
            asi.estado, asi.observacion
       FROM inscripcion i
       JOIN alumno a ON a.id = i.alumno_id
       JOIN persona p ON p.id = a.persona_id
       LEFT JOIN asistencia asi ON asi.clase_id = ? AND asi.alumno_id = a.id AND asi.fecha = ?
      WHERE i.clase_id = ? AND i.estado = 'activa'
      ORDER BY p.primer_apellido, p.primer_nombre`,
    [claseId, fecha, claseId]
  );
  const yaTomada = alumnos.some((a) => a.estado);
  return { fecha, yaTomada, alumnos };
}

/**
 * Guarda el pase de lista de una clase para un día.
 * Devuelve los alumnos que, tras este registro, superan el umbral de
 * inasistencia: son los que hay que notificar al encargado.
 */
export async function guardarAsistencia({ claseId, fecha, registros }, ctx) {
  if (!Array.isArray(registros) || !registros.length) {
    throw new AppError('No se recibio ningun registro de asistencia.', 400, 'SIN_REGISTROS');
  }

  const validos = new Set(['presente', 'ausente', 'tarde', 'justificado']);
  for (const r of registros) {
    if (!validos.has(r.estado)) {
      throw new AppError(`Estado de asistencia invalido: ${r.estado}.`, 400, 'ESTADO_INVALIDO');
    }
  }

  await transaccion(async (conn) => {
    for (const r of registros) {
      await conn.query(
        `INSERT INTO asistencia (clase_id, alumno_id, fecha, estado, observacion, registrado_por)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE estado = VALUES(estado), observacion = VALUES(observacion), registrado_por = VALUES(registrado_por)`,
        [claseId, r.alumnoId, fecha, r.estado, r.observacion ?? null, ctx?.usuarioId ?? null]
      );
    }
  }, ctx);

  // Tras guardar, ¿quién cruzó el umbral? Se calcula aparte para poder avisar.
  const enRiesgo = await alumnosEnRiesgo(claseId);

  // Notificar a la familia de quienes superan el umbral. Va FUERA de la
  // transacción de asistencia: si un aviso falla, la asistencia ya quedó
  // guardada y no debe deshacerse por eso.
  const [clase] = await q(
    `SELECT asg.nombre AS asignatura FROM clase c JOIN asignatura asg ON asg.id = c.asignatura_id WHERE c.id = ?`,
    [claseId]
  );
  for (const a of enRiesgo.filter((x) => x.enRiesgo)) {
    await avisarInasistencia({
      alumnoId: a.alumnoId, asignatura: clase?.asignatura ?? 'una asignatura', porcentaje: a.porcentajeInasistencia,
    }).catch(() => { /* el aviso es best-effort */ });
  }

  return { guardados: registros.length, enRiesgo };
}

/** Porcentaje de inasistencia por alumno en una clase, y quién supera el umbral. */
export async function alumnosEnRiesgo(claseId) {
  const cfg = await configAsistencia();

  const filas = await q(
    `SELECT a.id AS alumno_id, a.codigo,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS nombre,
            COUNT(asi.id) AS total,
            SUM(asi.estado = 'ausente') AS ausencias,
            SUM(asi.estado = 'tarde') AS tardanzas,
            SUM(asi.estado = 'justificado') AS justificadas
       FROM inscripcion i
       JOIN alumno a ON a.id = i.alumno_id
       JOIN persona p ON p.id = a.persona_id
       LEFT JOIN asistencia asi ON asi.alumno_id = a.id AND asi.clase_id = i.clase_id
      WHERE i.clase_id = ? AND i.estado = 'activa'
      GROUP BY a.id`,
    [claseId]
  );

  return filas
    .map((f) => {
      const total = Number(f.total) || 0;
      // Las justificadas no cuentan como inasistencia; las tardanzas, en parte.
      const faltas = Number(f.ausencias) + Number(f.tardanzas) * cfg.tardeEquivale;
      const pct = total > 0 ? (faltas / total) * 100 : 0;
      return {
        alumnoId: f.alumno_id, codigo: f.codigo, nombre: f.nombre,
        total, ausencias: Number(f.ausencias), tardanzas: Number(f.tardanzas),
        justificadas: Number(f.justificadas),
        porcentajeInasistencia: Math.round(pct * 10) / 10,
        enRiesgo: pct >= cfg.umbral,
      };
    })
    .filter((a) => a.total > 0)
    .sort((x, y) => y.porcentajeInasistencia - x.porcentajeInasistencia);
}

/** Resumen de asistencia de un alumno en todas sus clases. */
export async function resumenAlumno(alumnoId) {
  const cfg = await configAsistencia();
  const filas = await q(
    `SELECT c.id AS clase_id, asg.nombre AS asignatura,
            COUNT(asi.id) AS total,
            SUM(asi.estado = 'presente') AS presentes,
            SUM(asi.estado = 'ausente') AS ausencias,
            SUM(asi.estado = 'tarde') AS tardanzas,
            SUM(asi.estado = 'justificado') AS justificadas
       FROM inscripcion i
       JOIN clase c ON c.id = i.clase_id
       JOIN asignatura asg ON asg.id = c.asignatura_id
       LEFT JOIN asistencia asi ON asi.alumno_id = i.alumno_id AND asi.clase_id = c.id
      WHERE i.alumno_id = ? AND i.estado = 'activa'
      GROUP BY c.id
      ORDER BY asg.nombre`,
    [alumnoId]
  );

  return filas.map((f) => {
    const total = Number(f.total) || 0;
    const faltas = Number(f.ausencias) + Number(f.tardanzas) * cfg.tardeEquivale;
    const pct = total > 0 ? (faltas / total) * 100 : 0;
    return {
      claseId: f.clase_id, asignatura: f.asignatura, total,
      presentes: Number(f.presentes), ausencias: Number(f.ausencias),
      tardanzas: Number(f.tardanzas), justificadas: Number(f.justificadas),
      porcentajeInasistencia: Math.round(pct * 10) / 10,
      enRiesgo: pct >= cfg.umbral,
    };
  });
}

// ============================================================================
// COMPORTAMIENTO / INCIDENCIAS
// ============================================================================

export async function registrarIncidencia({ alumnoId, claseId, gravedad, descripcion, medidaDisciplinaria, fechaHora }, ctx) {
  const anio = await q("SELECT id FROM anio_lectivo WHERE estado = 'activo' LIMIT 1");
  if (!anio.length) throw new AppError('No hay ano lectivo activo.', 409, 'SIN_ANIO');

  const resultado = await transaccion(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO incidencia (alumno_id, clase_id, anio_lectivo_id, gravedad, descripcion, fecha_hora, medida_disciplinaria, estado, registrado_por)
       VALUES (?,?,?,?,?,?,?, 'abierta', ?)`,
      [alumnoId, claseId ?? null, anio[0].id, gravedad, descripcion,
        fechaHora ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
        medidaDisciplinaria ?? null, ctx?.usuarioId ?? null]
    );
    return { id: r.insertId };
  }, ctx);

  // Aviso a la familia, fuera de la transaccion.
  await avisarIncidencia({ alumnoId, gravedad }).catch(() => {});
  return resultado;
}

export async function listarIncidencias({ alumnoId, estado, gravedad, pagina = 1, porPagina = 30 }) {
  const where = [];
  const params = [];
  if (alumnoId) { where.push('inc.alumno_id = ?'); params.push(alumnoId); }
  if (estado) { where.push('inc.estado = ?'); params.push(estado); }
  if (gravedad) { where.push('inc.gravedad = ?'); params.push(gravedad); }

  const filtro = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const limite = Math.min(Number(porPagina) || 30, 100);
  const salto = (Math.max(Number(pagina) || 1, 1) - 1) * limite;

  return q(
    `SELECT inc.id, inc.gravedad, inc.descripcion, inc.fecha_hora, inc.estado,
            inc.medida_disciplinaria, inc.encargado_notificado,
            a.codigo, TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS alumno,
            asg.nombre AS clase
       FROM incidencia inc
       JOIN alumno a ON a.id = inc.alumno_id
       JOIN persona p ON p.id = a.persona_id
       LEFT JOIN clase c ON c.id = inc.clase_id
       LEFT JOIN asignatura asg ON asg.id = c.asignatura_id
       ${filtro}
      ORDER BY inc.fecha_hora DESC
      LIMIT ? OFFSET ?`,
    [...params, String(limite), String(salto)]
  );
}

export async function actualizarIncidencia(id, { estado, medidaDisciplinaria, encargadoNotificado }, ctx) {
  const [inc] = await q('SELECT id FROM incidencia WHERE id = ?', [id]);
  if (!inc) throw new AppError('La incidencia no existe.', 404, 'NO_ENCONTRADO');

  const campos = [];
  const params = [];
  if (estado) { campos.push('estado = ?'); params.push(estado); if (estado === 'resuelta') { campos.push('resuelto_por = ?', 'resuelto_en = UTC_TIMESTAMP()'); params.push(ctx?.usuarioId ?? null); } }
  if (medidaDisciplinaria !== undefined) { campos.push('medida_disciplinaria = ?'); params.push(medidaDisciplinaria); }
  if (encargadoNotificado !== undefined) { campos.push('encargado_notificado = ?', 'notificado_en = UTC_TIMESTAMP()'); params.push(encargadoNotificado ? 1 : 0); }

  if (!campos.length) return { ok: true };

  await transaccion(async (conn) => {
    await conn.query(`UPDATE incidencia SET ${campos.join(', ')} WHERE id = ?`, [...params, id]);
  }, ctx);
  return { ok: true };
}

// ============================================================================
// COMPORTAMIENTO AMPLIADO — méritos, catálogo y resumen
//
// El sistema de comportamiento tiene dos caras: méritos (buena conducta, suman
// puntos) y deméritos (faltas, restan puntos; viven en `incidencia`). El
// catálogo `tipo_comportamiento` da opciones predefinidas con su puntaje.
//
// Regla de visibilidad (se refuerza en las rutas): el admin ve todo; el maestro
// solo lo de las clases que imparte.
// ============================================================================

/** Catálogo de tipos de comportamiento (para los menús del formulario). */
export async function catalogoComportamiento() {
  const tipos = await q(
    "SELECT id, clase, nombre, puntos, gravedad FROM tipo_comportamiento WHERE activo = 1 ORDER BY clase, puntos DESC"
  );
  return {
    meritos: tipos.filter((t) => t.clase === 'merito'),
    demeritos: tipos.filter((t) => t.clase === 'demerito'),
  };
}

/** Registra un MÉRITO (buena conducta). */
export async function registrarMerito({ alumnoId, claseId, tipoId, puntos, descripcion, fechaHora }, ctx) {
  const anio = await q("SELECT id FROM anio_lectivo WHERE estado = 'activo' LIMIT 1");
  if (!anio.length) throw new AppError('No hay ano lectivo activo.', 409, 'SIN_ANIO');

  // Si viene un tipo del catálogo, se toman sus puntos como base.
  let pts = Number(puntos) || 1;
  if (tipoId) {
    const [t] = await q("SELECT puntos FROM tipo_comportamiento WHERE id = ? AND clase = 'merito'", [tipoId]);
    if (t) pts = t.puntos;
  }

  return transaccion(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO merito (alumno_id, clase_id, anio_lectivo_id, tipo_id, puntos, descripcion, fecha_hora, registrado_por)
       VALUES (?,?,?,?,?,?,?,?)`,
      [alumnoId, claseId ?? null, anio[0].id, tipoId ?? null, pts, descripcion,
        fechaHora ?? new Date().toISOString().slice(0, 19).replace('T', ' '), ctx?.usuarioId ?? null]
    );
    return { id: r.insertId, puntos: pts };
  }, ctx);
}

/**
 * Historial de comportamiento (méritos + deméritos unidos) de un alumno,
 * ordenado por fecha. Cada fila trae su signo de puntos.
 */
export async function comportamientoDeAlumno(alumnoId) {
  const filas = await q(
    `SELECT 'merito' AS clase, m.id, m.descripcion, m.fecha_hora, m.puntos, NULL AS gravedad,
            NULL AS estado, asg.nombre AS clase_nombre,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS registrado_por
       FROM merito m
       LEFT JOIN clase c ON c.id = m.clase_id
       LEFT JOIN asignatura asg ON asg.id = c.asignatura_id
       LEFT JOIN usuario u ON u.id = m.registrado_por
       LEFT JOIN persona p ON p.id = u.persona_id
      WHERE m.alumno_id = ?
     UNION ALL
      SELECT 'demerito' AS clase, inc.id, inc.descripcion, inc.fecha_hora,
             COALESCE(NULLIF(inc.puntos,0), CASE inc.gravedad WHEN 'leve' THEN -3 WHEN 'grave' THEN -8 ELSE -20 END) AS puntos,
             inc.gravedad, inc.estado, asg.nombre AS clase_nombre,
             TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS registrado_por
       FROM incidencia inc
       LEFT JOIN clase c ON c.id = inc.clase_id
       LEFT JOIN asignatura asg ON asg.id = c.asignatura_id
       LEFT JOIN usuario u ON u.id = inc.registrado_por
       LEFT JOIN persona p ON p.id = u.persona_id
      WHERE inc.alumno_id = ?
      ORDER BY fecha_hora DESC`,
    [alumnoId, alumnoId]
  );

  // Puntaje base 100; suman méritos, restan deméritos. Nunca baja de 0.
  const suma = filas.reduce((acc, f) => acc + Number(f.puntos), 0);
  const puntaje = Math.max(0, Math.min(100, 100 + suma));
  const meritos = filas.filter((f) => f.clase === 'merito').length;
  const demeritos = filas.filter((f) => f.clase === 'demerito').length;

  return { registros: filas, puntaje, meritos, demeritos, total: filas.length };
}
