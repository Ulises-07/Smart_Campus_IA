/**
 * Autenticación y autorización.
 *
 * Van dos capas separadas, y la distinción importa:
 *
 *   requiereRol()    — "¿tu rol puede usar esta funcionalidad?"
 *   puedeVerAlumno() — "¿puedes ver los datos DE ESTE alumno en concreto?"
 *
 * La segunda es la que impide el IDOR, que es el riesgo real de un sistema
 * escolar: un alumno autenticado cambia /api/notas/451 por /api/notas/452 y lee
 * las notas de otro. El control de rol por sí solo no lo detiene, porque ambos
 * son alumnos y ambos tienen permiso para "ver notas".
 */
import { q } from '../config/db.js';
import { AppError } from './error.js';
import { verificarAcceso } from '../services/auth.service.js';

export const ROLES = { ADMIN: 'ADMIN', MAESTRO: 'MAESTRO', ASESOR: 'ASESOR', ALUMNO: 'ALUMNO' };

/**
 * Exige sesión válida. Deja en req.usuario los datos del token.
 * No consulta la base: el JWT ya trae lo necesario y dura 15 minutos.
 */
export function requiereAuth(req, res, next) {
  const token = req.cookies?.acceso;

  if (!token) {
    return next(new AppError('Necesitas iniciar sesion.', 401, 'SIN_SESION'));
  }

  try {
    const datos = verificarAcceso(token);
    req.usuario = {
      id: datos.sub,
      rol: datos.rol,
      personaId: datos.pid,
      debeCambiarPassword: datos.cambio === 1,
    };
    return next();
  } catch (e) {
    const codigo = e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO';
    return next(new AppError('Sesion expirada o invalida.', 401, codigo));
  }
}

/**
 * Mientras la contraseña temporal no se cambie, el resto del sistema queda
 * cerrado. Si no, una cuenta con contraseña conocida por el administrador
 * seguiría funcionando indefinidamente.
 */
export function exigeCambioPassword(req, res, next) {
  if (req.usuario?.debeCambiarPassword) {
    return next(
      new AppError('Debes cambiar tu contrasena antes de continuar.', 403, 'CAMBIO_PASSWORD_REQUERIDO')
    );
  }
  next();
}

/** Restringe una ruta a ciertos roles. */
export function requiereRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario) {
      return next(new AppError('Necesitas iniciar sesion.', 401, 'SIN_SESION'));
    }
    if (!roles.includes(req.usuario.rol)) {
      return next(new AppError('No tienes permiso para esta accion.', 403, 'SIN_PERMISO'));
    }
    next();
  };
}

// ============================================================================
// AUTORIZACIÓN A NIVEL DE FILA
//
// Estas funciones responden "¿este usuario puede ver este registro?".
// Los módulos de las fases 4 a 7 las usarán antes de devolver cualquier dato
// académico o financiero.
// ============================================================================

/** El administrador ve todo. Es el único con esa potestad. */
const esAdmin = (u) => u.rol === ROLES.ADMIN;

/**
 * ¿Puede este usuario acceder a los datos de este alumno?
 *
 *  - ADMIN   : sí, siempre.
 *  - ASESOR  : sí (gestiona matrícula de todos).
 *  - MAESTRO : solo si el alumno está inscrito en alguna de sus clases.
 *  - ALUMNO  : solo si es él mismo.
 */
export async function puedeVerAlumno(usuario, alumnoId) {
  if (esAdmin(usuario) || usuario.rol === ROLES.ASESOR) return true;

  if (usuario.rol === ROLES.ALUMNO) {
    const filas = await q('SELECT 1 FROM alumno WHERE id = ? AND persona_id = ? LIMIT 1', [
      alumnoId, usuario.personaId,
    ]);
    return filas.length > 0;
  }

  if (usuario.rol === ROLES.MAESTRO) {
    const filas = await q(
      `SELECT 1
         FROM inscripcion i
         JOIN clase c ON c.id = i.clase_id
        WHERE i.alumno_id = ? AND c.maestro_id = ? AND i.estado = 'activa'
        LIMIT 1`,
      [alumnoId, usuario.id]
    );
    return filas.length > 0;
  }

  return false;
}

/**
 * ¿Puede este usuario acceder a esta clase?
 *  - MAESTRO : solo la que imparte.
 *  - ALUMNO  : solo en la que está inscrito.
 */
export async function puedeVerClase(usuario, claseId) {
  if (esAdmin(usuario) || usuario.rol === ROLES.ASESOR) return true;

  if (usuario.rol === ROLES.MAESTRO) {
    const filas = await q('SELECT 1 FROM clase WHERE id = ? AND maestro_id = ? LIMIT 1', [claseId, usuario.id]);
    return filas.length > 0;
  }

  if (usuario.rol === ROLES.ALUMNO) {
    const filas = await q(
      `SELECT 1
         FROM inscripcion i
         JOIN alumno a ON a.id = i.alumno_id
        WHERE i.clase_id = ? AND a.persona_id = ? AND i.estado = 'activa'
        LIMIT 1`,
      [claseId, usuario.personaId]
    );
    return filas.length > 0;
  }

  return false;
}

/**
 * Envuelve una comprobación de fila y devuelve 404 —no 403— cuando falla.
 *
 * Es intencional: un 403 confirma que el registro existe. Un alumno que prueba
 * /api/alumnos/1 hasta /api/alumnos/999 podría deducir cuántos alumnos hay y
 * qué identificadores son válidos. Con 404 no aprende nada.
 */
export function verificarAcceso404(verificador, paramName = 'id') {
  return async (req, res, next) => {
    try {
      const id = Number(req.params[paramName]);
      if (!Number.isInteger(id) || id <= 0) {
        return next(new AppError('Identificador invalido.', 400, 'ID_INVALIDO'));
      }
      if (!(await verificador(req.usuario, id))) {
        return next(new AppError('No se encontro el recurso solicitado.', 404, 'NO_ENCONTRADO'));
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
