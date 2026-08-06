/**
 * Alumnos y sus encargados.
 *
 * Todas las consultas de listado reciben el usuario que pregunta y filtran en
 * SQL, no en JavaScript. La diferencia importa: filtrar después de traer los
 * datos significa que la base ya los entregó, y basta un descuido en el
 * serializador para que se escapen.
 */
import bcrypt from 'bcryptjs';
import { q, transaccion } from '../config/db.js';
import { env } from '../config/env.js';
import { cifrar, descifrar, hashBusqueda } from '../config/crypto.js';
import { AppError } from '../middleware/error.js';
import { ROLES } from '../middleware/auth.js';

let _cifrado = null;
async function usaCifrado() {
  if (_cifrado !== null) return _cifrado;
  const f = await q(
    `SELECT column_name AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'persona' AND column_name = 'identidad_cifrada'`
  );
  _cifrado = f.length > 0;
  return _cifrado;
}

const colIdentidad = (cif) => (cif ? 'p.identidad_cifrada' : 'p.identidad');

/**
 * Restricción de visibilidad expresada como SQL.
 * Devuelve un fragmento WHERE y sus parámetros según el rol.
 */
function filtroPorRol(usuario, alias = 'a') {
  if (usuario.rol === ROLES.ADMIN || usuario.rol === ROLES.ASESOR) {
    return { sql: '1=1', params: [] };
  }

  if (usuario.rol === ROLES.MAESTRO) {
    return {
      sql: `EXISTS (SELECT 1 FROM inscripcion i JOIN clase c ON c.id = i.clase_id
                     WHERE i.alumno_id = ${alias}.id AND c.maestro_id = ? AND i.estado = 'activa')`,
      params: [usuario.id],
    };
  }

  if (usuario.rol === ROLES.ALUMNO) {
    return { sql: `${alias}.persona_id = ?`, params: [usuario.personaId] };
  }

  return { sql: '1=0', params: [] };
}

const SELECT_ALUMNO = `
  SELECT a.id, a.codigo, a.fecha_ingreso, a.estado,
         p.id AS persona_id, p.primer_nombre, p.segundo_nombre,
         p.primer_apellido, p.segundo_apellido, p.fecha_nacimiento, p.sexo,
         p.telefono, p.correo, p.direccion,
         m.id AS matricula_id, m.estado AS matricula_estado,
         s.id AS seccion_id, s.letra,
         g.id AS grado_id, g.numero AS grado_numero, g.nombre AS grado_nombre, g.nivel,
         ca.nombre AS carrera,
         al.anio
    FROM alumno a
    JOIN persona p ON p.id = a.persona_id
    LEFT JOIN matricula m ON m.alumno_id = a.id AND m.estado = 'activa'
    LEFT JOIN anio_lectivo al ON al.id = m.anio_lectivo_id
    LEFT JOIN seccion s ON s.id = m.seccion_id
    LEFT JOIN grado g ON g.id = s.grado_id
    LEFT JOIN carrera ca ON ca.id = g.carrera_id`;

function formatear(f) {
  return {
    id: f.id,
    codigo: f.codigo,
    nombreCompleto: [f.primer_nombre, f.segundo_nombre, f.primer_apellido, f.segundo_apellido]
      .filter(Boolean).join(' '),
    primerNombre: f.primer_nombre,
    segundoNombre: f.segundo_nombre,
    primerApellido: f.primer_apellido,
    segundoApellido: f.segundo_apellido,
    fechaNacimiento: f.fecha_nacimiento,
    sexo: f.sexo,
    telefono: f.telefono,
    correo: f.correo,
    direccion: f.direccion,
    fechaIngreso: f.fecha_ingreso,
    estado: f.estado,
    personaId: f.persona_id,
    matricula: f.matricula_id
      ? {
        id: f.matricula_id,
        estado: f.matricula_estado,
        anio: f.anio,
        seccionId: f.seccion_id,
        seccion: `${f.grado_numero}º ${f.letra}`,
        gradoId: f.grado_id,
        grado: f.grado_nombre,
        nivel: f.nivel,
        carrera: f.carrera,
      }
      : null,
  };
}

