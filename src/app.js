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
import { notasRouter } from './routes/notas.routes.js';
import { materialRouter } from './routes/material.routes.js';
import { finanzasRouter } from './routes/finanzas.routes.js';
import { asistenteRouter } from './routes/asistente.routes.js';
import { reportesRouter } from './routes/reportes.routes.js';
import { videoRouter } from './routes/video.routes.js';

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
/*
 * Dos políticas de seguridad de contenido (CSP):
 *
 * 1. ESTRICTA (por defecto, para TODO el sistema): scripts y estilos solo de
 *    'self', sin eval, sin CDNs. Es la máxima protección y cubre el 99% de las
 *    pantallas.
 *
 * 2. RELAJADA (SOLO para /video.html): la detección de objetos con
 *    TensorFlow.js obliga a permitir 'unsafe-eval' (la librería genera y evalúa
 *    código en tiempo de ejecución), estilos inline y el video de la cámara.
 *    En lugar de abrir estos permisos en todo el sistema, se abren únicamente
 *    en la pantalla que los necesita. Así el resto del sistema conserva la CSP
 *    estricta.
 *
 * TRADE-OFF de 'unsafe-eval', documentado a propósito: amplía la superficie de
 * ataque en teoría, pero se acepta solo en /video.html porque (1) el sistema
 * corre en red local sin exposición a internet, (2) los scripts siguen viniendo
 * solo de 'self' (ningún CDN), y (3) es la única forma de correr la IA de
 * detección. El resto del sistema nunca permite eval.
 */
const cspEstricta = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"], // estilos inline en el HTML de las vistas
  imgSrc: ["'self'", 'data:', 'blob:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
  baseUri: ["'self'"],
};

const cspVideo = {
  ...cspEstricta,
  scriptSrc: ["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'"], // TensorFlow.js
  mediaSrc: ["'self'", 'blob:'], // video de la cámara (no sale del navegador)
};

// ¿Esta petición es de la pantalla de videovigilancia (o sus recursos de IA)?
function esRutaVideo(req) {
  const p = req.path;
  return p === '/video.html' || p === '/js/video.js' || p.startsWith('/vendor/');
}

// Dos instancias de helmet, una por cada política. Un middleware elige cuál
// aplicar según la ruta: la relajada solo para videovigilancia.
const helmetEstricto = helmet({
  contentSecurityPolicy: { directives: cspEstricta },
  crossOriginEmbedderPolicy: false,
  hsts: env.HTTPS_ENABLED,
});

const helmetVideo = helmet({
  contentSecurityPolicy: { directives: cspVideo },
  crossOriginEmbedderPolicy: false,
  hsts: env.HTTPS_ENABLED,
});

app.use((req, res, next) => (esRutaVideo(req) ? helmetVideo : helmetEstricto)(req, res, next));

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
app.use('/api', notasRouter);
app.use('/api', materialRouter);
app.use('/api', finanzasRouter);
app.use('/api', asistenteRouter);
app.use('/api', reportesRouter);
app.use('/api', videoRouter);

// --- Frontend estatico ---
// Solo /public es publico. storage/ queda fuera a proposito.
app.use(express.static(path.join(raizProyecto, 'public'), { index: 'index.html' }));

app.use(noEncontrado);
app.use(manejadorErrores);