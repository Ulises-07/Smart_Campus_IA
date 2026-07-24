/**
 * Gestión de usuarios (solo administrador).
 *
 * Todo lo que escribe pasa por transaccion() con contexto, para que los
 * triggers de auditoría sepan quién actuó.
 */
import bcrypt from 'bcryptjs';
import { q, transaccion } from '../config/db.js';
import { env } from '../config/env.js';
import { cifrar, descifrar, hashBusqueda, tokenAleatorio } from '../config/crypto.js';
import { AppError } from '../middleware/error.js';
import { validarPassword, cerrarTodasLasSesiones } from './auth.service.js';

/** ¿La base ya tiene las columnas cifradas? Permite operar antes y después de la migración. */
let _cifradoDisponible = null;
async function cifradoDisponible() {
  if (_cifradoDisponible !== null) return _cifradoDisponible;
  const filas = await q(
    `SELECT column_name AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'persona' AND column_name = 'identidad_cifrada'`
  );
  _cifradoDisponible = filas.length > 0;
  return _cifradoDisponible;
}

const SELECT_BASE = `
  SELECT u.id, u.usuario, u.estado, u.debe_cambiar_password, u.ultimo_acceso,
         u.bloqueado_hasta, u.creado_en,
         r.codigo AS rol, r.nombre AS rol_nombre,
         p.id AS persona_id, p.primer_nombre, p.segundo_nombre,
         p.primer_apellido, p.segundo_apellido, p.correo, p.telefono
    FROM usuario u
    JOIN rol r ON r.id = u.rol_id
    JOIN persona p ON p.id = u.persona_id`;

function formatear(f) {
  return {
    id: f.id,
    usuario: f.usuario,
    rol: f.rol,
    rolNombre: f.rol_nombre,
    estado: f.estado,
    debeCambiarPassword: !!f.debe_cambiar_password,
    bloqueado: !!(f.bloqueado_hasta && new Date(f.bloqueado_hasta) > new Date()),
    ultimoAcceso: f.ultimo_acceso,
    creadoEn: f.creado_en,
    persona: {
      id: f.persona_id,
      nombreCompleto: [f.primer_nombre, f.segundo_nombre, f.primer_apellido, f.segundo_apellido]
        .filter(Boolean).join(' '),
      correo: f.correo,
      telefono: f.telefono,
    },
  };
}

export async function listar({ rol, estado, busqueda, pagina = 1, porPagina = 25 }) {
  const where = [];
  const params = [];

  if (rol) { where.push('r.codigo = ?'); params.push(rol); }
  if (estado) { where.push('u.estado = ?'); params.push(estado); }
  if (busqueda) {
    where.push('(u.usuario LIKE ? OR p.primer_nombre LIKE ? OR p.primer_apellido LIKE ?)');
    const like = `%${busqueda}%`;
    params.push(like, like, like);
  }

  const filtro = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const limite = Math.min(Number(porPagina) || 25, 100);
  const salto = (Math.max(Number(pagina) || 1, 1) - 1) * limite;

  const filas = await q(
    `${SELECT_BASE}${filtro} ORDER BY p.primer_apellido, p.primer_nombre LIMIT ? OFFSET ?`,
    [...params, String(limite), String(salto)]
  );

  const [{ total }] = await q(
    `SELECT COUNT(*) AS total FROM usuario u JOIN rol r ON r.id=u.rol_id JOIN persona p ON p.id=u.persona_id${filtro}`,
    params
  );

  return { total, pagina: Number(pagina) || 1, porPagina: limite, datos: filas.map(formatear) };
}

export async function obtener(id) {
  const filas = await q(`${SELECT_BASE} WHERE u.id = ?`, [id]);
  if (!filas.length) throw new AppError('Usuario no encontrado.', 404, 'NO_ENCONTRADO');
  return formatear(filas[0]);
}

/**
 * Crea persona + usuario en una sola transacción.
 * Devuelve una contraseña temporal que el administrador entrega en mano;
 * nunca se guarda en claro ni se envía por ningún canal.
 */
