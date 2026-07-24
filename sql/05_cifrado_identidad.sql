-- ============================================================================
-- Smart Campus IA — FASE 2
-- Cifrado en reposo del número de identidad (requisito A.9)
--
-- La identidad de un menor es un dato personal sensible. En la Fase 1 quedó en
-- texto plano para poder inspeccionar la base durante la construcción; ahora
-- toca cerrarlo, antes de que haya cientos de alumnos reales cargados.
--
-- PROCESO EN TRES PASOS. No los combines: si algo sale mal en el paso 2,
-- todavía tienes la columna original intacta.
--
--   1) Este script         -> agrega las columnas nuevas
--   2) npm run migrar:identidad -> cifra los datos existentes
--   3) sql/06_...          -> elimina la columna en texto plano
--
-- HAZ UN RESPALDO ANTES:  npm run backup
-- ============================================================================

USE smart_campus;

-- identidad_cifrada: AES-256-GCM en base64. No se puede indexar ni buscar.
-- identidad_hash:    HMAC-SHA256. Sirve para buscar y para el índice único.
ALTER TABLE persona
  ADD COLUMN identidad_cifrada VARCHAR(255) NULL AFTER identidad,
  ADD COLUMN identidad_hash    CHAR(64)     NULL AFTER identidad_cifrada;

-- El índice único se mueve del texto plano al hash: sigue impidiendo dos
-- personas con la misma identidad, pero sin exponer el dato.
ALTER TABLE persona
  ADD UNIQUE KEY uk_persona_identidad_hash (identidad_hash);

SELECT
  COUNT(*) AS personas_totales,
  SUM(identidad IS NOT NULL) AS con_identidad,
  SUM(identidad_cifrada IS NOT NULL) AS ya_cifradas
FROM persona;

-- Siguiente paso:  npm run migrar:identidad
