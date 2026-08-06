/**
 * Videovigilancia — capa de gobernanza.
 *
 * IMPORTANTE: este módulo NO captura ni procesa video. Modela el control del
 * ciclo de vida de las grabaciones —dónde se puede grabar, quién consintió,
 * cuánto se retiene y quién accede— que es la parte que protege a los menores.
 *
 * Las reglas que aquí se hacen cumplir están escritas en:
 *   docs/FASE-8-consentimiento.md
 *   docs/FASE-8-retencion.md
 *
 * Nada de esto hace reconocimiento facial, seguimiento ni analítica de
 * conducta. Esas ausencias son decisiones de diseño.
 */
import { q, transaccion } from '../config/db.js';
import { AppError } from '../middleware/error.js';

// Patrón de zonas prohibidas, además del ENUM y el trigger de la base.
// Defensa en profundidad: se valida en tres capas.
const ZONA_PROHIBIDA = /ba(n|ñ)o|servicio sanitario|vestidor|vestuario|cambio|enfermer|medic|lactancia/i;

async function config() {
  const filas = await q(
    "SELECT clave, valor FROM config_sistema WHERE clave IN ('video.retencion_dias','video.retencion_evidencia_dias')"
  );
  const m = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  return {
    dias: Number(m['video.retencion_dias'] ?? 30),
    diasEvidencia: Number(m['video.retencion_evidencia_dias'] ?? 180),
  };
}

// ============================================================================
// CÁMARAS
// ============================================================================

export async function listarCamaras() {
  return q(
    `SELECT c.id, c.codigo, c.nombre, c.zona, c.tipo_zona, c.retencion_dias, c.activa, c.fecha_instalacion,
            (SELECT COUNT(*) FROM grabacion g WHERE g.camara_id = c.id AND g.purgada = 0) AS grabaciones_vigentes
       FROM camara c ORDER BY c.codigo`
  );
}

