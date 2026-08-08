-- ============================================================
-- Corrige el nombre del año lectivo: "Ano" -> "Año"
-- (se generó sin la ñ). Aplica a la base actual sin borrar nada.
-- Córrelo en phpMyAdmin sobre smart_campus. NO usa FLUSH.
-- ============================================================

USE smart_campus;

UPDATE anio_lectivo
   SET nombre = REPLACE(nombre, 'Ano Lectivo', 'Año Lectivo')
 WHERE nombre LIKE 'Ano Lectivo%';

SELECT nombre AS resultado FROM anio_lectivo;
