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
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<any>} fn
 */
export async function transaccion(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
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
