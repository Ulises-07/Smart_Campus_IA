/**
 * Bitacora de la aplicacion.
 * En desarrollo escribe legible en consola; en produccion, JSON a archivo.
 */
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { env, esProduccion } from './env.js';

fs.mkdirSync(env.LOG_DIR, { recursive: true });

const destino = esProduccion
  ? pino.destination({
      dest: path.join(env.LOG_DIR, 'app.log'),
      mkdir: true,
      sync: false,
    })
  : undefined;

export const logger = pino(
  {
    level: esProduccion ? 'info' : 'debug',
    // Nunca registrar credenciales ni tokens en la bitacora.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.contrasena',
        'res.headers["set-cookie"]',
      ],
      censor: '[OCULTO]',
    },
    transport: esProduccion
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
  },
  destino
);
