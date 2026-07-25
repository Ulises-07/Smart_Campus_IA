/**
 * Horarios.
 *
 * La base de datos ya rechaza los solapamientos con tres índices únicos. Este
 * servicio existe para algo distinto: decirle a la persona QUÉ choca, antes de
 * que intente guardar.
 *
 * Un "Duplicate entry '1-3-2-4' for key 'uk_horario_aula'" es correcto y es
 * inútil para quien arma el horario. "El aula LAB-1 ya está ocupada el martes
 * a las 8:30 por Matemáticas de 9º B con el profesor Meza" es accionable.
 */
import { q, transaccion } from '../config/db.js';
import { AppError } from '../middleware/error.js';

export const DIAS = { 1: 'Lunes', 2: 'Martes', 3: 'Miercoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sabado' };

/**
 * Busca los tres tipos de choque posibles y los describe en lenguaje humano.
 * @returns {Promise<Array<{tipo:string, mensaje:string}>>} vacío si no hay conflicto
 */
export async function detectarConflictos({ claseId, diaSemana, bloqueId, aulaId, horarioIdExcluir = null }) {
  const [clase] = await q(
    `SELECT c.id, c.seccion_id, c.maestro_id, c.anio_lectivo_id,
            asg.nombre AS asignatura,
            g.numero AS grado, s.letra
       FROM clase c
       JOIN asignatura asg ON asg.id = c.asignatura_id
       JOIN seccion s ON s.id = c.seccion_id
       JOIN grado g ON g.id = s.grado_id
      WHERE c.id = ?`,
    [claseId]
  );
  if (!clase) throw new AppError('La clase no existe.', 404, 'CLASE_NO_ENCONTRADA');

  const [bloque] = await q('SELECT id, nombre, hora_inicio, hora_fin, es_receso FROM bloque_horario WHERE id = ?', [bloqueId]);
  if (!bloque) throw new AppError('El bloque horario no existe.', 404, 'BLOQUE_NO_ENCONTRADO');
  if (bloque.es_receso) {
    return [{ tipo: 'receso', mensaje: `El bloque "${bloque.nombre}" es un receso: no se pueden programar clases.` }];
  }

  const ocupacion = await q(
    `SELECT h.id, h.aula_id, h.seccion_id, h.maestro_id,
            asg.nombre AS asignatura,
            g.numero AS grado, s.letra,
            au.codigo AS aula,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS maestro
       FROM horario h
       JOIN clase c ON c.id = h.clase_id
       JOIN asignatura asg ON asg.id = c.asignatura_id
       JOIN seccion s ON s.id = h.seccion_id
       JOIN grado g ON g.id = s.grado_id
       JOIN aula au ON au.id = h.aula_id
       LEFT JOIN usuario u ON u.id = h.maestro_id
       LEFT JOIN persona p ON p.id = u.persona_id
      WHERE h.anio_lectivo_id = ? AND h.dia_semana = ? AND h.bloque_horario_id = ?
        AND (? IS NULL OR h.id <> ?)`,
    [clase.anio_lectivo_id, diaSemana, bloqueId, horarioIdExcluir, horarioIdExcluir]
  );

  const cuando = `${DIAS[diaSemana]} a las ${String(bloque.hora_inicio).slice(0, 5)}`;
  const conflictos = [];

  const porSeccion = ocupacion.find((o) => o.seccion_id === clase.seccion_id);
  if (porSeccion) {
    conflictos.push({
      tipo: 'seccion',
      mensaje: `La seccion ${porSeccion.grado}º "${porSeccion.letra}" ya tiene ${porSeccion.asignatura} el ${cuando}.`,
    });
  }

  const porAula = ocupacion.find((o) => o.aula_id === Number(aulaId));
  if (porAula) {
    conflictos.push({
      tipo: 'aula',
      mensaje: `El aula ${porAula.aula} esta ocupada el ${cuando} por ${porAula.asignatura} de ${porAula.grado}º "${porAula.letra}".`,
    });
  }

  if (clase.maestro_id) {
    const porMaestro = ocupacion.find((o) => o.maestro_id === clase.maestro_id);
    if (porMaestro) {
      conflictos.push({
        tipo: 'maestro',
        mensaje: `${porMaestro.maestro} ya imparte ${porMaestro.asignatura} a ${porMaestro.grado}º "${porMaestro.letra}" el ${cuando}.`,
      });
    }
  }

  return conflictos;
}

/**
 * Bloques libres para una clase, día por día.
 * Sirve para que la interfaz muestre en verde dónde SÍ se puede colocar, en
 * lugar de dejar que la persona pruebe a ciegas.
 */
