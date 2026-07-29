import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler, AppError } from '../middleware/error.js';
import { requiereAuth, requiereRol, exigeCambioPassword, ROLES } from '../middleware/auth.js';
import { contextoDe } from '../config/db.js';
import * as video from '../services/videovigilancia.service.js';

export const videoRouter = Router();

// TODO el módulo es exclusivo del administrador. La videovigilancia de menores
// no es accesible para ningún otro rol, por diseño.
videoRouter.use('/video', requiereAuth, exigeCambioPassword, requiereRol(ROLES.ADMIN));

function validar(esquema, cuerpo) {
  const r = esquema.safeParse(cuerpo);
  if (!r.success) throw new AppError('Datos invalidos.', 400, 'DATOS_INVALIDOS', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  return r.data;
}

videoRouter.get('/video/resumen', asyncHandler(async (req, res) => {
  res.json({ ok: true, resumen: await video.resumen() });
}));

// --- Cámaras ---
videoRouter.get('/video/camaras', asyncHandler(async (req, res) => {
  res.json({ ok: true, camaras: await video.listarCamaras() });
}));

videoRouter.post('/video/camaras', asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    codigo: z.string().trim().min(1).max(20),
    nombre: z.string().trim().min(1).max(100),
    zona: z.string().trim().min(1).max(120),
    tipoZona: z.enum(['entrada', 'pasillo', 'patio', 'perimetro', 'area_administrativa', 'aula']),
    retencionDias: z.coerce.number().int().min(1).max(365).optional().nullable(),
    fechaInstalacion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  }), req.body);
  res.status(201).json({ ok: true, ...(await video.crearCamara(datos, contextoDe(req))) });
}));

videoRouter.patch('/video/camaras/:id', asyncHandler(async (req, res) => {
  const { activa } = validar(z.object({ activa: z.boolean() }), req.body);
  res.json({ ok: true, ...(await video.cambiarEstadoCamara(Number(req.params.id), activa, contextoDe(req))) });
}));

// --- Consentimiento ---
videoRouter.get('/video/consentimientos', asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await video.listarConsentimientos(req.query)) });
}));

videoRouter.put('/video/consentimientos/:alumnoId', asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    estado: z.enum(['otorgado', 'denegado', 'pendiente']),
    encargadoId: z.coerce.number().int().positive().optional().nullable(),
    documentoReferencia: z.string().trim().max(120).optional().nullable(),
    observacion: z.string().trim().max(255).optional().nullable(),
  }), req.body);
  res.json({ ok: true, ...(await video.registrarConsentimiento({ alumnoId: Number(req.params.alumnoId), ...datos }, contextoDe(req))) });
}));

// --- Grabaciones ---
videoRouter.get('/video/grabaciones', asyncHandler(async (req, res) => {
  res.json({ ok: true, grabaciones: await video.listarGrabaciones(req.query) });
}));

videoRouter.post('/video/grabaciones', asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    camaraId: z.coerce.number().int().positive(),
    fechaInicio: z.string(),
    fechaFin: z.string(),
    archivoReferencia: z.string().trim().min(1).max(200),
  }), req.body);
  res.status(201).json({ ok: true, ...(await video.registrarGrabacion(datos, contextoDe(req))) });
}));

// Acceder a una grabación: exige motivo, queda auditado, respeta consentimiento.
videoRouter.post('/video/grabaciones/:id/acceder', asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    motivo: z.string().trim().min(5).max(255),
    alumnoId: z.coerce.number().int().positive().optional().nullable(),
  }), req.body);
  res.json({ ok: true, ...(await video.accederGrabacion({ grabacionId: Number(req.params.id), ...datos }, contextoDe(req))) });
}));

videoRouter.post('/video/grabaciones/:id/evidencia', asyncHandler(async (req, res) => {
  const datos = validar(z.object({ motivo: z.string().trim().min(5).max(255) }), req.body);
  res.json({ ok: true, ...(await video.marcarEvidencia({ grabacionId: Number(req.params.id), ...datos }, contextoDe(req))) });
}));

// Purga manual (además de la tarea programada).
videoRouter.post('/video/purgar', asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await video.purgarVencidas(contextoDe(req))) });
}));

// ============================================================================
// DETECCIÓN EN VIVO
// ============================================================================

// Qué objetos vigilar (para configurar la lista y para que el navegador sepa
// qué clases marcar como peligrosas).
videoRouter.get('/video/objetos', asyncHandler(async (req, res) => {
  res.json({ ok: true, objetos: await video.objetosPeligrosos(), vigiladas: await video.clasesVigiladas() });
}));

videoRouter.patch('/video/objetos/:id', asyncHandler(async (req, res) => {
  const datos = validar(z.object({ activo: z.boolean() }), req.body);
  res.json({ ok: true, ...(await video.cambiarObjetoPeligroso(Number(req.params.id), datos.activo, contextoDe(req))) });
}));

// El navegador reporta una detección. El servidor la registra y notifica.
videoRouter.post('/video/detecciones', asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    camaraId: z.coerce.number().int().positive().optional().nullable(),
    clase: z.string().trim().min(1).max(50),
    confianza: z.coerce.number().min(0).max(1),
  }), req.body);
  res.json({ ok: true, ...(await video.registrarDeteccion(datos, contextoDe(req))) });
}));

videoRouter.get('/video/detecciones', asyncHandler(async (req, res) => {
  const soloNoAtendidas = req.query.noAtendidas === '1' || req.query.noAtendidas === 'true';
  res.json({ ok: true, ...(await video.listarDetecciones({ soloNoAtendidas, pagina: req.query.pagina, porPagina: req.query.porPagina })) });
}));

videoRouter.post('/video/detecciones/:id/atender', asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await video.atenderDeteccion(Number(req.params.id), contextoDe(req))) });
}));
