/**
 * Cálculo de la nota final de un alumno en una clase y periodo.
 *
 * Este archivo es el que decide si un alumno aprueba o reprueba. Cada línea
 * tiene consecuencias sobre un menor, así que la lógica es explícita y las
 * reglas vienen de config_sistema, nunca quemadas en el código.
 *
 * LA FÓRMULA (acordada en la Fase 1):
 *
 *   Para cada tipo con ponderación (Tareas, Proyectos, Exámenes):
 *     aporte = (Σ puntajes obtenidos / Σ puntajes máximos) × porcentaje
 *
 *   nota_base = Σ aportes
 *   nota_final = MIN(tope, nota_base + puntos_extra)
 *   aprobado = nota_final >= nota_minima
 *
 * El redondeo se aplica AL FINAL, una sola vez. Redondear cada aporte por
 * separado acumularía error y podría cambiar un aprobado por un reprobado.
 */
import { q } from '../config/db.js';

/** Lee la configuración de notas una vez y la cachea. */
let _config = null;
export async function configNotas(forzar = false) {
  if (_config && !forzar) return _config;

  const filas = await q(
    `SELECT clave, valor FROM config_sistema
      WHERE clave IN ('notas.minima_aprobacion','notas.decimales','notas.modo_redondeo','notas.tope_maximo')`
  );
  const m = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));

  _config = {
    minima: Number(m['notas.minima_aprobacion'] ?? 70),
    decimales: Number(m['notas.decimales'] ?? 2),
    modo: m['notas.modo_redondeo'] ?? 'DECIMALES_2',
    tope: Number(m['notas.tope_maximo'] ?? 100),
  };
  return _config;
}

/**
 * Aplica el modo de redondeo configurado.
 *
 * DECIMALES_2 → dos decimales. 69.9 se queda en 69.90 y REPRUEBA.
 * ENTERO      → al entero más cercano. 69.5 sube a 70 y APRUEBA.
 *
 * La distinción no es cosmética: es la diferencia entre aprobar y reprobar a
 * un alumno cuya nota cae justo en el borde.
 */
export function redondear(valor, config) {
  if (config.modo === 'ENTERO') return Math.round(valor);
  const factor = 10 ** config.decimales;
  return Math.round(valor * factor) / factor;
}

/**
 * Calcula la nota de un alumno en una clase y periodo, sin guardar nada.
 * Devuelve el desglose completo para poder mostrarlo y auditarlo.
 */
export async function calcular({ alumnoId, claseId, periodoId }, config = null) {
  const cfg = config ?? (await configNotas());

  // Ponderaciones definidas para esta clase y periodo.
  const ponderaciones = await q(
    `SELECT p.tipo_evaluacion_id, p.porcentaje, t.codigo, t.nombre, t.es_extra
       FROM ponderacion p
       JOIN tipo_evaluacion t ON t.id = p.tipo_evaluacion_id
      WHERE p.clase_id = ? AND p.periodo_id = ?`,
    [claseId, periodoId]
  );

  // Notas del alumno en las evaluaciones de esta clase y periodo.
  const notas = await q(
    `SELECT e.tipo_evaluacion_id, e.puntaje_maximo, e.titulo, n.puntaje
       FROM evaluacion e
       LEFT JOIN nota n ON n.evaluacion_id = e.id AND n.alumno_id = ?
      WHERE e.clase_id = ? AND e.periodo_id = ? AND e.activa = 1`,
    [alumnoId, claseId, periodoId]
  );

  const desglose = [];
  let notaBase = 0;
  let puntosExtra = 0;

  for (const pond of ponderaciones) {
    const delTipo = notas.filter((n) => n.tipo_evaluacion_id === pond.tipo_evaluacion_id);

    if (pond.es_extra) {
      // Los puntos extra se suman aparte y no entran en la ponderación.
      const suma = delTipo.reduce((s, n) => s + Number(n.puntaje ?? 0), 0);
      puntosExtra += suma;
      desglose.push({
        tipo: pond.nombre, codigo: pond.codigo, esExtra: true,
        evaluaciones: delTipo.length,
        puntosExtra: suma,
      });
      continue;
    }

    // Una evaluación sin nota cuenta como cero: el alumno no la entregó.
    const obtenido = delTipo.reduce((s, n) => s + Number(n.puntaje ?? 0), 0);
    const maximo = delTipo.reduce((s, n) => s + Number(n.puntaje_maximo), 0);

    const proporcion = maximo > 0 ? obtenido / maximo : 0;
    const aporte = proporcion * Number(pond.porcentaje);
    notaBase += aporte;

    desglose.push({
      tipo: pond.nombre, codigo: pond.codigo, esExtra: false,
      porcentaje: Number(pond.porcentaje),
      evaluaciones: delTipo.length,
      calificadas: delTipo.filter((n) => n.puntaje !== null).length,
      puntosObtenidos: Math.round(obtenido * 100) / 100,
      puntosMaximos: Math.round(maximo * 100) / 100,
      aporte: Math.round(aporte * 100) / 100,
    });
  }

  const notaFinal = redondear(Math.min(cfg.tope, notaBase + puntosExtra), cfg);
  const sumaPorcentajes = ponderaciones.filter((p) => !p.es_extra).reduce((s, p) => s + Number(p.porcentaje), 0);

  return {
    notaBase: redondear(notaBase, cfg),
    puntosExtra,
    notaFinal,
    aprobado: notaFinal >= cfg.minima,
    notaMinima: cfg.minima,
    // Si la suma de porcentajes no da 100, la nota está mal ponderada: se avisa
    // para que el maestro lo corrija, en vez de calcular sobre una base falsa.
    ponderacionCompleta: Math.abs(sumaPorcentajes - 100) < 0.01,
    sumaPorcentajes,
    desglose,
  };
}

/**
 * Calcula y GUARDA la nota consolidada del periodo.
 * Se llama al digitar notas y al cerrar el periodo.
 */
export async function consolidar(conn, { alumnoId, claseId, periodoId }, cfg) {
  const r = await calcular({ alumnoId, claseId, periodoId }, cfg);

  await conn.query(
    `INSERT INTO nota_periodo
       (alumno_id, clase_id, periodo_id, nota_final, puntos_extra, nota_minima_aplicada, aprobado, detalle_calculo)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       nota_final = VALUES(nota_final),
       puntos_extra = VALUES(puntos_extra),
       nota_minima_aplicada = VALUES(nota_minima_aplicada),
       aprobado = VALUES(aprobado),
       detalle_calculo = VALUES(detalle_calculo)`,
    [alumnoId, claseId, periodoId, r.notaFinal, r.puntosExtra, r.notaMinima,
      r.aprobado ? 1 : 0, JSON.stringify(r.desglose)]
  );

  return r;
}
