-- ============================================================================
-- Smart Campus IA — FASE 1
-- Triggers: auditoría inmutable y validaciones que el backend no puede evadir
--
-- Ejecutar DESPUÉS de 01_esquema.sql:
--   C:\xampp\mysql\bin\mysql.exe -u root -p smart_campus < sql\02_triggers.sql
--
-- Si lo ejecutas desde phpMyAdmin, cambia el delimitador a $$ en el cuadro
-- "Delimitador" al pie de la pestaña SQL, o fallará en el primer BEGIN.
--
-- ---------------------------------------------------------------------------
-- CÓMO SABE UN TRIGGER QUIÉN HIZO EL CAMBIO
--
-- MySQL solo conoce al usuario de conexión (sc_app), no al usuario de la
-- aplicación. El backend debe declarar quién actúa al inicio de cada
-- transacción que escriba datos sensibles:
--
--   SET @app_usuario_id = 42, @app_rol = 'maestro', @app_ip = '192.168.1.20';
--
-- Si no se declara, la auditoría igual se escribe, pero con usuario NULL.
-- Eso es intencional: preferimos un registro incompleto a ningún registro.
-- ============================================================================

DELIMITER $$

-- ============================================================================
-- 1. INMUTABILIDAD DE LA AUDITORÍA
--
-- Los permisos de MySQL (script 04) ya impiden que sc_app haga UPDATE o DELETE.
-- Estos triggers son la segunda capa: bloquean el intento incluso si alguien
-- se conecta como root por phpMyAdmin. Sin esto, la tabla no tiene valor
-- probatorio ante una junta directiva o una autoridad educativa.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_auditoria_no_update $$
CREATE TRIGGER trg_auditoria_no_update
BEFORE UPDATE ON auditoria
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La tabla de auditoria es inmutable: no se permite UPDATE.';
END $$

DROP TRIGGER IF EXISTS trg_auditoria_no_delete $$
CREATE TRIGGER trg_auditoria_no_delete
BEFORE DELETE ON auditoria
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La tabla de auditoria es inmutable: no se permite DELETE.';
END $$


-- ============================================================================
-- 2. VALIDACIONES DE NOTAS
--
-- Un CHECK no puede consultar otra tabla, así que estas reglas van en triggers.
-- ============================================================================

-- El puntaje no puede exceder el máximo de su evaluación.
DROP TRIGGER IF EXISTS trg_nota_valida_ins $$
CREATE TRIGGER trg_nota_valida_ins
BEFORE INSERT ON nota
FOR EACH ROW
BEGIN
  DECLARE v_max DECIMAL(6,2);
  DECLARE v_estado VARCHAR(20);

  SELECT e.puntaje_maximo, p.estado
    INTO v_max, v_estado
  FROM evaluacion e
  JOIN periodo p ON p.id = e.periodo_id
  WHERE e.id = NEW.evaluacion_id;

  IF NEW.puntaje > v_max THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El puntaje excede el maximo de la evaluacion.';
  END IF;

  IF v_estado <> 'abierto' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El periodo no esta abierto: no se pueden registrar notas.';
  END IF;
END $$


DROP TRIGGER IF EXISTS trg_nota_valida_upd $$
CREATE TRIGGER trg_nota_valida_upd
BEFORE UPDATE ON nota
FOR EACH ROW
BEGIN
  DECLARE v_max DECIMAL(6,2);
  DECLARE v_estado VARCHAR(20);

  SELECT e.puntaje_maximo, p.estado
    INTO v_max, v_estado
  FROM evaluacion e
  JOIN periodo p ON p.id = e.periodo_id
  WHERE e.id = NEW.evaluacion_id;

  IF NEW.puntaje > v_max THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El puntaje excede el maximo de la evaluacion.';
  END IF;

  -- Un periodo cerrado solo se modifica con autorización explícita del
  -- administrador, que el backend señala con @permitir_periodo_cerrado = 1.
  IF v_estado <> 'abierto' AND COALESCE(@permitir_periodo_cerrado, 0) <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El periodo esta cerrado: se requiere autorizacion del administrador.';
  END IF;
END $$


