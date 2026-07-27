/**
 * Repositorio de material didáctico.
 *
 * Subir archivos es la vía de entrada favorita a un servidor. Este módulo se
 * escribió asumiendo que cada archivo que llega es hostil hasta que se
 * demuestre lo contrario. Las defensas, en orden:
 *
 *  1. El archivo se guarda FUERA de /public, con un nombre generado por el
 *     servidor. Nunca se sirve por URL directa: solo por un endpoint que antes
 *     verifica sesión y permiso.
 *  2. El tipo se valida por los BYTES REALES del archivo, no por su extensión.
 *     Renombrar virus.exe a tarea.pdf no engaña a la comprobación.
 *  3. El nombre original del usuario se guarda solo para mostrarlo; jamás se
 *     usa para construir una ruta en disco (evita el path traversal).
 *  4. Tamaño y tipo limitados por config.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { q, transaccion } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.js';
import { ROLES } from '../middleware/auth.js';

// Tipos permitidos: extensión ↔ MIME real esperado. Un archivo pasa solo si su
// contenido real coincide con lo declarado.
const TIPOS_PERMITIDOS = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
};

// Los formatos de Office son ZIP por dentro; file-type los reporta así.
const EXTENSIONES_ZIP = new Set(['docx', 'pptx', 'xlsx']);

async function limiteTamano() {
  const [c] = await q("SELECT valor FROM config_sistema WHERE clave = 'archivos.tamano_max_mb'");
  return (Number(c?.valor) || 25) * 1024 * 1024;
}

async function extensionesPermitidas() {
  const [c] = await q("SELECT valor FROM config_sistema WHERE clave = 'archivos.tipos_permitidos'");
  return (c?.valor ?? 'pdf,docx,pptx,xlsx,jpg,jpeg,png').split(',').map((e) => e.trim().toLowerCase());
}

/**
 * Valida el buffer subido y devuelve la extensión y el MIME confirmados.
 * @throws {AppError} si el tipo real no coincide con lo permitido
 */
export async function validarArchivo(buffer, nombreOriginal) {
  const permitidas = await extensionesPermitidas();
  const extDeclarada = path.extname(nombreOriginal).slice(1).toLowerCase();

  if (!permitidas.includes(extDeclarada)) {
    throw new AppError(
      `Tipo de archivo no permitido. Solo se aceptan: ${permitidas.join(', ')}.`,
      400, 'TIPO_NO_PERMITIDO'
    );
  }

  const detectado = await fileTypeFromBuffer(buffer);

  // Las imágenes y PDF tienen firma binaria clara: si no se detecta o no
  // coincide, se rechaza.
  if (!EXTENSIONES_ZIP.has(extDeclarada)) {
    if (!detectado) {
      throw new AppError('No se pudo verificar el tipo real del archivo.', 400, 'TIPO_NO_VERIFICABLE');
    }
    const esperados = TIPOS_PERMITIDOS[extDeclarada] ?? [];
    if (!esperados.includes(detectado.mime)) {
      throw new AppError(
        `El contenido del archivo (${detectado.mime}) no corresponde a un .${extDeclarada}. ` +
        'Puede que la extension no coincida con el archivo real.',
        400, 'CONTENIDO_NO_COINCIDE'
      );
    }
    return { extension: extDeclarada, mime: detectado.mime };
  }

  // Office: por dentro son ZIP. file-type los ve como 'application/zip'. Se
  // acepta si es zip; una validación más profunda abriría el ZIP, innecesario aquí.
  if (detectado && detectado.mime !== 'application/zip') {
    throw new AppError(
      `El contenido no corresponde a un archivo de Office valido.`,
      400, 'CONTENIDO_NO_COINCIDE'
    );
  }
  return { extension: extDeclarada, mime: TIPOS_PERMITIDOS[extDeclarada][0] };
}

/**
 * Guarda el material: escribe el archivo en disco y registra la fila.
 * El nombre en disco lo genera el servidor; el del usuario nunca toca el
 * sistema de archivos.
 */
