import { Router } from 'express';
import { probarConexion } from '../config/db.js';
import { estado as estadoOllama } from '../services/ollama.service.js';
import { asyncHandler } from '../middleware/error.js';
import { env } from '../config/env.js';

export const saludRouter = Router();

saludRouter.get(
  '/salud',
  asyncHandler(async (req, res) => {
    let bd;
    try {
      bd = await probarConexion();
    } catch (error) {
      bd = { ok: false, motivo: error.message };
    }

    const ia = await estadoOllama();

    // La base de datos es critica; la IA no lo es.
    const estadoHttp = bd.ok ? 200 : 503;

    res.status(estadoHttp).json({
      ok: bd.ok,
      servicio: 'Smart Campus IA',
      entorno: env.NODE_ENV,
      zonaHoraria: env.TZ,
      hora: new Date().toISOString(),
      componentes: { baseDatos: bd, ia },
    });
  })
);
