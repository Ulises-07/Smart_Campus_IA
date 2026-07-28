/**
 * Tableros (dashboards).
 *
 * Cada rol ve un tablero distinto, y no por estética: un maestro no debe ver
 * las cifras financieras del colegio, y un asesor no necesita el detalle
 * interno de cada clase. Las consultas se arman por rol, igual que en el resto
 * del sistema.
 *
 * Todo son cifras AGREGADAS. Ningún tablero expone datos de un alumno concreto;
 * para eso están las pantallas con su control de permiso por fila.
 */
import { q } from '../config/db.js';
import { ROLES } from '../middleware/auth.js';

async function anioActivo() {
  const filas = await q("SELECT id, anio, nombre FROM anio_lectivo WHERE estado = 'activo' LIMIT 1");
  return filas[0] ?? null;
}

/** Tablero de administración: alumnos, secciones, finanzas y rendimiento global. */
async function tableroAdmin(anioId) {
  const [[matricula]] = await q(
    `SELECT COUNT(*) AS activos,
            SUM(CASE WHEN a.sexo = 'F' THEN 1 ELSE 0 END) AS mujeres,
            SUM(CASE WHEN a.sexo = 'M' THEN 1 ELSE 0 END) AS hombres
       FROM matricula m JOIN alumno al ON al.id = m.alumno_id JOIN persona a ON a.id = al.persona_id
      WHERE m.anio_lectivo_id = ? AND m.estado = 'activa'`,
    [anioId]
  ).then((r) => [r]);

  const porGrado = await q(
    `SELECT g.numero AS grado, g.nombre AS grado_nombre, COUNT(m.id) AS alumnos
       FROM matricula m JOIN seccion s ON s.id = m.seccion_id JOIN grado g ON g.id = s.grado_id
      WHERE m.anio_lectivo_id = ? AND m.estado = 'activa'
      GROUP BY g.id ORDER BY g.numero`,
    [anioId]
  );

  const [[finanzas]] = await q(
    `SELECT
        COALESCE(SUM(c.monto + c.monto_mora - c.descuento), 0) AS total_cargado,
        COALESCE(SUM((SELECT COALESCE(SUM(p.monto), 0) FROM pago p WHERE p.cargo_id = c.id AND p.anulado = 0)), 0) AS total_pagado,
        COUNT(DISTINCT CASE WHEN c.estado IN ('pendiente','mora') THEN c.alumno_id END) AS morosos
       FROM cargo c WHERE c.anio_lectivo_id = ?`,
    [anioId]
  ).then((r) => [r]);
  const totalSaldo = Number(finanzas.total_cargado) - Number(finanzas.total_pagado);

  const [[rendimiento]] = await q(
    `SELECT COUNT(*) AS con_nota,
            SUM(np.aprobado = 1) AS aprobados,
            SUM(np.aprobado = 0) AS reprobados,
            ROUND(AVG(np.nota_final), 2) AS promedio_general
       FROM nota_periodo np
       JOIN clase c ON c.id = np.clase_id
      WHERE c.anio_lectivo_id = ?`,
    [anioId]
  ).then((r) => [r]);

  const [[asistencia]] = await q(
    `SELECT COUNT(*) AS registros,
            SUM(estado = 'ausente') AS ausencias,
            SUM(estado = 'presente') AS presencias
       FROM asistencia asi
       JOIN clase c ON c.id = asi.clase_id
      WHERE c.anio_lectivo_id = ?`,
    [anioId]
  ).then((r) => [r]);

  const pctAsistencia = asistencia.registros > 0
    ? Math.round((asistencia.presencias / asistencia.registros) * 1000) / 10 : null;

  return {
    matricula: { activos: matricula.activos ?? 0, mujeres: matricula.mujeres ?? 0, hombres: matricula.hombres ?? 0 },
    porGrado,
    finanzas: {
      totalCargado: Number(finanzas.total_cargado),
      totalPagado: Number(finanzas.total_pagado),
      totalSaldo: totalSaldo,
      morosos: finanzas.morosos ?? 0,
      pctRecaudado: Number(finanzas.total_cargado) > 0
        ? Math.round((Number(finanzas.total_pagado) / Number(finanzas.total_cargado)) * 1000) / 10 : 0,
    },
    rendimiento: {
      conNota: rendimiento.con_nota ?? 0,
      aprobados: rendimiento.aprobados ?? 0,
      reprobados: rendimiento.reprobados ?? 0,
      promedioGeneral: rendimiento.promedio_general,
      pctAprobacion: rendimiento.con_nota > 0
        ? Math.round((rendimiento.aprobados / rendimiento.con_nota) * 1000) / 10 : null,
    },
    asistencia: { pctAsistencia, ausencias: asistencia.ausencias ?? 0 },
  };
}

