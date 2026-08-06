-- ============================================================================
-- Smart Campus IA — FASE 9: Sistema de comportamiento
--
-- Amplia el registro de conducta para cubrir DOS caras:
--   - Deméritos (faltas): ya existían en la tabla `incidencia`.
--   - Méritos (reconocimientos): nuevos, para registrar buena conducta.
--
-- Se agrega un CATÁLOGO de tipos de comportamiento con puntos, de modo que el
-- maestro elija de una lista en vez de escribir todo a mano, y el sistema pueda
-- calcular un puntaje de conducta por alumno.
--
-- Permisos: el ADMIN ve todos los registros; el MAESTRO solo los de sus clases.
-- Esa regla se aplica en el backend (capa de servicio/ruta), no aquí.
--
-- Idempotente: se puede ejecutar más de una vez sin error.
-- ============================================================================

USE smart_campus;

-- Catálogo de tipos de comportamiento (méritos y deméritos con puntaje).
CREATE TABLE IF NOT EXISTS tipo_comportamiento (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  clase       ENUM('merito','demerito') NOT NULL,
  nombre      VARCHAR(120) NOT NULL,
  puntos      SMALLINT     NOT NULL,          -- positivos para mérito, negativos para demérito
  gravedad    ENUM('leve','grave','muy_grave') NULL,  -- solo aplica a deméritos
  activo      TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipo_comp (clase, nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Registro de MÉRITOS (buena conducta). Los deméritos siguen en `incidencia`.
CREATE TABLE IF NOT EXISTS merito (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  alumno_id         INT UNSIGNED NOT NULL,
  clase_id          INT UNSIGNED NULL,
  anio_lectivo_id   INT UNSIGNED NOT NULL,
  tipo_id           INT UNSIGNED NULL,
  puntos            SMALLINT     NOT NULL DEFAULT 1,
  descripcion       TEXT         NOT NULL,
  fecha_hora        DATETIME     NOT NULL,
  registrado_por    INT UNSIGNED NULL,
  creado_en         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_merito_alumno (alumno_id, fecha_hora),
  KEY ix_merito_clase (clase_id),
  CONSTRAINT fk_mer_alumno   FOREIGN KEY (alumno_id) REFERENCES alumno(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mer_clase    FOREIGN KEY (clase_id) REFERENCES clase(id) ON DELETE SET NULL,
  CONSTRAINT fk_mer_anio     FOREIGN KEY (anio_lectivo_id) REFERENCES anio_lectivo(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mer_tipo     FOREIGN KEY (tipo_id) REFERENCES tipo_comportamiento(id) ON DELETE SET NULL,
  CONSTRAINT fk_mer_registro FOREIGN KEY (registrado_por) REFERENCES usuario(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La tabla `incidencia` (deméritos) gana una referencia opcional al catálogo y
-- un puntaje, para unificar el cálculo. MariaDB soporta IF NOT EXISTS en ALTER,
-- así que es seguro re-ejecutar el script.
ALTER TABLE incidencia ADD COLUMN IF NOT EXISTS tipo_id INT UNSIGNED NULL AFTER clase_id;
ALTER TABLE incidencia ADD COLUMN IF NOT EXISTS puntos SMALLINT NOT NULL DEFAULT 0 AFTER gravedad;

-- Catálogo inicial de tipos (méritos y deméritos comunes en un colegio).
INSERT INTO tipo_comportamiento (clase, nombre, puntos, gravedad, activo) VALUES
  ('merito',   'Participación destacada en clase',      5,  NULL,        1),
  ('merito',   'Ayuda a un compañero',                  4,  NULL,        1),
  ('merito',   'Excelente trabajo o proyecto',          8,  NULL,        1),
  ('merito',   'Liderazgo positivo',                    6,  NULL,        1),
  ('merito',   'Puntualidad y responsabilidad ejemplar',3,  NULL,        1),
  ('merito',   'Representación del colegio',            10,  NULL,        1),
  ('demerito', 'Interrumpir la clase',                 -3,  'leve',      1),
  ('demerito', 'No traer materiales o tareas',         -2,  'leve',      1),
  ('demerito', 'Uso indebido del celular',             -4,  'leve',      1),
  ('demerito', 'Falta de respeto a un compañero',      -8,  'grave',     1),
  ('demerito', 'Falta de respeto a un docente',       -12,  'grave',     1),
  ('demerito', 'Daño a bienes del colegio',           -15,  'grave',     1),
  ('demerito', 'Agresión física',                     -25,  'muy_grave', 1),
  ('demerito', 'Posesión de objeto peligroso',        -30,  'muy_grave', 1)
ON DUPLICATE KEY UPDATE puntos = VALUES(puntos), gravedad = VALUES(gravedad);

-- Permisos para el usuario de la aplicación.

SELECT 'Sistema de comportamiento (meritos + demeritos) listo.' AS resultado;
