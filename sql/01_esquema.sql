-- ============================================================================
-- Smart Campus IA — FASE 1
-- Esquema de la base de datos
--
-- Motor:  MariaDB 10.2+ / MySQL 8+
-- Juego:  utf8mb4_unicode_ci (acentos y ñ)
-- Fechas: DATETIME en UTC. La conversión a America/Tegucigalpa es de la UI.
--
-- Ejecutar:
--   C:\xampp\mysql\bin\mysql.exe -u root -p smart_campus < sql\01_esquema.sql
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Borrado en orden inverso de dependencias, para poder reejecutar el script.
DROP TABLE IF EXISTS auditoria;
DROP TABLE IF EXISTS notificacion;
DROP TABLE IF EXISTS pago;
DROP TABLE IF EXISTS cargo;
DROP TABLE IF EXISTS concepto_pago;
DROP TABLE IF EXISTS material;
DROP TABLE IF EXISTS incidencia;
DROP TABLE IF EXISTS asistencia;
DROP TABLE IF EXISTS nota_periodo;
DROP TABLE IF EXISTS nota;
DROP TABLE IF EXISTS evaluacion;
DROP TABLE IF EXISTS ponderacion;
DROP TABLE IF EXISTS tipo_evaluacion;
DROP TABLE IF EXISTS inscripcion;
DROP TABLE IF EXISTS horario;
DROP TABLE IF EXISTS clase;
DROP TABLE IF EXISTS asignatura;
DROP TABLE IF EXISTS matricula;
DROP TABLE IF EXISTS alumno_encargado;
DROP TABLE IF EXISTS encargado;
DROP TABLE IF EXISTS alumno;
DROP TABLE IF EXISTS intento_login;
DROP TABLE IF EXISTS sesion_refresh;
DROP TABLE IF EXISTS usuario;
DROP TABLE IF EXISTS persona;
DROP TABLE IF EXISTS rol;
DROP TABLE IF EXISTS bloque_horario;
DROP TABLE IF EXISTS aula;
DROP TABLE IF EXISTS seccion;
DROP TABLE IF EXISTS grado;
DROP TABLE IF EXISTS carrera;
DROP TABLE IF EXISTS periodo;
DROP TABLE IF EXISTS anio_lectivo;
DROP TABLE IF EXISTS config_sistema;

SET FOREIGN_KEY_CHECKS = 1;


-- ============================================================================
-- 1. CONFIGURACIÓN Y CALENDARIO
-- ============================================================================

