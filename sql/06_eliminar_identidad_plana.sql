-- ============================================================================
-- Smart Campus IA — FASE 2
-- Paso 3 de 3: eliminar la columna de identidad en texto plano
--
-- EJECUTA ESTO SOLO DESPUÉS de que `npm run migrar:identidad` haya terminado
-- sin errores y hayas verificado el conteo. Es irreversible.
--
-- Verificación previa: los dos números deben coincidir.
--   SELECT SUM(identidad IS NOT NULL) AS planas,
--          SUM(identidad_cifrada IS NOT NULL) AS cifradas FROM persona;
-- ============================================================================

USE smart_campus;

ALTER TABLE persona DROP INDEX uk_persona_identidad;
ALTER TABLE persona DROP COLUMN identidad;

SELECT 'Identidad en texto plano eliminada.' AS resultado;
SHOW COLUMNS FROM persona LIKE 'identidad%';
