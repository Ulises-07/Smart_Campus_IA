import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler, AppError } from '../middleware/error.js';
import { requiereAuth, requiereRol, exigeCambioPassword, ROLES, verificarAcceso404, puedeVerClase, puedeVerAlumno } from '../middleware/auth.js';
import { contextoDe, q } from '../config/db.js';
import * as notas from '../services/nota.service.js';
import * as asistencia from '../services/asistencia.service.js';
import * as matricula from '../services/matricula.service.js';

export const notasRouter = Router();
notasRouter.use(requiereAuth, exigeCambioPassword);

function validar(esquema, cuerpo) {
  const r = esquema.safeParse(cuerpo);
  if (!r.success) {
    throw new AppError('Datos invalidos.', 400, 'DATOS_INVALIDOS',
      r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return r.data;
}

/**
 * El maestro solo puede TOCAR las clases que imparte. Un admin puede todas.
 * Esta es la barrera central de la fase: sin ella, un maestro autenticado
 * podría cambiar /api/clases/10/... por /api/clases/11/... y calificar en una
 * clase ajena.
 */
const claseDelMaestro = verificarAcceso404(async (usuario, claseId) => {
  if (usuario.rol === ROLES.ADMIN) return true;
  if (usuario.rol === ROLES.MAESTRO) {
    return (await q('SELECT 1 FROM clase WHERE id = ? AND maestro_id = ? LIMIT 1', [claseId, usuario.id])).length > 0;
  }
  return false;
}, 'claseId');

// ============================================================================
// Ponderación
// ============================================================================

notasRouter.get('/clases/:claseId/ponderacion', claseDelMaestro, asyncHandler(async (req, res) => {
  const periodoId = Number(req.query.periodoId);
  res.json({ ok: true, ...(await notas.obtenerPonderacion(Number(req.params.claseId), periodoId)) });
}));

notasRouter.put('/clases/:claseId/ponderacion', claseDelMaestro, requiereRol(ROLES.ADMIN, ROLES.MAESTRO), asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    periodoId: z.coerce.number().int().positive(),
    items: z.array(z.object({
      tipoEvaluacionId: z.coerce.number().int().positive(),
      porcentaje: z.coerce.number().min(0).max(100),
      esExtra: z.boolean().optional(),
    })).min(1),
  }), req.body);

  res.json({ ok: true, ...(await notas.definirPonderacion({ claseId: Number(req.params.claseId), ...datos }, contextoDe(req))) });
}));

// ============================================================================
// Evaluaciones
// ============================================================================

notasRouter.get('/clases/:claseId/evaluaciones', claseDelMaestro, asyncHandler(async (req, res) => {
  res.json({ ok: true, evaluaciones: await notas.listarEvaluaciones(Number(req.params.claseId), Number(req.query.periodoId)) });
}));

notasRouter.post('/clases/:claseId/evaluaciones', claseDelMaestro, requiereRol(ROLES.ADMIN, ROLES.MAESTRO), asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    periodoId: z.coerce.number().int().positive(),
    tipoEvaluacionId: z.coerce.number().int().positive(),
    titulo: z.string().trim().min(1).max(120),
    descripcion: z.string().trim().max(255).optional().nullable(),
    puntajeMaximo: z.coerce.number().positive().max(1000).optional(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }), req.body);

  res.status(201).json({ ok: true, ...(await notas.crearEvaluacion({ claseId: Number(req.params.claseId), ...datos }, contextoDe(req))) });
}));

notasRouter.delete('/evaluaciones/:id', requiereRol(ROLES.ADMIN, ROLES.MAESTRO), asyncHandler(async (req, res) => {
  // La verificación de fila va dentro: se comprueba que la evaluación pertenece
  // a una clase del maestro antes de tocarla.
  const [e] = await q('SELECT clase_id FROM evaluacion WHERE id = ?', [Number(req.params.id)]);
  if (!e) throw new AppError('No se encontro la evaluacion.', 404, 'NO_ENCONTRADO');
  if (req.usuario.rol === ROLES.MAESTRO) {
    const ok = await q('SELECT 1 FROM clase WHERE id = ? AND maestro_id = ?', [e.clase_id, req.usuario.id]);
    if (!ok.length) throw new AppError('No se encontro la evaluacion.', 404, 'NO_ENCONTRADO');
  }
  res.json({ ok: true, ...(await notas.eliminarEvaluacion(Number(req.params.id), contextoDe(req))) });
}));

