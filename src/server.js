import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { probarConexion, cerrarPool } from './config/db.js';

async function iniciar() {
  // Falla rapido: si la base de datos no responde, mejor saberlo ahora.
  try {
    const info = await probarConexion();
    logger.info(`Base de datos conectada: ${info.bd} (MySQL/MariaDB ${info.version})`);
  } catch (error) {
    logger.error(`No se pudo conectar a la base de datos: ${error.message}`);
    logger.error('Revisa que MySQL de XAMPP este encendido y que .env tenga los datos correctos.');
    process.exit(1);
  }

  let servidor;
  let protocolo = 'http';

  if (env.HTTPS_ENABLED) {
    try {
      const opciones = {
        key: fs.readFileSync(env.HTTPS_KEY_PATH),
        cert: fs.readFileSync(env.HTTPS_CERT_PATH),
      };
      servidor = https.createServer(opciones, app);
      protocolo = 'https';
    } catch (error) {
      logger.error(`No se pudieron leer los certificados: ${error.message}`);
      logger.error('Ejecuta  npm run cert  o pon HTTPS_ENABLED=false en .env');
      process.exit(1);
    }
  } else {
    servidor = http.createServer(app);
  }

  servidor.listen(env.PORT, () => {
    logger.info(`Smart Campus IA escuchando en ${protocolo}://localhost:${env.PORT}`);
    logger.info(`Estado del sistema: ${protocolo}://localhost:${env.PORT}/api/salud`);
  });

  const apagar = async (senal) => {
    logger.info(`Recibida senal ${senal}, cerrando...`);
    servidor.close(async () => {
      await cerrarPool();
      logger.info('Cierre limpio completado.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => apagar('SIGINT'));
  process.on('SIGTERM', () => apagar('SIGTERM'));
}

iniciar();
