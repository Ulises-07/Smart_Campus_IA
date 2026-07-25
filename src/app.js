import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { noEncontrado, manejadorErrores } from './middleware/error.js';
import { verificarOrigen } from './middleware/seguridad.js';
import { saludRouter } from './routes/salud.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { usuarioRouter } from './routes/usuario.routes.js';
import { academicoRouter } from './routes/academico.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const raizProyecto = path.resolve(__dirname, '..');

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(pinoHttp({ logger }));

/**
 * Politica de seguridad de contenido cerrada a 'self'.
 * Esto hace cumplir por diseno la restriccion del proyecto: cero CDNs,
 * cero fuentes remotas, cero llamadas fuera de este servidor.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: env.HTTPS_ENABLED,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

// Limite general. En la Fase 2 se anade uno mas estricto solo para /api/auth/login.
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, codigo: 'DEMASIADAS_PETICIONES', mensaje: 'Espera un momento e intenta de nuevo.' },
  })
);

// Toda peticion que modifique datos debe venir de este mismo origen.
app.use('/api', verificarOrigen);

// --- Rutas de API ---
app.use('/api', saludRouter);
app.use('/api', authRouter);
app.use('/api', usuarioRouter);
app.use('/api', academicoRouter);

// --- Frontend estatico ---
// Solo /public es publico. storage/ queda fuera a proposito.
app.use(express.static(path.join(raizProyecto, 'public'), { index: 'index.html' }));

app.use(noEncontrado);
app.use(manejadorErrores);
