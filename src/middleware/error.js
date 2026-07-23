import { logger } from '../config/logger.js';
import { esProduccion } from '../config/env.js';

/** Error de negocio con codigo HTTP. Todo lo demas se trata como error 500. */
export class AppError extends Error {
  constructor(mensaje, estado = 400, codigo = 'ERROR_SOLICITUD', detalles = null) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
    this.esOperacional = true;
  }
}

export function noEncontrado(req, res) {
  res.status(404).json({
    ok: false,
    codigo: 'RUTA_NO_ENCONTRADA',
    mensaje: `No existe la ruta ${req.method} ${req.originalUrl}`,
  });
}

// eslint-disable-next-line no-unused-vars
export function manejadorErrores(err, req, res, _next) {
  const estado = err.estado || 500;

  if (estado >= 500) {
    logger.error({ err, url: req.originalUrl, metodo: req.method }, 'Error no controlado');
  } else {
    logger.warn({ mensaje: err.message, url: req.originalUrl }, 'Solicitud rechazada');
  }

  res.status(estado).json({
    ok: false,
    codigo: err.codigo || 'ERROR_INTERNO',
    // Nunca filtrar detalles internos al cliente en produccion.
    mensaje: estado >= 500 && esProduccion ? 'Ocurrio un error en el servidor.' : err.message,
    detalles: err.detalles ?? undefined,
  });
}

/** Envuelve controladores async para no repetir try/catch en cada ruta. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
