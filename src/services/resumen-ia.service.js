/**
 * Resumen de materiales con IA (Ollama).
 *
 * Extrae el texto de un material subido (PDF, Word o texto plano) y le pide a
 * Ollama un resumen para estudiantes. El texto se extrae bajo demanda (al pedir
 * el resumen), no al subir, para no ralentizar la carga de archivos.
 *
 * Formatos con texto extraíble: PDF (con texto real, no escaneado), DOCX y TXT.
 * Un PDF escaneado (solo imágenes) no tiene texto que extraer sin OCR.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { q } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.js';
import * as ollama from './ollama.service.js';

// Límite de texto que se manda al modelo: un material enorme se recorta para no
// saturar a Ollama ni tardar demasiado. ~12k caracteres son varias páginas.
const MAX_CARACTERES = 12000;

/**
 * Extrae el texto de un archivo según su extensión.
 * Devuelve string (posiblemente vacío si no hay texto).
 */
async function extraerTexto(rutaAbs, nombreOriginal) {
  const ext = path.extname(nombreOriginal).slice(1).toLowerCase();

  if (ext === 'txt' || ext === 'md' || ext === 'csv') {
    return (await fs.readFile(rutaAbs, 'utf8')).trim();
  }

  if (ext === 'pdf') {
    // Import diferido: pdf-parse solo se carga cuando de verdad se necesita.
    const { default: pdfParse } = await import('pdf-parse');
    const buffer = await fs.readFile(rutaAbs);
    const datos = await pdfParse(buffer);
    return (datos.text ?? '').trim();
  }

  if (ext === 'docx') {
    const { default: mammoth } = await import('mammoth');
    const { value } = await mammoth.extractRawText({ path: rutaAbs });
    return (value ?? '').trim();
  }

  // Otros formatos (pptx, xlsx, imágenes) no se resumen por ahora.
  throw new AppError(
    `No se puede resumir un archivo .${ext}. La IA resume PDF, Word (.docx) y texto (.txt).`,
    422, 'FORMATO_NO_RESUMIBLE'
  );
}

/**
 * Genera el resumen de un material con Ollama.
 * Devuelve { materialId, titulo, resumen, nombreOriginal }.
 */
export async function resumirMaterial(materialId) {
  // 1) Verificar que Ollama esté disponible antes de hacer trabajo pesado.
  const estado = await ollama.estado();
  if (!estado.disponible) {
    throw new AppError(
      'El asistente de IA no está disponible en este momento. Verifica que Ollama esté encendido.',
      503, 'IA_NO_DISPONIBLE'
    );
  }

  // 2) Traer el material y su ubicación en disco.
  const [m] = await q(
    'SELECT id, clase_id, titulo, nombre_original, nombre_servidor FROM material WHERE id = ?',
    [materialId]
  );
  if (!m) throw new AppError('Material no encontrado.', 404, 'NO_ENCONTRADO');

  // Ruta física, con la misma protección anti path-traversal que la descarga.
  const ruta = path.join(env.UPLOAD_DIR, String(m.clase_id), m.nombre_servidor);
  const raiz = path.resolve(env.UPLOAD_DIR);
  if (!path.resolve(ruta).startsWith(raiz)) {
    throw new AppError('Ruta de archivo inválida.', 400, 'RUTA_INVALIDA');
  }

  // 3) Extraer el texto del archivo.
  let texto;
  try {
    texto = await extraerTexto(ruta, m.nombre_original);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('No se pudo leer el contenido del archivo.', 422, 'LECTURA_FALLIDA');
  }

  if (!texto || texto.length < 20) {
    throw new AppError(
      'El material no tiene texto que se pueda leer (puede ser un PDF escaneado o una imagen).',
      422, 'SIN_TEXTO'
    );
  }

  const recortado = texto.length > MAX_CARACTERES;
  const contexto = recortado ? texto.slice(0, MAX_CARACTERES) : texto;

  // 4) Pedir el resumen a Ollama.
  const system = [
    'Eres un asistente educativo que ayuda a estudiantes de secundaria en Honduras.',
    'Resume el material de clase de forma clara y ordenada, en español.',
    'Estructura el resumen así:',
    '1. Un párrafo breve con la idea general.',
    '2. Los puntos clave en viñetas (usa guiones).',
    '3. Una conclusión de una o dos líneas.',
    'Usa lenguaje sencillo y didáctico. No inventes información que no esté en el material.',
  ].join('\n');

  const pregunta = `Resume el siguiente material titulado "${m.titulo}".`;
  const salida = await ollama.generar({ system, contexto, pregunta });

  if (!salida.disponible || !salida.texto) {
    throw new AppError(
      'La IA no pudo generar el resumen. Intenta de nuevo en un momento.',
      503, 'IA_SIN_RESPUESTA'
    );
  }

  return {
    materialId: m.id,
    titulo: m.titulo,
    nombreOriginal: m.nombre_original,
    resumen: salida.texto,
    recortado,
  };
}