export async function disponibilidad({ claseId, aulaId }) {
  const [clase] = await q('SELECT id, seccion_id, maestro_id, anio_lectivo_id FROM clase WHERE id = ?', [claseId]);
  if (!clase) throw new AppError('La clase no existe.', 404, 'CLASE_NO_ENCONTRADA');

  const bloques = await q('SELECT id, orden, nombre, hora_inicio, hora_fin, es_receso FROM bloque_horario ORDER BY orden');

  const ocupados = await q(
    `SELECT dia_semana, bloque_horario_id, seccion_id, maestro_id, aula_id
       FROM horario WHERE anio_lectivo_id = ?`,
    [clase.anio_lectivo_id]
  );

  const rejilla = [];
  for (const dia of Object.keys(DIAS).map(Number).filter((d) => d <= 5)) {
    for (const b of bloques) {
      if (b.es_receso) continue;

      const enEsteHueco = ocupados.filter((o) => o.dia_semana === dia && o.bloque_horario_id === b.id);
      const motivos = [];
      if (enEsteHueco.some((o) => o.seccion_id === clase.seccion_id)) motivos.push('seccion');
      if (clase.maestro_id && enEsteHueco.some((o) => o.maestro_id === clase.maestro_id)) motivos.push('maestro');
      if (aulaId && enEsteHueco.some((o) => o.aula_id === Number(aulaId))) motivos.push('aula');

      rejilla.push({
        dia, diaNombre: DIAS[dia],
        bloqueId: b.id, bloque: b.nombre,
        hora: `${String(b.hora_inicio).slice(0, 5)} - ${String(b.hora_fin).slice(0, 5)}`,
        libre: motivos.length === 0,
        ocupadoPor: motivos,
      });
    }
  }
  return rejilla;
}

/** Aulas libres en un día y bloque concretos. */
export async function aulasLibres({ anioLectivoId, diaSemana, bloqueId, tipo }) {
  return q(
    `SELECT a.id, a.codigo, a.nombre, a.capacidad, a.tipo
       FROM aula a
      WHERE a.activa = 1
        ${tipo ? 'AND a.tipo = ?' : ''}
        AND a.id NOT IN (
          SELECT h.aula_id FROM horario h
           WHERE h.anio_lectivo_id = ? AND h.dia_semana = ? AND h.bloque_horario_id = ?
        )
      ORDER BY a.codigo`,
    tipo ? [tipo, anioLectivoId, diaSemana, bloqueId] : [anioLectivoId, diaSemana, bloqueId]
  );
}

export async function crear({ claseId, diaSemana, bloqueId, aulaId }, ctx) {
  const conflictos = await detectarConflictos({ claseId, diaSemana, bloqueId, aulaId });
  if (conflictos.length) {
    throw new AppError('No se puede programar en ese horario.', 409, 'CHOQUE_HORARIO',
      conflictos.map((c) => c.mensaje));
  }

  return transaccion(async (conn) => {
    // Los campos maestro_id, seccion_id y anio_lectivo_id los rellena el
    // trigger a partir de la clase: no se envían desde aquí a propósito.
    const [r] = await conn.query(
      'INSERT INTO horario (clase_id, bloque_horario_id, dia_semana, aula_id, seccion_id, anio_lectivo_id) VALUES (?,?,?,?,0,0)',
      [claseId, bloqueId, diaSemana, aulaId]
    );
    return { id: r.insertId };
  }, ctx);
}

export async function eliminar(horarioId, ctx) {
  const [h] = await q('SELECT id FROM horario WHERE id = ?', [horarioId]);
  if (!h) throw new AppError('No se encontro ese bloque del horario.', 404, 'NO_ENCONTRADO');

  return transaccion(async (conn) => {
    await conn.query('DELETE FROM horario WHERE id = ?', [horarioId]);
    return { ok: true };
  }, ctx);
}

/** Rejilla completa. `filtro` puede ser por sección, por maestro o por aula. */
export async function rejilla({ anioLectivoId, seccionId, maestroId, aulaId }) {
  const where = ['h.anio_lectivo_id = ?'];
  const params = [anioLectivoId];
  if (seccionId) { where.push('h.seccion_id = ?'); params.push(seccionId); }
  if (maestroId) { where.push('h.maestro_id = ?'); params.push(maestroId); }
  if (aulaId) { where.push('h.aula_id = ?'); params.push(aulaId); }

  const filas = await q(
    `SELECT h.id, h.dia_semana, h.bloque_horario_id, h.clase_id,
            b.nombre AS bloque, b.orden, b.hora_inicio, b.hora_fin,
            asg.codigo AS asignatura_codigo, asg.nombre AS asignatura,
            g.numero AS grado, s.letra AS seccion, s.id AS seccion_id,
            au.codigo AS aula,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS maestro
       FROM horario h
       JOIN bloque_horario b ON b.id = h.bloque_horario_id
       JOIN clase c ON c.id = h.clase_id
       JOIN asignatura asg ON asg.id = c.asignatura_id
       JOIN seccion s ON s.id = h.seccion_id
       JOIN grado g ON g.id = s.grado_id
       JOIN aula au ON au.id = h.aula_id
       LEFT JOIN usuario u ON u.id = h.maestro_id
       LEFT JOIN persona p ON p.id = u.persona_id
      WHERE ${where.join(' AND ')}
      ORDER BY h.dia_semana, b.orden`,
    params
  );

  const bloques = await q('SELECT id, orden, nombre, hora_inicio, hora_fin, es_receso FROM bloque_horario ORDER BY orden');

  return {
    bloques: bloques.map((b) => ({
      id: b.id, orden: b.orden, nombre: b.nombre, esReceso: !!b.es_receso,
      hora: `${String(b.hora_inicio).slice(0, 5)} - ${String(b.hora_fin).slice(0, 5)}`,
    })),
    dias: Object.entries(DIAS).filter(([d]) => Number(d) <= 5).map(([id, nombre]) => ({ id: Number(id), nombre })),
    celdas: filas,
  };
}
