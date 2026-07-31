-- ============================================================================
-- Smart Campus IA — FASE 1
-- Permisos de mínimo privilegio: auditoría de solo escritura y lectura
--
-- Ejecutar como root DESPUÉS de 01_esquema.sql:
--   C:\xampp\mysql\bin\mysql.exe -u root -p < sql\04_permisos_auditoria.sql
--
-- POR QUÉ ESTE SCRIPT SE VE ASÍ
--
-- MySQL no tiene "denegar". Un privilegio concedido sobre `smart_campus.*`
-- cubre TODAS las tablas, incluida auditoria, y no se puede revocar solo para
-- una. Por eso el único camino correcto es:
--
--   1. Quitar todo.
--   2. Conceder SELECT e INSERT sobre la base completa (auditoria incluida).
--   3. Conceder UPDATE y DELETE tabla por tabla, EXCEPTO auditoria.
--
-- Es tedioso, pero es lo que hace que la auditoría tenga valor probatorio:
-- ni la aplicación ni una inyección SQL a través de ella pueden alterar el
-- rastro. Junto con los triggers del script 02 —que bloquean UPDATE y DELETE
-- incluso para root— son dos capas independientes.
--
-- Si en el futuro agregas una tabla nueva, recuerda añadirla a la lista de
-- abajo o la aplicación no podrá modificarla.
-- ============================================================================

-- 2. Lectura y escritura de alta en toda la base, auditoria incluida.
GRANT SELECT, INSERT, EXECUTE ON smart_campus.* TO 'sc_app'@'localhost';
GRANT SELECT, INSERT, EXECUTE ON smart_campus.* TO 'sc_app'@'127.0.0.1';

-- 3. Modificación y borrado, tabla por tabla, salvo auditoria.
GRANT UPDATE, DELETE ON smart_campus.alumno           TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.alumno_encargado TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.anio_lectivo     TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.asignatura       TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.asistencia       TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.aula             TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.bloque_horario   TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.cargo            TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.carrera          TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.clase            TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.concepto_pago    TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.config_sistema   TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.encargado        TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.evaluacion       TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.grado            TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.horario          TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.incidencia       TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.inscripcion      TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.intento_login    TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.material         TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.matricula        TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.nota             TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.nota_periodo     TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.notificacion     TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.pago             TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.periodo          TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.persona          TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.ponderacion      TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.rol              TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.seccion          TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.sesion_refresh   TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.tipo_evaluacion  TO 'sc_app'@'localhost';
GRANT UPDATE, DELETE ON smart_campus.usuario          TO 'sc_app'@'localhost';

GRANT UPDATE, DELETE ON smart_campus.alumno           TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.alumno_encargado TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.anio_lectivo     TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.asignatura       TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.asistencia       TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.aula             TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.bloque_horario   TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.cargo            TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.carrera          TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.clase            TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.concepto_pago    TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.config_sistema   TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.encargado        TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.evaluacion       TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.grado            TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.horario          TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.incidencia       TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.inscripcion      TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.intento_login    TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.material         TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.matricula        TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.nota             TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.nota_periodo     TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.notificacion     TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.pago             TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.periodo          TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.persona          TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.ponderacion      TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.rol              TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.seccion          TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.sesion_refresh   TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.tipo_evaluacion  TO 'sc_app'@'127.0.0.1';
GRANT UPDATE, DELETE ON smart_campus.usuario          TO 'sc_app'@'127.0.0.1';

FLUSH PRIVILEGES;

-- ============================================================================
-- COMPROBACIÓN
-- Debe mostrar únicamente SELECT e INSERT para la tabla auditoria.
-- ============================================================================
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'smart_campus' AND table_name = 'auditoria'
ORDER BY grantee, privilege_type;

-- Prueba manual recomendada:
--   mysql.exe -u sc_app -p smart_campus
--   DELETE FROM auditoria WHERE id = 1;
-- Debe responder "command denied". Si te deja, el modulo de auditoria es
-- decorativo y hay que revisar este script.
