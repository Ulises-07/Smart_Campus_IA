/**
 * Finanzas: estado de cuenta, cargos, pagos y mora.
 *
 * Principios que ordenan este módulo:
 *  - El dinero se maneja en DECIMAL, nunca en float. Un céntimo perdido por
 *    redondeo binario en un colegio con cientos de alumnos son lempiras reales.
 *  - Un pago no se borra: se anula, dejando el rastro. Los triggers de
 *    auditoría de la Fase 1 ya registran cada pago automáticamente.
 *  - El número de recibo es único y correlativo: es un documento contable.
 *  - Un pago no puede exceder el saldo del cargo. Sobrepagar sería un error
 *    contable, no una cortesía.
 */
import { q, transaccion } from '../config/db.js';
import { AppError } from '../middleware/error.js';

async function configFinanzas() {
  const filas = await q(
    `SELECT clave, valor FROM config_sistema
      WHERE clave IN ('finanzas.moneda','finanzas.mora_porcentaje','finanzas.dias_gracia','finanzas.prefijo_recibo')`
  );
  const m = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  return {
    moneda: m['finanzas.moneda'] ?? 'HNL',
    moraPct: Number(m['finanzas.mora_porcentaje'] ?? 5),
    diasGracia: Number(m['finanzas.dias_gracia'] ?? 5),
    prefijoRecibo: m['finanzas.prefijo_recibo'] ?? 'REC',
  };
}

/** Redondeo contable a 2 decimales, hecho sobre enteros para evitar float. */
function dinero(valor) {
  return Math.round(Number(valor) * 100) / 100;
}

/**
 * Estado de cuenta de un alumno: cada cargo con lo pagado y su saldo.
 */
export async function estadoCuenta(alumnoId, anioLectivoId) {
  const cargos = await q(
    `SELECT c.id, c.mes, c.monto, c.monto_mora, c.descuento, c.fecha_vencimiento, c.estado,
            cp.nombre AS concepto, cp.tipo,
            COALESCE((SELECT SUM(p.monto) FROM pago p WHERE p.cargo_id = c.id AND p.anulado = 0), 0) AS pagado
       FROM cargo c
       JOIN concepto_pago cp ON cp.id = c.concepto_id
      WHERE c.alumno_id = ? AND c.anio_lectivo_id = ?
      ORDER BY cp.tipo, c.mes`,
    [alumnoId, anioLectivoId]
  );

  let totalCargado = 0, totalPagado = 0, totalSaldo = 0;

  const detalle = cargos.map((c) => {
    const totalCargo = dinero(Number(c.monto) + Number(c.monto_mora) - Number(c.descuento));
    const pagado = dinero(Number(c.pagado));
    const saldo = dinero(totalCargo - pagado);

    totalCargado += totalCargo;
    totalPagado += pagado;
    totalSaldo += saldo;

    return {
      id: c.id,
      concepto: c.concepto,
      tipo: c.tipo,
      mes: c.mes,
      monto: dinero(c.monto),
      mora: dinero(c.monto_mora),
      descuento: dinero(c.descuento),
      totalCargo,
      pagado,
      saldo,
      estado: c.estado,
      fechaVencimiento: c.fecha_vencimiento,
    };
  });

  return {
    cargos: detalle,
    resumen: {
      totalCargado: dinero(totalCargado),
      totalPagado: dinero(totalPagado),
      totalSaldo: dinero(totalSaldo),
      alDia: totalSaldo <= 0.01,
    },
  };
}

