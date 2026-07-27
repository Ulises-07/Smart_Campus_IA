import './_silencio.js';
/**
 * Pruebas de material didáctico y finanzas — Fase 5.
 * Ejecuta:  npm run probar:finanzas
 *
 * Los bloques que importan:
 *   - 2: un .exe renombrado a .pdf es rechazado (validación por bytes).
 *   - 3: el material no es accesible por URL directa ni por otro rol.
 *   - 5-7: el dinero cuadra al céntimo, no se sobrepaga, y anular reajusta.
 *
 * Todo con marcas _zz5 y se borra al final.
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
const casi = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;

function cliente() {
  const cookies = new Map();
  const cab = () => {
    const h = { Origin: base };
    if (cookies.size) h.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    return h;
  };
  const guardarCookies = (r) => {
    for (const sc of r.headers.getSetCookie?.() ?? []) {
      const [par] = sc.split(';'); const i = par.indexOf('='); const v = par.slice(i + 1);
      if (!v || /Expires=Thu, 01 Jan 1970/i.test(sc)) cookies.delete(par.slice(0, i));
      else cookies.set(par.slice(0, i), v);
    }
  };
  return {
    cookies,
    async json(m, ruta, cuerpo) {
      const h = cab();
      if (cuerpo) h['Content-Type'] = 'application/json';
      const r = await fetch(base + ruta, { method: m, headers: h, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
      guardarCookies(r);
      return { estado: r.status, datos: await r.json().catch(() => ({})) };
    },
    async subir(ruta, campos, archivo) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(campos)) fd.append(k, v);
      if (archivo) fd.append('archivo', new Blob([archivo.buffer], { type: archivo.tipo }), archivo.nombre);
      const r = await fetch(base + ruta, { method: 'POST', headers: cab(), body: fd });
      guardarCookies(r);
      return { estado: r.status, datos: await r.json().catch(() => ({})) };
    },
    async crudo(ruta) {
      const r = await fetch(base + ruta, { headers: cab() });
      return { estado: r.status, tipo: r.headers.get('content-type'), buffer: Buffer.from(await r.arrayBuffer()) };
    },
    get: function (r) { return this.json('GET', r); },
    post: function (r, c) { return this.json('POST', r, c); },
    patch: function (r, c) { return this.json('PATCH', r, c); },
    del: function (r) { return this.json('DELETE', r); },
  };
}

const CLAVE = 'PruebaSegura2026';
async function crearUsuario(nombre, rol, personaId = null) {
  const [ro] = await q('SELECT id FROM rol WHERE codigo = ?', [rol]);
  const hash = await bcrypt.hash(CLAVE, env.BCRYPT_COST);
  let pid = personaId;
  if (!pid) pid = (await q('INSERT INTO persona (primer_nombre, primer_apellido) VALUES (?,?)', ['ZZ5', nombre])).insertId;
  const ru = await q('INSERT INTO usuario (persona_id, rol_id, usuario, password_hash, debe_cambiar_password) VALUES (?,?,?,?,0)', [pid, ro.id, nombre, hash]);
  return { id: ru.insertId, personaId: pid };
}

// PDF mínimo válido (empieza con %PDF-).
const pdfValido = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
// "exe" simulado: firma MZ, lo que un ejecutable Windows lleva al inicio.
const exeMalicioso = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(200, 0x90)]);

async function limpiar() {
  const secs = await q("SELECT id FROM seccion WHERE letra = 'V'");
  for (const s of secs) {
    const cls = await q('SELECT id FROM clase WHERE seccion_id = ?', [s.id]);
    for (const c of cls) {
      await q('DELETE FROM material WHERE clase_id = ?', [c.id]);
      await q('DELETE FROM inscripcion WHERE clase_id = ?', [c.id]);
    }
    await q('DELETE FROM clase WHERE seccion_id = ?', [s.id]);
    const mats = await q('SELECT alumno_id FROM matricula WHERE seccion_id = ?', [s.id]);
    for (const m of mats) {
      await q('DELETE FROM pago WHERE cargo_id IN (SELECT id FROM cargo WHERE alumno_id = ?)', [m.alumno_id]);
      await q('DELETE FROM cargo WHERE alumno_id = ?', [m.alumno_id]);
    }
    await q('DELETE FROM matricula WHERE seccion_id = ?', [s.id]);
    await q('DELETE FROM seccion WHERE id = ?', [s.id]);
  }
  await q("DELETE FROM alumno WHERE codigo LIKE '_ZZ5%'");
  const us = await q("SELECT id, persona_id FROM usuario WHERE usuario LIKE '_zz5_%'");
  for (const u of us) {
    await q('DELETE FROM sesion_refresh WHERE usuario_id = ?', [u.id]);
    await q('UPDATE clase SET maestro_id = NULL WHERE maestro_id = ?', [u.id]);
    await q('DELETE FROM usuario WHERE id = ?', [u.id]);
  }
  await q("DELETE FROM persona WHERE primer_nombre = 'ZZ5'");
}

async function main() {
  console.log('\n=== Pruebas de material y finanzas ===');
  await limpiar();

  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    const uAdmin = await crearUsuario('_zz5_admin', 'ADMIN');
    const uMaestro = await crearUsuario('_zz5_maestro', 'MAESTRO');
    const uOtro = await crearUsuario('_zz5_otro', 'MAESTRO');

    const admin = cliente();
    await admin.post('/api/auth/login', { usuario: '_zz5_admin', password: CLAVE });
    const maestro = cliente();
    await maestro.post('/api/auth/login', { usuario: '_zz5_maestro', password: CLAVE });

    const ctx = (await admin.get('/api/contexto')).datos;
    const grado = ctx.catalogos.grados[0];
    const asig = ctx.catalogos.asignaturas[0];

    const secV = (await admin.post('/api/secciones', { gradoId: grado.id, letra: 'V', cupoMaximo: 30 })).datos.id;
    await admin.post(`/api/secciones/${secV}/clases`, { asignaturas: [{ asignaturaId: asig.id, maestroId: uMaestro.id }] });
    const clase = (await admin.get(`/api/secciones/${secV}/clases`)).datos.clases[0];

    const alumno = (await admin.post('/api/alumnos', {
      codigo: '_ZZ5-0001', primerNombre: 'ZZ5', primerApellido: 'Pagador',
    })).datos.alumno;
    await admin.post('/api/matriculas', { alumnoId: alumno.id, seccionId: secV });

    // ================================================================
    seccion('1. Subir material valido');

    let r = await maestro.subir(`/api/clases/${clase.id}/material`,
      { titulo: 'Guia de estudio', descripcion: 'Unidad 1' },
      { buffer: pdfValido, nombre: 'guia.pdf', tipo: 'application/pdf' });
    const materialId = r.datos.id;
    r.estado === 201 ? ok('PDF valido subido', `${r.datos.tamano} bytes`) : falla('Subir PDF', JSON.stringify(r.datos));

    // ================================================================
    seccion('2. Rechazo de archivo disfrazado');

    r = await maestro.subir(`/api/clases/${clase.id}/material`,
      { titulo: 'Virus disfrazado' },
      { buffer: exeMalicioso, nombre: 'tarea.pdf', tipo: 'application/pdf' });
    r.estado === 400
      ? ok('Un .exe renombrado a .pdf es RECHAZADO', 'validacion por bytes, no por extension')
      : falla('Se acepto un ejecutable disfrazado de PDF', `estado ${r.estado}`);

    r = await maestro.subir(`/api/clases/${clase.id}/material`,
      { titulo: 'Script' },
      { buffer: Buffer.from('#!/bin/bash\nrm -rf /'), nombre: 'malo.sh', tipo: 'application/pdf' });
    r.estado === 400 ? ok('Extension .sh no permitida', r.datos.mensaje?.slice(0, 50)) : falla('Se acepto un .sh', r.estado);

    // ================================================================
    seccion('3. El material no se sirve por URL directa');

    // Averiguar el nombre en disco.
    const [mat] = await q('SELECT nombre_servidor, clase_id FROM material WHERE id = ?', [materialId]);

    // Intento de acceso directo al archivo estático: debe fallar (fuera de /public).
    r = await admin.crudo(`/storage/uploads/${mat.clase_id}/${mat.nombre_servidor}`);
    r.estado === 404
      ? ok('El archivo NO es accesible como estatico', 'esta fuera del webroot')
      : falla('El archivo se sirvio directamente', `estado ${r.estado}`);

    // Descarga por el endpoint: el maestro dueño sí puede.
    r = await maestro.crudo(`/api/material/${materialId}/descargar`);
    r.estado === 200 && r.buffer.slice(0, 5).toString() === '%PDF-'
      ? ok('Descarga por el endpoint entrega el PDF real')
      : falla('La descarga autorizada fallo', `estado ${r.estado}`);

    // Otro maestro (no dueño de la clase): 404.
    const otro = cliente();
    await otro.post('/api/auth/login', { usuario: '_zz5_otro', password: CLAVE });
    r = await otro.crudo(`/api/material/${materialId}/descargar`);
    r.estado === 404
      ? ok('Un maestro ajeno NO puede descargar el material', '404, no revela que existe')
      : falla('Un maestro ajeno descargo material', `estado ${r.estado}`);

    // El alumno inscrito SÍ puede (puede ver la clase).
    const [pa] = await q('SELECT persona_id FROM alumno WHERE id = ?', [alumno.id]);
    await crearUsuario('_zz5_alumno', 'ALUMNO', pa.persona_id);
    const cAlumno = cliente();
    await cAlumno.post('/api/auth/login', { usuario: '_zz5_alumno', password: CLAVE });
    r = await cAlumno.crudo(`/api/material/${materialId}/descargar`);
    r.estado === 200 ? ok('El alumno inscrito SI puede descargar') : falla('El alumno no pudo descargar', r.estado);

    // ================================================================
    seccion('4. Borrado de material');

    r = await otro.del(`/api/material/${materialId}`);
    r.estado === 404 ? ok('Un maestro ajeno NO puede borrar el material') : falla('Se borro material ajeno', r.estado);

    r = await maestro.del(`/api/material/${materialId}`);
    r.estado === 200 ? ok('El maestro dueno borra su material') : falla('El maestro no pudo borrar', r.estado);

    // ================================================================
    seccion('5. Generar cargos y estado de cuenta');

    r = await admin.post(`/api/alumnos/${alumno.id}/generar-cargos`, { meses: [2, 3, 4] });
    r.datos.creados === 4
      ? ok('Cargos generados', 'matricula + 3 mensualidades')
      : falla('Generacion de cargos', JSON.stringify(r.datos));

    r = await admin.get(`/api/alumnos/${alumno.id}/estado-cuenta`);
    const ec = r.datos;
    // matricula 1500 + 3*900 = 4200
    casi(ec.resumen.totalCargado, 4200)
      ? ok('Estado de cuenta cuadra', `total ${ec.resumen.totalCargado}, saldo ${ec.resumen.totalSaldo}`)
      : falla('El total no cuadra', JSON.stringify(ec.resumen));

    // ================================================================
    seccion('6. Pagos');

    const cargoMatricula = ec.cargos.find((c) => c.tipo === 'matricula');

    r = await admin.post('/api/pagos', { cargoId: cargoMatricula.id, monto: 1500, metodo: 'efectivo' });
    r.estado === 201 && r.datos.numeroRecibo
      ? ok('Pago registrado con recibo', r.datos.numeroRecibo)
      : falla('Registrar pago', JSON.stringify(r.datos));

    const pagoId = r.datos.pagoId;

    // Sobrepago: rechazado.
    r = await admin.post('/api/pagos', { cargoId: cargoMatricula.id, monto: 100 });
    r.estado === 400 && r.datos.codigo === 'PAGO_EXCEDE_SALDO'
      ? ok('Un pago que excede el saldo es rechazado', 'la matricula ya esta saldada')
      : falla('Se acepto un sobrepago', `estado ${r.estado}`);

    // El cargo quedó pagado.
    r = await admin.get(`/api/alumnos/${alumno.id}/estado-cuenta`);
    const matriculaPagada = r.datos.cargos.find((c) => c.tipo === 'matricula');
    matriculaPagada.estado === 'pagado' && casi(matriculaPagada.saldo, 0)
      ? ok('El cargo pagado queda saldado', 'saldo 0')
      : falla('El cargo no se marco como pagado', JSON.stringify(matriculaPagada));

    // Pago parcial de una mensualidad.
    const mensualidad = r.datos.cargos.find((c) => c.tipo === 'mensualidad');
    r = await admin.post('/api/pagos', { cargoId: mensualidad.id, monto: 400 });
    r.datos.saldoRestante && casi(r.datos.saldoRestante, 500)
      ? ok('Pago parcial deja saldo correcto', `900 - 400 = ${r.datos.saldoRestante}`)
      : falla('Saldo tras pago parcial', JSON.stringify(r.datos));

    // ================================================================
    seccion('7. Anular pago');

    r = await admin.post(`/api/pagos/${pagoId}/anular`, { motivo: 'Prueba de anulacion' });
    r.estado === 200 ? ok('Pago anulado') : falla('Anular pago', JSON.stringify(r.datos));

    r = await admin.get(`/api/alumnos/${alumno.id}/estado-cuenta`);
    const matriculaTrasAnular = r.datos.cargos.find((c) => c.tipo === 'matricula');
    matriculaTrasAnular.estado === 'pendiente' && casi(matriculaTrasAnular.saldo, 1500)
      ? ok('Al anular, el cargo vuelve a pendiente', 'el saldo se recompone')
      : falla('El estado no se reajusto tras anular', JSON.stringify(matriculaTrasAnular));

    // El pago sigue existiendo, marcado como anulado (no se borra).
    const [pagoAnulado] = await q('SELECT anulado FROM pago WHERE id = ?', [pagoId]);
    pagoAnulado?.anulado === 1 ? ok('El pago anulado NO se borra', 'queda el rastro contable') : falla('El pago se borro');

    // ================================================================
    seccion('8. Permisos de finanzas');

    r = await maestro.get(`/api/alumnos/${alumno.id}/estado-cuenta`);
    r.estado === 404 ? ok('El maestro NO ve el estado de cuenta de un alumno ajeno') : falla('El maestro vio finanzas ajenas', r.estado);

    r = await maestro.post('/api/pagos', { cargoId: mensualidad.id, monto: 100 });
    r.estado === 403 ? ok('El maestro NO puede registrar pagos') : falla('El maestro registro un pago', r.estado);

    r = await cAlumno.get(`/api/alumnos/${alumno.id}/estado-cuenta`);
    r.estado === 200 ? ok('El alumno ve su propio estado de cuenta') : falla('El alumno no vio lo suyo', r.estado);

    r = await cAlumno.post('/api/pagos', { cargoId: mensualidad.id, monto: 100 });
    r.estado === 403 ? ok('El alumno NO puede registrar pagos') : falla('El alumno registro un pago', r.estado);

    // ================================================================
    seccion('9. Mora');

    // Cargo vencido hace tiempo, para forzar la mora.
    const anio = ctx.anioLectivo;
    await q("UPDATE cargo SET fecha_vencimiento = '2026-01-01', estado = 'pendiente', monto_mora = 0 WHERE id = ?", [mensualidad.id]);
    r = await admin.post('/api/finanzas/aplicar-mora');
    r.datos.aplicados >= 1 ? ok('Mora aplicada a cargos vencidos', `${r.datos.aplicados} cargo(s), ${r.datos.moraPct}%`) : falla('No se aplico mora', JSON.stringify(r.datos));

    const [conMora] = await q('SELECT monto_mora, estado FROM cargo WHERE id = ?', [mensualidad.id]);
    casi(conMora.monto_mora, 45) && conMora.estado === 'mora'
      ? ok('Mora del 5% sobre 900 = 45.00', 'y el cargo pasa a estado mora')
      : falla('La mora mal calculada', JSON.stringify(conMora));

    // Idempotencia: correr de nuevo no duplica la mora.
    r = await admin.post('/api/finanzas/aplicar-mora');
    const [moraDoble] = await q('SELECT monto_mora FROM cargo WHERE id = ?', [mensualidad.id]);
    casi(moraDoble.monto_mora, 45) ? ok('Aplicar mora dos veces NO la duplica', 'idempotente') : falla('La mora se duplico', moraDoble.monto_mora);

    // ================================================================
    seccion('10. Reporte de morosidad y auditoria');

    r = await admin.get('/api/finanzas/morosidad');
    Array.isArray(r.datos.morosos)
      ? ok('Reporte de morosidad generado', `${r.datos.morosos.length} alumno(s) con saldo`)
      : falla('Reporte de morosidad', JSON.stringify(r.datos).slice(0, 80));

    const [audPago] = await q("SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'pago' AND fecha_hora > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)");
    audPago.n > 0 ? ok('Los pagos quedaron auditados', `${audPago.n} eventos`) : falla('No se auditaron los pagos');
  } finally {
    await limpiar();
    servidor.close();
    await pool.end();
  }

  console.log('\n' + '='.repeat(58));
  console.log(fallaron === 0
    ? `${VERDE}Las ${pasaron} pruebas pasaron.${RESET}`
    : `${ROJO}${fallaron} prueba(s) fallaron${RESET}, ${pasaron} pasaron.`);
  console.log('Los datos de prueba fueron eliminados.');
  console.log('='.repeat(58) + '\n');
  process.exit(fallaron === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('\nError inesperado:', e.stack ?? e.message);
  try { await limpiar(); await pool.end(); } catch { /* ya cerrado */ }
  process.exit(1);
});
