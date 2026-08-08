/**
 * Matrícula, inscripción automática, traslados y promoción de grado.
 *
 * La regla que ordena todo este archivo: NADA se borra. Un alumno que se
 * traslada de sección conserva las notas que ya obtuvo en su sección anterior;
 * un alumno que se retira conserva su historial. Borrar filas destruiría el
 * expediente académico, que es justamente lo que un colegio debe conservar.
 */
import { q, transaccion } from '../config/db.js';
import { AppError } from '../middleware/error.js';

/** Año lectivo activo. Casi todo el sistema depende de que exista uno. */
export async function anioActivo() {
  const filas = await q("SELECT id, anio, nombre, fecha_inicio, fecha_fin FROM anio_lectivo WHERE estado = 'activo' LIMIT 1");
  if (!filas.length) {
    throw new AppError('No hay un ano lectivo activo. Configuralo antes de matricular.', 409, 'SIN_ANIO_ACTIVO');
  }
  return filas[0];
}

async function seccionConCupo(conn, seccionId) {
  const [filas] = await conn.query(
    `SELECT s.id, s.cupo_maximo, s.anio_lectivo_id, s.activa,
            g.nombre AS grado, s.letra,
            (SELECT COUNT(*) FROM matricula m WHERE m.seccion_id = s.id AND m.estado = 'activa') AS ocupados
       FROM seccion s JOIN grado g ON g.id = s.grado_id
      WHERE s.id = ?`,
    [seccionId]
  );
  if (!filas.length) throw new AppError('La seccion no existe.', 404, 'SECCION_NO_ENCONTRADA');
  const s = filas[0];
  if (!s.activa) throw new AppError('La seccion esta inactiva.', 409, 'SECCION_INACTIVA');
  if (s.ocupados >= s.cupo_maximo) {
    throw new AppError(
      `La seccion ${s.grado} "${s.letra}" ya alcanzo su cupo de ${s.cupo_maximo} alumnos.`,
      409, 'CUPO_LLENO'
    );
  }
  return s;
}

/**
 * Inscribe al alumno en todas las clases activas de su sección.
 * Es el criterio de aceptación: matricular a un alumno debe dejarlo listo en
 * todas sus materias sin que nadie lo haga a mano, materia por materia.
 */
async function inscribirEnClases(conn, { matriculaId, alumnoId, seccionId }) {
  const [clases] = await conn.query(
    "SELECT id FROM clase WHERE seccion_id = ? AND activa = 1", [seccionId]
  );

  let nuevas = 0;
  for (const c of clases) {
    // Si ya existe una inscripción retirada en esa clase (caso de un traslado
    // de ida y vuelta), se reactiva en lugar de duplicar.
    const [r] = await conn.query(
      `INSERT INTO inscripcion (matricula_id, alumno_id, clase_id, estado)
       VALUES (?,?,?, 'activa')
       ON DUPLICATE KEY UPDATE estado = 'activa', matricula_id = VALUES(matricula_id)`,
      [matriculaId, alumnoId, c.id]
    );
    if (r.affectedRows) nuevas++;
  }
  return { clases: clases.length, inscripciones: nuevas };
}

/** Matricula a un alumno y lo deja listo en todas sus clases. */
export async function matricular({ alumnoId, seccionId, fechaMatricula, observaciones }, ctx) {
  const anio = await anioActivo();

  const [alumno] = await q('SELECT id, estado, codigo FROM alumno WHERE id = ?', [alumnoId]);
  if (!alumno) throw new AppError('No se encontro el alumno.', 404, 'NO_ENCONTRADO');
  if (alumno.estado !== 'activo') {
    throw new AppError(`El alumno esta en estado "${alumno.estado}" y no puede matricularse.`, 409, 'ALUMNO_NO_ACTIVO');
  }

  const yaMatriculado = await q(
    "SELECT id FROM matricula WHERE alumno_id = ? AND anio_lectivo_id = ? AND estado = 'activa'",
    [alumnoId, anio.id]
  );
  if (yaMatriculado.length) {
    throw new AppError(`El alumno ya esta matriculado en ${anio.anio}. Usa el traslado si cambia de seccion.`, 409, 'YA_MATRICULADO');
  }

  return transaccion(async (conn) => {
    const seccion = await seccionConCupo(conn, seccionId);
    if (seccion.anio_lectivo_id !== anio.id) {
      throw new AppError('Esa seccion pertenece a otro ano lectivo.', 409, 'SECCION_OTRO_ANIO');
    }

    const [rm] = await conn.query(
      `INSERT INTO matricula (alumno_id, anio_lectivo_id, seccion_id, fecha_matricula, estado, registrado_por, observaciones)
       VALUES (?,?,?,?, 'activa', ?, ?)`,
      [alumnoId, anio.id, seccionId, fechaMatricula ?? new Date().toISOString().slice(0, 10),
        ctx?.usuarioId ?? null, observaciones ?? null]
    );

    const resumen = await inscribirEnClases(conn, {
      matriculaId: rm.insertId, alumnoId, seccionId,
    });

    return { matriculaId: rm.insertId, ...resumen };
  }, ctx);
}

