/**
 * Catálogos académicos: grados, secciones, asignaturas, clases, aulas.
 * Lo que el administrador configura una vez al año y luego usa todo el mundo.
 */
import { q, transaccion } from '../config/db.js';
import { AppError } from '../middleware/error.js';
import { ROLES } from '../middleware/auth.js';

export async function catalogos(anioLectivoId) {
  const [grados, aulas, bloques, asignaturas, carreras, secciones, maestros] = await Promise.all([
    q(`SELECT g.id, g.numero, g.nombre, g.nivel, g.carrera_id, c.nombre AS carrera
         FROM grado g LEFT JOIN carrera c ON c.id = g.carrera_id
        WHERE g.activo = 1 ORDER BY g.numero, c.nombre`),
    q('SELECT id, codigo, nombre, capacidad, tipo FROM aula WHERE activa = 1 ORDER BY codigo'),
    q('SELECT id, orden, nombre, hora_inicio, hora_fin, es_receso FROM bloque_horario ORDER BY orden'),
    q('SELECT id, codigo, nombre FROM asignatura WHERE activa = 1 ORDER BY nombre'),
    q('SELECT id, codigo, nombre FROM carrera WHERE activa = 1 ORDER BY nombre'),
    q(`SELECT s.id, s.letra, s.cupo_maximo, s.grado_id, g.numero AS grado, g.nombre AS grado_nombre,
              g.nivel, c.nombre AS carrera, s.aula_id,
              (SELECT COUNT(*) FROM matricula m WHERE m.seccion_id = s.id AND m.estado='activa') AS matriculados
         FROM seccion s JOIN grado g ON g.id = s.grado_id
         LEFT JOIN carrera c ON c.id = g.carrera_id
        WHERE s.anio_lectivo_id = ? AND s.activa = 1
        ORDER BY g.numero, c.nombre, s.letra`, [anioLectivoId]),
    q(`SELECT u.id, TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS nombre
         FROM usuario u JOIN persona p ON p.id = u.persona_id JOIN rol r ON r.id = u.rol_id
        WHERE r.codigo = 'MAESTRO' AND u.estado = 'activo'
        ORDER BY p.primer_apellido`),
  ]);

  return { grados, aulas, bloques, asignaturas, carreras, secciones, maestros };
}

export async function crearSeccion({ gradoId, anioLectivoId, letra, cupoMaximo, aulaId }, ctx) {
  const dup = await q(
    'SELECT id FROM seccion WHERE grado_id = ? AND anio_lectivo_id = ? AND letra = ?',
    [gradoId, anioLectivoId, letra]
  );
  if (dup.length) throw new AppError('Ya existe esa seccion para ese grado y ano.', 409, 'SECCION_DUPLICADA');

  return transaccion(async (conn) => {
    const [r] = await conn.query(
      'INSERT INTO seccion (grado_id, anio_lectivo_id, letra, cupo_maximo, aula_id) VALUES (?,?,?,?,?)',
      [gradoId, anioLectivoId, letra.toUpperCase(), cupoMaximo ?? 35, aulaId ?? null]
    );
    return { id: r.insertId };
  }, ctx);
}

/**
 * Clases de una sección. Es la unidad sobre la que giran notas y asistencia,
 * así que crearlas es el paso obligatorio antes de matricular a nadie:
 * la inscripción automática solo puede inscribir en clases que ya existan.
 */
export async function clasesDeSeccion(seccionId) {
  return q(
    `SELECT c.id, c.activa, c.asignatura_id, c.maestro_id,
            asg.codigo, asg.nombre AS asignatura,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS maestro,
            (SELECT COUNT(*) FROM inscripcion i WHERE i.clase_id = c.id AND i.estado='activa') AS inscritos,
            (SELECT COUNT(*) FROM horario h WHERE h.clase_id = c.id) AS bloques_asignados
       FROM clase c
       JOIN asignatura asg ON asg.id = c.asignatura_id
       LEFT JOIN usuario u ON u.id = c.maestro_id
       LEFT JOIN persona p ON p.id = u.persona_id
      WHERE c.seccion_id = ?
      ORDER BY asg.nombre`,
    [seccionId]
  );
}

/**
 * Crea varias clases de golpe para una sección.
 * Si la sección ya tiene alumnos matriculados, los inscribe también en las
 * clases nuevas: de lo contrario quedarían fuera de una materia sin que nadie
 * lo note hasta que el maestro pase lista.
 */
