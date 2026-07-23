/**
 * Respaldo de la base de datos.
 * Ejecuta:  npm run backup
 *
 * Programalo con el Programador de tareas de Windows (diario, 11:00 p.m.)
 * o con cron en Linux:  0 23 * * * cd /ruta/proyecto && npm run backup
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../src/config/env.js';

const RETENCION_DIAS = 14;

fs.mkdirSync(env.BACKUP_DIR, { recursive: true });

const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const destino = path.join(env.BACKUP_DIR, `smart_campus_${sello}.sql`);

const args = [
  `--host=${env.DB_HOST}`,
  `--port=${env.DB_PORT}`,
  `--user=${env.DB_USER}`,
  `--password=${env.DB_PASSWORD}`,
  '--single-transaction',
  '--routines',
  '--triggers',
  '--events',
  '--default-character-set=utf8mb4',
  env.DB_NAME,
];

const salida = fs.createWriteStream(destino);
const proceso = spawn(env.MYSQLDUMP_PATH, args);

proceso.stdout.pipe(salida);
proceso.stderr.on('data', (d) => {
  const texto = d.toString();
  // mysqldump avisa por stderr que usar la clave en linea de comandos es inseguro; se ignora.
  if (!texto.includes('Using a password')) process.stderr.write(texto);
});

proceso.on('close', (codigo) => {
  if (codigo !== 0) {
    console.error(`El respaldo fallo (codigo ${codigo}).`);
    fs.rmSync(destino, { force: true });
    process.exit(1);
  }

  const mb = (fs.statSync(destino).size / 1024 / 1024).toFixed(2);
  console.log(`Respaldo creado: ${destino} (${mb} MB)`);

  // Rotacion: borra los respaldos mas viejos que RETENCION_DIAS.
  const limite = Date.now() - RETENCION_DIAS * 24 * 60 * 60 * 1000;
  let borrados = 0;
  for (const archivo of fs.readdirSync(env.BACKUP_DIR)) {
    if (!archivo.endsWith('.sql')) continue;
    const ruta = path.join(env.BACKUP_DIR, archivo);
    if (fs.statSync(ruta).mtimeMs < limite) {
      fs.rmSync(ruta);
      borrados++;
    }
  }
  if (borrados) console.log(`Respaldos antiguos eliminados: ${borrados}`);
});

proceso.on('error', (e) => {
  console.error(`No se pudo ejecutar mysqldump: ${e.message}`);
  console.error(`Revisa MYSQLDUMP_PATH en .env (actual: ${env.MYSQLDUMP_PATH})`);
  process.exit(1);
});
