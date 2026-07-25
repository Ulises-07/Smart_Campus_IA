import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler, AppError } from '../middleware/error.js';
import { requiereAuth, requiereRol, exigeCambioPassword, ROLES, verificarAcceso404, puedeVerAlumno, puedeVerClase } from '../middleware/auth.js';
import { contextoDe } from '../config/db.js';
import * as alumnos from '../services/alumno.service.js';
import * as matricula from '../services/matricula.service.js';
import * as academico from '../services/academico.service.js';
import * as horarios from '../services/horario.service.js';

export const academicoRouter = Router();

// Todo el módulo exige sesión y contraseña ya cambiada.
academicoRouter.use(requiereAuth, exigeCambioPassword);

function validar(esquema, cuerpo) {
  const r = esquema.safeParse(cuerpo);
  if (!r.success) {
    throw new AppError('Datos invalidos.', 400, 'DATOS_INVALIDOS',
      r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return r.data;
}

const soloGestion = requiereRol(ROLES.ADMIN, ROLES.ASESOR);
const soloAdmin = requiereRol(ROLES.ADMIN);

// ============================================================================
// Contexto general
// ============================================================================

academicoRouter.get('/contexto', asyncHandler(async (req, res) => {
  const anio = await matricula.anioActivo();
  res.json({
    ok: true,
    anioLectivo: anio,
    catalogos: await academico.catalogos(anio.id),
  });
}));

academicoRouter.get('/mis-clases', asyncHandler(async (req, res) => {
  const anio = await matricula.anioActivo();
  res.json({ ok: true, clases: await academico.misClases(req.usuario, anio.id) });
}));

// ============================================================================
// Alumnos
// ============================================================================

const persona = {
  primerNombre: z.string().trim().min(1).max(60),
  segundoNombre: z.string().trim().max(60).optional().nullable(),
  primerApellido: z.string().trim().min(1).max(60),
  segundoApellido: z.string().trim().max(60).optional().nullable(),
  identidad: z.string().trim().min(5).max(20).optional().nullable(),
  fechaNacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  sexo: z.enum(['M', 'F', 'otro']).optional().nullable(),
  direccion: z.string().trim().max(255).optional().nullable(),
  telefono: z.string().trim().max(25).optional().nullable(),
  correo: z.string().trim().email().max(120).optional().nullable().or(z.literal('')),
};

const esquemaAlumno = z.object({
  ...persona,
  codigo: z.string().trim().max(20).optional(),
  fechaIngreso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  observaciones: z.string().trim().max(1000).optional().nullable(),
  encargados: z.array(z.object({
    ...persona,
    parentesco: z.enum(['padre', 'madre', 'tutor', 'otro']).optional(),
    ocupacion: z.string().trim().max(80).optional().nullable(),
    lugarTrabajo: z.string().trim().max(120).optional().nullable(),
    esPrincipal: z.boolean().optional(),
    puedeRetirar: z.boolean().optional(),
  })).max(4).optional(),
});

academicoRouter.get('/alumnos', asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await alumnos.listar(req.usuario, req.query)) });
}));

// La comprobación por fila va ANTES del controlador: si no pasa, el servicio
// ni siquiera se ejecuta y la respuesta es 404, no 403.
academicoRouter.get('/alumnos/:id',
  verificarAcceso404(puedeVerAlumno),
  asyncHandler(async (req, res) => {
    res.json({ ok: true, alumno: await alumnos.obtener(req.usuario, Number(req.params.id)) });
  }));

academicoRouter.post('/alumnos', soloGestion, asyncHandler(async (req, res) => {
  const datos = validar(esquemaAlumno, req.body);
  const id = await alumnos.crear(datos, contextoDe(req));
  res.status(201).json({ ok: true, alumno: await alumnos.obtener(req.usuario, id) });
}));

