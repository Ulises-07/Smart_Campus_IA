-- ============================================================================
-- Smart Campus IA — FASE 1
-- Datos semilla: lo mínimo indispensable para que el sistema arranque
--
-- Ejecutar DESPUÉS de 02_triggers.sql:
--   C:\xampp\mysql\bin\mysql.exe -u root -p smart_campus < sql\03_datos_semilla.sql
--
-- Este script contiene solo catálogos y configuración. Los alumnos, notas y
-- asistencias de demostración se generan aparte con:
--   npm run demo
-- ============================================================================

SET NAMES utf8mb4;

-- Los triggers de auditoría registrarán esta carga como acción del sistema.
SET @app_usuario_id = NULL;
SET @app_rol = 'sistema';
SET @app_ip = '127.0.0.1';


-- ============================================================================
-- CONFIGURACIÓN DEL SISTEMA
-- ============================================================================

INSERT INTO config_sistema (clave, valor, tipo, descripcion, editable) VALUES
  ('institucion.nombre',        'Instituto Smart Campus',  'texto',    'Nombre oficial del centro educativo', 1),
  ('institucion.codigo',        'SC-0001',                 'texto',    'Codigo del centro ante la Secretaria de Educacion', 1),
  ('institucion.zona_horaria',  'America/Tegucigalpa',     'texto',    'Zona horaria para la interfaz', 0),

  -- --- Reglas de calificación ---
  ('notas.minima_aprobacion',   '70.00',                   'decimal',  'Nota minima para aprobar, sobre 100', 1),
  ('notas.decimales',           '2',                       'entero',   'Decimales que se conservan en la nota final', 1),
  ('notas.modo_redondeo',       'DECIMALES_2',             'texto',    'DECIMALES_2 = redondea a dos decimales (69.9 reprueba). ENTERO = redondea al entero mas cercano (69.5 aprueba).', 1),
  ('notas.tope_maximo',         '100.00',                  'decimal',  'Tope absoluto: los puntos extra nunca superan este valor', 0),
  ('notas.periodos_por_anio',   '4',                       'entero',   'Cantidad de parciales del ano lectivo', 1),

  -- --- Asistencia ---
  ('asistencia.umbral_alerta',  '15',                      'entero',   'Porcentaje de inasistencia que dispara alerta automatica', 1),
  ('asistencia.tarde_equivale', '0.5',                     'decimal',  'Cuantas ausencias equivale una llegada tarde', 1),

  -- --- Seguridad ---
  ('seguridad.intentos_maximos','5',                       'entero',   'Intentos fallidos antes de bloquear la cuenta', 1),
  ('seguridad.bloqueo_minutos', '15',                      'entero',   'Minutos que dura el bloqueo por intentos fallidos', 1),
  ('seguridad.password_min',    '10',                      'entero',   'Longitud minima de contrasena', 1),

  -- --- Finanzas ---
  ('finanzas.moneda',           'HNL',                     'texto',    'Moneda del sistema (Lempira hondureno)', 1),
  ('finanzas.mora_porcentaje',  '5.00',                    'decimal',  'Porcentaje de mora mensual sobre el saldo vencido', 1),
  ('finanzas.dias_gracia',      '5',                       'entero',   'Dias despues del vencimiento antes de aplicar mora', 1),
  ('finanzas.prefijo_recibo',   'REC',                     'texto',    'Prefijo de la numeracion de recibos', 1),

  -- --- Archivos ---
  ('archivos.tamano_max_mb',    '25',                      'entero',   'Tamano maximo por archivo subido', 1),
  ('archivos.tipos_permitidos', 'pdf,docx,pptx,xlsx,jpg,jpeg,png', 'texto', 'Extensiones permitidas en el repositorio didactico', 1);


-- ============================================================================
-- ROLES
-- ============================================================================

INSERT INTO rol (id, codigo, nombre) VALUES
  (1, 'ADMIN',   'Administrador'),
  (2, 'MAESTRO', 'Maestro'),
  (3, 'ASESOR',  'Asesor de Matricula'),
  (4, 'ALUMNO',  'Alumno');


-- ============================================================================
-- AÑO LECTIVO Y PERIODOS
-- ============================================================================

