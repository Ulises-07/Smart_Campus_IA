/**
 * Notificaciones internas (bandeja dentro del sistema).
 *
 * No hay correo. Es un requisito del proyecto, no una carencia: el sistema no
 * envía correos a nadie. Los avisos viven en una bandeja que el usuario ve al
 * entrar.
 *
 * Las notificaciones se dirigen a un USUARIO (el que tiene cuenta). Para avisar
 * a un encargado hay que resolver primero si tiene cuenta; si no la tiene, el
 * aviso queda para el personal que sí la tiene (asesor/admin), porque el
 * sistema no puede llegar a alguien que no está dentro.
 */
import { q, transaccion } from '../config/db.js';
import { AppError } from '../middleware/error.js';

/** Crea una notificación para un usuario. */
export async function crear({ usuarioId, tipo, titulo, mensaje, enlace }, conn = null) {
  const ejecutar = async (c) => {
    const [r] = await c.query(
      'INSERT INTO notificacion (usuario_id, tipo, titulo, mensaje, enlace) VALUES (?,?,?,?,?)',
      [usuarioId, tipo, titulo, mensaje, enlace ?? null]
    );
    return r.insertId;
  };
  if (conn) return ejecutar(conn);
  return transaccion(async (c) => ejecutar(c));
}

/** Crea la misma notificación para varios usuarios de una vez. */
export async function crearMuchas(usuarioIds, plantilla, conn = null) {
  const unicos = [...new Set(usuarioIds)].filter(Boolean);
  if (!unicos.length) return { creadas: 0 };

  const ejecutar = async (c) => {
    const valores = unicos.map(() => '(?,?,?,?,?)').join(',');
    const params = unicos.flatMap((uid) => [uid, plantilla.tipo, plantilla.titulo, plantilla.mensaje, plantilla.enlace ?? null]);
    await c.query(`INSERT INTO notificacion (usuario_id, tipo, titulo, mensaje, enlace) VALUES ${valores}`, params);
    return { creadas: unicos.length };
  };
  if (conn) return ejecutar(conn);
  return transaccion(async (c) => ejecutar(c));
}

/** Bandeja de un usuario. */
export async function bandeja(usuarioId, { soloNoLeidas = false, pagina = 1, porPagina = 20 } = {}) {
  const where = ['usuario_id = ?'];
  const params = [usuarioId];
  if (soloNoLeidas) where.push('leida = 0');

  const limite = Math.min(Number(porPagina) || 20, 50);
  const salto = (Math.max(Number(pagina) || 1, 1) - 1) * limite;

  const notificaciones = await q(
    `SELECT id, tipo, titulo, mensaje, enlace, leida, creado_en
       FROM notificacion WHERE ${where.join(' AND ')}
      ORDER BY creado_en DESC LIMIT ? OFFSET ?`,
    [...params, String(limite), String(salto)]
  );

  const [{ no_leidas }] = await q(
    'SELECT COUNT(*) AS no_leidas FROM notificacion WHERE usuario_id = ? AND leida = 0',
    [usuarioId]
  );

  return { notificaciones, noLeidas: Number(no_leidas) };
}

/** Cuántas no leídas: para el contador del ícono, muy liviano. */
export async function contarNoLeidas(usuarioId) {
  const [{ n }] = await q('SELECT COUNT(*) AS n FROM notificacion WHERE usuario_id = ? AND leida = 0', [usuarioId]);
  return Number(n);
}

export async function marcarLeida(usuarioId, notificacionId) {
  // El WHERE incluye usuario_id: nadie marca como leída una notificación ajena.
  const r = await q(
    'UPDATE notificacion SET leida = 1, leida_en = UTC_TIMESTAMP() WHERE id = ? AND usuario_id = ? AND leida = 0',
    [notificacionId, usuarioId]
  );
  if (!r.affectedRows) throw new AppError('No se encontro la notificacion.', 404, 'NO_ENCONTRADO');
  return { ok: true };
}

