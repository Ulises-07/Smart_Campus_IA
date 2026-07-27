import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler, AppError } from '../middleware/error.js';
import { requiereAuth, requiereRol, exigeCambioPassword, ROLES, verificarAcceso404, puedeVerAlumno } from '../middleware/auth.js';
import { contextoDe, q } from '../config/db.js';
import * as finanzas from '../services/finanzas.service.js';
import * as matricula from '../services/matricula.service.js';

export const finanzasRouter = Router();
finanzasRouter.use(requiereAuth, exigeCambioPassword);

function validar(esquema, cuerpo) {
  const r = esquema.safeParse(cuerpo);
  if (!r.success) throw new AppError('Datos invalidos.', 400, 'DATOS_INVALIDOS', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  return r.data;
}

// Quién administra dinero: admin y asesor. El maestro no toca finanzas.
const soloCaja = requiereRol(ROLES.ADMIN, ROLES.ASESOR);

// Estado de cuenta: el alumno ve el suyo; caja (admin/asesor) ve el de
// cualquiera. Un MAESTRO no ve finanzas, aunque el alumno este en su clase:
// las notas son asunto suyo, el dinero no. Por eso NO se usa puedeVerAlumno.
const puedeVerFinanzas = verificarAcceso404(async (usuario, alumnoId) => {
  if (usuario.rol === ROLES.ADMIN || usuario.rol === ROLES.ASESOR) return true;
  if (usuario.rol === ROLES.ALUMNO) {
    return (await q('SELECT 1 FROM alumno WHERE id = ? AND persona_id = ?', [alumnoId, usuario.personaId])).length > 0;
  }
  return false;
});

finanzasRouter.get('/alumnos/:id/estado-cuenta', puedeVerFinanzas, asyncHandler(async (req, res) => {
  const anio = await matricula.anioActivo();
  res.json({ ok: true, ...(await finanzas.estadoCuenta(Number(req.params.id), anio.id)) });
}));

finanzasRouter.post('/alumnos/:id/generar-cargos', soloCaja, asyncHandler(async (req, res) => {
  const anio = await matricula.anioActivo();
  const datos = validar(z.object({ meses: z.array(z.coerce.number().int().min(1).max(12)).optional() }), req.body);
  res.status(201).json({ ok: true, ...(await finanzas.generarCargos({ alumnoId: Number(req.params.id), anioLectivoId: anio.id, ...datos }, contextoDe(req))) });
}));

finanzasRouter.post('/pagos', soloCaja, asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    cargoId: z.coerce.number().int().positive(),
    monto: z.coerce.number().positive(),
    metodo: z.enum(['efectivo', 'transferencia', 'deposito', 'otro']).optional(),
    referencia: z.string().trim().max(60).optional().nullable(),
    observacion: z.string().trim().max(255).optional().nullable(),
    fechaPago: z.string().optional(),
  }), req.body);

  const r = await finanzas.registrarPago(datos, contextoDe(req));
  res.status(201).json({ ok: true, ...r, mensaje: `Pago registrado. Recibo ${r.numeroRecibo}.` });
}));

finanzasRouter.post('/pagos/:id/anular', soloCaja, asyncHandler(async (req, res) => {
  const datos = validar(z.object({ motivo: z.string().trim().min(1).max(255) }), req.body);
  res.json({ ok: true, ...(await finanzas.anularPago({ pagoId: Number(req.params.id), ...datos }, contextoDe(req))) });
}));

finanzasRouter.get('/pagos/:id/recibo', asyncHandler(async (req, res) => {
  const recibo = await finanzas.obtenerRecibo(Number(req.params.id));
  // El alumno solo ve sus propios recibos.
  if (req.usuario.rol === ROLES.ALUMNO) {
    const [propio] = await q(
      `SELECT 1 FROM pago p JOIN cargo c ON c.id = p.cargo_id
        JOIN alumno a ON a.id = c.alumno_id WHERE p.id = ? AND a.persona_id = ?`,
      [Number(req.params.id), req.usuario.personaId]
    );
    if (!propio) throw new AppError('No se encontro el recibo.', 404, 'NO_ENCONTRADO');
  }
  res.json({ ok: true, recibo });
}));

finanzasRouter.patch('/cargos/:id/ajustar', soloCaja, asyncHandler(async (req, res) => {
  const datos = validar(z.object({
    descuento: z.coerce.number().min(0).optional(),
    exonerar: z.boolean().optional(),
  }), req.body);
  res.json({ ok: true, ...(await finanzas.ajustarCargo({ cargoId: Number(req.params.id), ...datos }, contextoDe(req))) });
}));

finanzasRouter.post('/finanzas/aplicar-mora', requiereRol(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const anio = await matricula.anioActivo();
  res.json({ ok: true, ...(await finanzas.aplicarMora(anio.id, contextoDe(req))) });
}));

finanzasRouter.get('/finanzas/morosidad', soloCaja, asyncHandler(async (req, res) => {
  const anio = await matricula.anioActivo();
  res.json({ ok: true, morosos: await finanzas.reporteMorosidad(anio.id, { seccionId: req.query.seccionId ? Number(req.query.seccionId) : undefined }) });
}));