export async function crear(datos, ctx) {
  const { usuario, rol, primerNombre, segundoNombre, primerApellido, segundoApellido,
    identidad, correo, telefono, fechaNacimiento, sexo, direccion } = datos;

  const existe = await q('SELECT 1 FROM usuario WHERE usuario = ? LIMIT 1', [usuario]);
  if (existe.length) throw new AppError('Ese nombre de usuario ya esta en uso.', 409, 'USUARIO_DUPLICADO');

  const rolFila = await q('SELECT id FROM rol WHERE codigo = ?', [rol]);
  if (!rolFila.length) throw new AppError('Rol no valido.', 400, 'ROL_INVALIDO');

  // Contraseña temporal legible pero no adivinable. debe_cambiar_password = 1
  // obliga a reemplazarla en el primer ingreso.
  const temporal = `SC-${tokenAleatorio(4).toUpperCase()}-${new Date().getFullYear()}`;
  const hash = await bcrypt.hash(temporal, env.BCRYPT_COST);

  const usaCifrado = await cifradoDisponible();

  const id = await transaccion(async (conn) => {
    let sqlPersona, paramsPersona;

    if (usaCifrado) {
      sqlPersona = `INSERT INTO persona (identidad_cifrada, identidad_hash, primer_nombre, segundo_nombre,
                      primer_apellido, segundo_apellido, fecha_nacimiento, sexo, direccion, telefono, correo)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
      paramsPersona = [cifrar(identidad), hashBusqueda(identidad), primerNombre, segundoNombre ?? null,
        primerApellido, segundoApellido ?? null, fechaNacimiento ?? null, sexo ?? null,
        direccion ?? null, telefono ?? null, correo ?? null];
    } else {
      sqlPersona = `INSERT INTO persona (identidad, primer_nombre, segundo_nombre, primer_apellido,
                      segundo_apellido, fecha_nacimiento, sexo, direccion, telefono, correo)
                    VALUES (?,?,?,?,?,?,?,?,?,?)`;
      paramsPersona = [identidad ?? null, primerNombre, segundoNombre ?? null, primerApellido,
        segundoApellido ?? null, fechaNacimiento ?? null, sexo ?? null,
        direccion ?? null, telefono ?? null, correo ?? null];
    }

    const [rp] = await conn.query(sqlPersona, paramsPersona);

    const [ru] = await conn.query(
      `INSERT INTO usuario (persona_id, rol_id, usuario, password_hash, debe_cambiar_password, creado_por)
       VALUES (?,?,?,?,1,?)`,
      [rp.insertId, rolFila[0].id, usuario, hash, ctx?.usuarioId ?? null]
    );

    return ru.insertId;
  }, ctx);

  return { usuario: await obtener(id), passwordTemporal: temporal };
}

export async function actualizar(id, datos, ctx) {
  const actual = await obtener(id);

  const campos = [];
  const params = [];
  for (const [col, val] of Object.entries({
    primer_nombre: datos.primerNombre,
    segundo_nombre: datos.segundoNombre,
    primer_apellido: datos.primerApellido,
    segundo_apellido: datos.segundoApellido,
    correo: datos.correo,
    telefono: datos.telefono,
    direccion: datos.direccion,
  })) {
    if (val !== undefined) { campos.push(`${col} = ?`); params.push(val); }
  }

  await transaccion(async (conn) => {
    if (campos.length) {
      await conn.query(`UPDATE persona SET ${campos.join(', ')} WHERE id = ?`, [...params, actual.persona.id]);
    }
    if (datos.rol) {
      const r = await conn.query('SELECT id FROM rol WHERE codigo = ?', [datos.rol]);
      if (!r[0].length) throw new AppError('Rol no valido.', 400, 'ROL_INVALIDO');
      await conn.query('UPDATE usuario SET rol_id = ? WHERE id = ?', [r[0][0].id, id]);
    }
    if (datos.estado) {
      await conn.query('UPDATE usuario SET estado = ? WHERE id = ?', [datos.estado, id]);
    }
  }, ctx);

  // Un usuario desactivado o con rol cambiado no debe conservar su sesión
  // vigente: su token de acceso seguiría siendo válido hasta 15 minutos.
  if (datos.estado === 'inactivo' || datos.estado === 'bloqueado' || datos.rol) {
    await cerrarTodasLasSesiones(id);
  }

  return obtener(id);
}

/** Reinicia la contraseña. Devuelve la temporal para entregarla en persona. */
export async function reiniciarPassword(id, ctx) {
  await obtener(id);

  const temporal = `SC-${tokenAleatorio(4).toUpperCase()}-${new Date().getFullYear()}`;
  const hash = await bcrypt.hash(temporal, env.BCRYPT_COST);

  await transaccion(async (conn) => {
    await conn.query(
      `UPDATE usuario SET password_hash = ?, debe_cambiar_password = 1,
              intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?`,
      [hash, id]
    );
  }, ctx);

  await cerrarTodasLasSesiones(id);
  return { passwordTemporal: temporal };
}

/** Quita el bloqueo por intentos fallidos, sin cambiar la contraseña. */
export async function desbloquear(id, ctx) {
  await obtener(id);
  await transaccion(async (conn) => {
    await conn.query('UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?', [id]);
  }, ctx);
  return obtener(id);
}

/**
 * Devuelve el perfil propio, con la identidad descifrada.
 * Un usuario puede ver su propia identidad; nadie más, salvo el administrador.
 */
export async function perfil(usuarioId) {
  const u = await obtener(usuarioId);
  const usaCifrado = await cifradoDisponible();

  const filas = await q(
    usaCifrado
      ? 'SELECT identidad_cifrada AS ident FROM persona WHERE id = ?'
      : 'SELECT identidad AS ident FROM persona WHERE id = ?',
    [u.persona.id]
  );

  u.persona.identidad = usaCifrado ? descifrar(filas[0]?.ident) : filas[0]?.ident ?? null;
  return u;
}

/** Búsqueda por identidad sin descifrar la tabla completa. */
export async function buscarPorIdentidad(identidad) {
  const usaCifrado = await cifradoDisponible();
  return usaCifrado
    ? q('SELECT id, primer_nombre, primer_apellido FROM persona WHERE identidad_hash = ?', [hashBusqueda(identidad)])
    : q('SELECT id, primer_nombre, primer_apellido FROM persona WHERE identidad = ?', [identidad]);
}

export { validarPassword };