-- Una nota consolidada bloqueada no se toca sin autorización.
DROP TRIGGER IF EXISTS trg_nota_periodo_bloqueada $$
CREATE TRIGGER trg_nota_periodo_bloqueada
BEFORE UPDATE ON nota_periodo
FOR EACH ROW
BEGIN
  IF OLD.bloqueada = 1 AND COALESCE(@permitir_periodo_cerrado, 0) <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La nota del periodo esta bloqueada: se requiere autorizacion del administrador.';
  END IF;
END $$


-- ============================================================================
-- 3. COHERENCIA DEL HORARIO
--
-- horario duplica maestro_id, seccion_id y anio_lectivo_id para que los
-- índices únicos puedan rechazar los choques. Estos triggers garantizan que
-- esas copias siempre coincidan con la clase: si se llenaran a mano desde el
-- backend, un descuido dejaría pasar un solapamiento.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_horario_sync_ins $$
CREATE TRIGGER trg_horario_sync_ins
BEFORE INSERT ON horario
FOR EACH ROW
BEGIN
  SELECT c.maestro_id, c.seccion_id, c.anio_lectivo_id
    INTO @m, @s, @a
  FROM clase c WHERE c.id = NEW.clase_id;

  SET NEW.maestro_id = @m;
  SET NEW.seccion_id = @s;
  SET NEW.anio_lectivo_id = @a;
END $$

DROP TRIGGER IF EXISTS trg_horario_sync_upd $$
CREATE TRIGGER trg_horario_sync_upd
BEFORE UPDATE ON horario
FOR EACH ROW
BEGIN
  SELECT c.maestro_id, c.seccion_id, c.anio_lectivo_id
    INTO @m, @s, @a
  FROM clase c WHERE c.id = NEW.clase_id;

  SET NEW.maestro_id = @m;
  SET NEW.seccion_id = @s;
  SET NEW.anio_lectivo_id = @a;
END $$


-- ============================================================================
-- 4. CUPO DE LA SECCIÓN
-- ============================================================================

DROP TRIGGER IF EXISTS trg_matricula_cupo $$
CREATE TRIGGER trg_matricula_cupo
BEFORE INSERT ON matricula
FOR EACH ROW
BEGIN
  DECLARE v_cupo SMALLINT UNSIGNED;
  DECLARE v_ocupados INT;

  SELECT cupo_maximo INTO v_cupo FROM seccion WHERE id = NEW.seccion_id;

  SELECT COUNT(*) INTO v_ocupados
  FROM matricula
  WHERE seccion_id = NEW.seccion_id AND estado = 'activa';

  IF v_ocupados >= v_cupo THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La seccion alcanzo su cupo maximo.';
  END IF;
END $$


-- ============================================================================
-- 5. AUDITORÍA AUTOMÁTICA DE TABLAS CRÍTICAS
--
-- Escriben en auditoria pase lo que pase: por la aplicación, por phpMyAdmin o
-- por un script suelto. El middleware del backend (Fase 2) añadirá además el
-- contexto HTTP; estos triggers son la garantía de que ninguna ruta de
-- escritura pueda evadir el registro.
-- ============================================================================

-- --- NOTAS ---
DROP TRIGGER IF EXISTS trg_aud_nota_ins $$
CREATE TRIGGER trg_aud_nota_ins
AFTER INSERT ON nota
FOR EACH ROW
BEGIN
  INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
  VALUES (
    @app_usuario_id, @app_rol, 'INSERT', 'nota', NEW.id, NULL,
    JSON_OBJECT('evaluacion_id', NEW.evaluacion_id, 'alumno_id', NEW.alumno_id, 'puntaje', NEW.puntaje),
    'trigger', @app_ip
  );
END $$