-- Parámetros del sistema. Nada de reglas de negocio quemadas en el código:
-- la nota mínima, el redondeo y los umbrales se cambian aquí sin recompilar.
CREATE TABLE config_sistema (
  clave           VARCHAR(60)   NOT NULL,
  valor           VARCHAR(255)  NOT NULL,
  tipo            ENUM('texto','entero','decimal','booleano','json') NOT NULL DEFAULT 'texto',
  descripcion     VARCHAR(255)  NULL,
  editable        TINYINT(1)    NOT NULL DEFAULT 1,
  actualizado_en  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Sin esta tabla el sistema colapsa al iniciar el segundo año lectivo.
CREATE TABLE anio_lectivo (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  anio          SMALLINT UNSIGNED NOT NULL,
  nombre        VARCHAR(60)   NOT NULL,
  fecha_inicio  DATE          NOT NULL,
  fecha_fin     DATE          NOT NULL,
  estado        ENUM('planificado','activo','cerrado') NOT NULL DEFAULT 'planificado',
  creado_en     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_anio (anio),
  CONSTRAINT ck_anio_fechas CHECK (fecha_fin > fecha_inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Parciales I a IV. El estado controla si el maestro puede digitar notas.
CREATE TABLE periodo (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  anio_lectivo_id  INT UNSIGNED NOT NULL,
  numero           TINYINT UNSIGNED NOT NULL,
  nombre           VARCHAR(40)  NOT NULL,
  fecha_inicio     DATE         NOT NULL,
  fecha_fin        DATE         NOT NULL,
  estado           ENUM('planificado','abierto','cerrado') NOT NULL DEFAULT 'planificado',
  cerrado_en       DATETIME     NULL,
  cerrado_por      INT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_periodo (anio_lectivo_id, numero),
  KEY ix_periodo_estado (estado),
  CONSTRAINT fk_periodo_anio FOREIGN KEY (anio_lectivo_id) REFERENCES anio_lectivo(id) ON DELETE RESTRICT,
  CONSTRAINT ck_periodo_numero CHECK (numero BETWEEN 1 AND 4),
  CONSTRAINT ck_periodo_fechas CHECK (fecha_fin > fecha_inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- 2. ESTRUCTURA ACADÉMICA
-- ============================================================================

CREATE TABLE carrera (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo   VARCHAR(20)  NOT NULL,
  nombre   VARCHAR(120) NOT NULL,
  activa   TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_carrera_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 7.º a 9.º son Ciclo Común y no tienen carrera (carrera_id NULL).
-- 10.º a 12.º existen una vez por cada carrera del BTP.
--
-- carrera_key existe porque MySQL permite valores NULL repetidos en un índice
-- único: sin ella se podrían crear dos "7.º grado" sin que la base lo impida.
CREATE TABLE grado (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  numero      TINYINT UNSIGNED NOT NULL,
  nombre      VARCHAR(80)  NOT NULL,
  nivel       ENUM('CICLO_COMUN','BTP') NOT NULL,
  carrera_id  INT UNSIGNED NULL,
  carrera_key INT UNSIGNED AS (COALESCE(carrera_id, 0)) STORED,
  activo      TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_grado (numero, carrera_key),
  CONSTRAINT fk_grado_carrera FOREIGN KEY (carrera_id) REFERENCES carrera(id) ON DELETE RESTRICT,
  CONSTRAINT ck_grado_numero CHECK (numero BETWEEN 7 AND 12),
  CONSTRAINT ck_grado_nivel CHECK (
    (nivel = 'CICLO_COMUN' AND carrera_id IS NULL AND numero BETWEEN 7 AND 9) OR
    (nivel = 'BTP'         AND carrera_id IS NOT NULL AND numero BETWEEN 10 AND 12)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE aula (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo     VARCHAR(20)  NOT NULL,
  nombre     VARCHAR(80)  NOT NULL,
  capacidad  SMALLINT UNSIGNED NOT NULL DEFAULT 40,
  tipo       ENUM('aula','laboratorio','taller','otro') NOT NULL DEFAULT 'aula',
  activa     TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aula_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Un grado con 80 alumnos no es un solo grupo. La sección es la unidad real
-- de pase de lista y de horario.
CREATE TABLE seccion (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  grado_id         INT UNSIGNED NOT NULL,
  anio_lectivo_id  INT UNSIGNED NOT NULL,
  letra            CHAR(2)      NOT NULL,
  cupo_maximo      SMALLINT UNSIGNED NOT NULL DEFAULT 35,
  aula_id          INT UNSIGNED NULL,
  activa           TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_seccion (grado_id, anio_lectivo_id, letra),
  KEY ix_seccion_anio (anio_lectivo_id),
  CONSTRAINT fk_seccion_grado FOREIGN KEY (grado_id) REFERENCES grado(id) ON DELETE RESTRICT,
  CONSTRAINT fk_seccion_anio  FOREIGN KEY (anio_lectivo_id) REFERENCES anio_lectivo(id) ON DELETE RESTRICT,
  CONSTRAINT fk_seccion_aula  FOREIGN KEY (aula_id) REFERENCES aula(id) ON DELETE SET NULL,
  CONSTRAINT ck_seccion_cupo CHECK (cupo_maximo BETWEEN 1 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE bloque_horario (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  orden        TINYINT UNSIGNED NOT NULL,
  nombre       VARCHAR(40)  NOT NULL,
  hora_inicio  TIME         NOT NULL,
  hora_fin     TIME         NOT NULL,
  es_receso    TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bloque_orden (orden),
  CONSTRAINT ck_bloque_horas CHECK (hora_fin > hora_inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- 3. PERSONAS, USUARIOS Y ACCESO
-- ============================================================================

CREATE TABLE rol (
  id      TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo  VARCHAR(20)  NOT NULL,
  nombre  VARCHAR(60)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rol_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Datos personales, compartidos por alumnos, maestros, asesores y encargados.
-- Separar persona de usuario permite que un encargado exista sin tener acceso
-- al sistema, y que un maestro cambie de rol sin duplicar sus datos.
CREATE TABLE persona (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  identidad         VARCHAR(20)  NULL,
  primer_nombre     VARCHAR(60)  NOT NULL,
  segundo_nombre    VARCHAR(60)  NULL,
  primer_apellido   VARCHAR(60)  NOT NULL,
  segundo_apellido  VARCHAR(60)  NULL,
  fecha_nacimiento  DATE         NULL,
  sexo              ENUM('M','F','otro') NULL,
  direccion         VARCHAR(255) NULL,
  telefono          VARCHAR(25)  NULL,
  correo            VARCHAR(120) NULL,
  foto_ruta         VARCHAR(255) NULL,
  creado_en         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_persona_identidad (identidad),
  KEY ix_persona_apellidos (primer_apellido, primer_nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE usuario (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  persona_id            INT UNSIGNED NOT NULL,
  rol_id                TINYINT UNSIGNED NOT NULL,
  usuario               VARCHAR(60)  NOT NULL,
  password_hash         VARCHAR(255) NOT NULL,
  estado                ENUM('activo','inactivo','bloqueado') NOT NULL DEFAULT 'activo',
  debe_cambiar_password TINYINT(1)   NOT NULL DEFAULT 1,
  intentos_fallidos     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_hasta       DATETIME     NULL,
  ultimo_acceso         DATETIME     NULL,
  password_cambiado_en  DATETIME     NULL,
  creado_por            INT UNSIGNED NULL,
  creado_en             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_usuario_nombre (usuario),
  UNIQUE KEY uk_usuario_persona (persona_id),
  KEY ix_usuario_rol (rol_id),
  CONSTRAINT fk_usuario_persona FOREIGN KEY (persona_id) REFERENCES persona(id) ON DELETE RESTRICT,
  CONSTRAINT fk_usuario_rol     FOREIGN KEY (rol_id) REFERENCES rol(id) ON DELETE RESTRICT,
  CONSTRAINT fk_usuario_creador FOREIGN KEY (creado_por) REFERENCES usuario(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Solo se guarda el hash del refresh token: si alguien lee la base, no puede
-- suplantar sesiones activas.
CREATE TABLE sesion_refresh (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id  INT UNSIGNED NOT NULL,
  token_hash  CHAR(64)     NOT NULL,
  expira_en   DATETIME     NOT NULL,
  revocado_en DATETIME     NULL,
  ip          VARCHAR(45)  NULL,
  user_agent  VARCHAR(255) NULL,
  creado_en   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sesion_token (token_hash),
  KEY ix_sesion_usuario (usuario_id, expira_en),
  CONSTRAINT fk_sesion_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE intento_login (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_txt  VARCHAR(60)  NOT NULL,
  usuario_id   INT UNSIGNED NULL,
  exitoso      TINYINT(1)   NOT NULL,
  ip           VARCHAR(45)  NULL,
  user_agent   VARCHAR(255) NULL,
  fecha_hora   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_intento_usuario (usuario_txt, fecha_hora),
  KEY ix_intento_ip (ip, fecha_hora)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- 4. ALUMNOS, ENCARGADOS Y MATRÍCULA
-- ============================================================================

CREATE TABLE alumno (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  persona_id     INT UNSIGNED NOT NULL,
  codigo         VARCHAR(20)  NOT NULL,
  fecha_ingreso  DATE         NOT NULL,
  estado         ENUM('activo','retirado','egresado','trasladado') NOT NULL DEFAULT 'activo',
  observaciones  TEXT         NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_alumno_persona (persona_id),
  UNIQUE KEY uk_alumno_codigo (codigo),
  KEY ix_alumno_estado (estado),
  CONSTRAINT fk_alumno_persona FOREIGN KEY (persona_id) REFERENCES persona(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE encargado (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  persona_id   INT UNSIGNED NOT NULL,
  ocupacion    VARCHAR(80)  NULL,
  lugar_trabajo VARCHAR(120) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_encargado_persona (persona_id),
  CONSTRAINT fk_encargado_persona FOREIGN KEY (persona_id) REFERENCES persona(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Un alumno puede tener varios encargados (padre, madre, tutor legal) y un
-- encargado puede tener varios hijos en el colegio.
CREATE TABLE alumno_encargado (
  alumno_id      INT UNSIGNED NOT NULL,
  encargado_id   INT UNSIGNED NOT NULL,
  parentesco     ENUM('padre','madre','tutor','otro') NOT NULL DEFAULT 'tutor',
  es_principal   TINYINT(1)   NOT NULL DEFAULT 0,
  puede_retirar  TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (alumno_id, encargado_id),
  KEY ix_ae_encargado (encargado_id),
  CONSTRAINT fk_ae_alumno    FOREIGN KEY (alumno_id) REFERENCES alumno(id) ON DELETE CASCADE,
  CONSTRAINT fk_ae_encargado FOREIGN KEY (encargado_id) REFERENCES encargado(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Un alumno se matricula una sola vez por año lectivo. Esa restricción única
-- es la que hace posible el historial y la promoción de grado.
CREATE TABLE matricula (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  alumno_id        INT UNSIGNED NOT NULL,
  anio_lectivo_id  INT UNSIGNED NOT NULL,
  seccion_id       INT UNSIGNED NOT NULL,
  fecha_matricula  DATE         NOT NULL,
  estado           ENUM('activa','retirada','trasladada','egresada') NOT NULL DEFAULT 'activa',
  registrado_por   INT UNSIGNED NULL,
  observaciones    VARCHAR(255) NULL,
  creado_en        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_matricula (alumno_id, anio_lectivo_id),
  KEY ix_matricula_seccion (seccion_id, estado),
  CONSTRAINT fk_matricula_alumno  FOREIGN KEY (alumno_id) REFERENCES alumno(id) ON DELETE RESTRICT,
  CONSTRAINT fk_matricula_anio    FOREIGN KEY (anio_lectivo_id) REFERENCES anio_lectivo(id) ON DELETE RESTRICT,
  CONSTRAINT fk_matricula_seccion FOREIGN KEY (seccion_id) REFERENCES seccion(id) ON DELETE RESTRICT,
  CONSTRAINT fk_matricula_usuario FOREIGN KEY (registrado_por) REFERENCES usuario(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- 5. CLASES Y HORARIOS
-- ============================================================================

-- Catálogo de materias: "Matemáticas", "Programación I".
CREATE TABLE asignatura (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo       VARCHAR(20)  NOT NULL,
  nombre       VARCHAR(120) NOT NULL,
  descripcion  VARCHAR(255) NULL,
  activa       TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asignatura_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Una clase es una asignatura concreta impartida a una sección concreta por un
-- maestro concreto en un año concreto. Es la unidad sobre la que giran notas,
-- asistencia y material.
CREATE TABLE clase (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  asignatura_id    INT UNSIGNED NOT NULL,
  seccion_id       INT UNSIGNED NOT NULL,
  maestro_id       INT UNSIGNED NULL,
  anio_lectivo_id  INT UNSIGNED NOT NULL,
  activa           TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_clase (asignatura_id, seccion_id, anio_lectivo_id),
  KEY ix_clase_maestro (maestro_id, anio_lectivo_id),
  KEY ix_clase_seccion (seccion_id, activa),
  CONSTRAINT fk_clase_asignatura FOREIGN KEY (asignatura_id) REFERENCES asignatura(id) ON DELETE RESTRICT,
  CONSTRAINT fk_clase_seccion    FOREIGN KEY (seccion_id) REFERENCES seccion(id) ON DELETE RESTRICT,
  CONSTRAINT fk_clase_maestro    FOREIGN KEY (maestro_id) REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT fk_clase_anio       FOREIGN KEY (anio_lectivo_id) REFERENCES anio_lectivo(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- maestro_id, seccion_id y anio_lectivo_id se repiten aquí a propósito, aunque
-- se puedan deducir de clase_id. Es la única forma de que la BASE DE DATOS
-- rechace los choques de horario con índices únicos, en vez de depender de que
-- el backend se acuerde de validarlos. Se mantienen sincronizados por trigger.
CREATE TABLE horario (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  clase_id           INT UNSIGNED NOT NULL,
  bloque_horario_id  INT UNSIGNED NOT NULL,
  dia_semana         TINYINT UNSIGNED NOT NULL,
  aula_id            INT UNSIGNED NOT NULL,
  maestro_id         INT UNSIGNED NULL,
  seccion_id         INT UNSIGNED NOT NULL,
  anio_lectivo_id    INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_horario_seccion (anio_lectivo_id, seccion_id, dia_semana, bloque_horario_id),
  UNIQUE KEY uk_horario_aula    (anio_lectivo_id, aula_id,    dia_semana, bloque_horario_id),
  UNIQUE KEY uk_horario_maestro (anio_lectivo_id, maestro_id, dia_semana, bloque_horario_id),
  KEY ix_horario_clase (clase_id),
  CONSTRAINT fk_horario_clase   FOREIGN KEY (clase_id) REFERENCES clase(id) ON DELETE CASCADE,
  CONSTRAINT fk_horario_bloque  FOREIGN KEY (bloque_horario_id) REFERENCES bloque_horario(id) ON DELETE RESTRICT,
  CONSTRAINT fk_horario_aula    FOREIGN KEY (aula_id) REFERENCES aula(id) ON DELETE RESTRICT,
  CONSTRAINT fk_horario_maestro FOREIGN KEY (maestro_id) REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT fk_horario_seccion FOREIGN KEY (seccion_id) REFERENCES seccion(id) ON DELETE CASCADE,
  CONSTRAINT fk_horario_anio    FOREIGN KEY (anio_lectivo_id) REFERENCES anio_lectivo(id) ON DELETE RESTRICT,
  CONSTRAINT ck_horario_dia CHECK (dia_semana BETWEEN 1 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- La matrícula dispara la inscripción automática a todas las clases activas de
-- la sección. Se guarda explícitamente y no se deduce, porque un alumno puede
-- retirarse de una clase sin retirarse del colegio.
CREATE TABLE inscripcion (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  matricula_id  INT UNSIGNED NOT NULL,
  alumno_id     INT UNSIGNED NOT NULL,
  clase_id      INT UNSIGNED NOT NULL,
  estado        ENUM('activa','retirada') NOT NULL DEFAULT 'activa',
  fecha         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_inscripcion (alumno_id, clase_id),
  KEY ix_inscripcion_clase (clase_id, estado),
  KEY ix_inscripcion_matricula (matricula_id),
  CONSTRAINT fk_inscripcion_matricula FOREIGN KEY (matricula_id) REFERENCES matricula(id) ON DELETE CASCADE,
  CONSTRAINT fk_inscripcion_alumno    FOREIGN KEY (alumno_id) REFERENCES alumno(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inscripcion_clase     FOREIGN KEY (clase_id) REFERENCES clase(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- 6. EVALUACIÓN Y NOTAS
-- ============================================================================

CREATE TABLE tipo_evaluacion (
  id           TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo       VARCHAR(20)  NOT NULL,
  nombre       VARCHAR(60)  NOT NULL,
  es_extra     TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tipoeval_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- La ponderación la define el administrador. El maestro no puede tocarla una
-- vez que el periodo está abierto: eso lo hace cumplir el backend (Fase 4).
CREATE TABLE ponderacion (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  clase_id            INT UNSIGNED NOT NULL,
  periodo_id          INT UNSIGNED NOT NULL,
  tipo_evaluacion_id  TINYINT UNSIGNED NOT NULL,
  porcentaje          DECIMAL(5,2) NOT NULL,
  definido_por        INT UNSIGNED NULL,
  creado_en           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ponderacion (clase_id, periodo_id, tipo_evaluacion_id),
  KEY ix_ponderacion_periodo (periodo_id),
  CONSTRAINT fk_pond_clase   FOREIGN KEY (clase_id) REFERENCES clase(id) ON DELETE CASCADE,
  CONSTRAINT fk_pond_periodo FOREIGN KEY (periodo_id) REFERENCES periodo(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pond_tipo    FOREIGN KEY (tipo_evaluacion_id) REFERENCES tipo_evaluacion(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pond_usuario FOREIGN KEY (definido_por) REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_pond_rango CHECK (porcentaje >= 0 AND porcentaje <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Una evaluación concreta: "Tarea 1", "Examen del II Parcial".
CREATE TABLE evaluacion (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  clase_id            INT UNSIGNED NOT NULL,
  periodo_id          INT UNSIGNED NOT NULL,
  tipo_evaluacion_id  TINYINT UNSIGNED NOT NULL,
  titulo              VARCHAR(120) NOT NULL,
  descripcion         VARCHAR(255) NULL,
  puntaje_maximo      DECIMAL(6,2) NOT NULL DEFAULT 100.00,
  fecha               DATE         NOT NULL,
  creado_por          INT UNSIGNED NULL,
  activa              TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_evaluacion_clase (clase_id, periodo_id, activa),
  KEY ix_evaluacion_tipo (tipo_evaluacion_id),
  CONSTRAINT fk_eval_clase   FOREIGN KEY (clase_id) REFERENCES clase(id) ON DELETE CASCADE,
  CONSTRAINT fk_eval_periodo FOREIGN KEY (periodo_id) REFERENCES periodo(id) ON DELETE RESTRICT,
  CONSTRAINT fk_eval_tipo    FOREIGN KEY (tipo_evaluacion_id) REFERENCES tipo_evaluacion(id) ON DELETE RESTRICT,
  CONSTRAINT fk_eval_usuario FOREIGN KEY (creado_por) REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_eval_puntaje CHECK (puntaje_maximo > 0 AND puntaje_maximo <= 1000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- El puntaje no puede exceder el máximo de su evaluación: eso lo verifica un
-- trigger, porque un CHECK no puede consultar otra tabla.
CREATE TABLE nota (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  evaluacion_id   INT UNSIGNED NOT NULL,
  alumno_id       INT UNSIGNED NOT NULL,
  puntaje         DECIMAL(6,2) NOT NULL,
  observacion     VARCHAR(255) NULL,
  registrado_por  INT UNSIGNED NULL,
  creado_en       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_nota (evaluacion_id, alumno_id),
  KEY ix_nota_alumno (alumno_id),
  CONSTRAINT fk_nota_evaluacion FOREIGN KEY (evaluacion_id) REFERENCES evaluacion(id) ON DELETE CASCADE,
  CONSTRAINT fk_nota_alumno     FOREIGN KEY (alumno_id) REFERENCES alumno(id) ON DELETE RESTRICT,
  CONSTRAINT fk_nota_usuario    FOREIGN KEY (registrado_por) REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_nota_positiva CHECK (puntaje >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Nota consolidada del alumno en una clase y periodo. Se recalcula al digitar
-- notas y queda bloqueada al cerrar el periodo.
--
-- La columna `aprobado` NO se calcula aquí con un valor fijo de 70: se guarda
-- también la nota mínima vigente al momento del cálculo, para que un cambio
-- futuro de la regla no reescriba la historia académica.
CREATE TABLE nota_periodo (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  alumno_id         INT UNSIGNED NOT NULL,
  clase_id          INT UNSIGNED NOT NULL,
  periodo_id        INT UNSIGNED NOT NULL,
  nota_final        DECIMAL(5,2) NOT NULL,
  puntos_extra      DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  nota_minima_aplicada DECIMAL(5,2) NOT NULL DEFAULT 70.00,
  aprobado          TINYINT(1)   NOT NULL,
  bloqueada         TINYINT(1)   NOT NULL DEFAULT 0,
  detalle_calculo   TEXT         NULL,
  calculado_en      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_nota_periodo (alumno_id, clase_id, periodo_id),
  KEY ix_np_clase (clase_id, periodo_id),
  KEY ix_np_aprobado (aprobado),
  CONSTRAINT fk_np_alumno  FOREIGN KEY (alumno_id) REFERENCES alumno(id) ON DELETE RESTRICT,
  CONSTRAINT fk_np_clase   FOREIGN KEY (clase_id) REFERENCES clase(id) ON DELETE CASCADE,
  CONSTRAINT fk_np_periodo FOREIGN KEY (periodo_id) REFERENCES periodo(id) ON DELETE RESTRICT,
  CONSTRAINT ck_np_rango CHECK (nota_final >= 0 AND nota_final <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- 7. ASISTENCIA Y COMPORTAMIENTO
-- ============================================================================

-- La clave única (clase, alumno, fecha) impide el pase de lista duplicado,
-- que es el error operativo más común en estos sistemas.
CREATE TABLE asistencia (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  clase_id        INT UNSIGNED NOT NULL,
  alumno_id       INT UNSIGNED NOT NULL,
  fecha           DATE         NOT NULL,
  estado          ENUM('presente','ausente','tarde','justificado') NOT NULL,
  observacion     VARCHAR(255) NULL,
  registrado_por  INT UNSIGNED NULL,
  creado_en       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asistencia (clase_id, alumno_id, fecha),
  KEY ix_asistencia_alumno (alumno_id, fecha),
  KEY ix_asistencia_fecha (fecha, estado),
  CONSTRAINT fk_asis_clase   FOREIGN KEY (clase_id) REFERENCES clase(id) ON DELETE CASCADE,
  CONSTRAINT fk_asis_alumno  FOREIGN KEY (alumno_id) REFERENCES alumno(id) ON DELETE RESTRICT,
  CONSTRAINT fk_asis_usuario FOREIGN KEY (registrado_por) REFERENCES usuario(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE incidencia (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  alumno_id             INT UNSIGNED NOT NULL,
  clase_id              INT UNSIGNED NULL,
  anio_lectivo_id       INT UNSIGNED NOT NULL,
  gravedad              ENUM('leve','grave','muy_grave') NOT NULL,
  descripcion           TEXT         NOT NULL,
  fecha_hora            DATETIME     NOT NULL,
  evidencia_ruta        VARCHAR(255) NULL,
  medida_disciplinaria  VARCHAR(255) NULL,
  estado                ENUM('abierta','en_proceso','resuelta') NOT NULL DEFAULT 'abierta',
  encargado_notificado  TINYINT(1)   NOT NULL DEFAULT 0,
  notificado_en         DATETIME     NULL,
  registrado_por        INT UNSIGNED NULL,
  resuelto_por          INT UNSIGNED NULL,
  resuelto_en           DATETIME     NULL,
  creado_en             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_incidencia_alumno (alumno_id, fecha_hora),
  KEY ix_incidencia_estado (estado, gravedad),
  CONSTRAINT fk_inc_alumno   FOREIGN KEY (alumno_id) REFERENCES alumno(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inc_clase    FOREIGN KEY (clase_id) REFERENCES clase(id) ON DELETE SET NULL,
  CONSTRAINT fk_inc_anio     FOREIGN KEY (anio_lectivo_id) REFERENCES anio_lectivo(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inc_registro FOREIGN KEY (registrado_por) REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT fk_inc_resuelve FOREIGN KEY (resuelto_por) REFERENCES usuario(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- 8. REPOSITORIO DIDÁCTICO
-- ============================================================================

-- nombre_original es lo que ve el usuario; nombre_servidor es el que se guarda
-- en disco, generado por el backend. Nunca se confía en el nombre del archivo
-- subido: es la vía clásica de path traversal.
CREATE TABLE material (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  clase_id         INT UNSIGNED NOT NULL,
  titulo           VARCHAR(150) NOT NULL,
  descripcion      VARCHAR(255) NULL,
  nombre_original  VARCHAR(255) NOT NULL,
  nombre_servidor  VARCHAR(120) NOT NULL,
  mime_type        VARCHAR(100) NOT NULL,
  tamano_bytes     INT UNSIGNED NOT NULL,
  sha256           CHAR(64)     NULL,
  texto_extraido   MEDIUMTEXT   NULL,
  subido_por       INT UNSIGNED NULL,
  creado_en        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_material_servidor (nombre_servidor),
  KEY ix_material_clase (clase_id, creado_en),
  CONSTRAINT fk_material_clase   FOREIGN KEY (clase_id) REFERENCES clase(id) ON DELETE CASCADE,
  CONSTRAINT fk_material_usuario FOREIGN KEY (subido_por) REFERENCES usuario(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- 9. FINANZAS
-- ============================================================================

CREATE TABLE concepto_pago (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo         VARCHAR(20)  NOT NULL,
  nombre         VARCHAR(120) NOT NULL,
  tipo           ENUM('matricula','mensualidad','otro') NOT NULL,
  monto_default  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  activo         TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_concepto_codigo (codigo),
  CONSTRAINT ck_concepto_monto CHECK (monto_default >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Un cargo es una deuda generada. El estado 'mora' lo calcula un proceso
-- programado comparando fecha_vencimiento contra la fecha actual.
CREATE TABLE cargo (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  alumno_id         INT UNSIGNED NOT NULL,
  anio_lectivo_id   INT UNSIGNED NOT NULL,
  concepto_id       INT UNSIGNED NOT NULL,
  mes               TINYINT UNSIGNED NULL,
  monto             DECIMAL(10,2) NOT NULL,
  monto_mora        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  descuento         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  fecha_vencimiento DATE          NOT NULL,
  estado            ENUM('pendiente','pagado','mora','exonerado','anulado') NOT NULL DEFAULT 'pendiente',
  creado_en         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cargo (alumno_id, anio_lectivo_id, concepto_id, mes),
  KEY ix_cargo_estado (estado, fecha_vencimiento),
  KEY ix_cargo_alumno (alumno_id, anio_lectivo_id),
  CONSTRAINT fk_cargo_alumno   FOREIGN KEY (alumno_id) REFERENCES alumno(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cargo_anio     FOREIGN KEY (anio_lectivo_id) REFERENCES anio_lectivo(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cargo_concepto FOREIGN KEY (concepto_id) REFERENCES concepto_pago(id) ON DELETE RESTRICT,
  CONSTRAINT ck_cargo_monto CHECK (monto >= 0 AND monto_mora >= 0 AND descuento >= 0),
  CONSTRAINT ck_cargo_mes CHECK (mes IS NULL OR mes BETWEEN 1 AND 12)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE pago (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cargo_id        INT UNSIGNED NOT NULL,
  numero_recibo   VARCHAR(30)  NOT NULL,
  monto           DECIMAL(10,2) NOT NULL,
  fecha_pago      DATETIME     NOT NULL,
  metodo          ENUM('efectivo','transferencia','deposito','otro') NOT NULL DEFAULT 'efectivo',
  referencia      VARCHAR(60)  NULL,
  observacion     VARCHAR(255) NULL,
  anulado         TINYINT(1)   NOT NULL DEFAULT 0,
  anulado_motivo  VARCHAR(255) NULL,
  registrado_por  INT UNSIGNED NULL,
  creado_en       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pago_recibo (numero_recibo),
  KEY ix_pago_cargo (cargo_id),
  KEY ix_pago_fecha (fecha_pago),
  CONSTRAINT fk_pago_cargo   FOREIGN KEY (cargo_id) REFERENCES cargo(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pago_usuario FOREIGN KEY (registrado_por) REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_pago_monto CHECK (monto > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- 10. NOTIFICACIONES INTERNAS
-- ============================================================================

-- Bandeja dentro del sistema. No hay correo externo: es un requisito, no una
-- limitación que haya que rodear.
CREATE TABLE notificacion (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id   INT UNSIGNED NOT NULL,
  tipo         ENUM('nota','asistencia','pago','incidencia','sistema') NOT NULL,
  titulo       VARCHAR(150) NOT NULL,
  mensaje      TEXT         NOT NULL,
  enlace       VARCHAR(255) NULL,
  leida        TINYINT(1)   NOT NULL DEFAULT 0,
  leida_en     DATETIME     NULL,
  creado_en    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_notif_usuario (usuario_id, leida, creado_en),
  CONSTRAINT fk_notif_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- 11. AUDITORÍA
-- ============================================================================

-- Sin claves foráneas a propósito: si algún día se borra un usuario, su rastro
-- de auditoría debe sobrevivir. Un registro de auditoría que desaparece con el
-- responsable no sirve de nada.
--
-- El usuario sc_app solo tendrá INSERT y SELECT sobre esta tabla (ver el
-- script 04). Los triggers la escriben con DEFINER=root.
CREATE TABLE auditoria (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id      INT UNSIGNED NULL,
  rol             VARCHAR(20)  NULL,
  accion          ENUM('INSERT','UPDATE','DELETE','LOGIN','LOGOUT','LOGIN_FALLIDO','EXPORT','OTRO') NOT NULL,
  entidad         VARCHAR(60)  NOT NULL,
  entidad_id      BIGINT UNSIGNED NULL,
  valor_anterior  LONGTEXT     NULL,
  valor_nuevo     LONGTEXT     NULL,
  origen          ENUM('app','trigger') NOT NULL DEFAULT 'app',
  ip              VARCHAR(45)  NULL,
  user_agent      VARCHAR(255) NULL,
  fecha_hora      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_auditoria_usuario (usuario_id, fecha_hora),
  KEY ix_auditoria_entidad (entidad, entidad_id),
  KEY ix_auditoria_fecha (fecha_hora)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- VISTAS DE APOYO
-- ============================================================================

-- Nombre completo armado una sola vez, para no repetir CONCAT en cada consulta.
CREATE OR REPLACE VIEW v_persona_nombre AS
SELECT
  p.id AS persona_id,
  TRIM(CONCAT_WS(' ', p.primer_nombre, p.segundo_nombre)) AS nombres,
  TRIM(CONCAT_WS(' ', p.primer_apellido, p.segundo_apellido)) AS apellidos,
  TRIM(CONCAT_WS(' ', p.primer_nombre, p.segundo_nombre, p.primer_apellido, p.segundo_apellido)) AS nombre_completo
FROM persona p;


-- Alumnos con su matrícula vigente. Es la consulta más repetida del sistema.
CREATE OR REPLACE VIEW v_alumno_actual AS
SELECT
  a.id            AS alumno_id,
  a.codigo,
  vn.nombre_completo,
  m.id            AS matricula_id,
  m.anio_lectivo_id,
  al.anio,
  s.id            AS seccion_id,
  s.letra,
  g.id            AS grado_id,
  g.numero        AS grado_numero,
  g.nombre        AS grado_nombre,
  g.nivel,
  c.nombre        AS carrera
FROM alumno a
JOIN persona p          ON p.id = a.persona_id
JOIN v_persona_nombre vn ON vn.persona_id = p.id
JOIN matricula m        ON m.alumno_id = a.id AND m.estado = 'activa'
JOIN anio_lectivo al    ON al.id = m.anio_lectivo_id
JOIN seccion s          ON s.id = m.seccion_id
JOIN grado g            ON g.id = s.grado_id
LEFT JOIN carrera c     ON c.id = g.carrera_id;
