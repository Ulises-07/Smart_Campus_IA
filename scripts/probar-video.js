import './_silencio.js';
/**
 * Pruebas de videovigilancia (gobernanza) — Fase 8.
 * Ejecuta:  npm run probar:video
 *
 * Estas pruebas comprueban que las POLÍTICAS se cumplen en código, no solo en
 * los documentos:
 *   - No se puede poner una cámara en una zona prohibida (baño, vestidor).
 *   - El acceso a una grabación exige motivo y respeta el consentimiento.
 *   - La retención purga lo vencido y conserva lo vigente.
 *   - Solo el administrador entra; todo acceso queda auditado.
 *
 * Nada de esto captura video: se prueba la capa que protege a los menores.
 */
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { app } from '../src/app.js';
import { pool, q } from '../src/config/db.js';
import { env } from '../src/config/env.js';

const VERDE = '\x1b[32m', ROJO = '\x1b[31m', GRIS = '\x1b[90m', RESET = '\x1b[0m';
let pasaron = 0, fallaron = 0, base = '';
const ok = (t, d = '') => { pasaron++; console.log(`${VERDE}  OK  ${RESET} ${t}${d ? ` ${GRIS}${d}${RESET}` : ''}`); };
const falla = (t, d = '') => { fallaron++; console.log(`${ROJO} FALLA${RESET} ${t}`); if (d) console.log(`        ${GRIS}${String(d).slice(0, 160)}${RESET}`); };
const seccion = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