export async function listar(usuario, { busqueda, seccionId, gradoId, estado, anio, pagina = 1, porPagina = 30 }) {
  const filtro = filtroPorRol(usuario);
  const where = [filtro.sql];
  const params = [...filtro.params];

  if (busqueda) {
    where.push('(a.codigo LIKE ? OR p.primer_nombre LIKE ? OR p.primer_apellido LIKE ? OR p.segundo_apellido LIKE ?)');
    const like = `%${busqueda}%`;
    params.push(like, like, like, like);
  }
  if (seccionId) { where.push('m.seccion_id = ?'); params.push(seccionId); }
  if (gradoId) { where.push('s.grado_id = ?'); params.push(gradoId); }
  if (estado) { where.push('a.estado = ?'); params.push(estado); }
  if (anio) { where.push('al.anio = ?'); params.push(anio); }

  const filtroSql = ` WHERE ${where.join(' AND ')}`;
  const limite = Math.min(Number(porPagina) || 30, 100);
  const salto = (Math.max(Number(pagina) || 1, 1) - 1) * limite;

  const filas = await q(
    `${SELECT_ALUMNO}${filtroSql} ORDER BY p.primer_apellido, p.primer_nombre LIMIT ? OFFSET ?`,
    [...params, String(limite), String(salto)]
  );

  const [{ total }] = await q(
    `SELECT COUNT(DISTINCT a.id) AS total FROM alumno a
       JOIN persona p ON p.id = a.persona_id
       LEFT JOIN matricula m ON m.alumno_id = a.id AND m.estado = 'activa'
       LEFT JOIN anio_lectivo al ON al.id = m.anio_lectivo_id
       LEFT JOIN seccion s ON s.id = m.seccion_id${filtroSql}`,
    params
  );

  return { total, pagina: Number(pagina) || 1, porPagina: limite, datos: filas.map(formatear) };
}

/**
 * Detalle de un alumno. La identidad solo se descifra para quien tiene
 * derecho a verla: administración y asesoría. Un maestro necesita saber a
 * quién califica, no su número de identidad.
 */
export async function obtener(usuario, alumnoId) {
  const cif = await usaCifrado();
  const filas = await q(`${SELECT_ALUMNO} WHERE a.id = ?`, [alumnoId]);
  if (!filas.length) throw new AppError('No se encontro el alumno.', 404, 'NO_ENCONTRADO');

  const alumno = formatear(filas[0]);

  const puedeVerIdentidad =
    usuario.rol === ROLES.ADMIN ||
    usuario.rol === ROLES.ASESOR ||
    (usuario.rol === ROLES.ALUMNO && filas[0].persona_id === usuario.personaId);

  if (puedeVerIdentidad) {
    const [id] = await q(`SELECT ${colIdentidad(cif)} AS ident FROM persona p WHERE p.id = ?`, [filas[0].persona_id]);
    alumno.identidad = cif ? descifrar(id?.ident) : id?.ident ?? null;
  }

  alumno.encargados = await q(
    `SELECT e.id, e.ocupacion, e.lugar_trabajo, ae.parentesco, ae.es_principal, ae.puede_retirar,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.segundo_nombre, p.primer_apellido, p.segundo_apellido)) AS nombre,
            p.telefono, p.correo
       FROM alumno_encargado ae
       JOIN encargado e ON e.id = ae.encargado_id
       JOIN persona p ON p.id = e.persona_id
      WHERE ae.alumno_id = ?
      ORDER BY ae.es_principal DESC`,
    [alumnoId]
  );

  alumno.historial = await q(
    `SELECT m.id, al.anio, g.numero AS grado, g.nombre AS grado_nombre, s.letra, m.estado, m.fecha_matricula
       FROM matricula m
       JOIN anio_lectivo al ON al.id = m.anio_lectivo_id
       JOIN seccion s ON s.id = m.seccion_id
       JOIN grado g ON g.id = s.grado_id
      WHERE m.alumno_id = ?
      ORDER BY al.anio DESC`,
    [alumnoId]
  );

  return alumno;
}