export async function crearClases({ seccionId, asignaturas, anioLectivoId }, ctx) {
  if (!Array.isArray(asignaturas) || !asignaturas.length) {
    throw new AppError('Selecciona al menos una asignatura.', 400, 'SIN_ASIGNATURAS');
  }

  return transaccion(async (conn) => {
    const resultado = { creadas: 0, yaExistian: 0, alumnosInscritos: 0 };

    const [matriculados] = await conn.query(
      "SELECT id, alumno_id FROM matricula WHERE seccion_id = ? AND estado = 'activa'",
      [seccionId]
    );

    for (const a of asignaturas) {
      const asignaturaId = a.asignaturaId ?? a;
      const maestroId = a.maestroId ?? null;

      const [ya] = await conn.query(
        'SELECT id FROM clase WHERE asignatura_id = ? AND seccion_id = ? AND anio_lectivo_id = ?',
        [asignaturaId, seccionId, anioLectivoId]
      );

      let claseId;
      if (ya.length) {
        claseId = ya[0].id;
        resultado.yaExistian++;
        if (maestroId) await conn.query('UPDATE clase SET maestro_id = ? WHERE id = ?', [maestroId, claseId]);
      } else {
        const [r] = await conn.query(
          'INSERT INTO clase (asignatura_id, seccion_id, maestro_id, anio_lectivo_id) VALUES (?,?,?,?)',
          [asignaturaId, seccionId, maestroId, anioLectivoId]
        );
        claseId = r.insertId;
        resultado.creadas++;
      }

      for (const m of matriculados) {
        const [r] = await conn.query(
          `INSERT INTO inscripcion (matricula_id, alumno_id, clase_id, estado) VALUES (?,?,?, 'activa')
           ON DUPLICATE KEY UPDATE estado = 'activa'`,
          [m.id, m.alumno_id, claseId]
        );
        if (r.affectedRows === 1) resultado.alumnosInscritos++;
      }
    }

    return resultado;
  }, ctx);
}

export async function asignarMaestro({ claseId, maestroId }, ctx) {
  const [c] = await q('SELECT id FROM clase WHERE id = ?', [claseId]);
  if (!c) throw new AppError('La clase no existe.', 404, 'NO_ENCONTRADO');

  if (maestroId) {
    const [m] = await q(
      "SELECT u.id FROM usuario u JOIN rol r ON r.id = u.rol_id WHERE u.id = ? AND r.codigo = 'MAESTRO' AND u.estado = 'activo'",
      [maestroId]
    );
    if (!m) throw new AppError('Ese usuario no es un maestro activo.', 400, 'MAESTRO_INVALIDO');
  }

  return transaccion(async (conn) => {
    // El trigger de horario sincroniza maestro_id, pero solo se dispara al
    // insertar o actualizar la fila del horario. Al cambiar de maestro hay que
    // tocar el horario para que los indices unicos vuelvan a validar los
    // choques con la agenda del maestro nuevo.
    await conn.query('UPDATE clase SET maestro_id = ? WHERE id = ?', [maestroId ?? null, claseId]);

    const [horarios] = await conn.query('SELECT id FROM horario WHERE clase_id = ?', [claseId]);
    for (const h of horarios) {
      await conn.query('UPDATE horario SET clase_id = clase_id WHERE id = ?', [h.id]);
    }

    return { ok: true, bloquesRevalidados: horarios.length };
  }, ctx);
}

/** Clases visibles para el usuario, según su rol. */
export async function misClases(usuario, anioLectivoId) {
  if (usuario.rol === ROLES.MAESTRO) {
    return q(
      `SELECT c.id, asg.nombre AS asignatura, g.numero AS grado, s.letra AS seccion, s.id AS seccion_id,
              (SELECT COUNT(*) FROM inscripcion i WHERE i.clase_id = c.id AND i.estado='activa') AS inscritos
         FROM clase c
         JOIN asignatura asg ON asg.id = c.asignatura_id
         JOIN seccion s ON s.id = c.seccion_id
         JOIN grado g ON g.id = s.grado_id
        WHERE c.maestro_id = ? AND c.anio_lectivo_id = ? AND c.activa = 1
        ORDER BY g.numero, s.letra, asg.nombre`,
      [usuario.id, anioLectivoId]
    );
  }

  if (usuario.rol === ROLES.ALUMNO) {
    return q(
      `SELECT c.id, asg.nombre AS asignatura, g.numero AS grado, s.letra AS seccion, s.id AS seccion_id,
              TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS maestro
         FROM inscripcion i
         JOIN alumno a ON a.id = i.alumno_id
         JOIN clase c ON c.id = i.clase_id
         JOIN asignatura asg ON asg.id = c.asignatura_id
         JOIN seccion s ON s.id = c.seccion_id
         JOIN grado g ON g.id = s.grado_id
         LEFT JOIN usuario u ON u.id = c.maestro_id
         LEFT JOIN persona p ON p.id = u.persona_id
        WHERE a.persona_id = ? AND i.estado = 'activa' AND c.anio_lectivo_id = ?
        ORDER BY asg.nombre`,
      [usuario.personaId, anioLectivoId]
    );
  }

  return q(
    `SELECT c.id, asg.nombre AS asignatura, g.numero AS grado, s.letra AS seccion, s.id AS seccion_id,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS maestro
       FROM clase c
       JOIN asignatura asg ON asg.id = c.asignatura_id
       JOIN seccion s ON s.id = c.seccion_id
       JOIN grado g ON g.id = s.grado_id
       LEFT JOIN usuario u ON u.id = c.maestro_id
       LEFT JOIN persona p ON p.id = u.persona_id
      WHERE c.anio_lectivo_id = ? AND c.activa = 1
      ORDER BY g.numero, s.letra, asg.nombre`,
    [anioLectivoId]
  );
}
