/**
 * Autenticación.
 *
 * Decisiones que conviene entender antes de tocar este archivo:
 *
 * - El token de acceso vive 15 minutos y va en una cookie httpOnly. El
 *   JavaScript de la página no puede leerlo, así que un XSS no puede robarlo.
 * - El token de refresco es aleatorio (no un JWT) y en la base solo se guarda
 *   su hash. Si alguien roba el respaldo .sql, no obtiene sesiones válidas.
 * - Cada refresco ROTA el token. Si un token ya usado vuelve a aparecer, se
 *   asume robo y se cierran todas las sesiones de esa persona.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { q, transaccion } from '../config/db.js';
import { env } from '../config/env.js';
import { hashToken, tokenAleatorio } from '../config/crypto.js';
import { AppError } from '../middleware/error.js';
import { logger } from '../config/logger.js';

// Hash de descarte para gastar el mismo tiempo cuando el usuario no existe.
// Sin esto, un login fallido responde más rápido para usuarios inexistentes y
// eso permite averiguar qué cuentas existen.
const HASH_SENUELO = '$2b$12$JpnO4X3ArUmf5Sus8/84P.DFC100KXz0sPhtkXlEtgIz0nmdqoe.S';

function ttlAMs(ttl) {
  const m = String(ttl).match(/^(\d+)([smhd])$/);
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  return { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]] * n;
}

export const MS_ACCESO = ttlAMs(env.JWT_ACCESS_TTL);
export const MS_REFRESCO = ttlAMs(env.JWT_REFRESH_TTL);

function firmarAcceso(usuario) {
  return jwt.sign(
    {
      sub: usuario.id,
      rol: usuario.rol_codigo,
      pid: usuario.persona_id,
      cambio: usuario.debe_cambiar_password ? 1 : 0,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_TTL, issuer: 'smart-campus' }
  );
}

export function verificarAcceso(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'smart-campus' });
}

async function registrarIntento(usuarioTxt, usuarioId, exitoso, ip, ua) {
  await q(
    'INSERT INTO intento_login (usuario_txt, usuario_id, exitoso, ip, user_agent) VALUES (?,?,?,?,?)',
    [usuarioTxt.slice(0, 60), usuarioId, exitoso ? 1 : 0, ip ?? null, (ua ?? '').slice(0, 255)]
  );
}

async function crearRefresco(usuarioId, ip, ua) {
  const token = tokenAleatorio();
  const expira = new Date(Date.now() + MS_REFRESCO);
  await q(
    'INSERT INTO sesion_refresh (usuario_id, token_hash, expira_en, ip, user_agent) VALUES (?,?,?,?,?)',
    [usuarioId, hashToken(token), expira, ip ?? null, (ua ?? '').slice(0, 255)]
  );
  return token;
}

/**
 * Valida credenciales y entrega los dos tokens.
 * @throws {AppError} 401 credenciales inválidas, 423 cuenta bloqueada
 */
