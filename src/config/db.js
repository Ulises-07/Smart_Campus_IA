/**
 * Pool de conexiones a MariaDB/MySQL.
 *
 * Regla del proyecto: TODA consulta usa parametros (?), nunca concatenacion.
 * Por eso se exporta un helper `q` que obliga a pasar los valores aparte.
 */
import mysql from 'mysql2/promise';
import { env } from './env.js';

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: env.DB_CONNECTION_LIMIT,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  // Guardamos DATETIME en UTC; la conversion a hora de Honduras se hace en la UI.
  timezone: 'Z',
  dateStrings: false,
  // Evita que un ID numerico enorme pierda precision.
  supportBigNumbers: true,
  bigNumberStrings: false,
  // Bloquea multiples sentencias en una sola llamada: mitiga inyeccion encadenada.
  multipleStatements: false,
});

/**
 * Ejecuta una consulta preparada y devuelve solo las filas.
 * @param {string} sql sentencia con marcadores ?
 * @param {Array} params valores
 */
export async function q(sql, params = []) {
  const [filas] = await pool.execute(sql, params);
  return filas;
}

/**
 * Ejecuta una funcion dentro de una transaccion.
 * Si lanza, hace rollback automatico.
 *
 * El segundo parametro declara QUIEN esta actuando. Los triggers de auditoria
 * leen esas variables de sesion; sin ellas el rastro queda con usuario NULL.
 *
 * Es imprescindible que se fijen sobre LA MISMA conexion que hace la escritura:
 * el pool reparte conexiones distintas entre consultas, asi que un SET suelto
 * antes de la operacion acabaria en otra conexion y no serviria de nada.
 *
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<any>} fn
 * @param {{usuarioId?: number, rol?: string, ip?: string}} [ctx]
 */
export async function transaccion(fn, ctx = null) {
  const conn = await pool.getConnection();
  try {
    if (ctx) {
      await conn.query('SET @app_usuario_id = ?, @app_rol = ?, @app_ip = ?', [
        ctx.usuarioId ?? null,
        ctx.rol ?? null,
        ctx.ip ?? null,
      ]);
    }
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    // Limpiar el contexto: la conexion vuelve al pool y la reutiliza otro
    // usuario. Sin esto, una escritura sin contexto heredaria el anterior y la
    // auditoria culparia a la persona equivocada.
    if (ctx) {
      try {
        await conn.query('SET @app_usuario_id = NULL, @app_rol = NULL, @app_ip = NULL');
      } catch { /* la conexion ya murio; el pool la descarta */ }
    }
    conn.release();
  }
}

/** Construye el contexto de auditoria a partir de la peticion HTTP. */
export function contextoDe(req) {
  return {
    usuarioId: req.usuario?.id ?? null,
    rol: req.usuario?.rol ?? null,
    ip: req.ip ?? null,
  };
}

/** Comprueba que la base de datos responde. Se usa en /api/salud y en el arranque. */
export async function probarConexion() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    const [[info]] = await conn.query('SELECT VERSION() AS version, DATABASE() AS bd');
    return { ok: true, ...info };
  } finally {
    conn.release();
  }
}

export async function cerrarPool() {
  await pool.end();
}
