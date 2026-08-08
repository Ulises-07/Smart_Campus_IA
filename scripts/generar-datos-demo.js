/**
 * Generador de datos de demostración — Fase 1.
 * Ejecuta:  npm run demo
 *
 * Crea un colegio completo y creíble: maestros, alumnos con nombres
 * hondureños, secciones, clases, horarios sin choques, notas del I Parcial,
 * asistencia de varias semanas, incidencias y estado de cuenta.
 *
 * Sin esto, los dashboards de la Fase 7 se construyen a ciegas: no hay forma
 * de saber si un gráfico está bien hasta que tiene datos con forma real.
 *
 * BORRA los datos transaccionales anteriores (no los catálogos). Pide
 * confirmación salvo que se pase --si.
 */
import './_silencio.js';
import readline from 'node:readline/promises';
import bcrypt from 'bcryptjs';
import { pool, transaccion, q as consulta } from '../src/config/db.js';
import { cifrar, hashBusqueda } from '../src/config/crypto.js';


const AUTO = process.argv.includes('--si');
const PASSWORD_DEMO = 'Demo.2026.Cambiar';

// --- Nombres para que los reportes se vean como un colegio de verdad ---
const NOMBRES_M = ['Carlos', 'José', 'Luis', 'Marco', 'Kevin', 'Denis', 'Óscar', 'Elvin', 'Josué', 'Cristian', 'Alexander', 'Darwin', 'Nahúm', 'Byron', 'Wilmer'];
const NOMBRES_F = ['María', 'Ana', 'Gabriela', 'Keyla', 'Wendy', 'Dulce', 'Karla', 'Suyapa', 'Jessica', 'Nohemí', 'Fernanda', 'Yensi', 'Heidy', 'Astrid', 'Marlen'];
const SEGUNDOS = ['Alberto', 'Antonio', 'Isabel', 'Nicole', 'David', 'Esteban', 'Raquel', 'Milagro', 'Andrea', 'Fernando', ''];
const APELLIDOS = ['López', 'Martínez', 'Rodríguez', 'Hernández', 'García', 'Flores', 'Reyes', 'Cruz', 'Sánchez', 'Mejía', 'Zelaya', 'Bonilla', 'Núñez', 'Padilla', 'Cáceres', 'Aguilar', 'Ordóñez', 'Interiano', 'Banegas', 'Discua', 'Fajardo', 'Andino'];

const al = (a) => a[Math.floor(Math.random() * a.length)];
const ent = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Distribución normal: notas agrupadas alrededor de una media, como en la vida real. */
function normal(media, desv, min, max) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(max, Math.max(min, media + z * desv));
}

async function confirmar() {
  if (AUTO) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const r = await rl.question(
    '\nEsto BORRARA alumnos, notas, asistencia, pagos e incidencias existentes.\n' +
    'Los catalogos (grados, asignaturas, configuracion) se conservan.\n' +
    'Escribe SI para continuar: '
  );
  rl.close();
  return r.trim().toUpperCase() === 'SI';
}