export async function iniciarSesion({ usuario, password, ip, userAgent }) {
  const filas = await q(
    `SELECT u.id, u.persona_id, u.usuario, u.password_hash, u.estado,
            u.debe_cambiar_password, u.intentos_fallidos, u.bloqueado_hasta,
            r.codigo AS rol_codigo, r.nombre AS rol_nombre,
            p.primer_nombre, p.primer_apellido
       FROM usuario u
       JOIN rol r ON r.id = u.rol_id
       JOIN persona p ON p.id = u.persona_id
      WHERE u.usuario = ?`,
    [usuario]
  );

  const u = filas[0];

  // Usuario inexistente: se compara igual contra el señuelo para no delatar
  // por tiempo de respuesta qué cuentas existen.
  if (!u) {
    await bcrypt.compare(password, HASH_SENUELO);
    await registrarIntento(usuario, null, false, ip, userAgent);
    throw new AppError('Usuario o contrasena incorrectos.', 401, 'CREDENCIALES_INVALIDAS');
  }

  if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
    const minutos = Math.ceil((new Date(u.bloqueado_hasta) - new Date()) / 60000);
    await registrarIntento(usuario, u.id, false, ip, userAgent);
    throw new AppError(
      `Cuenta bloqueada temporalmente. Intenta de nuevo en ${minutos} minuto(s).`,
      423, 'CUENTA_BLOQUEADA'
    );
  }

  if (u.estado !== 'activo') {
    await registrarIntento(usuario, u.id, false, ip, userAgent);
    throw new AppError('La cuenta esta inactiva. Comunicate con la administracion.', 403, 'CUENTA_INACTIVA');
  }

  const coincide = await bcrypt.compare(password, u.password_hash);

  if (!coincide) {
    const intentos = u.intentos_fallidos + 1;
    const alcanzoLimite = intentos >= env.LOGIN_MAX_INTENTOS;

    await q(
      `UPDATE usuario SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?`,
      [
        alcanzoLimite ? 0 : intentos,
        alcanzoLimite ? new Date(Date.now() + env.LOGIN_BLOQUEO_MINUTOS * 60_000) : null,
        u.id,
      ]
    );
    await registrarIntento(usuario, u.id, false, ip, userAgent);

    if (alcanzoLimite) {
      logger.warn({ usuario, ip }, 'Cuenta bloqueada por intentos fallidos');
      throw new AppError(
        `Cuenta bloqueada por ${env.LOGIN_BLOQUEO_MINUTOS} minutos tras ${env.LOGIN_MAX_INTENTOS} intentos fallidos.`,
        423, 'CUENTA_BLOQUEADA'
      );
    }

    // El mensaje NO dice cuántos intentos quedan: sería información gratis
    // para quien está probando contraseñas.
    throw new AppError('Usuario o contrasena incorrectos.', 401, 'CREDENCIALES_INVALIDAS');
  }

  // --- Credenciales correctas ---
  await q(
    'UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = UTC_TIMESTAMP() WHERE id = ?',
    [u.id]
  );
  await registrarIntento(usuario, u.id, true, ip, userAgent);

  await q(
    "INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, ip, user_agent, origen) VALUES (?,?,'LOGIN','usuario',?,?,?,'app')",
    [u.id, u.rol_codigo, u.id, ip ?? null, (userAgent ?? '').slice(0, 255)]
  );

  const refresco = await crearRefresco(u.id, ip, userAgent);

  return {
    acceso: firmarAcceso(u),
    refresco,
    usuario: {
      id: u.id,
      usuario: u.usuario,
      rol: u.rol_codigo,
      rolNombre: u.rol_nombre,
      nombre: `${u.primer_nombre} ${u.primer_apellido}`,
      debeCambiarPassword: !!u.debe_cambiar_password,
    },
  };
}

/**
 * Canjea un token de refresco por uno nuevo, rotándolo.
 *
 * Si llega un token ya revocado, se asume que fue robado y reutilizado: se
 * cierran TODAS las sesiones de esa persona. Es molesto para el usuario
 * legítimo y correcto desde el punto de vista de seguridad.
 */
export async function refrescarSesion({ token, ip, userAgent }) {
  if (!token) throw new AppError('Sesion no valida.', 401, 'SIN_REFRESCO');

  const hash = hashToken(token);
  const filas = await q(
    `SELECT s.id, s.usuario_id, s.expira_en, s.revocado_en,
            u.estado, u.debe_cambiar_password, u.persona_id,
            r.codigo AS rol_codigo
       FROM sesion_refresh s
       JOIN usuario u ON u.id = s.usuario_id
       JOIN rol r ON r.id = u.rol_id
      WHERE s.token_hash = ?`,
    [hash]
  );

  const s = filas[0];
  if (!s) throw new AppError('Sesion no valida.', 401, 'REFRESCO_DESCONOCIDO');

  if (s.revocado_en) {
    logger.error({ usuarioId: s.usuario_id, ip }, 'Reuso de token de refresco: posible robo de sesion');
    await q('UPDATE sesion_refresh SET revocado_en = UTC_TIMESTAMP() WHERE usuario_id = ? AND revocado_en IS NULL', [s.usuario_id]);
    await q(
      "INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_nuevo, ip, origen) VALUES (?,'OTRO','sesion',?,?,?,'app')",
      [s.usuario_id, s.id, JSON.stringify({ evento: 'reuso_token_refresco', accion: 'todas_las_sesiones_cerradas' }), ip ?? null]
    );
    throw new AppError('Sesion invalidada por seguridad. Vuelve a iniciar sesion.', 401, 'SESION_COMPROMETIDA');
  }

  if (new Date(s.expira_en) <= new Date()) {
    throw new AppError('La sesion expiro. Vuelve a iniciar sesion.', 401, 'REFRESCO_EXPIRADO');
  }

  if (s.estado !== 'activo') {
    throw new AppError('La cuenta esta inactiva.', 403, 'CUENTA_INACTIVA');
  }

  // Rotación: el token viejo muere aquí mismo.
  await q('UPDATE sesion_refresh SET revocado_en = UTC_TIMESTAMP() WHERE id = ?', [s.id]);
  const nuevo = await crearRefresco(s.usuario_id, ip, userAgent);

  return {
    acceso: firmarAcceso({
      id: s.usuario_id,
      persona_id: s.persona_id,
      rol_codigo: s.rol_codigo,
      debe_cambiar_password: s.debe_cambiar_password,
    }),
    refresco: nuevo,
  };
}

