-- ============================================================================
-- Smart Campus IA — FASE 6
-- Registro de conversaciones con el asistente de IA
--
-- Por que se guarda: en un sistema con datos de menores conviene poder auditar
-- que se le pregunto al asistente y que respondio. No se guarda el contexto
-- completo (seria duplicar datos sensibles), solo un resumen.
--
-- Idempotente: se puede ejecutar mas de una vez sin error.
-- ============================================================================

USE smart_campus;

CREATE TABLE IF NOT EXISTS chat_log (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id         INT UNSIGNED NOT NULL,
  rol                VARCHAR(20)  NULL,
  pregunta           VARCHAR(500) NOT NULL,
  respuesta_extracto VARCHAR(500) NULL,
  contexto_resumen   VARCHAR(255) NULL,
  ip                 VARCHAR(45)  NULL,
  creado_en          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_chatlog_usuario (usuario_id, creado_en),
  CONSTRAINT fk_chatlog_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Permisos para el usuario de la aplicacion (mismo criterio que el resto:
-- puede insertar y leer, y limpiar registros viejos).
GRANT SELECT, INSERT, DELETE ON smart_campus.chat_log TO 'sc_app'@'localhost';
GRANT SELECT, INSERT, DELETE ON smart_campus.chat_log TO 'sc_app'@'127.0.0.1';
FLUSH PRIVILEGES;

SELECT 'Tabla chat_log lista.' AS resultado;
