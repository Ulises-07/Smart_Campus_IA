import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler, AppError } from '../middleware/error.js';
import { requiereAuth, requiereRol, exigeCambioPassword, ROLES } from '../middleware/auth.js';
import { contextoDe } from '../config/db.js';
import * as usuarios from '../services/usuario.service.js';

export const usuarioRouter = Router();

// Todo este módulo es exclusivo del administrador.
usuarioRouter.use('/usuarios', requiereAuth, exigeCambioPassword, requiereRol(ROLES.ADMIN));

const esquemaCrear = z.object({
  usuario: z.string().trim().min(3).max(60).regex(/^[a-z0-9._-]+$/i, 'Solo letras, numeros, punto, guion y guion bajo.'),
  rol: z.enum(['ADMIN', 'MAESTRO', 'ASESOR', 'ALUMNO']),
  primerNombre: z.string().trim().min(1).max(60),
  segundoNombre: z.string().trim().max(60).optional().nullable(),
  primerApellido: z.string().trim().min(1).max(60),
  segundoApellido: z.string().trim().max(60).optional().nullable(),
  identidad: z.string().trim().min(5).max(20).optional().nullable(),
  correo: z.string().trim().email('Correo invalido.').max(120).optional().nullable(),
  telefono: z.string().trim().max(25).optional().nullable(),
  fechaNacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  sexo: z.enum(['M', 'F', 'otro']).optional().nullable(),
  direccion: z.string().trim().max(255).optional().nullable(),
});

const esquemaActualizar = esquemaCrear.partial().extend({
  estado: z.enum(['activo', 'inactivo', 'bloqueado']).optional(),
}).omit({ usuario: true });

function validar(esquema, cuerpo) {
  const r = esquema.safeParse(cuerpo);
  if (!r.success) {
    throw new AppError('Datos invalidos.', 400, 'DATOS_INVALIDOS',
      r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return r.data;
}

usuarioRouter.get('/usuarios', asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await usuarios.listar(req.query)) });
}));

usuarioRouter.get('/usuarios/:id', asyncHandler(async (req, res) => {
  res.json({ ok: true, usuario: await usuarios.obtener(Number(req.params.id)) });
}));

usuarioRouter.post('/usuarios', asyncHandler(async (req, res) => {
  const datos = validar(esquemaCrear, req.body);
  const r = await usuarios.crear(datos, contextoDe(req));

  // La contraseña temporal se devuelve UNA sola vez y no queda en ningún lado.
  // El administrador la entrega en persona.
  res.status(201).json({
    ok: true,
    usuario: r.usuario,
    passwordTemporal: r.passwordTemporal,
    aviso: 'Anota esta contrasena ahora: no se volvera a mostrar. El usuario debera cambiarla al ingresar.',
  });
}));

usuarioRouter.patch('/usuarios/:id', asyncHandler(async (req, res) => {
  const datos = validar(esquemaActualizar, req.body);
  const id = Number(req.params.id);

  // Un administrador no puede desactivarse ni degradarse a sí mismo: dejaría
  // el sistema sin quien administre.
  if (id === req.usuario.id && (datos.estado || datos.rol)) {
    throw new AppError('No puedes cambiar tu propio rol ni estado.', 400, 'AUTO_MODIFICACION');
  }

  res.json({ ok: true, usuario: await usuarios.actualizar(id, datos, contextoDe(req)) });
}));

usuarioRouter.post('/usuarios/:id/reiniciar-password', asyncHandler(async (req, res) => {
  const r = await usuarios.reiniciarPassword(Number(req.params.id), contextoDe(req));
  res.json({ ok: true, ...r, aviso: 'Entregala en persona. No se volvera a mostrar.' });
}));

usuarioRouter.post('/usuarios/:id/desbloquear', asyncHandler(async (req, res) => {
  res.json({ ok: true, usuario: await usuarios.desbloquear(Number(req.params.id), contextoDe(req)) });
}));