/**
 * Traslado a otra sección.
 *
 * Lo delicado aquí: las notas que el alumno ya obtuvo pertenecen a las clases
 * de la sección ANTERIOR. Esas inscripciones se marcan 'retirada', no se
 * borran, para que el expediente quede completo. En la sección nueva se
 * crean inscripciones nuevas, que empiezan sin notas.
 *
 * Es lo correcto y hay que explicárselo al usuario: al trasladarse a mitad de
 * parcial, el alumno no arrastra sus calificaciones. Quien decida el traslado
 * debe saberlo de antemano.
 */
export async function trasladar({ matriculaId, seccionDestinoId, motivo }, ctx) {
  const [m] = await q(
    `SELECT m.id, m.alumno_id, m.seccion_id, m.anio_lectivo_id, m.estado
       FROM matricula m WHERE m.id = ?`, [matriculaId]
  );
  if (!m) throw new AppError('No se encontro la matricula.', 404, 'NO_ENCONTRADO');
  if (m.estado !== 'activa') throw new AppError('La matricula no esta activa.', 409, 'MATRICULA_INACTIVA');
  if (m.seccion_id === Number(seccionDestinoId)) {
    throw new AppError('El alumno ya esta en esa seccion.', 400, 'MISMA_SECCION');
  }

  return transaccion(async (conn) => {
    const destino = await seccionConCupo(conn, seccionDestinoId);
    if (destino.anio_lectivo_id !== m.anio_lectivo_id) {
      throw new AppError('No se puede trasladar entre anos lectivos distintos.', 409, 'ANIO_DISTINTO');
    }

    // Cuántas notas quedan atrás: se informa, no se oculta.
    const [[notas]] = await conn.query(
      `SELECT COUNT(*) AS total FROM nota n
         JOIN evaluacion e ON e.id = n.evaluacion_id
         JOIN clase c ON c.id = e.clase_id
        WHERE n.alumno_id = ? AND c.seccion_id = ?`,
      [m.alumno_id, m.seccion_id]
    );

    await conn.query(
      `UPDATE inscripcion i JOIN clase c ON c.id = i.clase_id
          SET i.estado = 'retirada'
        WHERE i.alumno_id = ? AND c.seccion_id = ? AND i.estado = 'activa'`,
      [m.alumno_id, m.seccion_id]
    );

    await conn.query(
      'UPDATE matricula SET seccion_id = ?, observaciones = CONCAT_WS(" | ", observaciones, ?) WHERE id = ?',
      [seccionDestinoId, `Traslado: ${motivo ?? 'sin motivo registrado'}`, matriculaId]
    );

    const resumen = await inscribirEnClases(conn, {
      matriculaId, alumnoId: m.alumno_id, seccionId: seccionDestinoId,
    });

    return {
      ...resumen,
      notasEnSeccionAnterior: notas.total,
      aviso: notas.total > 0
        ? `El alumno tenia ${notas.total} nota(s) en su seccion anterior. Quedan en su expediente historico, pero NO se trasladan a las clases nuevas.`
        : null,
    };
  }, ctx);
}

