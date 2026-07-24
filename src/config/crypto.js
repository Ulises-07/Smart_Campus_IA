/**
 * Cifrado en reposo de datos sensibles de menores de edad (requisito A.9).
 *
 * DOS PIEZAS, DOS PROPÓSITOS DISTINTOS:
 *
 * 1. cifrar()  — AES-256-GCM. Reversible. Guarda el número de identidad de
 *    forma que, si alguien roba el archivo .sql del respaldo, no obtiene
 *    identidades de menores. GCM además autentica: si alguien altera un byte
 *    del texto cifrado, el descifrado falla en vez de devolver basura.
 *
 * 2. hashBusqueda() — HMAC-SHA256. Irreversible. Permite buscar por identidad
 *    sin descifrar toda la tabla, y sirve de clave única.
 *
 * POR QUÉ HMAC Y NO SHA-256 A SECAS:
 * una identidad hondureña tiene 13 dígitos. Un atacante con la base robada
 * podría generar todos los hashes posibles en minutos y revertir la tabla
 * completa. Con HMAC necesita además la clave secreta, que vive en el .env
 * y no en la base de datos.
 */
import crypto from 'node:crypto';
import { env } from './env.js';

const ALGORITMO = 'aes-256-gcm';
const LARGO_IV = 12; // 96 bits, el recomendado para GCM

function clave(nombre) {
  const hex = env[nombre];
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error(`${nombre} debe ser exactamente 64 caracteres hexadecimales (32 bytes).`);
  }
  return buf;
}

/**
 * Cifra un texto. Devuelve una cadena base64 con formato iv|tag|cifrado.
 * @param {string|null} texto
 * @returns {string|null}
 */
export function cifrar(texto) {
  if (texto === null || texto === undefined || texto === '') return null;

  const iv = crypto.randomBytes(LARGO_IV);
  const cipher = crypto.createCipheriv(ALGORITMO, clave('ENCRYPTION_KEY'), iv);
  const cifrado = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, cifrado]).toString('base64');
}

/**
 * Descifra lo que produjo cifrar(). Devuelve null si el dato viene corrupto
 * o alterado, en vez de lanzar: un registro dañado no debe tumbar un listado
 * de 500 alumnos.
 * @param {string|null} paquete
 * @returns {string|null}
 */
export function descifrar(paquete) {
  if (!paquete) return null;

  try {
    const buf = Buffer.from(paquete, 'base64');
    const iv = buf.subarray(0, LARGO_IV);
    const tag = buf.subarray(LARGO_IV, LARGO_IV + 16);
    const cifrado = buf.subarray(LARGO_IV + 16);

    const decipher = crypto.createDecipheriv(ALGORITMO, clave('ENCRYPTION_KEY'), iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Huella determinista para buscar y para el índice único.
 * El mismo texto siempre produce el mismo hash; textos distintos, hashes
 * distintos. No se puede revertir sin la clave.
 * @param {string|null} texto
 * @returns {string|null} 64 caracteres hexadecimales
 */
export function hashBusqueda(texto) {
  if (texto === null || texto === undefined || texto === '') return null;
  return crypto
    .createHmac('sha256', clave('HASH_PEPPER'))
    .update(String(texto).trim())
    .digest('hex');
}

/** Hash de un refresh token, para no guardarlo en claro. */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Token aleatorio para sesiones de refresco. */
export function tokenAleatorio(bytes = 48) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Comparación en tiempo constante.
 * Comparar cadenas con === filtra información por el tiempo que tarda: un
 * atacante puede deducir cuántos caracteres acertó.
 */
export function comparacionSegura(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
