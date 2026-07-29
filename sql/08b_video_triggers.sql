USE smart_campus;

-- Segundo candado contra zonas prohibidas: aunque alguien altere el ENUM en el
-- futuro, este trigger rechaza nombres de zona que delaten un area privada.
DROP TRIGGER IF EXISTS trg_camara_zona_prohibida;
DELIMITER $$
CREATE TRIGGER trg_camara_zona_prohibida
BEFORE INSERT ON camara
FOR EACH ROW
BEGIN
  -- Se revisan el nombre Y la zona: la palabra delatora puede ir en cualquiera.
  IF LOWER(CONCAT_WS(' ', NEW.nombre, NEW.zona)) REGEXP 'ba(n|ñ)o|servicio sanitario|vestidor|vestuario|cambio|enfermer|medic|lactancia' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Zona prohibida para videovigilancia: no se permiten camaras en banos, vestidores ni areas medicas.';
  END IF;
END$$
DELIMITER ;

SELECT 'Trigger de zona prohibida instalado.' AS resultado;