academicoRouter.patch('/alumnos/:id', soloGestion, asyncHandler(async (req, res) => {
  const datos = validar(esquemaAlumno.partial(), req.body);
  await alumnos.actualizar(Number(req.params.id), datos, contextoDe(req));
  res.json({ ok: true, alumno: await alumnos.obtener(req.usuario, Number(req.params.id)) });
}));

academicoRouter.get('/alumnos/buscar/identidad/:identidad', soloGestion, asyncHandler(async (req, res) => {
  res.json({ ok: true, resultados: await alumnos.buscarPorIdentidad(req.params.identidad) });
}));

// ============================================================================
// Matrícula
// ============================================================================

academicoRouter.post('/matriculas', soloGestion, asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    alumnoId: z.coerce.number().int().positive(),
    seccionId: z.coerce.number().int().positive(),
    fechaMatricula: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    observaciones: z.string().trim().max(255).optional().nullable(),
  }), req.body);

  const r = await matricula.matricular(datos, contextoDe(req));
  res.status(201).json({
    ok: true, ...r,
    mensaje: `Alumno matriculado e inscrito automaticamente en ${r.inscripciones} de ${r.clases} clases de la seccion.`,
  });
}));

academicoRouter.post('/matriculas/:id/trasladar', soloGestion, asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    seccionDestinoId: z.coerce.number().int().positive(),
    motivo: z.string().trim().max(200).optional(),
  }), req.body);

  const r = await matricula.trasladar({ matriculaId: Number(req.params.id), ...datos }, contextoDe(req));
  res.json({ ok: true, ...r });
}));

academicoRouter.post('/matriculas/:id/retirar', soloGestion, asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    motivo: z.string().trim().max(200).optional(),
    estado: z.enum(['retirada', 'trasladada', 'egresada']).optional(),
  }), req.body);

  res.json({ ok: true, ...(await matricula.retirar({ matriculaId: Number(req.params.id), ...datos }, contextoDe(req))) });
}));

academicoRouter.get('/secciones/:id/alumnos',
  verificarAcceso404(async (usuario, seccionId) => {
    if (usuario.rol === ROLES.ADMIN || usuario.rol === ROLES.ASESOR) return true;
    // Un maestro ve la lista si imparte alguna clase de esa sección.
    const { q } = await import('../config/db.js');
    if (usuario.rol === ROLES.MAESTRO) {
      return (await q('SELECT 1 FROM clase WHERE seccion_id = ? AND maestro_id = ? LIMIT 1',
        [seccionId, usuario.id])).length > 0;
    }
    return false;
  }),
  asyncHandler(async (req, res) => {
    res.json({ ok: true, alumnos: await matricula.alumnosDeSeccion(Number(req.params.id)) });
  }));

// ============================================================================
// Promoción de grado
// ============================================================================

academicoRouter.get('/promocion/vista-previa', soloAdmin, asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    anioOrigenId: z.coerce.number().int().positive(),
    anioDestinoId: z.coerce.number().int().positive(),
  }), req.query);
  res.json({ ok: true, ...(await matricula.vistaPreviaPromocion(datos)) });
}));

academicoRouter.post('/promocion/ejecutar', soloAdmin, asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    anioOrigenId: z.coerce.number().int().positive(),
    anioDestinoId: z.coerce.number().int().positive(),
    decisiones: z.array(z.object({
      alumnoId: z.coerce.number().int().positive(),
      seccionDestinoId: z.coerce.number().int().positive().optional(),
      egresa: z.boolean().optional(),
    })).min(1),
  }), req.body);

  res.json({ ok: true, ...(await matricula.ejecutarPromocion(datos, contextoDe(req))) });
}));

// ============================================================================
// Secciones y clases
// ============================================================================

academicoRouter.post('/secciones', soloAdmin, asyncHandler(async (req, res) => {
  const anio = await matricula.anioActivo();
  const datos = validar(z.object({
    gradoId: z.coerce.number().int().positive(),
    letra: z.string().trim().min(1).max(2),
    cupoMaximo: z.coerce.number().int().min(1).max(100).optional(),
    aulaId: z.coerce.number().int().positive().optional().nullable(),
  }), req.body);

  res.status(201).json({ ok: true, ...(await academico.crearSeccion({ ...datos, anioLectivoId: anio.id }, contextoDe(req))) });
}));

