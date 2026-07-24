/**
 * Protección contra CSRF y manejo de cookies de sesión.
 *
 * Al guardar los tokens en cookies, el navegador los envía solo por estar
 * presentes. Sin una defensa, una página maliciosa abierta en otra pestaña
 * podría enviar POST a /api/... y el navegador adjuntaría la sesión.
 *
 * Aquí se usan dos barreras que se refuerzan:
 *
 *   1. SameSite=Strict en las cookies. El navegador no las manda en
 *      peticiones originadas por otro sitio.
 *   2. Verificación de Origin/Referer en toda petición que modifique datos.
 *      Cubre navegadores viejos y configuraciones raras.
 *
 * No se usa un token CSRF de doble envío porque, en un sistema de red local
 * sin terceros, estas dos barreras ya cubren el escenario y añadir una tercera
 * complicaría el frontend sin ganancia real.
 */
import { env, esProduccion } from '../config/env.js';
import { AppError } from './error.js';
import { MS_ACCESO, MS_REFRESCO } from '../services/auth.service.js';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function verificarOrigen(req, res, next) {
  if (METODOS_SEGUROS.has(req.method)) return next();

  const origen = req.get('origin') || req.get('referer');

  // Sin Origin ni Referer: puede ser una herramienta legítima (curl durante el
  // desarrollo). En producción se rechaza.
  if (!origen) {
    if (esProduccion) {
      return next(new AppError('Origen no verificable.', 403, 'ORIGEN_AUSENTE'));
    }
    return next();
  }

  let host;
  try {
    host = new URL(origen).host;
  } catch {
    return next(new AppError('Origen malformado.', 403, 'ORIGEN_INVALIDO'));
  }

  if (host !== req.get('host')) {
    return next(new AppError('Peticion de origen no permitido.', 403, 'ORIGEN_NO_PERMITIDO'));
  }

  next();
}

const baseCookie = {
  httpOnly: true,          // el JavaScript de la página no puede leerla: neutraliza el XSS
  sameSite: 'strict',      // no se envía desde otros sitios: neutraliza el CSRF
  secure: env.HTTPS_ENABLED,
  path: '/',
};

export function ponerCookiesSesion(res, { acceso, refresco }) {
  res.cookie('acceso', acceso, { ...baseCookie, maxAge: MS_ACCESO });
  res.cookie('refresco', refresco, {
    ...baseCookie,
    maxAge: MS_REFRESCO,
    // La cookie de refresco solo viaja hacia la ruta que la necesita. Si algún
    // día aparece un fallo en otro endpoint, esta cookie ni siquiera llega ahí.
    path: '/api/auth',
  });
}

export function borrarCookiesSesion(res) {
  res.clearCookie('acceso', { ...baseCookie });
  res.clearCookie('refresco', { ...baseCookie, path: '/api/auth' });
}
