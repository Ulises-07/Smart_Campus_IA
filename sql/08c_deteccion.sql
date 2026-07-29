-- ============================================================================
-- Smart Campus IA — FASE 8 (detección en vivo)
-- Registro de detecciones de objetos peligrosos y su configuración.
--
-- La detección corre en el navegador del administrador (TensorFlow.js). Cuando
-- encuentra un objeto de la lista de peligrosos, avisa al servidor, que guarda
-- la deteccion y dispara una notificacion. Aqui viven esas dos cosas.
--
-- Idempotente: se puede ejecutar más de una vez sin error.
-- ============================================================================

USE smart_campus;

-- El tipo de notificacion 'seguridad' es nuevo en esta parte: se usa para los
-- avisos de deteccion de objetos peligrosos. Se amplia el ENUM sin perder los
-- valores existentes.
ALTER TABLE notificacion
  MODIFY COLUMN tipo ENUM('nota','asistencia','pago','incidencia','sistema','seguridad') NOT NULL;

-- Qué objetos, de los que el modelo reconoce, se consideran peligrosos.
-- Configurable: el administrador puede activar o desactivar cada uno.
-- Las clases vienen del modelo COCO (en inglés); se guarda también la
-- etiqueta en español para mostrarla.
CREATE TABLE IF NOT EXISTS objeto_peligroso (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  clase       VARCHAR(50)  NOT NULL,   -- nombre de la clase del modelo (ej: 'knife')
  etiqueta    VARCHAR(80)  NOT NULL,   -- como se muestra (ej: 'Cuchillo')
  activo      TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_objeto_clase (clase)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cada vez que la IA detecta un objeto peligroso, queda registro.
CREATE TABLE IF NOT EXISTS deteccion (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  camara_id     INT UNSIGNED NULL,
  clase         VARCHAR(50)  NOT NULL,   -- qué se detectó (clase del modelo)
  etiqueta      VARCHAR(80)  NOT NULL,   -- etiqueta legible
  confianza     DECIMAL(5,4) NOT NULL,   -- 0.0000 a 1.0000 (probabilidad del modelo)
  imagen_ref    VARCHAR(255) NULL,       -- referencia opcional a un fotograma guardado
  atendida      TINYINT(1)   NOT NULL DEFAULT 0,
  atendida_por  INT UNSIGNED NULL,
  atendida_en   DATETIME     NULL,
  detectado_en  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_deteccion_fecha (detectado_en),
  KEY ix_deteccion_atendida (atendida, detectado_en),
  CONSTRAINT fk_deteccion_camara FOREIGN KEY (camara_id) REFERENCES camara(id) ON DELETE SET NULL,
  CONSTRAINT fk_deteccion_atendida FOREIGN KEY (atendida_por) REFERENCES usuario(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Objetos peligrosos por defecto. Son las clases del modelo COCO que pueden
-- representar un riesgo en un colegio. NOTA: el modelo estandar NO detecta
-- armas de fuego; para eso hace falta un modelo especializado. Estos son los
-- objetos "de riesgo" que el modelo libre sí reconoce.
INSERT INTO objeto_peligroso (clase, etiqueta, activo) VALUES
  ('knife',        'Cuchillo',         1),
  ('scissors',     'Tijeras',          1),
  ('baseball bat', 'Bate de béisbol',  1),
  ('bottle',       'Botella',          0)
ON DUPLICATE KEY UPDATE etiqueta = VALUES(etiqueta);

-- Permisos para el usuario de la aplicación.
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_campus.objeto_peligroso TO 'sc_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_campus.objeto_peligroso TO 'sc_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_campus.deteccion TO 'sc_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_campus.deteccion TO 'sc_app'@'127.0.0.1';
FLUSH PRIVILEGES;

SELECT 'Deteccion en vivo lista (tablas objeto_peligroso y deteccion).' AS resultado;
