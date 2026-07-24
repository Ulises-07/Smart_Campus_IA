/**
 * Carga y valida las variables de entorno.
 * Si falta algo obligatorio, el proceso muere aqui y no a mitad de una peticion.
 */
import 'dotenv/config';
import { z } from 'zod';

const booleano = z
  .string()
  .optional()
  .transform((v) => String(v).toLowerCase() === 'true');

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  TZ: z.string().default('America/Tegucigalpa'),

  HTTPS_ENABLED: booleano,
  HTTPS_KEY_PATH: z.string().default('./certs/server.key'),
  HTTPS_CERT_PATH: z.string().default('./certs/server.crt'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  BCRYPT_COST: z.coerce.number().int().min(12).default(12),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY debe ser 64 caracteres hexadecimales'),
  HASH_PEPPER: z.string().regex(/^[0-9a-fA-F]{64}$/, 'HASH_PEPPER debe ser 64 caracteres hexadecimales'),
  LOGIN_MAX_INTENTOS: z.coerce.number().int().positive().default(5),
  LOGIN_BLOQUEO_MINUTOS: z.coerce.number().int().positive().default(15),

  OLLAMA_ENABLED: booleano,
  OLLAMA_URL: z.string().url().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().default('llama3.1:8b'),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  VISION_ENABLED: booleano,
  VISION_URL: z.string().url().default('http://127.0.0.1:8000'),

  UPLOAD_DIR: z.string().default('./storage/uploads'),
  UPLOAD_MAX_MB: z.coerce.number().int().positive().default(25),
  BACKUP_DIR: z.string().default('./storage/backups'),
  LOG_DIR: z.string().default('./storage/logs'),
  MYSQLDUMP_PATH: z.string().default('mysqldump'),
});

const resultado = esquema.safeParse(process.env);

if (!resultado.success) {
  console.error('\n[ERROR] Configuracion invalida en el archivo .env:\n');
  for (const issue of resultado.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nRevisa .env.example y corrige los valores.\n');
  process.exit(1);
}

export const env = resultado.data;

// Zona horaria del proceso: los calculos de fecha del servidor usan Honduras,
// pero en la base de datos todo se guarda en UTC.
process.env.TZ = env.TZ;

export const esProduccion = env.NODE_ENV === 'production';