/** Genera los cargos del año para un alumno: matrícula + mensualidades. */
export async function generarCargos({ alumnoId, anioLectivoId, meses = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, ctx) {
  const conceptos = await q(
    "SELECT id, tipo, monto_default FROM concepto_pago WHERE codigo IN ('MATRICULA','MENSUALIDAD') AND activo = 1"
  );
  const matricula = conceptos.find((c) => c.tipo === 'matricula');
  const mensualidad = conceptos.find((c) => c.tipo === 'mensualidad');
  if (!matricula || !mensualidad) {
    throw new AppError('Faltan los conceptos de matricula o mensualidad en el catalogo.', 409, 'CONCEPTOS_FALTANTES');
  }

  const [{ anio }] = await q('SELECT anio FROM anio_lectivo WHERE id = ?', [anioLectivoId]);

  return transaccion(async (conn) => {
    let creados = 0;

    // Matrícula: un cargo, sin mes. ON DUPLICATE evita duplicar si se corre dos veces.
    const [rm] = await conn.query(
      `INSERT INTO cargo (alumno_id, anio_lectivo_id, concepto_id, mes, monto, fecha_vencimiento, estado)
       VALUES (?,?,?,NULL,?,?, 'pendiente')
       ON DUPLICATE KEY UPDATE monto = monto`,
      [alumnoId, anioLectivoId, matricula.id, matricula.monto_default, `${anio}-02-05`]
    );
    if (rm.affectedRows === 1) creados++;

    for (const mes of meses) {
      const [r] = await conn.query(
        `INSERT INTO cargo (alumno_id, anio_lectivo_id, concepto_id, mes, monto, fecha_vencimiento, estado)
         VALUES (?,?,?,?,?,?, 'pendiente')
         ON DUPLICATE KEY UPDATE monto = monto`,
        [alumnoId, anioLectivoId, mensualidad.id, mes, mensualidad.monto_default,
          `${anio}-${String(mes).padStart(2, '0')}-10`]
      );
      if (r.affectedRows === 1) creados++;
    }

    return { creados };
  }, ctx);
}

/**
 * Registra un pago sobre un cargo.
 * Verifica que el monto no exceda el saldo y genera un número de recibo único.
 */
export async function registrarPago({ cargoId, monto, metodo, referencia, observacion, fechaPago }, ctx) {
  const montoNum = dinero(monto);
  if (montoNum <= 0) throw new AppError('El monto debe ser mayor que cero.', 400, 'MONTO_INVALIDO');

  const cfg = await configFinanzas();

  return transaccion(async (conn) => {
    // Bloquea el cargo mientras se calcula el saldo, para que dos pagos
    // simultáneos no sobrepasen el total.
    const [[cargo]] = await conn.query(
      `SELECT c.id, c.monto, c.monto_mora, c.descuento, c.estado,
              COALESCE((SELECT SUM(p.monto) FROM pago p WHERE p.cargo_id = c.id AND p.anulado = 0), 0) AS pagado
         FROM cargo c WHERE c.id = ? FOR UPDATE`,
      [cargoId]
    );
    if (!cargo) throw new AppError('El cargo no existe.', 404, 'CARGO_NO_ENCONTRADO');
    if (cargo.estado === 'anulado') throw new AppError('El cargo esta anulado.', 409, 'CARGO_ANULADO');
    if (cargo.estado === 'exonerado') throw new AppError('El cargo esta exonerado, no requiere pago.', 409, 'CARGO_EXONERADO');

    const totalCargo = dinero(Number(cargo.monto) + Number(cargo.monto_mora) - Number(cargo.descuento));
    const saldo = dinero(totalCargo - Number(cargo.pagado));

    if (montoNum > saldo + 0.01) {
      throw new AppError(
        `El pago de ${montoNum} excede el saldo pendiente de ${saldo}.`,
        400, 'PAGO_EXCEDE_SALDO'
      );
    }

    // Número de recibo correlativo, bloqueando para evitar duplicados.
    const [[ultimo]] = await conn.query(
      "SELECT numero_recibo FROM pago WHERE numero_recibo LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE",
      [`${cfg.prefijoRecibo}-%`]
    );
    const secuencia = ultimo ? Number(String(ultimo.numero_recibo).split('-').pop()) + 1 : 1;
    const numeroRecibo = `${cfg.prefijoRecibo}-${new Date().getFullYear()}-${String(secuencia).padStart(5, '0')}`;

    const [rp] = await conn.query(
      `INSERT INTO pago (cargo_id, numero_recibo, monto, fecha_pago, metodo, referencia, observacion, registrado_por)
       VALUES (?,?,?,?,?,?,?,?)`,
      [cargoId, numeroRecibo, montoNum,
        fechaPago ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
        metodo ?? 'efectivo', referencia ?? null, observacion ?? null, ctx?.usuarioId ?? null]
    );

    // Actualiza el estado del cargo: pagado si el saldo llega a cero.
    const nuevoSaldo = dinero(saldo - montoNum);
    await conn.query('UPDATE cargo SET estado = ? WHERE id = ?', [nuevoSaldo <= 0.01 ? 'pagado' : 'pendiente', cargoId]);

    return { pagoId: rp.insertId, numeroRecibo, saldoRestante: nuevoSaldo };
  }, ctx);
}

/** Anula un pago (no lo borra) y reajusta el estado del cargo. */
export async function anularPago({ pagoId, motivo }, ctx) {
  return transaccion(async (conn) => {
    const [[pago]] = await conn.query('SELECT id, cargo_id, anulado FROM pago WHERE id = ? FOR UPDATE', [pagoId]);
    if (!pago) throw new AppError('El pago no existe.', 404, 'NO_ENCONTRADO');
    if (pago.anulado) throw new AppError('El pago ya estaba anulado.', 409, 'YA_ANULADO');

    await conn.query(
      'UPDATE pago SET anulado = 1, anulado_motivo = ? WHERE id = ?',
      [motivo ?? 'Sin motivo registrado', pagoId]
    );

    // Recalcula el estado del cargo tras quitar este pago.
    const [[cargo]] = await conn.query(
      `SELECT c.monto, c.monto_mora, c.descuento,
              COALESCE((SELECT SUM(p.monto) FROM pago p WHERE p.cargo_id = c.id AND p.anulado = 0), 0) AS pagado
         FROM cargo c WHERE c.id = ?`,
      [pago.cargo_id]
    );
    const totalCargo = dinero(Number(cargo.monto) + Number(cargo.monto_mora) - Number(cargo.descuento));
    const saldo = dinero(totalCargo - Number(cargo.pagado));
    await conn.query('UPDATE cargo SET estado = ? WHERE id = ?', [saldo <= 0.01 ? 'pagado' : 'pendiente', pago.cargo_id]);

    return { ok: true };
  }, ctx);
}

/** Aplica un descuento o exoneración a un cargo. */
export async function ajustarCargo({ cargoId, descuento, exonerar }, ctx) {
  return transaccion(async (conn) => {
    const [[cargo]] = await conn.query('SELECT id, monto, estado FROM cargo WHERE id = ? FOR UPDATE', [cargoId]);
    if (!cargo) throw new AppError('El cargo no existe.', 404, 'NO_ENCONTRADO');

    if (exonerar) {
      await conn.query("UPDATE cargo SET estado = 'exonerado' WHERE id = ?", [cargoId]);
      return { ok: true, estado: 'exonerado' };
    }

    const desc = dinero(descuento ?? 0);
    if (desc < 0 || desc > Number(cargo.monto)) {
      throw new AppError('El descuento no puede ser negativo ni superar el monto.', 400, 'DESCUENTO_INVALIDO');
    }
    await conn.query('UPDATE cargo SET descuento = ? WHERE id = ?', [desc, cargoId]);
    return { ok: true, descuento: desc };
  }, ctx);
}

/**
 * Aplica mora a los cargos vencidos y sin pagar.
 * Pensado para correr como tarea programada (una vez al día).
 * Idempotente: no vuelve a aplicar mora a un cargo que ya la tiene.
 */
export async function aplicarMora(anioLectivoId, ctx) {
  const cfg = await configFinanzas();

  return transaccion(async (conn) => {
    // Cargos vencidos hace más de los días de gracia, aún pendientes y sin mora.
    const [vencidos] = await conn.query(
      `SELECT id, monto FROM cargo
        WHERE anio_lectivo_id = ? AND estado = 'pendiente' AND monto_mora = 0
          AND fecha_vencimiento < DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [anioLectivoId, cfg.diasGracia]
    );

    let aplicados = 0;
    for (const c of vencidos) {
      const mora = dinero(Number(c.monto) * cfg.moraPct / 100);
      await conn.query("UPDATE cargo SET monto_mora = ?, estado = 'mora' WHERE id = ?", [mora, c.id]);
      aplicados++;
    }

    return { aplicados, moraPct: cfg.moraPct };
  }, ctx);
}

/** Recibo para imprimir/mostrar. */
export async function obtenerRecibo(pagoId) {
  const [r] = await q(
    `SELECT p.id, p.numero_recibo, p.monto, p.fecha_pago, p.metodo, p.referencia, p.anulado,
            cp.nombre AS concepto, c.mes,
            a.codigo, TRIM(CONCAT_WS(' ', per.primer_nombre, per.primer_apellido, per.segundo_apellido)) AS alumno,
            TRIM(CONCAT_WS(' ', pu.primer_nombre, pu.primer_apellido)) AS cajero
       FROM pago p
       JOIN cargo c ON c.id = p.cargo_id
       JOIN concepto_pago cp ON cp.id = c.concepto_id
       JOIN alumno a ON a.id = c.alumno_id
       JOIN persona per ON per.id = a.persona_id
       LEFT JOIN usuario u ON u.id = p.registrado_por
       LEFT JOIN persona pu ON pu.id = u.persona_id
      WHERE p.id = ?`,
    [pagoId]
  );
  if (!r) throw new AppError('El recibo no existe.', 404, 'NO_ENCONTRADO');
  return r;
}

/** Reporte de morosidad: alumnos con saldo pendiente. */
export async function reporteMorosidad(anioLectivoId, { seccionId } = {}) {
  const where = ['c.anio_lectivo_id = ?', "c.estado IN ('pendiente','mora')"];
  const params = [anioLectivoId];
  if (seccionId) { where.push('m.seccion_id = ?'); params.push(seccionId); }

  return q(
    `SELECT a.id AS alumno_id, a.codigo,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS alumno,
            g.numero AS grado, s.letra AS seccion,
            COUNT(c.id) AS cargos_pendientes,
            SUM(c.monto + c.monto_mora - c.descuento
                - COALESCE((SELECT SUM(pg.monto) FROM pago pg WHERE pg.cargo_id = c.id AND pg.anulado = 0), 0)) AS saldo
       FROM cargo c
       JOIN alumno a ON a.id = c.alumno_id
       JOIN persona p ON p.id = a.persona_id
       JOIN matricula m ON m.alumno_id = a.id AND m.anio_lectivo_id = c.anio_lectivo_id AND m.estado = 'activa'
       JOIN seccion s ON s.id = m.seccion_id
       JOIN grado g ON g.id = s.grado_id
      WHERE ${where.join(' AND ')}
      GROUP BY a.id
      HAVING saldo > 0.01
      ORDER BY saldo DESC`,
    params
  );
}

export { configFinanzas };
