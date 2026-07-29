import './_silencio.js';
/**
 * Purga de grabaciones vencidas — Fase 8.
 * Ejecuta:  npm run purgar:video
 *
 * Pensado para correr a diario como tarea programada (Programador de tareas de
 * Windows), igual que el respaldo. Elimina toda grabacion cuya retencion ya
 * vencio. Es idempotente: correrlo dos veces no causa dano.
 *
 * La politica que hace cumplir esta en docs/FASE-8-retencion.md.
 */
import { pool } from '../src/config/db.js';
import { purgarVencidas } from '../src/services/videovigilancia.service.js';

const VERDE = '\x1b[32m', GRIS = '\x1b[90m', RESET = '\x1b[0m';

async function main() {
  console.log('\n=== Purga de grabaciones vencidas ===\n');
  const r = await purgarVencidas({ usuarioId: null, rol: 'sistema' });
  if (r.purgadas === 0) {
    console.log(`${GRIS}No habia grabaciones vencidas. Nada que purgar.${RESET}\n`);
  } else {
    console.log(`${VERDE}Se purgaron ${r.purgadas} grabacion(es) vencida(s).${RESET}`);
    console.log(`${GRIS}La operacion quedo registrada en la auditoria.${RESET}\n`);
  }
  await pool.end();
}

main().catch(async (e) => {
  console.error('Fallo la purga:', e.message);
  try { await pool.end(); } catch { /* ya cerrado */ }
  process.exit(1);
});