INSERT INTO anio_lectivo (id, anio, nombre, fecha_inicio, fecha_fin, estado) VALUES
  (1, 2026, 'Ano Lectivo 2026', '2026-02-02', '2026-11-30', 'activo');

INSERT INTO periodo (anio_lectivo_id, numero, nombre, fecha_inicio, fecha_fin, estado) VALUES
  (1, 1, 'I Parcial',   '2026-02-02', '2026-04-10', 'abierto'),
  (1, 2, 'II Parcial',  '2026-04-13', '2026-06-19', 'planificado'),
  (1, 3, 'III Parcial', '2026-06-22', '2026-09-04', 'planificado'),
  (1, 4, 'IV Parcial',  '2026-09-07', '2026-11-20', 'planificado');


-- ============================================================================
-- ESTRUCTURA ACADÉMICA
-- ============================================================================

INSERT INTO carrera (id, codigo, nombre) VALUES
  (1, 'BTP-COMP',  'BTP en Computacion'),
  (2, 'BTP-ADMIN', 'BTP en Administracion de Empresas');

-- Ciclo Común: sin carrera. BTP: un grado por carrera.
INSERT INTO grado (numero, nombre, nivel, carrera_id) VALUES
  (7,  'Septimo Grado',  'CICLO_COMUN', NULL),
  (8,  'Octavo Grado',   'CICLO_COMUN', NULL),
  (9,  'Noveno Grado',   'CICLO_COMUN', NULL),
  (10, 'Decimo Grado — BTP Computacion',  'BTP', 1),
  (11, 'Undecimo Grado — BTP Computacion', 'BTP', 1),
  (12, 'Duodecimo Grado — BTP Computacion','BTP', 1),
  (10, 'Decimo Grado — BTP Administracion','BTP', 2),
  (11, 'Undecimo Grado — BTP Administracion','BTP', 2),
  (12, 'Duodecimo Grado — BTP Administracion','BTP', 2);


INSERT INTO aula (codigo, nombre, capacidad, tipo) VALUES
  ('A-101', 'Aula 101', 35, 'aula'),
  ('A-102', 'Aula 102', 35, 'aula'),
  ('A-103', 'Aula 103', 35, 'aula'),
  ('A-104', 'Aula 104', 35, 'aula'),
  ('A-201', 'Aula 201', 35, 'aula'),
  ('A-202', 'Aula 202', 35, 'aula'),
  ('A-203', 'Aula 203', 35, 'aula'),
  ('A-204', 'Aula 204', 35, 'aula'),
  ('LAB-1', 'Laboratorio de Computo 1', 30, 'laboratorio'),
  ('LAB-2', 'Laboratorio de Computo 2', 30, 'laboratorio'),
  ('TAL-1', 'Taller de Administracion',  30, 'taller');


-- Jornada matutina típica de un colegio hondureño.
INSERT INTO bloque_horario (orden, nombre, hora_inicio, hora_fin, es_receso) VALUES
  (1, 'Bloque 1', '07:00:00', '07:45:00', 0),
  (2, 'Bloque 2', '07:45:00', '08:30:00', 0),
  (3, 'Bloque 3', '08:30:00', '09:15:00', 0),
  (4, 'Receso',   '09:15:00', '09:35:00', 1),
  (5, 'Bloque 4', '09:35:00', '10:20:00', 0),
  (6, 'Bloque 5', '10:20:00', '11:05:00', 0),
  (7, 'Bloque 6', '11:05:00', '11:50:00', 0),
  (8, 'Bloque 7', '11:50:00', '12:35:00', 0);


-- ============================================================================
-- ASIGNATURAS
-- ============================================================================