DROP TRIGGER IF EXISTS trg_aud_nota_upd $$
CREATE TRIGGER trg_aud_nota_upd
AFTER UPDATE ON nota
FOR EACH ROW
BEGIN
  IF NOT (NEW.puntaje <=> OLD.puntaje) OR NOT (NEW.observacion <=> OLD.observacion) THEN
    INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
    VALUES (
      @app_usuario_id, @app_rol, 'UPDATE', 'nota', NEW.id,
      JSON_OBJECT('puntaje', OLD.puntaje, 'observacion', OLD.observacion),
      JSON_OBJECT('puntaje', NEW.puntaje, 'observacion', NEW.observacion),
      'trigger', @app_ip
    );
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_aud_nota_del $$
CREATE TRIGGER trg_aud_nota_del
AFTER DELETE ON nota
FOR EACH ROW
BEGIN
  INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
  VALUES (
    @app_usuario_id, @app_rol, 'DELETE', 'nota', OLD.id,
    JSON_OBJECT('evaluacion_id', OLD.evaluacion_id, 'alumno_id', OLD.alumno_id, 'puntaje', OLD.puntaje),
    NULL, 'trigger', @app_ip
  );
END $$


-- --- NOTA CONSOLIDADA DEL PERIODO ---
DROP TRIGGER IF EXISTS trg_aud_np_upd $$
CREATE TRIGGER trg_aud_np_upd
AFTER UPDATE ON nota_periodo
FOR EACH ROW
BEGIN
  IF NOT (NEW.nota_final <=> OLD.nota_final) OR NOT (NEW.aprobado <=> OLD.aprobado) THEN
    INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
    VALUES (
      @app_usuario_id, @app_rol, 'UPDATE', 'nota_periodo', NEW.id,
      JSON_OBJECT('nota_final', OLD.nota_final, 'aprobado', OLD.aprobado, 'bloqueada', OLD.bloqueada),
      JSON_OBJECT('nota_final', NEW.nota_final, 'aprobado', NEW.aprobado, 'bloqueada', NEW.bloqueada),
      'trigger', @app_ip
    );
  END IF;
END $$


-- --- PAGOS ---
DROP TRIGGER IF EXISTS trg_aud_pago_ins $$
CREATE TRIGGER trg_aud_pago_ins
AFTER INSERT ON pago
FOR EACH ROW
BEGIN
  INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
  VALUES (
    @app_usuario_id, @app_rol, 'INSERT', 'pago', NEW.id, NULL,
    JSON_OBJECT('cargo_id', NEW.cargo_id, 'recibo', NEW.numero_recibo, 'monto', NEW.monto, 'metodo', NEW.metodo),
    'trigger', @app_ip
  );
END $$

DROP TRIGGER IF EXISTS trg_aud_pago_upd $$
CREATE TRIGGER trg_aud_pago_upd
AFTER UPDATE ON pago
FOR EACH ROW
BEGIN
  INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
  VALUES (
    @app_usuario_id, @app_rol, 'UPDATE', 'pago', NEW.id,
    JSON_OBJECT('monto', OLD.monto, 'anulado', OLD.anulado, 'motivo', OLD.anulado_motivo),
    JSON_OBJECT('monto', NEW.monto, 'anulado', NEW.anulado, 'motivo', NEW.anulado_motivo),
    'trigger', @app_ip
  );
END $$

DROP TRIGGER IF EXISTS trg_aud_pago_del $$
CREATE TRIGGER trg_aud_pago_del
AFTER DELETE ON pago
FOR EACH ROW
BEGIN
  INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
  VALUES (
    @app_usuario_id, @app_rol, 'DELETE', 'pago', OLD.id,
    JSON_OBJECT('cargo_id', OLD.cargo_id, 'recibo', OLD.numero_recibo, 'monto', OLD.monto),
    NULL, 'trigger', @app_ip
  );
END $$


-- --- CARGOS (cambios de estado de cuenta) ---
DROP TRIGGER IF EXISTS trg_aud_cargo_upd $$
CREATE TRIGGER trg_aud_cargo_upd
AFTER UPDATE ON cargo
FOR EACH ROW
BEGIN
  IF NOT (NEW.estado <=> OLD.estado) OR NOT (NEW.monto <=> OLD.monto) OR NOT (NEW.descuento <=> OLD.descuento) THEN
    INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
    VALUES (
      @app_usuario_id, @app_rol, 'UPDATE', 'cargo', NEW.id,
      JSON_OBJECT('estado', OLD.estado, 'monto', OLD.monto, 'descuento', OLD.descuento),
      JSON_OBJECT('estado', NEW.estado, 'monto', NEW.monto, 'descuento', NEW.descuento),
      'trigger', @app_ip
    );
  END IF;
END $$


