-- ============================================================
-- Smart Campus IA - Fase 0
-- Creacion de la base de datos y de los usuarios de MySQL.
--
-- Ejecutar UNA sola vez, como usuario root, desde:
--   C:\xampp\mysql\bin\mysql.exe -u root -p < sql/00_crear_bd_y_usuarios.sql
-- o pegandolo en la pestana SQL de phpMyAdmin.
--
-- IMPORTANTE: cambia las dos contrasenas de ejemplo antes de ejecutar.
-- ============================================================

CREATE DATABASE IF NOT EXISTS smart_campus
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Usuario de la aplicacion (el que usa Node.js)
-- Principio de minimo privilegio: sin DROP, sin ALTER, sin GRANT.
-- ------------------------------------------------------------
CREATE USER IF NOT EXISTS 'sc_app'@'localhost' IDENTIFIED BY 'TuClaveDeRootAqui';

GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE
  ON smart_campus.* TO 'sc_app'@'localhost';

-- ------------------------------------------------------------
-- Auditoria inmutable.
-- La tabla se crea en la Fase 1; estos permisos se aplican despues,
-- pero se dejan documentados aqui porque son parte del diseno:
-- la aplicacion solo puede INSERTAR y LEER, jamas modificar ni borrar.
--
-- Ejecutar DESPUES de crear la tabla `auditoria` en la Fase 1:
--
--   REVOKE UPDATE, DELETE ON smart_campus.auditoria FROM 'sc_app'@'localhost';
--   GRANT SELECT, INSERT ON smart_campus.auditoria TO 'sc_app'@'localhost';
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Usuario de respaldos (solo lectura)
-- ------------------------------------------------------------
CREATE USER IF NOT EXISTS 'sc_backup'@'localhost' IDENTIFIED BY 'TuClaveDeRootAqui';

GRANT SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER
  ON smart_campus.* TO 'sc_backup'@'localhost';

FLUSH PRIVILEGES;

-- Comprobacion rapida
SELECT
  schema_name AS base_datos,
  default_character_set_name AS juego_caracteres,
  default_collation_name AS cotejamiento
FROM information_schema.schemata
WHERE schema_name = 'smart_campus';