/** Retira al alumno del año lectivo, conservando todo su historial. */
export async function retirar({ matriculaId, motivo, estado = 'retirada' }, ctx) {
  const [m] = await q('SELECT id, alumno_id, estado FROM matricula WHERE id = ?', [matriculaId]);
  if (!m) throw new AppError('No se encontro la matricula.', 404, 'NO_ENCONTRADO');
  if (m.estado !== 'activa') throw new AppError('La matricula ya no esta activa.', 409, 'MATRICULA_INACTIVA');

  return transaccion(async (conn) => {
    await conn.query(
      'UPDATE matricula SET estado = ?, observaciones = CONCAT_WS(" | ", observaciones, ?) WHERE id = ?',
      [estado, `Retiro: ${motivo ?? 'sin motivo registrado'}`, matriculaId]
    );
    await conn.query(
      "UPDATE inscripcion SET estado = 'retirada' WHERE matricula_id = ? AND estado = 'activa'",
      [matriculaId]
    );
    await conn.query(
      "UPDATE alumno SET estado = ? WHERE id = ?",
      [estado === 'egresada' ? 'egresado' : estado === 'trasladada' ? 'trasladado' : 'retirado', m.alumno_id]
    );
    return { ok: true };
  }, ctx);
}

/**
 * Vista previa de la promoción de grado.
 *
 * NO promueve nada: propone. Calcula el promedio anual de cada alumno por
 * clase y marca quién aprobó todas, quién reprobó alguna y de quién no hay
 * datos suficientes.
 *
 * La decisión final la toma una persona. Un sistema que promueve solo, con
 * notas incompletas, produce expedientes falsos que después nadie sabe
 * corregir.
 */
export async function vistaPreviaPromocion({ anioOrigenId, anioDestinoId }) {
  const [{ valor: minima }] = await q(
    "SELECT valor FROM config_sistema WHERE clave = 'notas.minima_aprobacion'"
  ).then((r) => (r.length ? r : [{ valor: '70' }]));

  const filas = await q(
    `SELECT a.id AS alumno_id, a.codigo,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS nombre,
            g.numero AS grado_actual, g.id AS grado_id, g.nivel, g.carrera_id,
            s.letra, s.id AS seccion_actual_id,
            COUNT(DISTINCT i.clase_id) AS clases,
            COUNT(DISTINCT np.clase_id) AS clases_con_nota,
            SUM(CASE WHEN np.aprobado = 0 THEN 1 ELSE 0 END) AS reprobadas,
            ROUND(AVG(np.nota_final), 2) AS promedio
       FROM matricula m
       JOIN alumno a ON a.id = m.alumno_id
       JOIN persona p ON p.id = a.persona_id
       JOIN seccion s ON s.id = m.seccion_id
       JOIN grado g ON g.id = s.grado_id
       LEFT JOIN inscripcion i ON i.matricula_id = m.id AND i.estado = 'activa'
       LEFT JOIN nota_periodo np ON np.alumno_id = a.id AND np.clase_id = i.clase_id
      WHERE m.anio_lectivo_id = ? AND m.estado = 'activa'
      GROUP BY a.id
      ORDER BY g.numero, s.letra, p.primer_apellido`,
    [anioOrigenId]
  );

  // Secciones disponibles en el año destino, para proponer destino automático.
  const destinos = await q(
    `SELECT s.id, s.letra, g.numero, g.carrera_id, g.nivel,
            s.cupo_maximo,
            (SELECT COUNT(*) FROM matricula m2 WHERE m2.seccion_id = s.id AND m2.estado='activa') AS ocupados
       FROM seccion s JOIN grado g ON g.id = s.grado_id
      WHERE s.anio_lectivo_id = ? AND s.activa = 1
      ORDER BY g.numero, s.letra`,
    [anioDestinoId]
  );

  return {
    notaMinima: Number(minima),
    alumnos: filas.map((f) => {
      const sinDatos = f.clases_con_nota === 0 || f.clases_con_nota < f.clases;
      const aprobado = !sinDatos && Number(f.reprobadas) === 0;

      const gradoSiguiente = f.grado_actual + 1;
      const propuesta = aprobado && gradoSiguiente <= 12
        ? destinos.find((d) =>
          d.numero === gradoSiguiente &&
          (d.carrera_id ?? null) === (f.carrera_id ?? null) &&
          d.ocupados < d.cupo_maximo)
        : destinos.find((d) =>
          d.numero === f.grado_actual &&
          (d.carrera_id ?? null) === (f.carrera_id ?? null) &&
          d.ocupados < d.cupo_maximo);

      return {
        alumnoId: f.alumno_id,
        codigo: f.codigo,
        nombre: f.nombre,
        gradoActual: f.grado_actual,
        seccionActual: f.letra,
        clases: f.clases,
        clasesConNota: f.clases_con_nota,
        clasesReprobadas: Number(f.reprobadas ?? 0),
        promedio: f.promedio,
        situacion: sinDatos ? 'sin_datos' : aprobado ? 'promueve' : 'repite',
        seccionDestinoSugerida: propuesta?.id ?? null,
        gradoDestinoSugerido: propuesta?.numero ?? null,
        egresa: aprobado && f.grado_actual === 12,
      };
    }),
    seccionesDestino: destinos,
  };
}

