/**
 * Cifra las identidades existentes — Fase 2, paso 2 de 3.
 * Ejecuta:  npm run migrar:identidad
 *
 * Lee cada `persona.identidad` en texto plano, la cifra y guarda el resultado
 * junto con su hash de búsqueda. No borra nada: eso lo hace el script SQL 06,
 * después de que verifiques el conteo.
 *
 * Es idempotente: si lo corres dos veces, salta las ya cifradas.
 */
import './_silencio.js';
import { pool, transaccion } from '../src/config/db.js';
import { cifrar, descifrar, hashBusqueda } from '../src/config/crypto.js';


const VERDE = '\x1b[32m';
const ROJO = '\x1b[31m';
const GRIS = '\x1b[90m';
const RESET = '\x1b[0m';

async function main() {
  console.log('\n=== Cifrado de identidades ===\n');

  // ¿Existe todavía la columna en texto plano?
  const [cols] = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='persona' AND column_name IN ('identidad','identidad_cifrada')"
  );
  const nombres = cols.map((c) => c.COLUMN_NAME ?? c.column_name);

  if (!nombres.includes('identidad_cifrada')) {
    console.log(`${ROJO}Falta la columna identidad_cifrada.${RESET}`);
    console.log('Ejecuta primero:  mysql -u root -p smart_campus < sql/05_cifrado_identidad.sql\n');
    process.exit(1);
  }
  if (!nombres.includes('identidad')) {
    console.log(`${VERDE}La columna en texto plano ya no existe.${RESET} La migracion ya se completo.\n`);
    await pool.end();
    return;
  }

  const [pendientes] = await pool.query(
    'SELECT id, identidad FROM persona WHERE identidad IS NOT NULL AND identidad_cifrada IS NULL'
  );

  if (pendientes.length === 0) {
    console.log('No hay identidades pendientes de cifrar.\n');
    await pool.end();
    return;
  }

  console.log(`Personas por cifrar: ${pendientes.length}\n`);

  let hechas = 0;
  let colisiones = 0;

  await transaccion(async (conn) => {
    for (const p of pendientes) {
      const cifrada = cifrar(p.identidad);
      const hash = hashBusqueda(p.identidad);

      // Verificación de ida y vuelta antes de guardar: si el descifrado no
      // devuelve el original, algo esta mal en la clave y es mejor abortar
      // ahora que descubrirlo con la columna plana ya borrada.
      if (descifrar(cifrada) !== p.identidad) {
        throw new Error(`El cifrado no es reversible para persona ${p.id}. Revisa ENCRYPTION_KEY.`);
      }

      try {
        await conn.query(
          'UPDATE persona SET identidad_cifrada = ?, identidad_hash = ? WHERE id = ?',
          [cifrada, hash, p.id]
        );
        hechas++;
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
          // Dos personas con la misma identidad: ya existia el problema, el
          // cifrado solo lo destapo. Hay que resolverlo a mano.
          console.log(`${ROJO}  Identidad duplicada en persona ${p.id}${RESET}`);
          colisiones++;
        } else {
          throw e;
        }
      }

      if (hechas % 100 === 0) process.stdout.write(`  ${hechas} cifradas...\r`);
    }
  });

  const [[resumen]] = await pool.query(
    'SELECT SUM(identidad IS NOT NULL) AS planas, SUM(identidad_cifrada IS NOT NULL) AS cifradas FROM persona'
  );

  console.log(`${VERDE}  OK  ${RESET} ${hechas} identidades cifradas`);
  if (colisiones) console.log(`${ROJO} AVISO${RESET} ${colisiones} duplicadas sin migrar: resuelvelas a mano`);
  console.log(`${GRIS}        en texto plano: ${resumen.planas} | cifradas: ${resumen.cifradas}${RESET}`);

  if (Number(resumen.planas) === Number(resumen.cifradas) && colisiones === 0) {
    console.log(`\n${VERDE}Los conteos coinciden.${RESET} Ya puedes ejecutar:`);
    console.log('  mysql -u root -p smart_campus < sql/06_eliminar_identidad_plana.sql\n');
  } else {
    console.log(`\n${ROJO}Los conteos no coinciden.${RESET} NO borres la columna plana todavia.\n`);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error('\nFallo la migracion:', e.message);
  console.error('No se guardo ningun cambio (rollback).\n');
  await pool.end();
  process.exit(1);
});
