import { Router } from 'express';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';

import { asyncHandler, AppError } from '../middleware/error.js';
import { requiereAuth, exigeCambioPassword, ROLES, verificarAcceso404, puedeVerClase } from '../middleware/auth.js';
import { contextoDe, q } from '../config/db.js';
import * as material from '../services/material.service.js';
import * as resumenIA from '../services/resumen-ia.service.js';
import PDFDocument from 'pdfkit';

export const materialRouter = Router();
materialRouter.use(requiereAuth, exigeCambioPassword);

// El archivo se recibe en memoria: se valida por bytes ANTES de tocar el disco.
// El límite de multer es un primer filtro; el real vive en el servicio, según config.
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
});

const verClase = verificarAcceso404(puedeVerClase, 'claseId');

/** Solo el maestro de la clase (o admin) sube y borra material. */
const gestionaClase = verificarAcceso404(async (usuario, claseId) => material.puedeGestionar(usuario, claseId), 'claseId');

// Listar material de una clase: cualquiera que pueda VER la clase.
materialRouter.get('/clases/:claseId/material', verClase, asyncHandler(async (req, res) => {
  res.json({ ok: true, material: await material.listar(Number(req.params.claseId)) });
}));

// Subir: solo quien gestiona la clase.
materialRouter.post('/clases/:claseId/material', gestionaClase, subida.single('archivo'), asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('No se recibio ningun archivo.', 400, 'SIN_ARCHIVO');

  const datos = z.object({
    titulo: z.string().trim().min(1).max(150),
    descripcion: z.string().trim().max(255).optional().nullable(),
  }).safeParse(req.body);
  if (!datos.success) throw new AppError('Datos invalidos.', 400, 'DATOS_INVALIDOS', datos.error.issues.map((i) => i.message));

  const r = await material.guardar({
    claseId: Number(req.params.claseId),
    titulo: datos.data.titulo,
    descripcion: datos.data.descripcion,
    buffer: req.file.buffer,
    nombreOriginal: req.file.originalname,
  }, contextoDe(req));

  res.status(201).json({ ok: true, ...r });
}));

// Descargar: el archivo NUNCA se sirve como estático. Aquí se verifica que el
// usuario pueda ver la clase del material, y solo entonces se entrega el binario.
materialRouter.get('/material/:id/descargar', asyncHandler(async (req, res) => {
  const materialId = Number(req.params.id);
  const [m] = await q('SELECT clase_id FROM material WHERE id = ?', [materialId]);
  if (!m) throw new AppError('El material no existe.', 404, 'NO_ENCONTRADO');

  if (!(await puedeVerClase(req.usuario, m.clase_id))) {
    // 404, no 403: no se revela que el material existe.
    throw new AppError('No se encontro el material.', 404, 'NO_ENCONTRADO');
  }

  const { ruta, nombreOriginal, mime } = await material.paraDescarga(materialId);

  // Content-Disposition con nombre saneado. Content-Type del MIME validado al
  // subir, no de lo que diga el navegador.
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${nombreOriginal.replace(/[^\w.\-]/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // sendFile exige ruta absoluta; paraDescarga ya la resolvio y verifico que
  // quede dentro del directorio de subidas.
  res.sendFile(path.resolve(ruta));
}));

// ---- Resumen con IA (Ollama) ----
// Cualquiera que pueda VER la clase puede pedir el resumen de un material.
// Helper: valida permiso de ver la clase del material y devuelve la fila.
async function exigeVerMaterial(req) {
  const materialId = Number(req.params.id);
  const [m] = await q('SELECT clase_id FROM material WHERE id = ?', [materialId]);
  if (!m) throw new AppError('El material no existe.', 404, 'NO_ENCONTRADO');
  if (!(await puedeVerClase(req.usuario, m.clase_id))) {
    throw new AppError('No se encontro el material.', 404, 'NO_ENCONTRADO');
  }
  return materialId;
}

// Genera el resumen y lo devuelve como JSON (para mostrarlo en pantalla).
materialRouter.post('/material/:id/resumen', asyncHandler(async (req, res) => {
  const materialId = await exigeVerMaterial(req);
  const resultado = await resumenIA.resumirMaterial(materialId);
  res.json({ ok: true, ...resultado });
}));

// Descarga el resumen como PDF. Recibe el texto ya generado en el cuerpo, para
// no volver a llamar al modelo (más rápido y coherente con lo que vio el usuario).
materialRouter.post('/material/:id/resumen/pdf', asyncHandler(async (req, res) => {
  await exigeVerMaterial(req);
  const titulo = String(req.body?.titulo ?? 'Material').slice(0, 150);
  const resumen = String(req.body?.resumen ?? '').slice(0, 20000);
  if (!resumen) throw new AppError('No hay resumen para generar el PDF.', 400, 'SIN_RESUMEN');

  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="resumen-${titulo.replace(/[^\w.\-]/g, '_')}.pdf"`);
  doc.pipe(res);

  doc.rect(50, 40, 512, 4).fill('#dba018');
  doc.fillColor('#0a2f5c').fontSize(11).font('Helvetica-Bold')
    .text('Smart Campus IA · Resumen generado con IA', 50, 54);
  doc.moveDown(1.5);
  doc.fillColor('#0a2f5c').fontSize(18).font('Helvetica-Bold').text(titulo, { width: 512 });
  doc.moveDown(0.5);
  doc.fillColor('#8a94a6').fontSize(9).font('Helvetica')
    .text(`Generado el ${new Date().toLocaleDateString('es-HN', { day: 'numeric', month: 'long', year: 'numeric' })}`);
  doc.moveDown(1);

  doc.fillColor('#1a1a1a').fontSize(11).font('Helvetica').text(resumen, { width: 512, align: 'left', lineGap: 3 });

  doc.moveDown(2);
  doc.fillColor('#8a94a6').fontSize(8).font('Helvetica-Oblique')
    .text('Este resumen fue generado automáticamente por inteligencia artificial a partir del material de clase. Puede contener imprecisiones; revísalo con el documento original.', { width: 512 });

  doc.end();
}));

materialRouter.delete('/material/:id', requiereAuth, asyncHandler(async (req, res) => {
  const materialId = Number(req.params.id);
  const [m] = await q('SELECT clase_id FROM material WHERE id = ?', [materialId]);
  if (!m) throw new AppError('El material no existe.', 404, 'NO_ENCONTRADO');
  if (!(await material.puedeGestionar(req.usuario, m.clase_id))) {
    throw new AppError('No se encontro el material.', 404, 'NO_ENCONTRADO');
  }
  res.json({ ok: true, ...(await material.eliminar(materialId, contextoDe(req))) });
}));