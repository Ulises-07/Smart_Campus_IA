/**
 * Crea el usuario de acceso para los alumnos que TODAVÍA no tienen uno.
 * Ejecuta:  npm run usuarios:alumnos
 *
 * El sistema crea el usuario automáticamente para cada alumno NUEVO, pero los
 * alumnos que ya existían antes de esa mejora se quedaron sin acceso. Este
 * script los recorre y les crea su usuario, con el mismo formato:
 *   - Usuario:    el código del alumno (ej. 2026-0264)
 *   - Contraseña: "SC-" + código (ej. SC-2026-0264), temporal
 *   - debe_cambiar_password = 1  (la cambia en su primer ingreso)
 *
 * Es seguro re-ejecutarlo: omite a los alumnos que ya tienen usuario.
 * Al final imprime un listado de las credenciales creadas.
 */
import './_silencio.js';
import bcrypt from 'bcryptjs';
import { pool, q, transaccion } from '../src/config/db.js';
import { env } from '../src/config/env.js';

async function main() {
  console.log('\n=== Crear usuarios para alumnos existentes ===\n');

  // Rol ALUMNO.
  const [rol] = await q("SELECT id FROM rol WHERE codigo = 'ALUMNO' LIMIT 1");
  if (!rol) {
    console.error('No existe el rol ALUMNO. Aborta.');
    await pool.end();
    process.exit(1);
  }

  // Alumnos SIN usuario: los que no tienen una fila en `usuario` ligada a su persona.
  const alumnos = await q(`
    SELECT a.id, a.codigo, a.persona_id,
           p.primer_nombre, p.primer_apellido
      FROM alumno a
      JOIN persona p ON p.id = a.persona_id
      LEFT JOIN usuario u ON u.persona_id = a.persona_id
     WHERE u.id IS NULL
     ORDER BY a.codigo
  `);

  if (!alumnos.length) {
    console.log('Todos los alumnos ya tienen usuario. No hay nada que crear.\n');
    await pool.end();
    return;
  }

  console.log(`Se crearán ${alumnos.length} usuario(s).\n`);

  const creados = [];
  for (const al of alumnos) {
    // Usuario = código. Si por alguna razón ya existiera ese nombre de usuario
    // (ligado a otra persona), se le añade un sufijo para no chocar.
    let usuario = al.codigo;
    const [choca] = await q('SELECT id FROM usuario WHERE usuario = ?', [usuario]);
    if (choca) usuario = `${al.codigo}-${al.id}`;

    const passwordTemporal = `SC-${al.codigo}`;
    const hash = await bcrypt.hash(passwordTemporal, env.BCRYPT_COST);

    await transaccion(async (conn) => {
      await conn.query(
        `INSERT INTO usuario (persona_id, rol_id, usuario, password_hash, debe_cambiar_password)
         VALUES (?,?,?,?,1)`,
        [al.persona_id, rol.id, usuario, hash]
      );
    });

    creados.push({ nombre: `${al.primer_nombre} ${al.primer_apellido}`, usuario, passwordTemporal });
  }

  // Listado de credenciales para entregar.
  console.log('Credenciales creadas (entrégalas a cada alumno):\n');
  console.log('  ALUMNO'.padEnd(34) + 'USUARIO'.padEnd(18) + 'CONTRASEÑA TEMPORAL');
  console.log('  ' + '-'.repeat(70));
  for (const c of creados) {
    console.log('  ' + c.nombre.slice(0, 30).padEnd(32) + c.usuario.padEnd(18) + c.passwordTemporal);
  }
  console.log('');
  console.log(`Listo: ${creados.length} usuario(s) creado(s).`);
  console.log('Todos deben cambiar su contraseña en el primer ingreso.\n');

  await pool.end();
}

main().catch(async (e) => {
  console.error('\nFallo:', e.sqlMessage ?? e.message);
  await pool.end();
  process.exit(1);
});