-- --- USUARIOS ---
-- Nunca se registra el hash de la contraseña, ni el viejo ni el nuevo.
-- Solo el hecho de que cambió.
DROP TRIGGER IF EXISTS trg_aud_usuario_ins $$
CREATE TRIGGER trg_aud_usuario_ins
AFTER INSERT ON usuario
FOR EACH ROW
BEGIN
  INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
  VALUES (
    @app_usuario_id, @app_rol, 'INSERT', 'usuario', NEW.id, NULL,
    JSON_OBJECT('usuario', NEW.usuario, 'rol_id', NEW.rol_id, 'estado', NEW.estado),
    'trigger', @app_ip
  );
END $$

DROP TRIGGER IF EXISTS trg_aud_usuario_upd $$
CREATE TRIGGER trg_aud_usuario_upd
AFTER UPDATE ON usuario
FOR EACH ROW
BEGIN
  IF NOT (NEW.rol_id <=> OLD.rol_id)
     OR NOT (NEW.estado <=> OLD.estado)
     OR NOT (NEW.usuario <=> OLD.usuario)
     OR NOT (NEW.password_hash <=> OLD.password_hash) THEN
    INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
    VALUES (
      @app_usuario_id, @app_rol, 'UPDATE', 'usuario', NEW.id,
      JSON_OBJECT('usuario', OLD.usuario, 'rol_id', OLD.rol_id, 'estado', OLD.estado,
                  'password_cambiado', IF(NEW.password_hash <=> OLD.password_hash, 'no', 'si')),
      JSON_OBJECT('usuario', NEW.usuario, 'rol_id', NEW.rol_id, 'estado', NEW.estado),
      'trigger', @app_ip
    );
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_aud_usuario_del $$
CREATE TRIGGER trg_aud_usuario_del
AFTER DELETE ON usuario
FOR EACH ROW
BEGIN
  INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
  VALUES (
    @app_usuario_id, @app_rol, 'DELETE', 'usuario', OLD.id,
    JSON_OBJECT('usuario', OLD.usuario, 'rol_id', OLD.rol_id),
    NULL, 'trigger', @app_ip
  );
END $$


-- --- MATRÍCULA ---
DROP TRIGGER IF EXISTS trg_aud_matricula_ins $$
CREATE TRIGGER trg_aud_matricula_ins
AFTER INSERT ON matricula
FOR EACH ROW
BEGIN
  INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
  VALUES (
    @app_usuario_id, @app_rol, 'INSERT', 'matricula', NEW.id, NULL,
    JSON_OBJECT('alumno_id', NEW.alumno_id, 'seccion_id', NEW.seccion_id, 'anio_lectivo_id', NEW.anio_lectivo_id),
    'trigger', @app_ip
  );
END $$

DROP TRIGGER IF EXISTS trg_aud_matricula_upd $$
CREATE TRIGGER trg_aud_matricula_upd
AFTER UPDATE ON matricula
FOR EACH ROW
BEGIN
  IF NOT (NEW.seccion_id <=> OLD.seccion_id) OR NOT (NEW.estado <=> OLD.estado) THEN
    INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
    VALUES (
      @app_usuario_id, @app_rol, 'UPDATE', 'matricula', NEW.id,
      JSON_OBJECT('seccion_id', OLD.seccion_id, 'estado', OLD.estado),
      JSON_OBJECT('seccion_id', NEW.seccion_id, 'estado', NEW.estado),
      'trigger', @app_ip
    );
  END IF;
END $$


-- --- CIERRE DE PERIODO ---
DROP TRIGGER IF EXISTS trg_aud_periodo_upd $$
CREATE TRIGGER trg_aud_periodo_upd
AFTER UPDATE ON periodo
FOR EACH ROW
BEGIN
  IF NOT (NEW.estado <=> OLD.estado) THEN
    INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, valor_anterior, valor_nuevo, origen, ip)
    VALUES (
      @app_usuario_id, @app_rol, 'UPDATE', 'periodo', NEW.id,
      JSON_OBJECT('estado', OLD.estado),
      JSON_OBJECT('estado', NEW.estado),
      'trigger', @app_ip
    );
  END IF;
END $$

DELIMITER ;
