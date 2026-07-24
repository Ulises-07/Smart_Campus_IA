import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { asyncHandler, AppError } from '../middleware/error.js';
import { requiereAuth } from '../middleware/auth.js';
import { ponerCookiesSesion, borrarCookiesSesion } from '../middleware/seguridad.js';
import * as auth from '../services/auth.service.js';
import { perfil } from '../services/usuario.service.js';

export const authRouter = Router();

/**
 * Límite estricto solo para el login. El límite general de /api es de 300 por
 * minuto, que para probar contraseñas sería una invitación abierta.
 * Este cuenta por IP; el bloqueo por cuenta lo maneja auth.service.
 */
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { ok: false, codigo: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos. Espera unos minutos.' },
});

const esquemaLogin = z.object({
  usuario: z.string().trim().min(1, 'Escribe tu usuario.').max(60),
  password: z.string().min(1, 'Escribe tu contrasena.').max(128),
});

const esquemaCambio = z.object({
  actual: z.string().min(1).max(128),
  nueva: z.string().min(1).max(128),
});

function validar(esquema, cuerpo) {
  const r = esquema.safeParse(cuerpo);
  if (!r.success) {
    throw new AppError('Datos invalidos.', 400, 'DATOS_INVALIDOS', r.error.issues.map((i) => i.message));
  }
  return r.data;
}

authRouter.post('/auth/login', limiteLogin, asyncHandler(async (req, res) => {
  const { usuario, password } = validar(esquemaLogin, req.body);

  const r = await auth.iniciarSesion({
    usuario, password, ip: req.ip, userAgent: req.get('user-agent'),
  });

  ponerCookiesSesion(res, { acceso: r.acceso, refresco: r.refresco });
  res.json({ ok: true, usuario: r.usuario });
}));

authRouter.post('/auth/refrescar', asyncHandler(async (req, res) => {
  const r = await auth.refrescarSesion({
    token: req.cookies?.refresco, ip: req.ip, userAgent: req.get('user-agent'),
  });
  ponerCookiesSesion(res, r);
  res.json({ ok: true });
}));

authRouter.post('/auth/logout', asyncHandler(async (req, res) => {
  let usuarioId = null;
  try {
    usuarioId = auth.verificarAcceso(req.cookies?.acceso ?? '').sub;
  } catch { /* sesión ya vencida; el cierre procede igual */ }

  await auth.cerrarSesion({ token: req.cookies?.refresco, usuarioId, ip: req.ip });
  borrarCookiesSesion(res);
  res.json({ ok: true });
}));

authRouter.get('/auth/yo', requiereAuth, asyncHandler(async (req, res) => {
  res.json({ ok: true, usuario: await perfil(req.usuario.id) });
}));

// No lleva exigeCambioPassword: es justamente la ruta que permite salir de ese
// estado. Si la bloqueara, el usuario quedaría atrapado.
authRouter.post('/auth/cambiar-password', requiereAuth, asyncHandler(async (req, res) => {
  const { actual, nueva } = validar(esquemaCambio, req.body);

  await auth.cambiarPassword({
    usuarioId: req.usuario.id, actual, nueva, ip: req.ip, rol: req.usuario.rol,
  });

  // Todas las sesiones quedaron cerradas: hay que volver a entrar.
  borrarCookiesSesion(res);
  res.json({ ok: true, mensaje: 'Contrasena actualizada. Inicia sesion de nuevo.' });
}));