export async function crearCamara({ codigo, nombre, zona, tipoZona, retencionDias, fechaInstalacion }, ctx) {
  // Primera capa de defensa (además del ENUM y el trigger): nunca se registra
  // una cámara en una zona con expectativa de intimidad. Se revisan el nombre
  // Y la zona: alguien podría poner "baño" en cualquiera de los dos campos.
  if (ZONA_PROHIBIDA.test(nombre ?? '') || ZONA_PROHIBIDA.test(zona ?? '')) {
    throw new AppError(
      'Zona prohibida: no se permiten camaras en banos, vestidores ni areas medicas.',
      400, 'ZONA_PROHIBIDA'
    );
  }

  const dup = await q('SELECT id FROM camara WHERE codigo = ?', [codigo]);
  if (dup.length) throw new AppError('Ya existe una camara con ese codigo.', 409, 'CODIGO_DUPLICADO');

  try {
    return await transaccion(async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO camara (codigo, nombre, zona, tipo_zona, retencion_dias, fecha_instalacion, creado_por)
         VALUES (?,?,?,?,?,?,?)`,
        [codigo, nombre, zona, tipoZona, retencionDias ?? null, fechaInstalacion ?? null, ctx?.usuarioId ?? null]
      );
      return { id: r.insertId };
    }, ctx);
  } catch (e) {
    // El trigger de la base también rechaza zonas prohibidas: si saltó, se
    // traduce a un mensaje claro.
    if (e.sqlState === '45000') throw new AppError(e.sqlMessage, 400, 'ZONA_PROHIBIDA');
    throw e;
  }
}

export async function cambiarEstadoCamara(id, activa, ctx) {
  const [c] = await q('SELECT id FROM camara WHERE id = ?', [id]);
  if (!c) throw new AppError('La camara no existe.', 404, 'NO_ENCONTRADO');
  await transaccion(async (conn) => {
    await conn.query('UPDATE camara SET activa = ? WHERE id = ?', [activa ? 1 : 0, id]);
  }, ctx);
  return { ok: true };
}

// ============================================================================
// CONSENTIMIENTO
// ============================================================================

/** Estado de consentimiento de todos los alumnos, con su nombre. Solo lectura agregada. */
export async function listarConsentimientos({ estado, busqueda, pagina = 1, porPagina = 40 }) {
  const where = [];
  const params = [];
  if (estado) { where.push('cv.estado = ?'); params.push(estado); }
  if (busqueda) {
    where.push('(a.codigo LIKE ? OR p.primer_nombre LIKE ? OR p.primer_apellido LIKE ?)');
    const like = `%${busqueda}%`;
    params.push(like, like, like);
  }
  const filtro = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const limite = Math.min(Number(porPagina) || 40, 100);
  const salto = (Math.max(Number(pagina) || 1, 1) - 1) * limite;

  // LEFT JOIN: los alumnos sin registro de consentimiento aparecen como 'pendiente'.
  const datos = await q(
    `SELECT a.id AS alumno_id, a.codigo,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS alumno,
            COALESCE(cv.estado, 'pendiente') AS estado,
            cv.documento_referencia, cv.decidido_en, cv.observacion
       FROM alumno a
       JOIN persona p ON p.id = a.persona_id
       LEFT JOIN consentimiento_video cv ON cv.alumno_id = a.id
       ${filtro.replace('cv.estado', "COALESCE(cv.estado,'pendiente')")}
      ORDER BY p.primer_apellido, p.primer_nombre
      LIMIT ? OFFSET ?`,
    [...params, String(limite), String(salto)]
  );

  const [{ total }] = await q(
    `SELECT COUNT(*) AS total FROM alumno a JOIN persona p ON p.id = a.persona_id
       LEFT JOIN consentimiento_video cv ON cv.alumno_id = a.id
       ${filtro.replace('cv.estado', "COALESCE(cv.estado,'pendiente')")}`,
    params
  );

  return { total, pagina: Number(pagina) || 1, porPagina: limite, datos };
}

/** Registra o actualiza el consentimiento de un alumno. Es revocable. */
export async function registrarConsentimiento({ alumnoId, estado, encargadoId, documentoReferencia, observacion }, ctx) {
  const [a] = await q('SELECT id FROM alumno WHERE id = ?', [alumnoId]);
  if (!a) throw new AppError('El alumno no existe.', 404, 'NO_ENCONTRADO');

  if (!['otorgado', 'denegado', 'pendiente'].includes(estado)) {
    throw new AppError('Estado de consentimiento invalido.', 400, 'ESTADO_INVALIDO');
  }

  await transaccion(async (conn) => {
    await conn.query(
      `INSERT INTO consentimiento_video (alumno_id, encargado_id, estado, documento_referencia, observacion, decidido_en, registrado_por)
       VALUES (?,?,?,?,?, UTC_TIMESTAMP(), ?)
       ON DUPLICATE KEY UPDATE
         encargado_id = VALUES(encargado_id), estado = VALUES(estado),
         documento_referencia = VALUES(documento_referencia), observacion = VALUES(observacion),
         decidido_en = UTC_TIMESTAMP(), registrado_por = VALUES(registrado_por)`,
      [alumnoId, encargadoId ?? null, estado, documentoReferencia ?? null, observacion ?? null, ctx?.usuarioId ?? null]
    );
  }, ctx);

  return { ok: true };
}

/** ¿El alumno tiene consentimiento otorgado? Se usa antes de cualquier acceso dirigido a él. */
export async function tieneConsentimiento(alumnoId) {
  const filas = await q("SELECT estado FROM consentimiento_video WHERE alumno_id = ?", [alumnoId]);
  return filas[0]?.estado === 'otorgado';
}

// ============================================================================
// GRABACIONES (metadatos) Y ACCESO
// ============================================================================

/** Registra una grabación calculando su fecha de expiración desde el inicio. */
export async function registrarGrabacion({ camaraId, fechaInicio, fechaFin, archivoReferencia }, ctx) {
  const [cam] = await q('SELECT id, retencion_dias FROM camara WHERE id = ?', [camaraId]);
  if (!cam) throw new AppError('La camara no existe.', 404, 'NO_ENCONTRADO');

  const cfg = await config();
  const dias = cam.retencion_dias ?? cfg.dias;

  const inicio = new Date(fechaInicio);
  const expira = new Date(inicio);
  expira.setDate(expira.getDate() + dias);

  return transaccion(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO grabacion (camara_id, fecha_inicio, fecha_fin, archivo_referencia, fecha_expiracion)
       VALUES (?,?,?,?,?)`,
      [camaraId, fechaInicio, fechaFin, archivoReferencia, expira.toISOString().slice(0, 10)]
    );
    return { id: r.insertId, fechaExpiracion: expira.toISOString().slice(0, 10), retencionDias: dias };
  }, ctx);
}