function cliente() {
  const cookies = new Map();
  const pedir = async (m, ruta, cuerpo) => {
    const cab = { Origin: base };
    if (cuerpo) cab['Content-Type'] = 'application/json';
    if (cookies.size) cab.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(base + ruta, { method: m, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    for (const sc of r.headers.getSetCookie?.() ?? []) {
      const [par] = sc.split(';'); const i = par.indexOf('='); const v = par.slice(i + 1);
      if (!v || /Expires=Thu, 01 Jan 1970/i.test(sc)) cookies.delete(par.slice(0, i));
      else cookies.set(par.slice(0, i), v);
    }
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  return { get: (r) => pedir('GET', r), post: (r, c) => pedir('POST', r, c), put: (r, c) => pedir('PUT', r, c), patch: (r, c) => pedir('PATCH', r, c) };
}

const CLAVE = 'PruebaSegura2026';
async function crearUsuario(nombre, rolCodigo) {
  const [rol] = await q('SELECT id FROM rol WHERE codigo = ?', [rolCodigo]);
  const hash = await bcrypt.hash(CLAVE, env.BCRYPT_COST);
  const pid = (await q('INSERT INTO persona (primer_nombre, primer_apellido) VALUES (?,?)', ['ZZ8', nombre])).insertId;
  const ru = await q('INSERT INTO usuario (persona_id, rol_id, usuario, password_hash, debe_cambiar_password) VALUES (?,?,?,?,0)', [pid, rol.id, nombre, hash]);
  return { id: ru.insertId, personaId: pid };
}

async function limpiar() {
  await q("DELETE FROM deteccion WHERE camara_id IN (SELECT id FROM camara WHERE codigo LIKE 'ZZ8%') OR clase IN ('knife','scissors','baseball bat')").catch(() => {});
  await q("DELETE FROM notificacion WHERE tipo = 'seguridad' AND creado_en > DATE_SUB(NOW(), INTERVAL 1 HOUR)").catch(() => {});
  await q("DELETE FROM grabacion WHERE camara_id IN (SELECT id FROM camara WHERE codigo LIKE 'ZZ8%')");
  await q("DELETE FROM camara WHERE codigo LIKE 'ZZ8%'");
  await q("DELETE FROM consentimiento_video WHERE alumno_id IN (SELECT id FROM alumno WHERE codigo LIKE '_ZZ8%')");
  const us = await q("SELECT id FROM usuario WHERE usuario LIKE '_zz8_%'");
  for (const u of us) { await q('DELETE FROM sesion_refresh WHERE usuario_id = ?', [u.id]); await q('DELETE FROM usuario WHERE id = ?', [u.id]); }
  await q("DELETE FROM persona WHERE primer_nombre = 'ZZ8'");
  await q("DELETE FROM auditoria WHERE entidad='grabacion' AND fecha_hora > DATE_SUB(NOW(), INTERVAL 1 HOUR)").catch(() => {});
}

async function main() {
  console.log('\n=== Pruebas de videovigilancia (gobernanza) ===');
  await limpiar();

  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    await crearUsuario('_zz8_admin', 'ADMIN');
    await crearUsuario('_zz8_maestro', 'MAESTRO');

    const admin = cliente();
    await admin.post('/api/auth/login', { usuario: '_zz8_admin', password: CLAVE });

    // ================================================================
    seccion('1. Zonas prohibidas: la primera linea de defensa');

    let r = await admin.post('/api/video/camaras', {
      codigo: 'ZZ8-BANO', nombre: 'Camara prohibida', zona: 'Bano de ninos planta baja', tipoZona: 'pasillo',
    });
    r.estado === 400 && r.datos.codigo === 'ZONA_PROHIBIDA'
      ? ok('Camara en bano RECHAZADA', 'el nombre de zona delata el area privada')
      : falla('Se permitio una camara en un bano', JSON.stringify(r.datos).slice(0, 90));

    r = await admin.post('/api/video/camaras', {
      codigo: 'ZZ8-VEST', nombre: 'Otra prohibida', zona: 'Vestidor de educacion fisica', tipoZona: 'patio',
    });
    r.estado === 400 ? ok('Camara en vestidor RECHAZADA') : falla('Se permitio camara en vestidor', r.estado);

    r = await admin.post('/api/video/camaras', {
      codigo: 'ZZ8-ENF', nombre: 'Prohibida', zona: 'Enfermeria', tipoZona: 'area_administrativa',
    });
    r.estado === 400 ? ok('Camara en enfermeria RECHAZADA', 'privacidad medica') : falla('Se permitio camara en enfermeria', r.estado);

    // El caso sutil: la palabra prohibida va en el NOMBRE, no en la zona. Una
    // validacion que solo mire "zona" dejaria pasar esto.
    r = await admin.post('/api/video/camaras', {
      codigo: 'ZZ8-BANO2', nombre: 'Camara del bano de ninos', zona: 'Bloque B', tipoZona: 'pasillo',
    });
    r.estado === 400 && r.datos.codigo === 'ZONA_PROHIBIDA'
      ? ok('Zona prohibida en el NOMBRE tambien RECHAZADA', 'se revisan ambos campos')
      : falla('Se colo una camara con "bano" en el nombre', JSON.stringify(r.datos).slice(0, 90));

    r = await admin.post('/api/video/camaras', {
      codigo: 'ZZ8-PAS1', nombre: 'Pasillo principal', zona: 'Pasillo del primer piso', tipoZona: 'pasillo',
    });
    const camaraId = r.datos.id;
    r.estado === 201 ? ok('Camara en pasillo (zona permitida) creada') : falla('No se pudo crear camara valida', JSON.stringify(r.datos));

    // ================================================================
    seccion('2. Solo el administrador entra');

    const cMaestro = cliente();
    await cMaestro.post('/api/auth/login', { usuario: '_zz8_maestro', password: CLAVE });
    r = await cMaestro.get('/api/video/camaras');
    r.estado === 403 ? ok('Un maestro NO accede a videovigilancia') : falla('El maestro accedio a video', r.estado);
    r = await cMaestro.get('/api/video/grabaciones');
    r.estado === 403 ? ok('Un maestro NO ve grabaciones') : falla('El maestro vio grabaciones', r.estado);

    // ================================================================
    seccion('3. Retencion: expiracion calculada y purga');

    // Grabacion normal: expira a los 30 dias (config por defecto).
    const hoy = new Date();
    const inicioReciente = new Date(hoy.getTime() - 2 * 86400000); // hace 2 dias
    r = await admin.post('/api/video/grabaciones', {
      camaraId, fechaInicio: inicioReciente.toISOString().slice(0, 19).replace('T', ' '),
      fechaFin: inicioReciente.toISOString().slice(0, 19).replace('T', ' '),
      archivoReferencia: 'demo/reciente.stub',
    });
    const grabReciente = r.datos.id;
    r.estado === 201 && r.datos.fechaExpiracion
      ? ok('Grabacion reciente registrada con expiracion', `vence ${r.datos.fechaExpiracion} (${r.datos.retencionDias} dias)`)
      : falla('Registro de grabacion', JSON.stringify(r.datos));

    // Grabacion ya vencida: se inserta directo con fecha de expiracion pasada.
    const inicioViejo = new Date(hoy.getTime() - 40 * 86400000);
    const expVieja = new Date(hoy.getTime() - 10 * 86400000);
    const grabVieja = (await q(
      'INSERT INTO grabacion (camara_id, fecha_inicio, fecha_fin, archivo_referencia, fecha_expiracion) VALUES (?,?,?,?,?)',
      [camaraId, inicioViejo.toISOString().slice(0, 19).replace('T', ' '), inicioViejo.toISOString().slice(0, 19).replace('T', ' '),
        'demo/vieja.stub', expVieja.toISOString().slice(0, 10)]
    )).insertId;

    // Purga: debe eliminar la vencida y conservar la reciente.
    r = await admin.post('/api/video/purgar', {});
    r.datos.purgadas >= 1 ? ok('La purga elimino la grabacion vencida', `${r.datos.purgadas} purgada(s)`) : falla('La purga no elimino nada', JSON.stringify(r.datos));

    const [[vieja]] = await q('SELECT purgada FROM grabacion WHERE id = ?', [grabVieja]).then((x) => [x]);
    vieja.purgada === 1 ? ok('La grabacion vencida quedo marcada como purgada') : falla('La vencida no se purgo');

    const [[reciente]] = await q('SELECT purgada FROM grabacion WHERE id = ?', [grabReciente]).then((x) => [x]);
    reciente.purgada === 0 ? ok('La grabacion vigente NO se purgo', 'la retencion respeta lo reciente') : falla('Se purgo una grabacion vigente');

    // Idempotencia: purgar otra vez no rompe.
    r = await admin.post('/api/video/purgar', {});
    r.estado === 200 ? ok('Purgar de nuevo es seguro (idempotente)', `${r.datos.purgadas} esta vez`) : falla('La segunda purga fallo', r.estado);

    // ================================================================
    seccion('4. Evidencia: extiende la retencion, con tope');

    r = await admin.post(`/api/video/grabaciones/${grabReciente}/evidencia`, { motivo: 'Incidente de prueba en el pasillo' });
    if (r.estado === 200 && r.datos.nuevaExpiracion) {
      ok('Grabacion marcada como evidencia', `nueva expiracion ${r.datos.nuevaExpiracion}`);
      const nueva = new Date(r.datos.nuevaExpiracion);
      const dias = Math.round((nueva - inicioReciente) / 86400000);
      dias <= 180 ? ok('La evidencia respeta el tope de 180 dias', `${dias} dias`) : falla('La evidencia excedio el tope', `${dias} dias`);
    } else {
      falla('Marcar evidencia', JSON.stringify(r.datos));
    }

    r = await admin.post(`/api/video/grabaciones/${grabReciente}/evidencia`, { motivo: 'x' });
    r.estado === 400 ? ok('Marcar evidencia sin motivo suficiente se rechaza') : falla('Se acepto evidencia sin motivo', r.estado);

    // ================================================================
    seccion('5. Consentimiento: el acceso dirigido a un alumno lo respeta');

    const [alumnoSinC] = await q("SELECT id FROM alumno LIMIT 1");
    const [alumnoConC] = await q("SELECT id FROM alumno WHERE id <> ? LIMIT 1", [alumnoSinC.id]);

    // Otorgar a uno, denegar/pendiente al otro.
    await admin.put(`/api/video/consentimientos/${alumnoConC.id}`, { estado: 'otorgado', documentoReferencia: 'DOC-001' });
    await admin.put(`/api/video/consentimientos/${alumnoSinC.id}`, { estado: 'denegado', observacion: 'La familia no autoriza' });

    // Acceso sin motivo: rechazado.
    r = await admin.post(`/api/video/grabaciones/${grabReciente}/acceder`, { motivo: 'x' });
    r.estado === 400 ? ok('Acceso sin motivo suficiente rechazado', 'un "porque si" no basta') : falla('Se accedio sin motivo', r.estado);

    // Acceso general (sin alumno): permitido y auditado.
    r = await admin.post(`/api/video/grabaciones/${grabReciente}/acceder`, { motivo: 'Revision de rutina del pasillo' });
    r.estado === 200 ? ok('Acceso general con motivo concedido', 'queda auditado') : falla('Acceso general', JSON.stringify(r.datos));

    // Acceso dirigido a un alumno CON consentimiento: permitido.
    r = await admin.post(`/api/video/grabaciones/${grabReciente}/acceder`, { motivo: 'Revisar incidente reportado', alumnoId: alumnoConC.id });
    r.estado === 200 ? ok('Acceso dirigido a alumno CON consentimiento: permitido') : falla('Se bloqueo un acceso valido', JSON.stringify(r.datos));

    // Acceso dirigido a un alumno SIN consentimiento: BLOQUEADO.
    r = await admin.post(`/api/video/grabaciones/${grabReciente}/acceder`, { motivo: 'Revisar incidente reportado', alumnoId: alumnoSinC.id });
    r.estado === 403 && r.datos.codigo === 'SIN_CONSENTIMIENTO'
      ? ok('Acceso dirigido a alumno SIN consentimiento: BLOQUEADO', 'la negativa de la familia se respeta')
      : falla('Se accedio a un alumno sin consentimiento', JSON.stringify(r.datos).slice(0, 90));

    // ================================================================
    seccion('6. Todo acceso queda auditado');

    const [[accesos]] = await q(
      "SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'grabacion' AND accion = 'EXPORT' AND fecha_hora > DATE_SUB(NOW(), INTERVAL 5 MINUTE)"
    ).then((x) => [x]);
    accesos.n >= 2 ? ok('Los accesos concedidos quedaron auditados', `${accesos.n} accesos`) : falla('No se auditaron los accesos', accesos.n);

    const [[bloqueos]] = await q(
      "SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'grabacion' AND accion = 'OTRO' AND valor_nuevo LIKE '%acceso_bloqueado%' AND fecha_hora > DATE_SUB(NOW(), INTERVAL 5 MINUTE)"
    ).then((x) => [x]);
    bloqueos.n >= 1
      ? ok('El intento bloqueado tambien quedo auditado', 'queda constancia de quien lo intento')
      : falla('El intento bloqueado no se audito', bloqueos.n);

    const [[purga]] = await q(
      "SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'grabacion' AND accion = 'DELETE' AND fecha_hora > DATE_SUB(NOW(), INTERVAL 5 MINUTE)"
    ).then((x) => [x]);
    purga.n >= 1 ? ok('La purga quedo auditada', 'la retencion es demostrable') : falla('La purga no se audito', purga.n);

    // ================================================================
    seccion('7. Resumen de gobernanza');

    r = await admin.get('/api/video/resumen');
    r.estado === 200 && r.datos.resumen?.consentimiento
      ? ok('El panel de resumen responde', `otorgados: ${r.datos.resumen.consentimiento.otorgado}, denegados: ${r.datos.resumen.consentimiento.denegado}`)
      : falla('Resumen de videovigilancia', JSON.stringify(r.datos).slice(0, 90));

    // ================================================================
    seccion('8. Deteccion en vivo: registro y notificacion');

    // La lista de objetos vigilados que se envia al navegador.
    r = await admin.get('/api/video/objetos');
    r.estado === 200 && r.datos.vigiladas && Object.keys(r.datos.vigiladas).length > 0
      ? ok('El servidor entrega la lista de objetos vigilados', Object.values(r.datos.vigiladas).join(', '))
      : falla('Lista de objetos vigilados', JSON.stringify(r.datos).slice(0, 90));

    // Un maestro no puede reportar detecciones (todo el modulo es solo admin).
    r = await cMaestro.post('/api/video/detecciones', { clase: 'knife', confianza: 0.9 });
    r.estado === 403 ? ok('Un maestro NO puede reportar detecciones') : falla('El maestro reporto una deteccion', r.estado);

    // Reportar una deteccion de cuchillo: debe registrarse y notificar al admin.
    r = await admin.post('/api/video/detecciones', { clase: 'knife', confianza: 0.87 });
    r.estado === 200 && r.datos.id && !r.datos.duplicada
      ? ok('Deteccion de cuchillo registrada', `notificados ${r.datos.notificados} admin(s)`)
      : falla('Registro de deteccion', JSON.stringify(r.datos).slice(0, 90));

    // La notificacion llego al administrador.
    const [{ n: notifSeg }] = await q("SELECT COUNT(*) AS n FROM notificacion WHERE tipo = 'seguridad' AND creado_en > DATE_SUB(NOW(), INTERVAL 2 MINUTE)");
    notifSeg > 0 ? ok('La deteccion genero una notificacion de seguridad', `${notifSeg} aviso(s)`) : falla('No se genero la notificacion de seguridad');

    // Anti-duplicados: reportar lo mismo enseguida no crea una segunda.
    r = await admin.post('/api/video/detecciones', { clase: 'knife', confianza: 0.9 });
    r.estado === 200 && r.datos.duplicada
      ? ok('Una deteccion repetida en 10s NO se duplica', 'evita inundar de avisos')
      : falla('Se duplico una deteccion inmediata', JSON.stringify(r.datos).slice(0, 90));

    // Un objeto NO vigilado se rechaza (el servidor no confia en el cliente).
    r = await admin.post('/api/video/detecciones', { clase: 'perro', confianza: 0.99 });
    r.estado === 400 && r.datos.codigo === 'NO_VIGILADO'
      ? ok('Un objeto no vigilado es rechazado', 'el servidor valida la clase')
      : falla('Se acepto un objeto no vigilado', JSON.stringify(r.datos).slice(0, 90));

    // El historial de detecciones lista lo registrado.
    r = await admin.get('/api/video/detecciones?porPagina=10');
    r.estado === 200 && r.datos.detecciones.some((d) => d.clase === 'knife')
      ? ok('El historial de detecciones muestra el cuchillo', `${r.datos.total} en total`)
      : falla('Historial de detecciones', JSON.stringify(r.datos).slice(0, 90));

    // Marcar como atendida.
    const detId = r.datos.detecciones.find((d) => d.clase === 'knife' && !d.atendida)?.id;
    if (detId) {
      r = await admin.post(`/api/video/detecciones/${detId}/atender`);
      r.estado === 200 ? ok('Una deteccion se marca como atendida') : falla('Marcar atendida', r.estado);
    } else {
      ok('Deteccion ya atendida o no pendiente', 'sin accion');
    }

    // Desactivar un objeto lo saca de la vigilancia.
    const [obj] = await q("SELECT id FROM objeto_peligroso WHERE clase = 'scissors'");
    if (obj) {
      r = await admin.patch(`/api/video/objetos/${obj.id}`, { activo: false });
      const vig = await admin.get('/api/video/objetos');
      !vig.datos.vigiladas.scissors
        ? ok('Desactivar un objeto lo saca de la vigilancia', 'la lista es configurable')
        : falla('El objeto desactivado sigue vigilado');
      await admin.patch(`/api/video/objetos/${obj.id}`, { activo: true }); // restaurar
    }
  } finally {
    await limpiar();
    servidor.close();
    await pool.end();
  }

  console.log('\n' + '='.repeat(58));
  console.log(fallaron === 0 ? `${VERDE}Las ${pasaron} pruebas pasaron.${RESET}` : `${ROJO}${fallaron} prueba(s) fallaron${RESET}, ${pasaron} pasaron.`);
  console.log('Los datos de prueba fueron eliminados.');
  console.log('='.repeat(58) + '\n');
  process.exit(fallaron === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('\nError inesperado:', e.stack ?? e.message);
  try { await limpiar(); await pool.end(); } catch { /* ya cerrado */ }
  process.exit(1);
});
