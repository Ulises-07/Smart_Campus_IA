-- ============================================================================
-- Smart Campus IA — Detección ampliada
--
-- Agrega un NIVEL de peligro a cada objeto y amplía la lista de objetos que la
-- IA puede detectar. Son todas clases que el modelo COCO estándar reconoce, así
-- que funcionan sin cambiar el modelo (proyecto demostrativo).
--
-- Nivel:  'critico' (arma/objeto muy peligroso), 'alto', 'medio', 'bajo'.
--         Sirve para colorear la alerta y priorizar la notificación.
--
-- Idempotente.
-- ============================================================================

USE smart_campus;

-- Nivel de peligro por objeto.
ALTER TABLE objeto_peligroso
  ADD COLUMN IF NOT EXISTS nivel ENUM('bajo','medio','alto','critico') NOT NULL DEFAULT 'alto' AFTER etiqueta;

-- La detección guarda también el nivel, para el historial y el color de alerta.
ALTER TABLE deteccion
  ADD COLUMN IF NOT EXISTS nivel ENUM('bajo','medio','alto','critico') NOT NULL DEFAULT 'alto' AFTER etiqueta;

-- Catálogo ampliado. Todas son clases reales del modelo COCO.
-- (clase del modelo, etiqueta en español, nivel, activo)
INSERT INTO objeto_peligroso (clase, etiqueta, nivel, activo) VALUES
  ('knife',         'Cuchillo',              'critico', 1),
  ('scissors',      'Tijeras',               'alto',    1),
  ('baseball bat',  'Bate de béisbol',       'alto',    1),
  ('fork',          'Tenedor',               'medio',   1),
  ('bottle',        'Botella',               'medio',   1),
  ('wine glass',    'Copa de vidrio',        'medio',   1),
  ('sports ball',   'Balón (proyectil)',     'bajo',    0),
  ('skateboard',    'Patineta',              'bajo',    0),
  ('tennis racket', 'Raqueta',               'bajo',    0),
  ('cell phone',    'Celular (uso indebido)','bajo',    0),
  ('laptop',        'Equipo no autorizado',  'bajo',    0)
ON DUPLICATE KEY UPDATE etiqueta = VALUES(etiqueta), nivel = VALUES(nivel);

SELECT clase, etiqueta, nivel, activo FROM objeto_peligroso ORDER BY FIELD(nivel,'critico','alto','medio','bajo');