/** Genera el siguiente código correlativo del año: 2026-0001, 2026-0002... */
async function siguienteCodigo(conn, anio) {
  const [filas] = await conn.query(
    'SELECT codigo FROM alumno WHERE codigo LIKE ? ORDER BY codigo DESC LIMIT 1',
    [`${anio}-%`]
  );
  const ultimo = filas[0] ? Number(String(filas[0].codigo).split('-')[1]) : 0;
  return `${anio}-${String(ultimo + 1).padStart(4, '0')}`;
}

/**
 * Alta de alumno con sus encargados, todo en una transacción.
 * Si falla el segundo encargado, no queda un alumno a medias.
 */
export async function crear(datos, ctx) {
  const cif = await usaCifrado();

  if (datos.identidad) {
    const dup = cif
      ? await q('SELECT id FROM persona WHERE identidad_hash = ?', [hashBusqueda(datos.identidad)])
      : await q('SELECT id FROM persona WHERE identidad = ?', [datos.identidad]);
    if (dup.length) throw new AppError('Ya existe una persona con esa identidad.', 409, 'IDENTIDAD_DUPLICADA');
  }

  const [{ anio }] = await q("SELECT anio FROM anio_lectivo WHERE estado = 'activo' LIMIT 1")
    .then((r) => (r.length ? r : [{ anio: new Date().getFullYear() }]));

  return transaccion(async (conn) => {
    const insertarPersona = async (p) => {
      const comunes = [p.primerNombre, p.segundoNombre ?? null, p.primerApellido, p.segundoApellido ?? null,
        p.fechaNacimiento ?? null, p.sexo ?? null, p.direccion ?? null, p.telefono ?? null, p.correo ?? null];

      const [r] = cif
        ? await conn.query(
          `INSERT INTO persona (identidad_cifrada, identidad_hash, primer_nombre, segundo_nombre,
             primer_apellido, segundo_apellido, fecha_nacimiento, sexo, direccion, telefono, correo)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [cifrar(p.identidad ?? null), hashBusqueda(p.identidad ?? null), ...comunes]
        )
        : await conn.query(
          `INSERT INTO persona (identidad, primer_nombre, segundo_nombre, primer_apellido,
             segundo_apellido, fecha_nacimiento, sexo, direccion, telefono, correo)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [p.identidad ?? null, ...comunes]
        );
      return r.insertId;
    };

    const personaId = await insertarPersona(datos);
    const codigo = datos.codigo || (await siguienteCodigo(conn, anio));

    const [ra] = await conn.query(
      'INSERT INTO alumno (persona_id, codigo, fecha_ingreso, estado, observaciones) VALUES (?,?,?,?,?)',
      [personaId, codigo, datos.fechaIngreso ?? new Date().toISOString().slice(0, 10), 'activo', datos.observaciones ?? null]
    );
    const alumnoId = ra.insertId;

    for (const [i, enc] of (datos.encargados ?? []).entries()) {
      let encargadoId;

      // Un encargado puede tener varios hijos en el colegio: se reutiliza el
      // registro existente en vez de duplicar a la misma persona.
      if (enc.identidad) {
        const [ya] = await conn.query(
          cif
            ? 'SELECT e.id FROM encargado e JOIN persona p ON p.id = e.persona_id WHERE p.identidad_hash = ?'
            : 'SELECT e.id FROM encargado e JOIN persona p ON p.id = e.persona_id WHERE p.identidad = ?',
          [cif ? hashBusqueda(enc.identidad) : enc.identidad]
        );
        if (ya.length) encargadoId = ya[0].id;
      }

      if (!encargadoId) {
        const pid = await insertarPersona(enc);
        const [re] = await conn.query(
          'INSERT INTO encargado (persona_id, ocupacion, lugar_trabajo) VALUES (?,?,?)',
          [pid, enc.ocupacion ?? null, enc.lugarTrabajo ?? null]
        );
        encargadoId = re.insertId;
      }

      await conn.query(
        `INSERT INTO alumno_encargado (alumno_id, encargado_id, parentesco, es_principal, puede_retirar)
         VALUES (?,?,?,?,?)`,
        [alumnoId, encargadoId, enc.parentesco ?? 'tutor', enc.esPrincipal ?? (i === 0 ? 1 : 0), enc.puedeRetirar ?? 1]
      );
    }

    // --- Acceso automático del alumno ---
    // Se le crea un usuario para que pueda entrar a ver su horario, sus pagos y
    // el asistente. El usuario es su código (ej. "2026-0264") y la contraseña
    // es temporal; el sistema lo obliga a cambiarla en el primer ingreso.
    const credenciales = await crearUsuarioAlumno(conn, {
      personaId, alumnoId, codigo, anio,
    }, ctx);

    return { id: alumnoId, codigo, credenciales };
  }, ctx);
}

