/**
 * Silencia la bitacora antes de que se cargue cualquier otro modulo.
 *
 * Debe importarse como PRIMERA linea de los scripts de prueba: en ESM los
 * imports se ejecutan en orden, asi que esto corre antes de que logger.js lea
 * su nivel. Poner logger.level = 'silent' despues no sirve, porque pino-http
 * ya habria fijado el suyo.
 */
process.env.LOG_LEVEL = 'silent';