export async function cerrarSesion({ token, usuarioId, ip }) {
  if (token) {
    await q('UPDATE sesion_refresh SET revocado_en = UTC_TIMESTAMP() WHERE token_hash = ? AND revocado_en IS NULL', [
      hashToken(token),
    ]);
  }
  if (usuarioId) {
    await q(
      "INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, ip, origen) VALUES (?,'LOGOUT','usuario',?,?,'app')",
      [usuarioId, usuarioId, ip ?? null]
    );
  }
}

/** Cierra todas las sesiones de un usuario. Se usa al cambiar contraseña. */
export async function cerrarTodasLasSesiones(usuarioId) {
  await q('UPDATE sesion_refresh SET revocado_en = UTC_TIMESTAMP() WHERE usuario_id = ? AND revocado_en IS NULL', [
    usuarioId,
  ]);
}

/**
 * Cambio de contraseña por el propio usuario.
 * Al terminar cierra todas las sesiones: si la contraseña se cambió porque
 * alguien más la sabía, esa persona debe quedar fuera.
 */
export async function cambiarPassword({ usuarioId, actual, nueva, ip, rol }) {
  const filas = await q('SELECT id, usuario, password_hash FROM usuario WHERE id = ?', [usuarioId]);
  const u = filas[0];
  if (!u) throw new AppError('Usuario no encontrado.', 404, 'NO_ENCONTRADO');

  if (!(await bcrypt.compare(actual, u.password_hash))) {
    throw new AppError('La contrasena actual no es correcta.', 401, 'PASSWORD_INCORRECTA');
  }

  validarPassword(nueva, u.usuario);

  if (await bcrypt.compare(nueva, u.password_hash)) {
    throw new AppError('La contrasena nueva debe ser distinta de la actual.', 400, 'PASSWORD_REPETIDA');
  }

  const hash = await bcrypt.hash(nueva, env.BCRYPT_COST);

  await transaccion(async (conn) => {
    await conn.query(
      'UPDATE usuario SET password_hash = ?, debe_cambiar_password = 0, password_cambiado_en = UTC_TIMESTAMP() WHERE id = ?',
      [hash, usuarioId]
    );
  }, { usuarioId, rol, ip });

  await cerrarTodasLasSesiones(usuarioId);
}

/**
 * Reglas de contraseña. Deliberadamente sencillas: exigir símbolos raros
 * empuja a la gente a escribirlas en un papel pegado al monitor. Lo que
 * de verdad importa es la longitud y que no sea adivinable.
 */
export function validarPassword(password, nombreUsuario = '') {
  const errores = [];
  const p = String(password ?? '');

  if (p.length < 10) errores.push('Debe tener al menos 10 caracteres.');
  if (p.length > 128) errores.push('No puede exceder 128 caracteres.');
  if (!/[a-zA-Z]/.test(p)) errores.push('Debe incluir al menos una letra.');
  if (!/[0-9]/.test(p)) errores.push('Debe incluir al menos un numero.');

  if (nombreUsuario && p.toLowerCase().includes(String(nombreUsuario).toLowerCase())) {
    errores.push('No puede contener tu nombre de usuario.');
  }

  const comunes = [
    '1234567890', 'contrasena', 'password123', 'qwertyuiop', 'admin12345',
    'colegio123', 'honduras123', 'smartcampus', '0123456789', 'abcd123456',
  ];
  if (comunes.some((c) => p.toLowerCase().includes(c))) {
    errores.push('Es una contrasena demasiado comun.');
  }

  if (errores.length) {
    throw new AppError('La contrasena no cumple los requisitos.', 400, 'PASSWORD_DEBIL', errores);
  }
}
