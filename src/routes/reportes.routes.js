import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler, AppError } from '../middleware/error.js';
import { requiereAuth, requiereRol, exigeCambioPassword, ROLES, verificarAcceso404, puedeVerAlumno } from '../middleware/auth.js';
import { q } from '../config/db.js';
import * as dashboard from '../services/dashboard.service.js';
import * as auditoria from '../services/auditoria.service.js';
import * as pdf from '../services/pdf.service.js';

export const reportesRouter = Router();
reportesRouter.use(requiereAuth, exigeCambioPassword);

// ============================================================================
// Tablero (cada rol ve el suyo)
// ============================================================================

reportesRouter.get('/tablero', asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await dashboard.tablero(req.usuario)) });
}));

// ============================================================================
// Auditoría (solo administrador) — SOLO LECTURA
// ============================================================================

const soloAdmin = requiereRol(ROLES.ADMIN);

reportesRouter.get('/auditoria', soloAdmin, asyncHandler(async (req, res) => {
  const [datos, resumen, entidades] = await Promise.all([
    auditoria.consultar(req.query),
    auditoria.resumen(),
    auditoria.entidadesDisponibles(),
  ]);
  res.json({ ok: true, ...datos, resumen, entidades });
}));

reportesRouter.get('/auditoria/:id', soloAdmin, asyncHandler(async (req, res) => {
  const ev = await auditoria.detalle(Number(req.params.id));
  if (!ev) throw new AppError('No se encontro el evento.', 404, 'NO_ENCONTRADO');
  res.json({ ok: true, evento: ev });
}));

// ============================================================================
// Documentos PDF
// ============================================================================

/** Boleta: la baja quien puede ver al alumno (admin, asesor, el propio alumno). */
reportesRouter.get('/alumnos/:id/boleta',
  verificarAcceso404(puedeVerAlumno),
  asyncHandler(async (req, res) => {
    const datos = z.object({ periodoId: z.coerce.number().int().positive() }).safeParse(req.query);
    if (!datos.success) throw new AppError('Falta el periodo.', 400, 'PERIODO_REQUERIDO');

    const { buffer, nombre } = await pdf.boletaCalificaciones({
      alumnoId: Number(req.params.id), periodoId: datos.data.periodoId,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    res.send(buffer);
  }));

/** Recibo: caja siempre; el alumno solo el suyo. */
reportesRouter.get('/pagos/:id/recibo-pdf', asyncHandler(async (req, res) => {
  const pagoId = Number(req.params.id);

  // Un alumno solo puede bajar recibos de pagos ligados a él.
  if (req.usuario.rol === ROLES.ALUMNO) {
    const filas = await q(
      `SELECT 1 FROM pago pg JOIN cargo c ON c.id = pg.cargo_id
         JOIN alumno a ON a.id = c.alumno_id
        WHERE pg.id = ? AND a.persona_id = ? LIMIT 1`,
      [pagoId, req.usuario.personaId]
    );
    if (!filas.length) throw new AppError('No se encontro el recibo.', 404, 'NO_ENCONTRADO');
  } else if (![ROLES.ADMIN, ROLES.ASESOR].includes(req.usuario.rol)) {
    // Un maestro no tiene nada que ver con recibos de pago.
    throw new AppError('No se encontro el recibo.', 404, 'NO_ENCONTRADO');
  }

  const { buffer, nombre } = await pdf.reciboPago({ pagoId });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
  res.send(buffer);
}));