/**
 * Crea el usuario de acceso de un alumno recién registrado.
 * - Usuario: el código del alumno (único y fácil de recordar).
 * - Contraseña temporal: "SC-" + código, que el alumno cambia al entrar.
 * Devuelve { usuario, passwordTemporal } para mostrárselo a quien lo registró.
 * Si por alguna razón no se puede crear (ej. rol ausente), no rompe el alta del
 * alumno: simplemente devuelve null y el usuario se puede crear luego a mano.
 */
async function crearUsuarioAlumno(conn, { personaId, codigo, anio }, ctx) {
  try {
    const [rol] = await conn.query("SELECT id FROM rol WHERE codigo = 'ALUMNO' LIMIT 1");
    if (!rol.length) return null;

    // El nombre de usuario es el código del alumno. Si ya existiera (raro),
    // se le añade un sufijo para no chocar.
    let usuario = codigo;
    const [existe] = await conn.query('SELECT id FROM usuario WHERE usuario = ?', [usuario]);
    if (existe.length) usuario = `${codigo}-${Date.now().toString().slice(-4)}`;

    // Contraseña temporal predecible pero personal. El alumno la cambia al entrar.
    const passwordTemporal = `SC-${codigo}`;
    const hash = await bcrypt.hash(passwordTemporal, env.BCRYPT_COST);

    await conn.query(
      `INSERT INTO usuario (persona_id, rol_id, usuario, password_hash, debe_cambiar_password, creado_por)
       VALUES (?,?,?,?,1,?)`,
      [personaId, rol[0].id, usuario, hash, ctx?.usuarioId ?? null]
    );

    return { usuario, passwordTemporal };
  } catch (e) {
    // No abortamos el registro del alumno por un fallo al crear su acceso.
    return null;
  }
}

export async function actualizar(alumnoId, datos, ctx) {
  const [a] = await q('SELECT persona_id FROM alumno WHERE id = ?', [alumnoId]);
  if (!a) throw new AppError('No se encontro el alumno.', 404, 'NO_ENCONTRADO');

  const mapa = {
    primer_nombre: datos.primerNombre,
    segundo_nombre: datos.segundoNombre,
    primer_apellido: datos.primerApellido,
    segundo_apellido: datos.segundoApellido,
    fecha_nacimiento: datos.fechaNacimiento,
    sexo: datos.sexo,
    direccion: datos.direccion,
    telefono: datos.telefono,
    correo: datos.correo,
  };

  const campos = [];
  const params = [];
  for (const [col, val] of Object.entries(mapa)) {
    if (val !== undefined) { campos.push(`${col} = ?`); params.push(val); }
  }

  await transaccion(async (conn) => {
    if (campos.length) {
      await conn.query(`UPDATE persona SET ${campos.join(', ')} WHERE id = ?`, [...params, a.persona_id]);
    }
    if (datos.estado) {
      await conn.query('UPDATE alumno SET estado = ? WHERE id = ?', [datos.estado, alumnoId]);
    }
    if (datos.observaciones !== undefined) {
      await conn.query('UPDATE alumno SET observaciones = ? WHERE id = ?', [datos.observaciones, alumnoId]);
    }
  }, ctx);
}

/** Búsqueda por identidad, sin descifrar la tabla completa. */
export async function buscarPorIdentidad(identidad) {
  const cif = await usaCifrado();
  return q(
    `SELECT a.id, a.codigo,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS nombre
       FROM alumno a JOIN persona p ON p.id = a.persona_id
      WHERE ${cif ? 'p.identidad_hash = ?' : 'p.identidad = ?'}`,
    [cif ? hashBusqueda(identidad) : identidad]
  );
}