/** Tablero del maestro: solo sus clases, sin nada financiero. */
async function tableroMaestro(usuario, anioId) {
  const clases = await q(
    `SELECT c.id, asg.nombre AS asignatura, g.numero AS grado, s.letra AS seccion,
            (SELECT COUNT(*) FROM inscripcion i WHERE i.clase_id = c.id AND i.estado = 'activa') AS inscritos,
            (SELECT ROUND(AVG(np.nota_final), 2) FROM nota_periodo np WHERE np.clase_id = c.id) AS promedio,
            (SELECT SUM(np.aprobado = 0) FROM nota_periodo np WHERE np.clase_id = c.id) AS reprobados
       FROM clase c
       JOIN asignatura asg ON asg.id = c.asignatura_id
       JOIN seccion s ON s.id = c.seccion_id
       JOIN grado g ON g.id = s.grado_id
      WHERE c.maestro_id = ? AND c.anio_lectivo_id = ? AND c.activa = 1
      ORDER BY g.numero, s.letra`,
    [usuario.id, anioId]
  );

  const totalAlumnos = clases.reduce((s, c) => s + Number(c.inscritos), 0);

  return {
    clases,
    resumen: {
      totalClases: clases.length,
      totalAlumnos,
      clasesConNotas: clases.filter((c) => c.promedio !== null).length,
    },
  };
}

/** Tablero del alumno: su propio rendimiento, sin cifras del colegio. */
async function tableroAlumno(usuario, anioId) {
  const [alumno] = await q(
    `SELECT a.id, TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS nombre,
            g.numero AS grado, s.letra AS seccion
       FROM alumno a JOIN persona p ON p.id = a.persona_id
       LEFT JOIN matricula m ON m.alumno_id = a.id AND m.estado = 'activa'
       LEFT JOIN seccion s ON s.id = m.seccion_id
       LEFT JOIN grado g ON g.id = s.grado_id
      WHERE p.id = ?`,
    [usuario.personaId]
  );
  if (!alumno) return { alumno: null };

  const notas = await q(
    `SELECT asg.nombre AS asignatura, np.nota_final, np.aprobado
       FROM inscripcion i
       JOIN clase c ON c.id = i.clase_id
       JOIN asignatura asg ON asg.id = c.asignatura_id
       LEFT JOIN nota_periodo np ON np.alumno_id = i.alumno_id AND np.clase_id = c.id
      WHERE i.alumno_id = ? AND i.estado = 'activa' AND c.anio_lectivo_id = ?
      ORDER BY asg.nombre`,
    [alumno.id, anioId]
  );

  const conNota = notas.filter((n) => n.nota_final !== null);
  const promedio = conNota.length
    ? Math.round((conNota.reduce((s, n) => s + Number(n.nota_final), 0) / conNota.length) * 100) / 100 : null;

  const [[saldo]] = await q(
    `SELECT COALESCE(SUM(c.monto + c.monto_mora - c.descuento
              - (SELECT COALESCE(SUM(p.monto), 0) FROM pago p WHERE p.cargo_id = c.id AND p.anulado = 0)), 0) AS total
       FROM cargo c WHERE c.alumno_id = ? AND c.anio_lectivo_id = ?`,
    [alumno.id, anioId]
  ).then((r) => [r]);

  return {
    alumno,
    promedio,
    materias: notas.length,
    aprobadas: conNota.filter((n) => n.aprobado).length,
    reprobadas: conNota.filter((n) => n.aprobado === 0).length,
    saldoPendiente: Number(saldo.total),
  };
}

export async function tablero(usuario) {
  const anio = await anioActivo();
  if (!anio) return { anio: null, datos: null };

  let datos;
  if (usuario.rol === ROLES.ADMIN || usuario.rol === ROLES.ASESOR) datos = await tableroAdmin(anio.id);
  else if (usuario.rol === ROLES.MAESTRO) datos = await tableroMaestro(usuario, anio.id);
  else datos = await tableroAlumno(usuario, anio.id);

  return { anio, rol: usuario.rol, datos };
}
