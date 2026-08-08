-- ============================================================
-- Ajuste de finanzas: dejar solo el I Parcial (febrero–abril)
--
-- El sistema simula que vamos por el I Parcial, así que los cargos y pagos
-- de mayo en adelante no corresponden. Este script elimina los cargos de
-- mensualidad de los meses 5 a 12 (mayo–diciembre) y sus pagos asociados,
-- dejando solo matrícula + febrero, marzo y abril.
--
-- Aplica a TODOS los alumnos. NO borra alumnos, usuarios ni notas.
-- Córrelo en phpMyAdmin sobre tu base smart_campus. NO usa FLUSH.
-- ============================================================

USE smart_campus;

-- 1) Borrar primero los PAGOS ligados a cargos de mensualidad de mayo en
--    adelante (mes >= 5). Se borran antes que los cargos por la relación.
DELETE pg
  FROM pago pg
  JOIN cargo c ON c.id = pg.cargo_id
 WHERE c.mes IS NOT NULL AND c.mes >= 5;

-- 2) Borrar los CARGOS de mensualidad de mayo en adelante (mes >= 5).
--    La matrícula (mes NULL) y feb/mar/abr (mes 2,3,4) se conservan.
DELETE FROM cargo
 WHERE mes IS NOT NULL AND mes >= 5;

-- 3) Reporte de lo que quedó, para confirmar.
SELECT 'Finanzas ajustadas al I Parcial (feb–abr).' AS resultado;

SELECT
  CASE WHEN mes IS NULL THEN 'Matrícula' ELSE CONCAT('Mes ', mes) END AS concepto,
  COUNT(*) AS cargos,
  SUM(estado = 'pagado')     AS pagados,
  SUM(estado = 'pendiente')  AS pendientes,
  SUM(estado = 'mora')       AS en_mora
FROM cargo
GROUP BY mes
ORDER BY (mes IS NOT NULL), mes;
