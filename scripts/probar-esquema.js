/**
 * Pruebas del esquema — Fase 1.
 * Ejecuta:  npm run probar:esquema
 *
 * Comprueba que la BASE DE DATOS, por sí sola, rechaza lo que los criterios de
 * aceptación dicen que debe rechazar. No confía en el backend: si mañana un
 * controlador olvida una validación, estas restricciones siguen ahí.
 *
 * Todo corre dentro de una transacción que se revierte al final: no deja
 * ningún dato en tu base.
 */
import './_silencio.js';
import { pool } from '../src/config/db.js';


const VERDE = '\x1b[32m';
const ROJO = '\x1b[31m';
const GRIS = '\x1b[90m';
const RESET = '\x1b[0m';

let pasaron = 0;
let fallaron = 0;
let conn;

/** Espera que la sentencia FALLE. Si pasa, es un agujero en el modelo. */
async function debeRechazar(titulo, sql, params = []) {
  try {
    await conn.query(sql, params);
    fallaron++;
    console.log(`${ROJO} FALLA${RESET} ${titulo}`);
    console.log(`        ${GRIS}-> la base lo ACEPTO y no debia${RESET}`);
  } catch (e) {
    pasaron++;
    const motivo = e.sqlMessage?.replace(/^.*?: /, '').slice(0, 70) ?? e.message;
    console.log(`${VERDE}  OK  ${RESET} ${titulo} ${GRIS}(${motivo})${RESET}`);
  }
}

/** Espera que la sentencia FUNCIONE. */
async function debeAceptar(titulo, sql, params = []) {
  try {
    await conn.query(sql, params);
    pasaron++;
    console.log(`${VERDE}  OK  ${RESET} ${titulo}`);
  } catch (e) {
    fallaron++;
    console.log(`${ROJO} FALLA${RESET} ${titulo}`);
    console.log(`        ${GRIS}-> ${e.sqlMessage ?? e.message}${RESET}`);
  }
}

function seccion(t) {
  console.log(`\n${t}\n${'-'.repeat(t.length)}`);
}

