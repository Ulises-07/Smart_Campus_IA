/**
 * Completa la asistencia del I Parcial hasta el 10 de abril de 2026.
 * Ejecuta:  npm run asistencia:completar
 *
 * La demo original generaba asistencia solo de las primeras semanas y para una
 * muestra de clases. Este script la completa: recorre TODAS las clases y todos
 * los días hábiles del 2 de febrero al 10 de abril, e inserta la asistencia que
 * falte. No duplica: si una clase ya tiene registro en una fecha, la respeta.
 *
 * Es seguro re-ejecutarlo. No borra nada.
 */
import './_silencio.js';
import { pool, q } from '../src/config/db.js';

const INICIO = '2026-02-02';
const FIN = '2026-04-10';

function diasHabiles(desde, hasta) {
  const dias = [];
  const d = new Date(desde + 'T00:00:00Z');
  const fin = new Date(hasta + 'T00:00:00Z');
  while (d <= fin) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) dias.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dias;
}

async function main() {
  console.log('\n=== Completar asistencia del I Parcial (2 feb – 10 abr) ===\n');

  const fechas = diasHabiles(INICIO, FIN);
  console.log(`Días hábiles a cubrir: ${fechas.length}`);

  // Clases con sus alumnos inscritos.
  const clases = await q('SELECT id FROM clase WHERE anio_lectivo_id = (SELECT id FROM anio_lectivo WHERE estado = \'activo\' LIMIT 1)');
  console.log(`Clases: ${clases.length}`);

  let insertados = 0, yaExistian = 0;

  for (const cl of clases) {
    // Alumnos inscritos en esta clase. La "aptitud" no se guarda en la base
    // (solo existe al generar la demo), así que aquí asignamos una al vuelo por
    // alumno para que unos falten más que otros, igual que en la demo original.
    const alumnos = await q(
      `SELECT a.id
         FROM inscripcion i JOIN alumno a ON a.id = i.alumno_id
        WHERE i.clase_id = ? AND i.estado = 'activa'`,
      [cl.id]
    );
    if (!alumnos.length) continue;

    // Aptitud estable por alumno dentro de esta corrida (entre 55 y 95).
    const aptitudDe = new Map(alumnos.map((a) => [a.id, 55 + Math.floor(Math.random() * 40)]));

    // Fechas que ESTA clase ya tiene registradas (para no duplicar).
    const yaReg = await q(
      `SELECT DISTINCT DATE_FORMAT(fecha, '%Y-%m-%d') AS f FROM asistencia WHERE clase_id = ?`,
      [cl.id]
    );
    const registradas = new Set(yaReg.map((r) => r.f));

    for (const iso of fechas) {
      if (registradas.has(iso)) { yaExistian += alumnos.length; continue; }

      const valores = [];
      const params = [];
      for (const a of alumnos) {
        const aptitud = aptitudDe.get(a.id);
        const r = Math.random();
        const riesgo = (100 - aptitud) / 400;
        let estado = 'presente';
        if (r < riesgo) estado = 'ausente';
        else if (r < riesgo + 0.05) estado = 'tarde';
        else if (r < riesgo + 0.07) estado = 'justificado';
        valores.push('(?,?,?,?)');
        params.push(cl.id, a.id, iso, estado);
      }
      await q(`INSERT INTO asistencia (clase_id, alumno_id, fecha, estado) VALUES ${valores.join(',')}`, params);
      insertados += alumnos.length;
    }
  }

  console.log(`\nRegistros nuevos insertados: ${insertados.toLocaleString()}`);
  console.log(`Ya existían (respetados):    ${yaExistian.toLocaleString()}`);
  console.log('Asistencia del I Parcial completa hasta el 10 de abril.\n');

  await pool.end();
}

main().catch(async (e) => {
  console.error('\nFallo:', e.sqlMessage ?? e.message);
  await pool.end();
  process.exit(1);
});