INSERT INTO asignatura (codigo, nombre, descripcion) VALUES
  -- Tronco común
  ('MAT',  'Matematicas',              'Area de matematicas'),
  ('ESP',  'Espanol',                  'Lengua y literatura'),
  ('CN',   'Ciencias Naturales',       'Biologia, quimica y fisica basica'),
  ('CS',   'Ciencias Sociales',        'Historia, geografia y civica'),
  ('ING',  'Ingles',                   'Idioma extranjero'),
  ('EF',   'Educacion Fisica',         'Deporte y salud'),
  ('ART',  'Educacion Artistica',      'Expresion artistica'),
  ('TEC',  'Tecnologia',               'Informatica basica'),
  -- BTP Computación
  ('PRG1', 'Programacion I',           'Fundamentos de programacion'),
  ('PRG2', 'Programacion II',          'Programacion orientada a objetos'),
  ('BDD',  'Base de Datos',            'Modelado y SQL'),
  ('REDES','Redes de Computadoras',    'Fundamentos de redes'),
  ('SOP',  'Sistemas Operativos',      'Administracion de sistemas'),
  ('DSW',  'Desarrollo Web',           'HTML, CSS y JavaScript'),
  -- BTP Administración
  ('CONT1','Contabilidad I',           'Contabilidad general'),
  ('CONT2','Contabilidad II',          'Contabilidad de costos'),
  ('ADM',  'Administracion',           'Teoria administrativa'),
  ('MERC', 'Mercadotecnia',            'Fundamentos de mercadeo'),
  ('ECO',  'Economia',                 'Microeconomia y macroeconomia'),
  ('EMP',  'Emprendimiento',           'Formulacion de proyectos');


-- ============================================================================
-- TIPOS DE EVALUACIÓN
-- ============================================================================

-- PUNTO_EXTRA lleva es_extra = 1: no entra en la ponderación, se suma después
-- y nunca permite pasar de 100.
INSERT INTO tipo_evaluacion (id, codigo, nombre, es_extra) VALUES
  (1, 'TAREA',       'Tareas',       0),
  (2, 'PROYECTO',    'Proyectos',    0),
  (3, 'EXAMEN',      'Examenes',     0),
  (4, 'PUNTO_EXTRA', 'Puntos extra', 1);


-- ============================================================================
-- CONCEPTOS DE PAGO
-- ============================================================================

INSERT INTO concepto_pago (id, codigo, nombre, tipo, monto_default) VALUES
  (1, 'MATRICULA',  'Matricula anual',        'matricula',   1500.00),
  (2, 'MENSUALIDAD','Mensualidad',            'mensualidad',  900.00),
  (3, 'GRADUACION', 'Cuota de graduacion',    'otro',        1200.00),
  (4, 'CARNET',     'Carnet estudiantil',     'otro',          80.00);


-- ============================================================================
-- USUARIO ADMINISTRADOR INICIAL
-- ============================================================================
--
-- Usuario:    admin
-- Contrasena: Admin.2026.Cambiar
--
-- debe_cambiar_password = 1 obliga a cambiarla en el primer ingreso. El hash
-- es bcrypt con coste 12; la contrasena en texto plano no existe en ninguna
-- parte del sistema.
--
-- CAMBIALA APENAS ENTRES POR PRIMERA VEZ.
-- ============================================================================

INSERT INTO persona (id, identidad, primer_nombre, primer_apellido, correo) VALUES
  (1, '0501199000001', 'Administrador', 'del Sistema', 'admin@smartcampus.local');

INSERT INTO usuario (id, persona_id, rol_id, usuario, password_hash, estado, debe_cambiar_password) VALUES
  (1, 1, 1, 'admin', '$2b$12$JpnO4X3ArUmf5Sus8/84P.DFC100KXz0sPhtkXlEtgIz0nmdqoe.S', 'activo', 1);


-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================

SELECT 'Configuracion' AS catalogo, COUNT(*) AS registros FROM config_sistema
UNION ALL SELECT 'Roles',        COUNT(*) FROM rol
UNION ALL SELECT 'Anios',        COUNT(*) FROM anio_lectivo
UNION ALL SELECT 'Periodos',     COUNT(*) FROM periodo
UNION ALL SELECT 'Carreras',     COUNT(*) FROM carrera
UNION ALL SELECT 'Grados',       COUNT(*) FROM grado
UNION ALL SELECT 'Aulas',        COUNT(*) FROM aula
UNION ALL SELECT 'Bloques',      COUNT(*) FROM bloque_horario
UNION ALL SELECT 'Asignaturas',  COUNT(*) FROM asignatura
UNION ALL SELECT 'Tipos eval.',  COUNT(*) FROM tipo_evaluacion
UNION ALL SELECT 'Conceptos',    COUNT(*) FROM concepto_pago
UNION ALL SELECT 'Usuarios',     COUNT(*) FROM usuario;