async function main() {
  console.log('\n=== Pruebas del esquema: Smart Campus IA ===');

  conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // --- Montaje ---
    const [[anio]] = await conn.query("SELECT id FROM anio_lectivo WHERE estado='activo' LIMIT 1");
    const [[per]] = await conn.query("SELECT id FROM periodo WHERE estado='abierto' LIMIT 1");
    const [[perCerrado]] = await conn.query("SELECT id FROM periodo WHERE estado<>'abierto' LIMIT 1");
    const [[grado]] = await conn.query('SELECT id FROM grado ORDER BY id LIMIT 1');
    const [[grado2]] = await conn.query('SELECT id FROM grado ORDER BY id LIMIT 1 OFFSET 1');

    if (!anio || !per) {
      console.log(`\n${ROJO}No hay ano lectivo activo o periodo abierto.${RESET}`);
      console.log('Carga primero sql/03_datos_semilla.sql\n');
      process.exit(1);
    }

    const ins = async (sql, p) => (await conn.query(sql, p))[0].insertId;

    const pA = await ins('INSERT INTO persona (primer_nombre,primer_apellido) VALUES (?,?)', ['Prueba', 'MaestroA']);
    const pB = await ins('INSERT INTO persona (primer_nombre,primer_apellido) VALUES (?,?)', ['Prueba', 'MaestroB']);
    const mA = await ins('INSERT INTO usuario (persona_id,rol_id,usuario,password_hash) VALUES (?,2,?,?)', [pA, '_test_a', 'x']);
    const mB = await ins('INSERT INTO usuario (persona_id,rol_id,usuario,password_hash) VALUES (?,2,?,?)', [pB, '_test_b', 'x']);

    const secA = await ins('INSERT INTO seccion (grado_id,anio_lectivo_id,letra,cupo_maximo) VALUES (?,?,?,2)', [grado.id, anio.id, 'Z']);
    const secB = await ins('INSERT INTO seccion (grado_id,anio_lectivo_id,letra,cupo_maximo) VALUES (?,?,?,30)', [grado2.id, anio.id, 'Z']);

    const cl1 = await ins('INSERT INTO clase (asignatura_id,seccion_id,maestro_id,anio_lectivo_id) VALUES (1,?,?,?)', [secA, mA, anio.id]);
    const cl2 = await ins('INSERT INTO clase (asignatura_id,seccion_id,maestro_id,anio_lectivo_id) VALUES (2,?,?,?)', [secA, mB, anio.id]);
    const cl3 = await ins('INSERT INTO clase (asignatura_id,seccion_id,maestro_id,anio_lectivo_id) VALUES (1,?,?,?)', [secB, mB, anio.id]);
    const cl4 = await ins('INSERT INTO clase (asignatura_id,seccion_id,maestro_id,anio_lectivo_id) VALUES (2,?,?,?)', [secB, mA, anio.id]);

    await conn.query('INSERT INTO horario (clase_id,bloque_horario_id,dia_semana,aula_id) VALUES (?,1,1,1)', [cl1]);

    // ================================================================
    seccion('1. Horarios: la base rechaza los solapamientos');

    await debeRechazar(
      'Choque de seccion (misma seccion, dia y bloque)',
      'INSERT INTO horario (clase_id,bloque_horario_id,dia_semana,aula_id) VALUES (?,1,1,2)', [cl2]
    );
    await debeRechazar(
      'Choque de aula (misma aula, dia y bloque)',
      'INSERT INTO horario (clase_id,bloque_horario_id,dia_semana,aula_id) VALUES (?,1,1,1)', [cl3]
    );
    await debeRechazar(
      'Choque de maestro (mismo maestro en dos secciones)',
      'INSERT INTO horario (clase_id,bloque_horario_id,dia_semana,aula_id) VALUES (?,1,1,3)', [cl4]
    );
    await debeAceptar(
      'Horario valido en otro bloque',
      'INSERT INTO horario (clase_id,bloque_horario_id,dia_semana,aula_id) VALUES (?,2,1,1)', [cl2]
    );

    // ================================================================
    seccion('2. Estructura academica');

    await debeRechazar(
      'Dos veces el mismo grado de Ciclo Comun',
      "INSERT INTO grado (numero,nombre,nivel,carrera_id) VALUES (7,'Duplicado','CICLO_COMUN',NULL)"
    );
    await debeRechazar(
      'Grado de BTP sin carrera asignada',
      "INSERT INTO grado (numero,nombre,nivel,carrera_id) VALUES (11,'Invalido','BTP',NULL)"
    );
    await debeRechazar(
      'Grado de Ciclo Comun con numero 11',
      "INSERT INTO grado (numero,nombre,nivel,carrera_id) VALUES (11,'Invalido','CICLO_COMUN',NULL)"
    );
    await debeRechazar(
      'Quinto parcial (solo existen I a IV)',
      "INSERT INTO periodo (anio_lectivo_id,numero,nombre,fecha_inicio,fecha_fin) VALUES (?,5,'V','2026-01-01','2026-02-01')", [anio.id]
    );

    // ================================================================
    seccion('3. Matricula');

    const alumnos = [];
    for (let i = 1; i <= 3; i++) {
      const p = await ins('INSERT INTO persona (primer_nombre,primer_apellido) VALUES (?,?)', ['Prueba', `Alumno${i}`]);
      alumnos.push(await ins('INSERT INTO alumno (persona_id,codigo,fecha_ingreso) VALUES (?,?,CURDATE())', [p, `_TEST_${i}`]));
    }

    await debeAceptar(
      'Primer alumno en seccion de cupo 2',
      'INSERT INTO matricula (alumno_id,anio_lectivo_id,seccion_id,fecha_matricula) VALUES (?,?,?,CURDATE())', [alumnos[0], anio.id, secA]
    );
    await debeAceptar(
      'Segundo alumno en seccion de cupo 2',
      'INSERT INTO matricula (alumno_id,anio_lectivo_id,seccion_id,fecha_matricula) VALUES (?,?,?,CURDATE())', [alumnos[1], anio.id, secA]
    );
    await debeRechazar(
      'Tercer alumno: la seccion llego a su cupo',
      'INSERT INTO matricula (alumno_id,anio_lectivo_id,seccion_id,fecha_matricula) VALUES (?,?,?,CURDATE())', [alumnos[2], anio.id, secA]
    );
    await debeRechazar(
      'Mismo alumno matriculado dos veces en el mismo ano',
      'INSERT INTO matricula (alumno_id,anio_lectivo_id,seccion_id,fecha_matricula) VALUES (?,?,?,CURDATE())', [alumnos[0], anio.id, secB]
    );

    // ================================================================
    seccion('4. Notas');

    const ev = await ins(
      'INSERT INTO evaluacion (clase_id,periodo_id,tipo_evaluacion_id,titulo,puntaje_maximo,fecha) VALUES (?,?,1,?,20.00,CURDATE())',
      [cl1, per.id, 'Tarea de prueba']
    );

    await debeRechazar(
      'Puntaje 25 en una evaluacion de 20 puntos',
      'INSERT INTO nota (evaluacion_id,alumno_id,puntaje) VALUES (?,?,25)', [ev, alumnos[0]]
    );
    await debeRechazar(
      'Puntaje negativo',
      'INSERT INTO nota (evaluacion_id,alumno_id,puntaje) VALUES (?,?,-5)', [ev, alumnos[0]]
    );
    await debeAceptar(
      'Puntaje 18 valido, periodo abierto',
      'INSERT INTO nota (evaluacion_id,alumno_id,puntaje) VALUES (?,?,18)', [ev, alumnos[0]]
    );
    await debeRechazar(
      'La misma nota dos veces para el mismo alumno',
      'INSERT INTO nota (evaluacion_id,alumno_id,puntaje) VALUES (?,?,19)', [ev, alumnos[0]]
    );

    if (perCerrado) {
      const evCerrada = await ins(
        'INSERT INTO evaluacion (clase_id,periodo_id,tipo_evaluacion_id,titulo,puntaje_maximo,fecha) VALUES (?,?,3,?,100.00,CURDATE())',
        [cl1, perCerrado.id, 'Examen periodo cerrado']
      );
      await debeRechazar(
        'Digitar nota en un periodo que no esta abierto',
        'INSERT INTO nota (evaluacion_id,alumno_id,puntaje) VALUES (?,?,80)', [evCerrada, alumnos[0]]
      );
    }

    // ================================================================
    seccion('5. Auditoria inmutable');

    await conn.query('SET @app_usuario_id = ?, @app_rol = ?, @app_ip = ?', [mA, 'maestro', '10.0.0.1']);
    await conn.query('UPDATE nota SET puntaje = 19.5 WHERE evaluacion_id = ? AND alumno_id = ?', [ev, alumnos[0]]);

    const [rastro] = await conn.query(
      "SELECT accion, valor_anterior, valor_nuevo, usuario_id, ip FROM auditoria WHERE entidad='nota' ORDER BY id DESC LIMIT 1"
    );

    if (rastro.length && rastro[0].valor_anterior && rastro[0].valor_nuevo) {
      pasaron++;
      console.log(`${VERDE}  OK  ${RESET} La correccion de nota dejo rastro con valor anterior y nuevo`);
      console.log(`        ${GRIS}anterior: ${rastro[0].valor_anterior}${RESET}`);
      console.log(`        ${GRIS}nuevo:    ${rastro[0].valor_nuevo}${RESET}`);
      console.log(`        ${GRIS}usuario ${rastro[0].usuario_id} desde ${rastro[0].ip}${RESET}`);
    } else {
      fallaron++;
      console.log(`${ROJO} FALLA${RESET} No se registro el cambio de nota en auditoria`);
    }

    await debeRechazar(
      'UPDATE sobre la tabla de auditoria',
      "UPDATE auditoria SET entidad='alterado' WHERE id > 0"
    );
    await debeRechazar(
      'DELETE sobre la tabla de auditoria',
      'DELETE FROM auditoria WHERE id > 0'
    );

    // ================================================================
    seccion('6. Configuracion de notas');

    const [config] = await conn.query(
      "SELECT clave, valor FROM config_sistema WHERE clave IN ('notas.minima_aprobacion','notas.modo_redondeo','notas.tope_maximo')"
    );
    for (const c of config) {
      console.log(`${VERDE}  OK  ${RESET} ${c.clave} = ${GRIS}${c.valor}${RESET}`);
      pasaron++;
    }
  } finally {
    // Nada de lo anterior queda en la base.
    await conn.rollback();
    conn.release();
    await pool.end();
  }

  console.log('\n' + '='.repeat(56));
  if (fallaron === 0) {
    console.log(`${VERDE}Las ${pasaron} pruebas pasaron.${RESET} El esquema cumple los criterios.`);
  } else {
    console.log(`${ROJO}${fallaron} prueba(s) fallaron${RESET}, ${pasaron} pasaron.`);
  }
  console.log('Ningun dato de prueba quedo guardado (rollback).');
  console.log('='.repeat(56) + '\n');

  process.exit(fallaron === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nError inesperado:', e.message);
  process.exit(1);
});