export async function listarGrabaciones({ camaraId, soloEvidencia, pagina = 1, porPagina = 40 }) {
  const where = ['g.purgada = 0'];
  const params = [];
  if (camaraId) { where.push('g.camara_id = ?'); params.push(camaraId); }
  if (soloEvidencia) where.push('g.es_evidencia = 1');

  const limite = Math.min(Number(porPagina) || 40, 100);
  const salto = (Math.max(Number(pagina) || 1, 1) - 1) * limite;

  return q(
    `SELECT g.id, g.fecha_inicio, g.fecha_fin, g.fecha_expiracion, g.es_evidencia, g.motivo_evidencia,
            c.codigo AS camara_codigo, c.zona,
            DATEDIFF(g.fecha_expiracion, CURDATE()) AS dias_restantes
       FROM grabacion g JOIN camara c ON c.id = g.camara_id
      WHERE ${where.join(' AND ')}
      ORDER BY g.fecha_inicio DESC
      LIMIT ? OFFSET ?`,
    [...params, String(limite), String(salto)]
  );
}

/**
 * Acceso a una grabación. Exige justificación y queda auditado SIEMPRE.
 * Si el acceso se dirige a identificar a un alumno concreto, exige que ese
 * alumno tenga consentimiento otorgado.
 */
export async function accederGrabacion({ grabacionId, motivo, alumnoId }, ctx) {
  if (!motivo || motivo.trim().length < 5) {
    throw new AppError('Debes indicar un motivo para acceder a la grabacion.', 400, 'MOTIVO_REQUERIDO');
  }

  const [g] = await q(
    `SELECT g.id, g.camara_id, g.fecha_inicio, g.archivo_referencia, g.purgada, c.zona, c.codigo
       FROM grabacion g JOIN camara c ON c.id = g.camara_id WHERE g.id = ?`,
    [grabacionId]
  );
  if (!g || g.purgada) throw new AppError('La grabacion no existe o ya fue purgada.', 404, 'NO_ENCONTRADO');

  // Acceso dirigido a un alumno: exige su consentimiento.
  if (alumnoId) {
    if (!(await tieneConsentimiento(alumnoId))) {
      // El intento se audita aunque se bloquee: queda constancia de que alguien
      // quiso ver a un alumno sin consentimiento.
      await q(
        "INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_nuevo, ip, origen) VALUES (?,?,'OTRO','grabacion',?,?,?,'app')",
        [ctx?.usuarioId ?? null, ctx?.rol ?? null, grabacionId,
          JSON.stringify({ evento: 'acceso_bloqueado', motivo: 'sin_consentimiento', alumnoId }), ctx?.ip ?? null]
      ).catch(() => {});
      throw new AppError('El alumno no tiene consentimiento de videovigilancia otorgado. Acceso bloqueado.', 403, 'SIN_CONSENTIMIENTO');
    }
  }

  // Acceso concedido: se audita quién, qué grabación, con qué motivo.
  await q(
    "INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_nuevo, ip, origen) VALUES (?,?,'EXPORT','grabacion',?,?,?,'app')",
    [ctx?.usuarioId ?? null, ctx?.rol ?? null, grabacionId,
      JSON.stringify({ evento: 'acceso_concedido', motivo: motivo.trim(), alumnoId: alumnoId ?? null, camara: g.codigo, zona: g.zona }),
      ctx?.ip ?? null]
  );

  return {
    ok: true,
    grabacion: { id: g.id, camara: g.codigo, zona: g.zona, fechaInicio: g.fecha_inicio, archivoReferencia: g.archivo_referencia },
    aviso: 'Este acceso quedo registrado en la auditoria.',
  };
}

/** Marca una grabación como evidencia y extiende su expiración hasta el tope. */
export async function marcarEvidencia({ grabacionId, motivo }, ctx) {
  const [g] = await q('SELECT id, fecha_inicio FROM grabacion WHERE id = ? AND purgada = 0', [grabacionId]);
  if (!g) throw new AppError('La grabacion no existe o ya fue purgada.', 404, 'NO_ENCONTRADO');
  if (!motivo || motivo.trim().length < 5) throw new AppError('Indica el motivo de la evidencia.', 400, 'MOTIVO_REQUERIDO');

  const cfg = await config();
  const inicio = new Date(g.fecha_inicio);
  const tope = new Date(inicio);
  tope.setDate(tope.getDate() + cfg.diasEvidencia);

  await transaccion(async (conn) => {
    await conn.query(
      'UPDATE grabacion SET es_evidencia = 1, motivo_evidencia = ?, fecha_expiracion = ? WHERE id = ?',
      [motivo.trim(), tope.toISOString().slice(0, 10), grabacionId]
    );
  }, ctx);

  return { ok: true, nuevaExpiracion: tope.toISOString().slice(0, 10) };
}

/**
 * Purga las grabaciones vencidas. Idempotente. Pensado para tarea diaria.
 * En producción, aquí también se borraría el archivo de video del disco.
 */
