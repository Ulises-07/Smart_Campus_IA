-- ============================================================
-- Migración de notas al modelo de SUMA DIRECTA
-- Tarea 1 = 15, Tarea 2 = 15, Tarea 3 = 15, Proyecto = 25, Examen = 30
-- (suman 100). La nota final pasa a ser la suma de los puntos.
--
-- Reescala las notas que ya existen para que encajen en los nuevos máximos,
-- ajusta los puntajes máximos de cada evaluación, redondea a enteros y
-- corrige las ponderaciones. Seguro de correr una sola vez.
--
-- Córrelo en phpMyAdmin sobre tu base smart_campus. NO usa FLUSH.
-- ============================================================

USE smart_campus;

-- 1) Reescalar las NOTAS existentes al nuevo máximo, según el título de la
--    evaluación. Regla de tres: nota_nueva = nota_vieja * (max_nuevo / max_viejo).
--    Se hace ANTES de cambiar el puntaje_maximo de la evaluación.

-- Tareas: de 20 a 15
UPDATE nota n
  JOIN evaluacion e ON e.id = n.evaluacion_id
   SET n.puntaje = ROUND(n.puntaje * 15 / e.puntaje_maximo)
 WHERE e.titulo IN ('Tarea 1', 'Tarea 2', 'Tarea 3')
   AND e.puntaje_maximo <> 15;

-- Proyecto: de 100 a 25
UPDATE nota n
  JOIN evaluacion e ON e.id = n.evaluacion_id
   SET n.puntaje = ROUND(n.puntaje * 25 / e.puntaje_maximo)
 WHERE e.titulo LIKE 'Proyecto%'
   AND e.puntaje_maximo <> 25;

-- Examen: de 100 a 30
UPDATE nota n
  JOIN evaluacion e ON e.id = n.evaluacion_id
   SET n.puntaje = ROUND(n.puntaje * 30 / e.puntaje_maximo)
 WHERE e.titulo LIKE 'Examen%'
   AND e.puntaje_maximo <> 30;

-- 2) Ajustar el PUNTAJE MÁXIMO de cada evaluación a su nuevo peso.
UPDATE evaluacion SET puntaje_maximo = 15 WHERE titulo IN ('Tarea 1', 'Tarea 2', 'Tarea 3');
UPDATE evaluacion SET puntaje_maximo = 25 WHERE titulo LIKE 'Proyecto%';
UPDATE evaluacion SET puntaje_maximo = 30 WHERE titulo LIKE 'Examen%';

-- 3) Redondear TODAS las notas a enteros (por si quedó algún decimal).
UPDATE nota SET puntaje = ROUND(puntaje);

-- 4) Corregir las PONDERACIONES por tipo para que reflejen la suma directa:
--    Tareas 45 (3×15), Proyectos 25, Exámenes 30.
UPDATE ponderacion SET porcentaje = 45 WHERE tipo_evaluacion_id = 1;  -- Tareas
UPDATE ponderacion SET porcentaje = 25 WHERE tipo_evaluacion_id = 2;  -- Proyectos
UPDATE ponderacion SET porcentaje = 30 WHERE tipo_evaluacion_id = 3;  -- Exámenes

-- 5) Limpiar las notas consolidadas viejas (estaban calculadas con la fórmula
--    anterior). El sistema ahora calcula la final por suma directa al vuelo.
DELETE FROM nota_periodo;

SELECT 'Notas migradas al modelo de suma directa (T1/T2/T3=15, Proyecto=25, Examen=30).' AS resultado;