// ============================================================================
// Digitación de notas
// ============================================================================

notasRouter.get('/evaluaciones/:id/planilla', requiereRol(ROLES.ADMIN, ROLES.MAESTRO), asyncHandler(async (req, res) => {
  const [e] = await q('SELECT clase_id FROM evaluacion WHERE id = ?', [Number(req.params.id)]);
  if (!e) throw new AppError('No se encontro la evaluacion.', 404, 'NO_ENCONTRADO');
  if (req.usuario.rol === ROLES.MAESTRO) {
    const ok = await q('SELECT 1 FROM clase WHERE id = ? AND maestro_id = ?', [e.clase_id, req.usuario.id]);
    if (!ok.length) throw new AppError('No se encontro la evaluacion.', 404, 'NO_ENCONTRADO');
  }
  res.json({ ok: true, ...(await notas.planillaEvaluacion(Number(req.params.id))) });
}));

notasRouter.put('/evaluaciones/:id/notas', requiereRol(ROLES.ADMIN, ROLES.MAESTRO), asyncHandler(async (req, res) => {
  const [e] = await q('SELECT clase_id FROM evaluacion WHERE id = ?', [Number(req.params.id)]);
  if (!e) throw new AppError('No se encontro la evaluacion.', 404, 'NO_ENCONTRADO');
  if (req.usuario.rol === ROLES.MAESTRO) {
    const ok = await q('SELECT 1 FROM clase WHERE id = ? AND maestro_id = ?', [e.clase_id, req.usuario.id]);
    if (!ok.length) throw new AppError('No se encontro la evaluacion.', 404, 'NO_ENCONTRADO');
  }

  const datos = validar(z.object({
    notas: z.array(z.object({
      alumnoId: z.coerce.number().int().positive(),
      puntaje: z.union([z.coerce.number(), z.null(), z.literal('')]).optional(),
      observacion: z.string().trim().max(255).optional().nullable(),
    })),
  }), req.body);

  res.json({ ok: true, ...(await notas.guardarNotas({ evaluacionId: Number(req.params.id), notas: datos.notas }, contextoDe(req))) });
}));

// Cuadro completo de notas de la clase (revisión antes de cerrar).
notasRouter.get('/clases/:claseId/cuadro', claseDelMaestro, asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await notas.cuadroNotas(Number(req.params.claseId), Number(req.query.periodoId))) });
}));

// Vista previa del cálculo de un alumno (para explicar la nota).
notasRouter.get('/clases/:claseId/calcular/:alumnoId', claseDelMaestro, asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await notas.calcular({
    alumnoId: Number(req.params.alumnoId),
    claseId: Number(req.params.claseId),
    periodoId: Number(req.query.periodoId),
  })) });
}));

// ============================================================================
// Notas del alumno (vista del propio alumno o de quien tiene permiso)
// ============================================================================

notasRouter.get('/alumnos/:id/notas', verificarAcceso404(puedeVerAlumno), asyncHandler(async (req, res) => {
  const anio = await matricula.anioActivo();
  res.json({
    ok: true,
    notas: await notas.notasDeAlumno(Number(req.params.id), {
      periodoId: req.query.periodoId ? Number(req.query.periodoId) : null,
      anioLectivoId: anio.id,
    }),
  });
}));

// ============================================================================
// Cierre de periodo (solo administrador)
// ============================================================================

notasRouter.post('/periodos/:id/cerrar', requiereRol(ROLES.ADMIN), asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await notas.cerrarPeriodo(Number(req.params.id), contextoDe(req))) });
}));