export async function purgarVencidas(ctx) {
  const vencidas = await q(
    "SELECT id, archivo_referencia FROM grabacion WHERE purgada = 0 AND fecha_expiracion < CURDATE()"
  );

  if (!vencidas.length) return { purgadas: 0 };

  await transaccion(async (conn) => {
    // En un despliegue real: aquí se elimina el archivo de video del disco antes
    // de marcar la fila. Sin video real, se elimina el registro de metadatos.
    const ids = vencidas.map((v) => v.id);
    await conn.query(
      `UPDATE grabacion SET purgada = 1, purgada_en = UTC_TIMESTAMP(), archivo_referencia = '(purgado)'
        WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    await conn.query(
      "INSERT INTO auditoria (usuario_id, rol, accion, entidad, valor_nuevo, origen) VALUES (?,?,'DELETE','grabacion',?, 'app')",
      [ctx?.usuarioId ?? null, ctx?.rol ?? 'sistema', JSON.stringify({ evento: 'purga_retencion', cantidad: vencidas.length })]
    );
  }, ctx);

  return { purgadas: vencidas.length };
}

/** Resumen para el panel: cámaras, consentimientos y grabaciones. */
export async function resumen() {
  const [[cam]] = await q('SELECT COUNT(*) AS total, SUM(activa) AS activas FROM camara').then((r) => [r]);
  const consent = await q(
    `SELECT COALESCE(cv.estado, 'pendiente') AS estado, COUNT(*) AS n
       FROM alumno a LEFT JOIN consentimiento_video cv ON cv.alumno_id = a.id
      GROUP BY COALESCE(cv.estado, 'pendiente')`
  );
  const [[grab]] = await q(
    'SELECT COUNT(*) AS vigentes, SUM(es_evidencia) AS evidencias FROM grabacion WHERE purgada = 0'
  ).then((r) => [r]);
  const [[porVencer]] = await q(
    "SELECT COUNT(*) AS n FROM grabacion WHERE purgada = 0 AND fecha_expiracion < CURDATE()"
  ).then((r) => [r]);

  const consentimiento = { otorgado: 0, denegado: 0, pendiente: 0 };
  for (const c of consent) consentimiento[c.estado] = Number(c.n);

  return {
    camaras: { total: cam.total ?? 0, activas: Number(cam.activas ?? 0) },
    consentimiento,
    grabaciones: { vigentes: grab.vigentes ?? 0, evidencias: Number(grab.evidencias ?? 0), porPurgar: porVencer.n ?? 0 },
  };
}

// ============================================================================
// DETECCIÓN EN VIVO
//
// La detección de objetos corre en el navegador del administrador con
// TensorFlow.js. El servidor no procesa video: recibe el aviso cuando la IA ya
// detectó algo, lo registra y notifica. Esto mantiene la regla de que el video
// no sale del navegador (privacidad) y el servidor solo guarda el hecho.
// ============================================================================

import { crear as crearNotificacion } from './notificacion.service.js';
import { logger } from '../config/logger.js';

/** Lista de objetos considerados peligrosos y activos, para enviar al navegador. */
export async function objetosPeligrosos() {
  return q('SELECT id, clase, etiqueta, activo FROM objeto_peligroso ORDER BY etiqueta');
}

/**
 * Solo las clases activas: lo que el navegador debe vigilar. Cada entrada trae
 * su etiqueta en español y su nivel de peligro, para colorear la alerta.
 */
export async function clasesVigiladas() {
  const filas = await q("SELECT clase, etiqueta, nivel FROM objeto_peligroso WHERE activo = 1");
  return Object.fromEntries(filas.map((f) => [f.clase, { etiqueta: f.etiqueta, nivel: f.nivel }]));
}

/** Activa o desactiva un objeto de la lista de peligrosos. */
export async function cambiarObjetoPeligroso(id, activo, ctx) {
  const r = await q('UPDATE objeto_peligroso SET activo = ? WHERE id = ?', [activo ? 1 : 0, id]);
  if (!r.affectedRows) throw new AppError('No se encontro el objeto.', 404, 'NO_ENCONTRADO');
  return { ok: true };
}

/**
 * Registra una detección enviada por el navegador y notifica a los
 * administradores. Se valida que la clase esté realmente en la lista de
 * peligrosos activos: el servidor no confía ciegamente en lo que le manda el
 * cliente.
 */
export async function registrarDeteccion({ camaraId, clase, confianza }, ctx) {
  const vigiladas = await clasesVigiladas();
  const info = vigiladas[clase];
  if (!info) {
    // La clase no está entre las vigiladas: se ignora en silencio. Evita que un
    // cliente manipulado inunde de detecciones falsas de cualquier objeto.
    throw new AppError('Objeto no vigilado.', 400, 'NO_VIGILADO');
  }
  // `info` es { etiqueta, nivel }. Extraemos el texto y el nivel por separado,
  // porque antes se guardaba el objeto entero y aparecía "[object Object]".
  const etiqueta = info.etiqueta;
  const nivel = info.nivel ?? 'alto';

  const conf = Math.max(0, Math.min(1, Number(confianza) || 0));

  // Anti-ruido: si ya hubo una detección de la misma clase en la misma cámara
  // en los últimos 10 segundos, no se duplica ni se vuelve a notificar. Un
  // objeto frente a la cámara dispara muchos fotogramas por segundo.
  const reciente = await q(
    `SELECT id FROM deteccion
      WHERE clase = ? AND (camara_id <=> ?)
        AND detectado_en > DATE_SUB(NOW(3), INTERVAL 10 SECOND)
      ORDER BY detectado_en DESC LIMIT 1`,
    [clase, camaraId ?? null]
  );
  if (reciente.length) {
    return { id: reciente[0].id, duplicada: true };
  }

  const detId = await transaccion(async (conn) => {
    const [r] = await conn.query(
      'INSERT INTO deteccion (camara_id, clase, etiqueta, nivel, confianza) VALUES (?,?,?,?,?)',
      [camaraId ?? null, clase, etiqueta, nivel, conf]
    );
    return r.insertId;
  }, ctx);

  // Notificar a todos los administradores.
  const admins = await q(
    "SELECT u.id FROM usuario u JOIN rol r ON r.id = u.rol_id WHERE r.codigo = 'ADMIN' AND u.estado = 'activo'"
  );
  let camaraNombre = 'una cámara';
  if (camaraId) {
    const [cam] = await q('SELECT nombre FROM camara WHERE id = ?', [camaraId]);
    if (cam) camaraNombre = cam.nombre;
  }
  for (const a of admins) {
    await crearNotificacion({
      usuarioId: a.id,
      tipo: 'seguridad',
      titulo: `⚠️ Objeto peligroso detectado: ${etiqueta}`,
      mensaje: `Se detectó "${etiqueta}" en ${camaraNombre} (confianza ${Math.round(conf * 100)}%). Revisa el monitoreo de inmediato.`,
      enlace: '/video.html',
    }).catch((e) => {
      // La detección ya quedó registrada; una notificación fallida no debe
      // tumbarla, pero sí debe ser visible en los logs, no silenciosa.
      logger.error({ err: e, adminId: a.id }, 'No se pudo crear la notificacion de deteccion');
    });
  }

  return { id: detId, duplicada: false, etiqueta, notificados: admins.length };
}

/** Lista de detecciones, más recientes primero. */
export async function listarDetecciones({ soloNoAtendidas = false, pagina = 1, porPagina = 50 } = {}) {
  const where = soloNoAtendidas ? 'WHERE d.atendida = 0' : '';
  const limite = Math.min(Number(porPagina) || 50, 200);
  const salto = (Math.max(Number(pagina) || 1, 1) - 1) * limite;

  const detecciones = await q(
    `SELECT d.id, d.clase, d.etiqueta, d.confianza, d.atendida, d.detectado_en,
            c.nombre AS camara_nombre, c.codigo AS camara_codigo,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS atendida_por_nombre
       FROM deteccion d
       LEFT JOIN camara c ON c.id = d.camara_id
       LEFT JOIN usuario u ON u.id = d.atendida_por
       LEFT JOIN persona p ON p.id = u.persona_id
       ${where}
      ORDER BY d.detectado_en DESC
      LIMIT ? OFFSET ?`,
    [String(limite), String(salto)]
  );

  const [{ total }] = await q(`SELECT COUNT(*) AS total FROM deteccion d ${where}`);
  const [{ sin_atender }] = await q('SELECT COUNT(*) AS sin_atender FROM deteccion WHERE atendida = 0');

  return { detecciones, total, sinAtender: Number(sin_atender) };
}

/** Marca una detección como atendida (el administrador ya la revisó). */
export async function atenderDeteccion(id, ctx) {
  const r = await q(
    'UPDATE deteccion SET atendida = 1, atendida_por = ?, atendida_en = NOW() WHERE id = ? AND atendida = 0',
    [ctx?.usuarioId ?? null, id]
  );
  if (!r.affectedRows) throw new AppError('No se encontro la deteccion o ya estaba atendida.', 404, 'NO_ENCONTRADO');
  return { ok: true };
}
