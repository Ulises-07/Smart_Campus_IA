-- ============================================================
-- Corrección de acentos y eñes en los datos existentes
--
-- Los datos de la demo se generaron sin tildes ni eñes (Nunez, Jose,
-- Matematicas...). Este script los corrige en la base actual, sin borrar
-- nada ni regenerar. Aplica a nombres, apellidos y catálogos.
--
-- Córrelo en phpMyAdmin sobre smart_campus. NO usa FLUSH.
-- Es seguro re-ejecutarlo: si un nombre ya está corregido, no lo cambia.
-- ============================================================

USE smart_campus;

-- --- NOMBRES de persona ---
UPDATE persona SET primer_nombre = 'José'   WHERE primer_nombre = 'Jose';
UPDATE persona SET primer_nombre = 'María'  WHERE primer_nombre = 'Maria';
UPDATE persona SET primer_nombre = 'Óscar'  WHERE primer_nombre = 'Oscar';
UPDATE persona SET primer_nombre = 'Josué'  WHERE primer_nombre = 'Josue';
UPDATE persona SET primer_nombre = 'Nahúm'  WHERE primer_nombre = 'Nahum';
UPDATE persona SET primer_nombre = 'Nohemí' WHERE primer_nombre = 'Nohemi';

-- (los segundos nombres iguales, por si acaso)
UPDATE persona SET segundo_nombre = 'José'   WHERE segundo_nombre = 'Jose';
UPDATE persona SET segundo_nombre = 'María'  WHERE segundo_nombre = 'Maria';

-- --- APELLIDOS de persona ---
UPDATE persona SET primer_apellido = 'López'     WHERE primer_apellido = 'Lopez';
UPDATE persona SET primer_apellido = 'Martínez'  WHERE primer_apellido = 'Martinez';
UPDATE persona SET primer_apellido = 'Rodríguez' WHERE primer_apellido = 'Rodriguez';
UPDATE persona SET primer_apellido = 'Hernández' WHERE primer_apellido = 'Hernandez';
UPDATE persona SET primer_apellido = 'García'    WHERE primer_apellido = 'Garcia';
UPDATE persona SET primer_apellido = 'Sánchez'   WHERE primer_apellido = 'Sanchez';
UPDATE persona SET primer_apellido = 'Mejía'     WHERE primer_apellido = 'Mejia';
UPDATE persona SET primer_apellido = 'Núñez'     WHERE primer_apellido = 'Nunez';
UPDATE persona SET primer_apellido = 'Cáceres'   WHERE primer_apellido = 'Caceres';
UPDATE persona SET primer_apellido = 'Ordóñez'   WHERE primer_apellido = 'Ordonez';

-- Mismos apellidos, pero en la columna del segundo apellido.
UPDATE persona SET segundo_apellido = 'López'     WHERE segundo_apellido = 'Lopez';
UPDATE persona SET segundo_apellido = 'Martínez'  WHERE segundo_apellido = 'Martinez';
UPDATE persona SET segundo_apellido = 'Rodríguez' WHERE segundo_apellido = 'Rodriguez';
UPDATE persona SET segundo_apellido = 'Hernández' WHERE segundo_apellido = 'Hernandez';
UPDATE persona SET segundo_apellido = 'García'    WHERE segundo_apellido = 'Garcia';
UPDATE persona SET segundo_apellido = 'Sánchez'   WHERE segundo_apellido = 'Sanchez';
UPDATE persona SET segundo_apellido = 'Mejía'     WHERE segundo_apellido = 'Mejia';
UPDATE persona SET segundo_apellido = 'Núñez'     WHERE segundo_apellido = 'Nunez';
UPDATE persona SET segundo_apellido = 'Cáceres'   WHERE segundo_apellido = 'Caceres';
UPDATE persona SET segundo_apellido = 'Ordóñez'   WHERE segundo_apellido = 'Ordonez';

-- --- ASIGNATURAS ---
UPDATE asignatura SET nombre = 'Matemáticas'        WHERE nombre = 'Matematicas';
UPDATE asignatura SET nombre = 'Español'            WHERE nombre = 'Espanol';
UPDATE asignatura SET nombre = 'Educación Física'   WHERE nombre = 'Educacion Fisica';
UPDATE asignatura SET nombre = 'Educación Artística' WHERE nombre = 'Educacion Artistica';
UPDATE asignatura SET nombre = 'Inglés'             WHERE nombre = 'Ingles';
UPDATE asignatura SET nombre = 'Tecnología'         WHERE nombre = 'Tecnologia';
UPDATE asignatura SET nombre = 'Programación I'     WHERE nombre = 'Programacion I';
UPDATE asignatura SET nombre = 'Programación II'    WHERE nombre = 'Programacion II';
UPDATE asignatura SET descripcion = 'Área de matemáticas'          WHERE descripcion = 'Area de matematicas';
UPDATE asignatura SET descripcion = 'Biología, química y física básica' WHERE descripcion = 'Biologia, quimica y fisica basica';
UPDATE asignatura SET descripcion = 'Expresión artística'          WHERE descripcion = 'Expresion artistica';
UPDATE asignatura SET descripcion = 'Informática básica'           WHERE descripcion = 'Informatica basica';
UPDATE asignatura SET descripcion = 'Fundamentos de programación'  WHERE descripcion = 'Fundamentos de programacion';
UPDATE asignatura SET descripcion = 'Programación orientada a objetos' WHERE descripcion = 'Programacion orientada a objetos';

-- --- GRADOS ---
UPDATE grado SET nombre = REPLACE(nombre, 'Decimo', 'Décimo')       WHERE nombre LIKE '%Decimo%';
UPDATE grado SET nombre = REPLACE(nombre, 'Undecimo', 'Undécimo')   WHERE nombre LIKE '%Undecimo%';
UPDATE grado SET nombre = REPLACE(nombre, 'Septimo', 'Séptimo')     WHERE nombre LIKE '%Septimo%';
UPDATE grado SET nombre = REPLACE(nombre, 'Computacion', 'Computación')   WHERE nombre LIKE '%Computacion%';
UPDATE grado SET nombre = REPLACE(nombre, 'Administracion', 'Administración') WHERE nombre LIKE '%Administracion%';

-- --- CARRERAS / OTROS CATÁLOGOS con Computacion o Administracion ---
UPDATE carrera SET nombre = REPLACE(nombre, 'Computacion', 'Computación')   WHERE nombre LIKE '%Computacion%';
UPDATE carrera SET nombre = REPLACE(nombre, 'Administracion', 'Administración') WHERE nombre LIKE '%Administracion%';

SELECT 'Acentos y eñes corregidos en los datos existentes.' AS resultado;
