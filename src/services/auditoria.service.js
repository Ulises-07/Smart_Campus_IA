/**
 * Consulta de la bitácora de auditoría.
 *
 * SOLO LECTURA. Este servicio no tiene función de escritura ni de borrado, y no
 * por olvido: la auditoría es inmutable. Los triggers de la Fase 1 bloquean
 * cualquier UPDATE o DELETE sobre la tabla incluso desde root. Aquí solo se
 * consulta y se filtra, para que un administrador pueda revisar quién hizo qué
 * sin salir del sistema.
 *
 * Ver la auditoría es en sí un evento sensible, pero no se audita a su vez para
 * no crecer sin fin; el acceso a esta pantalla ya exige rol de administrador.
 */
import { q } from '../config/db.js';

const ACCIONES = ['INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FALLIDO', 'EXPORT', 'OTRO'];

/**
 * Lista eventos de auditoría con filtros. Paginado, porque la tabla crece sin
 * límite por diseño y traerla entera tumbaría la pantalla.
 */
export async function consultar({ usuarioId, accion, entidad, desde, hasta, ip, pagina = 1, porPagina = 50 }) {
  const where = [];
  const params = [];

  if (usuarioId) { where.push('a.usuario_id = ?'); params.push(usuarioId); }
  if (accion && ACCIONES.includes(accion)) { where.push('a.accion = ?'); params.push(accion); }
  if (entidad) { where.push('a.entidad = ?'); params.push(entidad); }
  if (ip) { where.push('a.ip = ?'); params.push(ip); }
  if (desde) { where.push('a.fecha_hora >= ?'); params.push(desde); }
  if (hasta) { where.push('a.fecha_hora <= ?'); params.push(`${hasta} 23:59:59`); }

  const filtro = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const limite = Math.min(Number(porPagina) || 50, 200);
  const salto = (Math.max(Number(pagina) || 1, 1) - 1) * limite;

  const eventos = await q(
    `SELECT a.id, a.usuario_id, a.rol, a.accion, a.entidad, a.entidad_id,
            a.origen, a.ip, a.fecha_hora,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS usuario_nombre,
            u.usuario AS usuario_login
       FROM auditoria a
       LEFT JOIN usuario u ON u.id = a.usuario_id
       LEFT JOIN persona p ON p.id = u.persona_id
       ${filtro}
      ORDER BY a.fecha_hora DESC
      LIMIT ? OFFSET ?`,
    [...params, String(limite), String(salto)]
  );

  const [{ total }] = await q(`SELECT COUNT(*) AS total FROM auditoria a${filtro}`, params);

  return { total, pagina: Number(pagina) || 1, porPagina: limite, eventos };
}

/**
 * Detalle de un evento, con los valores anterior y nuevo si los tiene.
 * Útil para ver exactamente qué cambió en una nota o un pago.
 */
export async function detalle(id) {
  const [ev] = await q(
    `SELECT a.*, TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS usuario_nombre
       FROM auditoria a
       LEFT JOIN usuario u ON u.id = a.usuario_id
       LEFT JOIN persona p ON p.id = u.persona_id
      WHERE a.id = ?`,
    [id]
  );
  if (!ev) return null;

  // Los valores se guardan como JSON; se intenta parsear para mostrarlos
  // ordenados, pero si viniera texto plano se devuelve tal cual.
  const parsear = (v) => {
    if (!v) return null;
    try { return JSON.parse(v); } catch { return v; }
  };

  return {
    ...ev,
    valor_anterior: parsear(ev.valor_anterior),
    valor_nuevo: parsear(ev.valor_nuevo),
  };
}

/** Entidades distintas presentes en la auditoría, para poblar el filtro. */
export async function entidadesDisponibles() {
  const filas = await q('SELECT DISTINCT entidad FROM auditoria ORDER BY entidad');
  return filas.map((f) => f.entidad);
}

/** Resumen de actividad reciente, para el encabezado del visor. */
export async function resumen() {
  const [[hoy]] = await q(
    "SELECT COUNT(*) AS total FROM auditoria WHERE fecha_hora >= CURDATE()"
  ).then((r) => [r]);
  const [[fallidos]] = await q(
    "SELECT COUNT(*) AS total FROM auditoria WHERE accion = 'LOGIN_FALLIDO' AND fecha_hora >= DATE_SUB(NOW(), INTERVAL 24 HOUR)"
  ).then((r) => [r]);
  return { eventosHoy: hoy.total, loginsFallidos24h: fallidos.total };
}