async function main() {
  console.log('\n=== Generador de datos de demostracion ===');

  if (!(await confirmar())) {
    console.log('Cancelado. No se modifico nada.\n');
    await pool.end();
    return;
  }

  const hash = await bcrypt.hash(PASSWORD_DEMO, 12);

  await transaccion(async (c) => {
    const q = async (sql, p = []) => (await c.query(sql, p))[0];

    // --- Limpieza ---
    console.log('\nLimpiando datos anteriores...');
    await q('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['pago', 'cargo', 'material', 'incidencia', 'asistencia', 'nota_periodo', 'nota',
      'evaluacion', 'ponderacion', 'inscripcion', 'horario', 'clase', 'matricula',
      'alumno_encargado', 'encargado', 'alumno', 'notificacion', 'sesion_refresh', 'intento_login']) {
      await q(`DELETE FROM ${t}`);
    }
    await q("DELETE FROM usuario WHERE usuario <> 'admin'");
    await q('DELETE FROM persona WHERE id > 1');
    await q('DELETE FROM seccion');
    await q('SET FOREIGN_KEY_CHECKS = 1');

    const [anio] = await q("SELECT id, anio FROM anio_lectivo WHERE estado='activo' LIMIT 1");
    const periodos = await q('SELECT id, numero, estado FROM periodo WHERE anio_lectivo_id=? ORDER BY numero', [anio.id]);
    const grados = await q('SELECT id, numero, nivel, carrera_id FROM grado ORDER BY numero, carrera_id');
    const aulas = await q('SELECT id FROM aula ORDER BY id');
    const bloques = await q('SELECT id FROM bloque_horario WHERE es_receso=0 ORDER BY orden');
    const asignaturas = await q('SELECT id, codigo FROM asignatura');
    const asigPorCodigo = Object.fromEntries(asignaturas.map((a) => [a.codigo, a.id]));

    // Tras la migracion de la Fase 2 la identidad va cifrada. El generador se
    // adapta a las dos formas para que funcione antes y despues de migrar.
    const cifrado = (await consulta(
      `SELECT column_name AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'persona' AND column_name = 'identidad_cifrada'`
    )).length > 0;

    const crearPersona = async (nombre, seg, ap1, ap2, extra = {}) => {
      const direccion = `Col. ${al(['Los Pinos', 'El Carmen', 'Villa Nueva', 'Las Palmas', 'San Jose'])}, Choloma`;
      const telefono = `9${ent(1000000, 9999999)}`;
      const comunes = [nombre, seg || null, ap1, ap2, extra.nacimiento ?? null, extra.sexo ?? null,
        direccion, telefono, extra.correo ?? null];

      const r = cifrado
        ? await q(
          `INSERT INTO persona (identidad_cifrada, identidad_hash, primer_nombre, segundo_nombre,
                                primer_apellido, segundo_apellido, fecha_nacimiento, sexo,
                                direccion, telefono, correo)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [cifrar(extra.identidad ?? null), hashBusqueda(extra.identidad ?? null), ...comunes]
        )
        : await q(
          `INSERT INTO persona (identidad, primer_nombre, segundo_nombre, primer_apellido,
                                segundo_apellido, fecha_nacimiento, sexo, direccion, telefono, correo)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [extra.identidad ?? null, ...comunes]
        );
      return r.insertId;
    };

    // --- Maestros ---
    console.log('Creando maestros...');
    const maestros = [];
    for (let i = 0; i < 16; i++) {
      const esM = Math.random() < 0.45;
      const n = esM ? al(NOMBRES_M) : al(NOMBRES_F);
      const a1 = al(APELLIDOS), a2 = al(APELLIDOS);
      const p = await crearPersona(n, al(SEGUNDOS), a1, a2, {
        identidad: `0501${ent(1975, 1995)}${String(ent(1, 99999)).padStart(5, '0')}`,
        sexo: esM ? 'M' : 'F',
        correo: `${n.toLowerCase()}.${a1.toLowerCase()}@smartcampus.local`,
      });
      const u = await q(
        'INSERT INTO usuario (persona_id, rol_id, usuario, password_hash, debe_cambiar_password) VALUES (?,2,?,?,1)',
        [p, `${n.toLowerCase()}${a1.toLowerCase()}${i}`, hash]
      );
      maestros.push({ id: u.insertId, nombre: `${n} ${a1}` });
    }

    // --- Asesor de matrícula ---
    const pAsesor = await crearPersona('Sandra', 'Marisol', 'Portillo', 'Amaya', { sexo: 'F' });
    await q('INSERT INTO usuario (persona_id, rol_id, usuario, password_hash, debe_cambiar_password) VALUES (?,3,?,?,1)',
      [pAsesor, 'asesor', hash]);

    // --- Secciones: A y B para cada grado ---
    console.log('Creando secciones...');
    const secciones = [];
    let ia = 0;
    for (const g of grados) {
      for (const letra of ['A', 'B']) {
        const r = await q(
          'INSERT INTO seccion (grado_id, anio_lectivo_id, letra, cupo_maximo, aula_id) VALUES (?,?,?,?,?)',
          [g.id, anio.id, letra, 35, aulas[ia++ % aulas.length].id]
        );
        secciones.push({ id: r.insertId, grado: g, letra });
      }
    }

    // --- Clases por sección, según el nivel ---
    console.log('Creando clases y horarios...');
    const comunes = ['MAT', 'ESP', 'CN', 'CS', 'ING', 'EF'];
    const porCarrera = {
      1: ['PRG1', 'BDD', 'REDES', 'DSW'],
      2: ['CONT1', 'ADM', 'MERC', 'EMP'],
    };

    const clases = [];
    for (const s of secciones) {
      const codigos = s.grado.nivel === 'CICLO_COMUN'
        ? [...comunes, 'TEC', 'ART']
        : [...comunes, ...porCarrera[s.grado.carrera_id]];

      for (const cod of codigos) {
        const maestro = al(maestros);
        const r = await q(
          'INSERT INTO clase (asignatura_id, seccion_id, maestro_id, anio_lectivo_id) VALUES (?,?,?,?)',
          [asigPorCodigo[cod], s.id, maestro.id, anio.id]
        );
        clases.push({ id: r.insertId, seccion: s, maestro: maestro.id, codigo: cod });
      }
    }

    // Horarios: se intenta colocar cada clase y se ignoran los choques que la
    // base rechaza. Es la forma honesta de probar que las restricciones sirven.
    let colocados = 0, rechazados = 0;
    for (const cl of clases) {
      for (let intento = 0; intento < 12; intento++) {
        try {
          await q('INSERT INTO horario (clase_id, bloque_horario_id, dia_semana, aula_id) VALUES (?,?,?,?)',
            [cl.id, al(bloques).id, ent(1, 5), cl.seccion.id % aulas.length === 0 ? aulas[0].id : aulas[cl.seccion.id % aulas.length].id]);
          colocados++;
          break;
        } catch {
          rechazados++;
        }
      }
    }

    // --- Ponderación por tipo (suma directa): Tareas 45, Proyectos 25, Examenes 30 ---
    // Las 3 tareas (15 c/u) suman 45; el proyecto 25; el examen 30. Total 100.
    console.log('Definiendo ponderaciones (Tareas 45, Proyectos 25, Examenes 30)...');
    for (const cl of clases) {
      for (const p of periodos) {
        for (const [tipo, pct] of [[1, 45], [2, 25], [3, 30]]) {
          await q('INSERT INTO ponderacion (clase_id, periodo_id, tipo_evaluacion_id, porcentaje) VALUES (?,?,?,?)',
            [cl.id, p.id, tipo, pct]);
        }
      }
    }

    // --- Alumnos y matrícula ---
    console.log('Matriculando alumnos...');
    let correlativo = 1;
    const alumnos = [];
    for (const s of secciones) {
      const cantidad = ent(22, 30);
      for (let i = 0; i < cantidad; i++) {
        const esM = Math.random() < 0.5;
        const n = esM ? al(NOMBRES_M) : al(NOMBRES_F);
        const a1 = al(APELLIDOS);
        const edad = 12 + (s.grado.numero - 7);
        const p = await crearPersona(n, al(SEGUNDOS), a1, al(APELLIDOS), {
          identidad: `0501${anio.anio - edad}${String(ent(1, 99999)).padStart(5, '0')}`,
          nacimiento: `${anio.anio - edad}-${String(ent(1, 12)).padStart(2, '0')}-${String(ent(1, 28)).padStart(2, '0')}`,
          sexo: esM ? 'M' : 'F',
        });

        const codigo = `${anio.anio}-${String(correlativo++).padStart(4, '0')}`;
        const ra = await q('INSERT INTO alumno (persona_id, codigo, fecha_ingreso) VALUES (?,?,?)',
          [p, codigo, `${anio.anio}-02-02`]);
        const alumnoId = ra.insertId;

        // Encargado
        const pe = await crearPersona(al([...NOMBRES_M, ...NOMBRES_F]), '', a1, al(APELLIDOS), { sexo: null });
        const re = await q('INSERT INTO encargado (persona_id, ocupacion) VALUES (?,?)',
          [pe, al(['Comerciante', 'Docente', 'Operario', 'Agricultor', 'Enfermera', 'Independiente'])]);
        await q('INSERT INTO alumno_encargado (alumno_id, encargado_id, parentesco, es_principal) VALUES (?,?,?,1)',
          [alumnoId, re.insertId, al(['padre', 'madre', 'tutor'])]);

        const rm = await q(
          'INSERT INTO matricula (alumno_id, anio_lectivo_id, seccion_id, fecha_matricula) VALUES (?,?,?,?)',
          [alumnoId, anio.id, s.id, `${anio.anio}-01-${String(ent(15, 30)).padStart(2, '0')}`]
        );

        // Inscripción automática a todas las clases activas de su sección.
        const clasesSeccion = clases.filter((k) => k.seccion.id === s.id);
        for (const cl of clasesSeccion) {
          await q('INSERT INTO inscripcion (matricula_id, alumno_id, clase_id) VALUES (?,?,?)',
            [rm.insertId, alumnoId, cl.id]);
        }

        // Cada alumno tiene su "nivel" propio: así los gráficos muestran
        // dispersión real y no una nube uniforme.
        alumnos.push({ id: alumnoId, seccion: s.id, aptitud: normal(78, 11, 45, 98) });
      }
    }

    // --- Evaluaciones y notas del I Parcial ---
    const p1 = periodos.find((p) => p.numero === 1);
    console.log('Generando evaluaciones y notas del I Parcial...');

    let notasCreadas = 0;
    for (const cl of clases) {
      // 5 evaluaciones fijas por clase, en orden, con su puntaje máximo = su peso.
      // Tarea 1/2/3 = 15 c/u, Proyecto = 25, Examen = 30. Suman 100.
      const evaluaciones = [
        { tipo: 1, titulo: 'Tarea 1', max: 15 },
        { tipo: 1, titulo: 'Tarea 2', max: 15 },
        { tipo: 1, titulo: 'Tarea 3', max: 15 },
        { tipo: 2, titulo: 'Proyecto del parcial', max: 25 },
        { tipo: 3, titulo: 'Examen del I Parcial', max: 30 },
      ];

      const inscritos = alumnos.filter((a) => a.seccion === cl.seccion.id);

      for (const ev of evaluaciones) {
        const re = await q(
          `INSERT INTO evaluacion (clase_id, periodo_id, tipo_evaluacion_id, titulo, puntaje_maximo, fecha)
           VALUES (?,?,?,?,?,?)`,
          [cl.id, p1.id, ev.tipo, ev.titulo, ev.max,
            `${anio.anio}-0${ent(2, 3)}-${String(ent(1, 28)).padStart(2, '0')}`]
        );

        for (const a of inscritos) {
          // 4 % de los alumnos no entrega: sin esa realidad, los reportes de
          // riesgo académico no tendrían nada que detectar.
          if (Math.random() < 0.04) continue;
          const pct = normal(a.aptitud, 9, 30, 100) / 100;
          // Puntaje ENTERO (redondeado), nunca mayor al máximo.
          const puntaje = Math.min(ev.max, Math.round(pct * ev.max));
          await q('INSERT INTO nota (evaluacion_id, alumno_id, puntaje) VALUES (?,?,?)',
            [re.insertId, a.id, puntaje]);
          notasCreadas++;
        }
      }
    }

    // --- Asistencia: 6 semanas ---
    console.log('Generando asistencia de 6 semanas...');
    let asistencias = 0;
    const inicio = new Date(`${anio.anio}-02-02T00:00:00Z`);
    for (const cl of clases.slice(0, Math.min(clases.length, 60))) {
      const inscritos = alumnos.filter((a) => a.seccion === cl.seccion.id);
      for (let d = 0; d < 30; d++) {
        const fecha = new Date(inicio);
        fecha.setUTCDate(fecha.getUTCDate() + d);
        const dow = fecha.getUTCDay();
        if (dow === 0 || dow === 6) continue;
        const iso = fecha.toISOString().slice(0, 10);

        for (const a of inscritos) {
          const r = Math.random();
          // Un alumno con menor aptitud falta más: la correlación hace que los
          // reportes cruzados de notas y asistencia digan algo.
          const riesgo = (100 - a.aptitud) / 400;
          let estado = 'presente';
          if (r < riesgo) estado = 'ausente';
          else if (r < riesgo + 0.05) estado = 'tarde';
          else if (r < riesgo + 0.07) estado = 'justificado';

          await q('INSERT INTO asistencia (clase_id, alumno_id, fecha, estado) VALUES (?,?,?,?)',
            [cl.id, a.id, iso, estado]);
          asistencias++;
        }
      }
    }

    // --- Incidencias ---
    console.log('Generando incidencias de comportamiento...');
    const descripciones = [
      'Uso del teléfono celular durante la clase',
      'Llegada tarde reiterada sin justificación',
      'Falta de respeto a un compañero',
      'No porta el uniforme completo',
      'Interrumpe el desarrollo de la clase',
      'Se ausentó del aula sin permiso',
    ];
    let incidencias = 0;
    for (const a of alumnos) {
      if (Math.random() > 0.18) continue;
      const cl = al(clases.filter((k) => k.seccion.id === a.seccion));
      await q(
        `INSERT INTO incidencia (alumno_id, clase_id, anio_lectivo_id, gravedad, descripcion, fecha_hora,
                                 medida_disciplinaria, estado, encargado_notificado)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [a.id, cl?.id ?? null, anio.id,
          al(['leve', 'leve', 'leve', 'grave', 'muy_grave']),
          al(descripciones),
          `${anio.anio}-0${ent(2, 3)}-${String(ent(1, 28)).padStart(2, '0')} ${String(ent(7, 12)).padStart(2, '0')}:${String(ent(0, 59)).padStart(2, '0')}:00`,
          al(['Llamado de atencion verbal', 'Citacion al encargado', 'Amonestacion escrita', null]),
          al(['abierta', 'en_proceso', 'resuelta', 'resuelta']),
          Math.random() < 0.6 ? 1 : 0]
      );
      incidencias++;
    }

    // --- Finanzas ---
    console.log('Generando estado de cuenta...');
    let cargos = 0, pagos = 0, recibo = 1;
    for (const a of alumnos) {
      // Matrícula
      const rm = await q(
        `INSERT INTO cargo (alumno_id, anio_lectivo_id, concepto_id, mes, monto, fecha_vencimiento, estado)
         VALUES (?,?,1,NULL,1500.00,?, 'pendiente')`,
        [a.id, anio.id, `${anio.anio}-02-05`]
      );
      cargos++;
      if (Math.random() < 0.93) {
        await q(
          `INSERT INTO pago (cargo_id, numero_recibo, monto, fecha_pago, metodo) VALUES (?,?,?,?,?)`,
          [rm.insertId, `REC-${anio.anio}-${String(recibo++).padStart(5, '0')}`, 1500.0,
            `${anio.anio}-01-${String(ent(15, 31)).padStart(2, '0')} 09:00:00`, al(['efectivo', 'transferencia', 'deposito'])]
        );
        await q("UPDATE cargo SET estado='pagado' WHERE id=?", [rm.insertId]);
        pagos++;
      }

      // Mensualidades solo del I Parcial: febrero (2), marzo (3) y abril (4).
      // El sistema simula que vamos por el I Parcial, así que no tiene sentido
      // registrar cargos de meses que "todavía no han llegado".
      for (let mes = 2; mes <= 4; mes++) {
        const rc = await q(
          `INSERT INTO cargo (alumno_id, anio_lectivo_id, concepto_id, mes, monto, fecha_vencimiento, estado)
           VALUES (?,?,2,?,900.00,?, 'pendiente')`,
          [a.id, anio.id, mes, `${anio.anio}-${String(mes).padStart(2, '0')}-10`]
        );
        cargos++;

        const suerte = Math.random();
        if (suerte < 0.78) {
          await q('INSERT INTO pago (cargo_id, numero_recibo, monto, fecha_pago, metodo) VALUES (?,?,?,?,?)',
            [rc.insertId, `REC-${anio.anio}-${String(recibo++).padStart(5, '0')}`, 900.0,
              `${anio.anio}-${String(mes).padStart(2, '0')}-${String(ent(1, 12)).padStart(2, '0')} 10:30:00`,
              al(['efectivo', 'transferencia', 'deposito'])]);
          await q("UPDATE cargo SET estado='pagado' WHERE id=?", [rc.insertId]);
          pagos++;
        } else if (suerte < 0.92) {
          await q("UPDATE cargo SET estado='mora', monto_mora=45.00 WHERE id=?", [rc.insertId]);
        }
      }
    }

    console.log('\n--- Resumen ---');
    console.log(`  Maestros:      ${maestros.length}`);
    console.log(`  Secciones:     ${secciones.length}`);
    console.log(`  Clases:        ${clases.length}`);
    console.log(`  Horarios:      ${colocados} colocados, ${rechazados} choques rechazados por la base`);
    console.log(`  Alumnos:       ${alumnos.length}`);
    console.log(`  Notas:         ${notasCreadas}`);
    console.log(`  Asistencias:   ${asistencias}`);
    console.log(`  Incidencias:   ${incidencias}`);
    console.log(`  Cargos:        ${cargos}  (${pagos} pagados)`);
  });

  console.log('\nListo. Credenciales de demostracion:');
  console.log(`  admin  / Admin.2026.Cambiar`);
  console.log(`  asesor / ${PASSWORD_DEMO}`);
  console.log(`  maestros: ver la tabla usuario, contrasena ${PASSWORD_DEMO}`);
  console.log('\nTodas obligan a cambiar la contrasena en el primer ingreso.\n');

  await pool.end();
}

main().catch(async (e) => {
  console.error('\nFallo la generacion:', e.sqlMessage ?? e.message);
  await pool.end();
  process.exit(1);
});
