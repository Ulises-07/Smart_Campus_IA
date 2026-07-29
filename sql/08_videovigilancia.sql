-- ============================================================================
-- Smart Campus IA — FASE 8
-- Videovigilancia: capa de GOBERNANZA (consentimiento, retencion, acceso)
--
-- Este esquema NO captura video. Modela el control del ciclo de vida de las
-- grabaciones: donde se puede grabar, quien consintio, cuanto se retiene y
-- quien accede. Es la parte que protege a los menores.
--
-- Las politicas que este esquema hace cumplir estan en:
--   docs/FASE-8-consentimiento.md
--   docs/FASE-8-retencion.md
--
-- Idempotente en lo posible. Requiere delimitador $$ para el trigger.
-- ============================================================================

USE smart_campus;

-- Configuracion de retencion (minimizacion: 30 dias por defecto).
INSERT INTO config_sistema (clave, valor, descripcion) VALUES
  ('video.retencion_dias', '30', 'Dias que se conserva una grabacion antes de purgarla'),
  ('video.retencion_evidencia_dias', '180', 'Tope de dias para una grabacion marcada como evidencia')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- ----------------------------------------------------------------------------
-- Camaras. La zona prohibida se bloquea por CHECK y por trigger.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS camara (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo            VARCHAR(20)  NOT NULL,
  nombre            VARCHAR(100) NOT NULL,
  zona              VARCHAR(120) NOT NULL,
  tipo_zona         ENUM('entrada','pasillo','patio','perimetro','area_administrativa','aula') NOT NULL,
  retencion_dias    SMALLINT UNSIGNED NULL,   -- si es NULL usa el valor global
  activa            TINYINT(1)   NOT NULL DEFAULT 1,
  fecha_instalacion DATE         NULL,
  creado_por        INT UNSIGNED NULL,
  creado_en         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_camara_codigo (codigo),
  -- Las zonas prohibidas ni siquiera son valores validos del ENUM: no hay como
  -- registrar una camara en un bano o vestidor porque el tipo no existe.
  CONSTRAINT fk_camara_creador FOREIGN KEY (creado_por) REFERENCES usuario(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Consentimiento de videovigilancia, por alumno.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consentimiento_video (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  alumno_id             INT UNSIGNED NOT NULL,
  encargado_id          INT UNSIGNED NULL,      -- quien decidio
  estado                ENUM('otorgado','denegado','pendiente') NOT NULL DEFAULT 'pendiente',
  documento_referencia  VARCHAR(120) NULL,      -- referencia al papel firmado
  observacion           VARCHAR(255) NULL,
  decidido_en           DATETIME     NULL,
  registrado_por        INT UNSIGNED NULL,
  actualizado_en        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_consent_alumno (alumno_id),     -- un estado vigente por alumno
  KEY ix_consent_estado (estado),
  CONSTRAINT fk_consent_alumno FOREIGN KEY (alumno_id) REFERENCES alumno(id) ON DELETE CASCADE,
  CONSTRAINT fk_consent_encargado FOREIGN KEY (encargado_id) REFERENCES encargado(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Metadatos de grabacion. NO es video: es el registro de su ciclo de vida.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grabacion (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  camara_id         INT UNSIGNED NOT NULL,
  fecha_inicio      DATETIME     NOT NULL,
  fecha_fin         DATETIME     NOT NULL,
  archivo_referencia VARCHAR(200) NOT NULL,     -- en produccion: ruta al video cifrado
  fecha_expiracion  DATE         NOT NULL,      -- cuando debe purgarse
  es_evidencia      TINYINT(1)   NOT NULL DEFAULT 0,
  motivo_evidencia  VARCHAR(255) NULL,
  purgada           TINYINT(1)   NOT NULL DEFAULT 0,
  purgada_en        DATETIME     NULL,
  creado_en         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_grab_expiracion (purgada, fecha_expiracion),
  KEY ix_grab_camara (camara_id, fecha_inicio),
  CONSTRAINT fk_grab_camara FOREIGN KEY (camara_id) REFERENCES camara(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Esquema de videovigilancia (gobernanza) listo.' AS resultado;

-- Permisos para el usuario de la aplicacion.
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_campus.camara TO 'sc_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_campus.camara TO 'sc_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_campus.consentimiento_video TO 'sc_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_campus.consentimiento_video TO 'sc_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_campus.grabacion TO 'sc_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_campus.grabacion TO 'sc_app'@'127.0.0.1';
FLUSH PRIVILEGES;