// Reabrir un periodo cerrado. Accion sensible: solo administrador, y queda
// auditada. Desbloquea las notas para que se puedan corregir.
notasRouter.post('/periodos/:id/reabrir', requiereRol(ROLES.ADMIN), asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await notas.reabrirPeriodo(Number(req.params.id), contextoDe(req))) });
}));

// ============================================================================
// Asistencia
// ============================================================================

notasRouter.get('/clases/:claseId/asistencia', claseDelMaestro, asyncHandler(async (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
  res.json({ ok: true, ...(await asistencia.planilla(Number(req.params.claseId), fecha)) });
}));

notasRouter.put('/clases/:claseId/asistencia', claseDelMaestro, requiereRol(ROLES.ADMIN, ROLES.MAESTRO), asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    registros: z.array(z.object({
      alumnoId: z.coerce.number().int().positive(),
      estado: z.enum(['presente', 'ausente', 'tarde', 'justificado']),
      observacion: z.string().trim().max(255).optional().nullable(),
    })).min(1),
  }), req.body);

  const r = await asistencia.guardarAsistencia({ claseId: Number(req.params.claseId), ...datos }, contextoDe(req));
  res.json({
    ok: true,
    guardados: r.guardados,
    enRiesgo: r.enRiesgo.filter((a) => a.enRiesgo),
    mensaje: r.enRiesgo.filter((a) => a.enRiesgo).length
      ? `${r.enRiesgo.filter((a) => a.enRiesgo).length} alumno(s) superan el umbral de inasistencia.`
      : 'Asistencia registrada.',
  });
}));

notasRouter.get('/clases/:claseId/asistencia/riesgo', claseDelMaestro, asyncHandler(async (req, res) => {
  res.json({ ok: true, alumnos: await asistencia.alumnosEnRiesgo(Number(req.params.claseId)) });
}));

notasRouter.get('/alumnos/:id/asistencia', verificarAcceso404(puedeVerAlumno), asyncHandler(async (req, res) => {
  res.json({ ok: true, resumen: await asistencia.resumenAlumno(Number(req.params.id)) });
}));

// ============================================================================
// Incidencias de comportamiento
// ============================================================================

notasRouter.get('/incidencias', requiereRol(ROLES.ADMIN, ROLES.MAESTRO, ROLES.ASESOR), asyncHandler(async (req, res) => {
  res.json({ ok: true, incidencias: await asistencia.listarIncidencias(req.query) });
}));

notasRouter.post('/incidencias', requiereRol(ROLES.ADMIN, ROLES.MAESTRO), asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    alumnoId: z.coerce.number().int().positive(),
    claseId: z.coerce.number().int().positive().optional().nullable(),
    gravedad: z.enum(['leve', 'grave', 'muy_grave']),
    descripcion: z.string().trim().min(1).max(2000),
    medidaDisciplinaria: z.string().trim().max(255).optional().nullable(),
    fechaHora: z.string().optional(),
  }), req.body);

  // Un maestro solo registra incidencias de alumnos que puede ver.
  if (req.usuario.rol === ROLES.MAESTRO) {
    if (!(await puedeVerAlumno(req.usuario, datos.alumnoId))) {
      throw new AppError('No se encontro el alumno.', 404, 'NO_ENCONTRADO');
    }
  }

  res.status(201).json({ ok: true, ...(await asistencia.registrarIncidencia(datos, contextoDe(req))) });
}));

notasRouter.patch('/incidencias/:id', requiereRol(ROLES.ADMIN, ROLES.MAESTRO), asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    estado: z.enum(['abierta', 'en_proceso', 'resuelta']).optional(),
    medidaDisciplinaria: z.string().trim().max(255).optional().nullable(),
    encargadoNotificado: z.boolean().optional(),
  }), req.body);

  res.json({ ok: true, ...(await asistencia.actualizarIncidencia(Number(req.params.id), datos, contextoDe(req))) });
}));
