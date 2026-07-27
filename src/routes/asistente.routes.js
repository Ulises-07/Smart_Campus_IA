import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { asyncHandler, AppError } from '../middleware/error.js';
import { requiereAuth, exigeCambioPassword } from '../middleware/auth.js';
import * as chatbot from '../services/chatbot.service.js';
import * as notif from '../services/notificacion.service.js';

export const asistenteRouter = Router();
asistenteRouter.use(requiereAuth, exigeCambioPassword);

function validar(esquema, cuerpo) {
  const r = esquema.safeParse(cuerpo);
  if (!r.success) throw new AppError('Datos invalidos.', 400, 'DATOS_INVALIDOS', r.error.issues.map((i) => i.message));
  return r.data;
}

// ============================================================================
// Chatbot
// ============================================================================

// El chatbot consume la IA local, que es lenta. Un límite por usuario evita
// que alguien la sature con preguntas en ráfaga.
const limiteChat = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.usuario?.id ?? req.ip),
  message: { ok: false, codigo: 'DEMASIADAS_PREGUNTAS', mensaje: 'Vas muy rapido. Espera un momento antes de preguntar de nuevo.' },
});

asistenteRouter.get('/asistente/estado', asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await chatbot.estado()) });
}));

asistenteRouter.post('/asistente/preguntar', limiteChat, asyncHandler(async (req, res) => {
  const { pregunta } = validar(z.object({ pregunta: z.string().min(1).max(500) }), req.body);
  const r = await chatbot.preguntar({ usuario: req.usuario, pregunta, ip: req.ip });
  res.json({ ok: true, ...r });
}));

// ============================================================================
// Notificaciones (bandeja del propio usuario)
// ============================================================================

asistenteRouter.get('/notificaciones', asyncHandler(async (req, res) => {
  const soloNoLeidas = req.query.noLeidas === '1' || req.query.noLeidas === 'true';
  res.json({ ok: true, ...(await notif.bandeja(req.usuario.id, { soloNoLeidas, pagina: req.query.pagina, porPagina: req.query.porPagina })) });
}));

asistenteRouter.get('/notificaciones/contador', asyncHandler(async (req, res) => {
  res.json({ ok: true, noLeidas: await notif.contarNoLeidas(req.usuario.id) });
}));

asistenteRouter.post('/notificaciones/:id/leer', asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await notif.marcarLeida(req.usuario.id, Number(req.params.id))) });
}));

asistenteRouter.post('/notificaciones/leer-todas', asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await notif.marcarTodasLeidas(req.usuario.id)) });
}));