academicoRouter.get('/secciones/:id/clases', asyncHandler(async (req, res) => {
  res.json({ ok: true, clases: await academico.clasesDeSeccion(Number(req.params.id)) });
}));

academicoRouter.post('/secciones/:id/clases', soloAdmin, asyncHandler(async (req, res) => {
  const anio = await matricula.anioActivo();
  const datos = validar(z.object({
    asignaturas: z.array(z.object({
      asignaturaId: z.coerce.number().int().positive(),
      maestroId: z.coerce.number().int().positive().optional().nullable(),
    })).min(1),
  }), req.body);

  const r = await academico.crearClases(
    { seccionId: Number(req.params.id), asignaturas: datos.asignaturas, anioLectivoId: anio.id },
    contextoDe(req)
  );
  res.status(201).json({ ok: true, ...r });
}));

academicoRouter.patch('/clases/:id/maestro', soloAdmin, asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    maestroId: z.coerce.number().int().positive().nullable(),
  }), req.body);
  res.json({ ok: true, ...(await academico.asignarMaestro({ claseId: Number(req.params.id), ...datos }, contextoDe(req))) });
}));

// ============================================================================
// Horarios
// ============================================================================

academicoRouter.get('/horarios', asyncHandler(async (req, res) => {
  const anio = await matricula.anioActivo();
  const { seccionId, maestroId, aulaId } = req.query;

  // Un maestro sin filtro ve su propio horario, no el del colegio entero.
  const filtroMaestro = req.usuario.rol === ROLES.MAESTRO && !seccionId && !aulaId
    ? req.usuario.id
    : maestroId;

  res.json({
    ok: true,
    ...(await horarios.rejilla({ anioLectivoId: anio.id, seccionId, maestroId: filtroMaestro, aulaId })),
  });
}));

academicoRouter.get('/horarios/disponibilidad', soloAdmin, asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    claseId: z.coerce.number().int().positive(),
    aulaId: z.coerce.number().int().positive().optional(),
  }), req.query);
  res.json({ ok: true, rejilla: await horarios.disponibilidad(datos) });
}));

academicoRouter.get('/horarios/aulas-libres', soloAdmin, asyncHandler(async (req, res) => {
  const anio = await matricula.anioActivo();
  const datos = validar(z.object({
    diaSemana: z.coerce.number().int().min(1).max(6),
    bloqueId: z.coerce.number().int().positive(),
    tipo: z.enum(['aula', 'laboratorio', 'taller', 'otro']).optional(),
  }), req.query);
  res.json({ ok: true, aulas: await horarios.aulasLibres({ anioLectivoId: anio.id, ...datos }) });
}));

/** Consulta previa: dice qué chocaría, sin intentar guardar. */
academicoRouter.post('/horarios/verificar', soloAdmin, asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    claseId: z.coerce.number().int().positive(),
    diaSemana: z.coerce.number().int().min(1).max(6),
    bloqueId: z.coerce.number().int().positive(),
    aulaId: z.coerce.number().int().positive(),
  }), req.body);

  const conflictos = await horarios.detectarConflictos(datos);
  res.json({ ok: true, disponible: conflictos.length === 0, conflictos });
}));

academicoRouter.post('/horarios', soloAdmin, asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    claseId: z.coerce.number().int().positive(),
    diaSemana: z.coerce.number().int().min(1).max(6),
    bloqueId: z.coerce.number().int().positive(),
    aulaId: z.coerce.number().int().positive(),
  }), req.body);

  res.status(201).json({ ok: true, ...(await horarios.crear(datos, contextoDe(req))) });
}));

academicoRouter.delete('/horarios/:id', soloAdmin, asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await horarios.eliminar(Number(req.params.id), contextoDe(req))) });
}));