export async function marcarTodasLeidas(usuarioId) {
  const r = await q(
    'UPDATE notificacion SET leida = 1, leida_en = UTC_TIMESTAMP() WHERE usuario_id = ? AND leida = 0',
    [usuarioId]
  );
  return { marcadas: r.affectedRows };
}

// ============================================================================
// DISPARADORES: eventos del sistema que generan notificaciones.
// Se llaman desde los servicios de notas, asistencia y finanzas.
// ============================================================================

/**
 * Resuelve a qué usuarios avisar sobre un alumno: el propio alumno (si tiene
 * cuenta) y sus encargados con cuenta. Si nadie tiene cuenta, devuelve vacío y
 * el aviso simplemente no se envía a la familia (queda en el sistema para el
 * personal, que sí ve las pantallas).
 */
async function usuariosDelAlumno(alumnoId) {
  const filas = await q(
    `SELECT DISTINCT u.id
       FROM alumno a
       LEFT JOIN usuario u ON u.persona_id = a.persona_id
      WHERE a.id = ? AND u.id IS NOT NULL
      UNION
      SELECT DISTINCT u2.id
       FROM alumno_encargado ae
       JOIN encargado e ON e.id = ae.encargado_id
       JOIN usuario u2 ON u2.persona_id = e.persona_id
      WHERE ae.alumno_id = ?`,
    [alumnoId, alumnoId]
  );
  return filas.map((f) => f.id);
}

/** Aviso de inasistencia que cruzó el umbral. Se llama tras el pase de lista. */
export async function avisarInasistencia({ alumnoId, asignatura, porcentaje }, conn = null) {
  const usuarios = await usuariosDelAlumno(alumnoId);
  if (!usuarios.length) return { creadas: 0 };
  return crearMuchas(usuarios, {
    tipo: 'asistencia',
    titulo: 'Inasistencia por encima del limite',
    mensaje: `El alumno supera el ${porcentaje}% de inasistencia en ${asignatura}. Conviene comunicarse con el colegio.`,
    enlace: null,
  }, conn);
}

/** Aviso de nota reprobada al consolidar un periodo. */
export async function avisarNotaReprobada({ alumnoId, asignatura, nota, periodo }, conn = null) {
  const usuarios = await usuariosDelAlumno(alumnoId);
  if (!usuarios.length) return { creadas: 0 };
  return crearMuchas(usuarios, {
    tipo: 'nota',
    titulo: `Nota reprobada en ${asignatura}`,
    mensaje: `La nota del ${periodo} en ${asignatura} fue ${nota}, por debajo del minimo de aprobacion.`,
    enlace: null,
  }, conn);
}

/** Aviso de una incidencia de comportamiento. */
export async function avisarIncidencia({ alumnoId, gravedad }, conn = null) {
  const usuarios = await usuariosDelAlumno(alumnoId);
  if (!usuarios.length) return { creadas: 0 };
  const texto = { leve: 'leve', grave: 'grave', muy_grave: 'muy grave' }[gravedad] ?? gravedad;
  return crearMuchas(usuarios, {
    tipo: 'incidencia',
    titulo: 'Incidencia de comportamiento registrada',
    mensaje: `Se registro una incidencia de gravedad ${texto}. Comunicate con el colegio para mas detalles.`,
    enlace: null,
  }, conn);
}

/** Aviso de recordatorio de pago pendiente (uso manual desde finanzas). */
export async function avisarPagoPendiente({ alumnoId, monto, concepto }, conn = null) {
  const usuarios = await usuariosDelAlumno(alumnoId);
  if (!usuarios.length) return { creadas: 0 };
  return crearMuchas(usuarios, {
    tipo: 'pago',
    titulo: 'Recordatorio de pago',
    mensaje: `Hay un saldo pendiente de L ${Number(monto).toFixed(2)} en concepto de ${concepto}.`,
    enlace: null,
  }, conn);
}