export async function guardar({ claseId, titulo, descripcion, buffer, nombreOriginal }, ctx) {
  const maxBytes = await limiteTamano();
  if (buffer.length > maxBytes) {
    throw new AppError(`El archivo supera el limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`, 400, 'ARCHIVO_GRANDE');
  }

  const { extension, mime } = await validarArchivo(buffer, nombreOriginal);

  // Nombre en disco: aleatorio + extensión validada. Imposible de adivinar y
  // sin relación con lo que el usuario escribió.
  const nombreServidor = `${crypto.randomBytes(16).toString('hex')}.${extension}`;
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  const dirClase = path.join(env.UPLOAD_DIR, String(claseId));
  await fs.mkdir(dirClase, { recursive: true });
  const rutaCompleta = path.join(dirClase, nombreServidor);

  await fs.writeFile(rutaCompleta, buffer);

  try {
    const id = await transaccion(async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO material (clase_id, titulo, descripcion, nombre_original, nombre_servidor,
                               mime_type, tamano_bytes, sha256, subido_por)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [claseId, titulo, descripcion ?? null, nombreOriginal.slice(0, 255), nombreServidor,
          mime, buffer.length, sha256, ctx?.usuarioId ?? null]
      );
      return r.insertId;
    }, ctx);

    return { id, nombreServidor, tamano: buffer.length };
  } catch (e) {
    // Si la fila no se guardó, no dejar el archivo huérfano en disco.
    await fs.rm(rutaCompleta, { force: true }).catch(() => {});
    throw e;
  }
}

export async function listar(claseId) {
  return q(
    `SELECT m.id, m.titulo, m.descripcion, m.nombre_original, m.mime_type, m.tamano_bytes, m.creado_en,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS subido_por
       FROM material m
       LEFT JOIN usuario u ON u.id = m.subido_por
       LEFT JOIN persona p ON p.id = u.persona_id
      WHERE m.clase_id = ?
      ORDER BY m.creado_en DESC`,
    [claseId]
  );
}

/**
 * Devuelve la ruta física y los metadatos para descargar, tras confirmar que
 * el material existe. La verificación de PERMISO la hace la ruta antes de
 * llamar aquí: este servicio solo entrega si el archivo es real.
 */
export async function paraDescarga(materialId) {
  const [m] = await q(
    'SELECT id, clase_id, nombre_original, nombre_servidor, mime_type FROM material WHERE id = ?',
    [materialId]
  );
  if (!m) throw new AppError('El material no existe.', 404, 'NO_ENCONTRADO');

  const ruta = path.join(env.UPLOAD_DIR, String(m.clase_id), m.nombre_servidor);

  // Defensa final contra path traversal: la ruta resuelta debe quedar dentro
  // del directorio de subidas. Si algo la sacó de ahí, se rechaza.
  const raizSubidas = path.resolve(env.UPLOAD_DIR);
  if (!path.resolve(ruta).startsWith(raizSubidas)) {
    throw new AppError('Ruta de archivo invalida.', 400, 'RUTA_INVALIDA');
  }

  try {
    await fs.access(ruta);
  } catch {
    throw new AppError('El archivo ya no esta disponible.', 404, 'ARCHIVO_AUSENTE');
  }

  return { ruta, nombreOriginal: m.nombre_original, mime: m.mime_type };
}

export async function eliminar(materialId, ctx) {
  const [m] = await q('SELECT id, clase_id, nombre_servidor FROM material WHERE id = ?', [materialId]);
  if (!m) throw new AppError('El material no existe.', 404, 'NO_ENCONTRADO');

  await transaccion(async (conn) => {
    await conn.query('DELETE FROM material WHERE id = ?', [materialId]);
  }, ctx);

  // El archivo se borra después de confirmar la fila. Si el borrado físico
  // falla, la fila ya no existe y el archivo queda huérfano, pero inaccesible.
  const ruta = path.join(env.UPLOAD_DIR, String(m.clase_id), m.nombre_servidor);
  await fs.rm(ruta, { force: true }).catch(() => {});

  return { ok: true };
}

/** ¿Puede este usuario subir/borrar material de esta clase? */
export async function puedeGestionar(usuario, claseId) {
  if (usuario.rol === ROLES.ADMIN) return true;
  if (usuario.rol === ROLES.MAESTRO) {
    return (await q('SELECT 1 FROM clase WHERE id = ? AND maestro_id = ?', [claseId, usuario.id])).length > 0;
  }
  return false;
}