/**
 * Ejecuta la promoción sobre una lista revisada por una persona.
 * Cada entrada es { alumnoId, seccionDestinoId } o { alumnoId, egresa: true }.
 */
export async function ejecutarPromocion({ anioOrigenId, anioDestinoId, decisiones }, ctx) {
  if (!Array.isArray(decisiones) || !decisiones.length) {
    throw new AppError('No se recibio ninguna decision de promocion.', 400, 'SIN_DECISIONES');
  }

  return transaccion(async (conn) => {
    const resultado = { promovidos: 0, egresados: 0, errores: [] };

    for (const d of decisiones) {
      try {
        const [[m]] = await conn.query(
          "SELECT id FROM matricula WHERE alumno_id = ? AND anio_lectivo_id = ? AND estado = 'activa'",
          [d.alumnoId, anioOrigenId]
        );
        if (!m) { resultado.errores.push({ alumnoId: d.alumnoId, motivo: 'sin matricula activa en el ano origen' }); continue; }

        if (d.egresa) {
          await conn.query("UPDATE matricula SET estado = 'egresada' WHERE id = ?", [m.id]);
          await conn.query("UPDATE alumno SET estado = 'egresado' WHERE id = ?", [d.alumnoId]);
          resultado.egresados++;
          continue;
        }

        if (!d.seccionDestinoId) {
          resultado.errores.push({ alumnoId: d.alumnoId, motivo: 'sin seccion destino' });
          continue;
        }

        // Cierra el año anterior y abre el nuevo.
        await conn.query("UPDATE matricula SET estado = 'egresada' WHERE id = ?", [m.id]);
        await conn.query("UPDATE inscripcion SET estado = 'retirada' WHERE matricula_id = ?", [m.id]);

        const [rm] = await conn.query(
          `INSERT INTO matricula (alumno_id, anio_lectivo_id, seccion_id, fecha_matricula, estado, registrado_por, observaciones)
           VALUES (?,?,?,CURDATE(),'activa',?, 'Promocion automatica')`,
          [d.alumnoId, anioDestinoId, d.seccionDestinoId, ctx?.usuarioId ?? null]
        );

        await inscribirEnClases(conn, {
          matriculaId: rm.insertId, alumnoId: d.alumnoId, seccionId: d.seccionDestinoId,
        });

        resultado.promovidos++;
      } catch (e) {
        resultado.errores.push({ alumnoId: d.alumnoId, motivo: e.sqlMessage ?? e.message });
      }
    }

    return resultado;
  }, ctx);
}

/** Alumnos activos de una sección, para pase de lista y listados de clase. */
export async function alumnosDeSeccion(seccionId) {
  return q(
    `SELECT a.id, a.codigo,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido, p.segundo_apellido)) AS nombre
       FROM matricula m
       JOIN alumno a ON a.id = m.alumno_id
       JOIN persona p ON p.id = a.persona_id
      WHERE m.seccion_id = ? AND m.estado = 'activa'
      ORDER BY p.primer_apellido, p.primer_nombre`,
    [seccionId]
  );
}
