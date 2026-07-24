/**
 * Pruebas de autenticación y autorización — Fase 2.
 * Ejecuta:  npm run probar:auth
 *
 * Levanta el servidor en un puerto libre, hace peticiones HTTP reales y las
 * cierra. Comprueba lo que de verdad importa en un sistema con datos de
 * menores: que nadie vea lo que no le toca.
 *
 * No deja datos: los usuarios de prueba se borran al final.
 */
import './_silencio.js';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { app } from '../src/app.js';
import { pool, q } from '../src/config/db.js';
import { env } from '../src/config/env.js';


const VERDE = '\x1b[32m';
const ROJO = '\x1b[31m';
const GRIS = '\x1b[90m';
const RESET = '\x1b[0m';

let pasaron = 0, fallaron = 0, base = '';

function ok(t, d = '') { pasaron++; console.log(`${VERDE}  OK  ${RESET} ${t}${d ? ` ${GRIS}${d}${RESET}` : ''}`); }
function falla(t, d = '') { fallaron++; console.log(`${ROJO} FALLA${RESET} ${t}`); if (d) console.log(`        ${GRIS}${d}${RESET}`); }
function seccion(t) { console.log(`\n${t}\n${'-'.repeat(t.length)}`); }

/** Cliente HTTP mínimo con memoria de cookies, para simular un navegador. */
function crearCliente() {
  const cookies = new Map();
  return {
    cookies,
    async pedir(metodo, ruta, cuerpo) {
      const cabeceras = { Origin: base };
      if (cuerpo) cabeceras['Content-Type'] = 'application/json';
      if (cookies.size) {
        cabeceras.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      }

      const r = await fetch(base + ruta, {
        method: metodo,
        headers: cabeceras,
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        redirect: 'manual',
      });

      for (const sc of r.headers.getSetCookie?.() ?? []) {
        const [par] = sc.split(';');
        const i = par.indexOf('=');
        const nombre = par.slice(0, i);
        const valor = par.slice(i + 1);
        if (!valor || /Expires=Thu, 01 Jan 1970/i.test(sc)) cookies.delete(nombre);
        else cookies.set(nombre, valor);
      }

      return { estado: r.status, datos: await r.json().catch(() => ({})) };
    },
    get(r) { return this.pedir('GET', r); },
    post(r, c) { return this.pedir('POST', r, c); },
    patch(r, c) { return this.pedir('PATCH', r, c); },
  };
}

async function crearUsuarioPrueba(usuario, rolCodigo, password, personaExtra = {}) {
  const [rol] = await q('SELECT id FROM rol WHERE codigo = ?', [rolCodigo]);
  const hash = await bcrypt.hash(password, env.BCRYPT_COST);
  const rp = await q(
    'INSERT INTO persona (primer_nombre, primer_apellido) VALUES (?,?)',
    [personaExtra.nombre ?? 'Prueba', personaExtra.apellido ?? usuario]
  );
  const ru = await q(
    'INSERT INTO usuario (persona_id, rol_id, usuario, password_hash, debe_cambiar_password) VALUES (?,?,?,?,0)',
    [rp.insertId, rol.id, usuario, hash]
  );
  return { id: ru.insertId, personaId: rp.insertId };
}

async function limpiar() {
  const usuarios = await q("SELECT id, persona_id FROM usuario WHERE usuario LIKE '_zz_%'");
  for (const u of usuarios) {
    await q('DELETE FROM sesion_refresh WHERE usuario_id = ?', [u.id]);
    await q('DELETE FROM intento_login WHERE usuario_id = ?', [u.id]);
    await q('DELETE FROM usuario WHERE id = ?', [u.id]);
    await q('DELETE FROM persona WHERE id = ?', [u.persona_id]);
  }
}

async function main() {
  console.log('\n=== Pruebas de autenticacion y permisos ===');

  await limpiar();

  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  const CLAVE = 'PruebaSegura2026';

  try {
    const admin = await crearUsuarioPrueba('_zz_admin', 'ADMIN', CLAVE);
    const maestro = await crearUsuarioPrueba('_zz_maestro', 'MAESTRO', CLAVE);
    const alumno = await crearUsuarioPrueba('_zz_alumno', 'ALUMNO', CLAVE);

    // ================================================================
    seccion('1. Ingreso');

    const c = crearCliente();

    let r = await c.post('/api/auth/login', { usuario: '_zz_admin', password: 'incorrecta' });
    r.estado === 401 ? ok('Contrasena incorrecta rechazada') : falla('Contrasena incorrecta', `estado ${r.estado}`);

    r = await c.post('/api/auth/login', { usuario: '_zz_no_existe', password: CLAVE });
    r.datos.mensaje === 'Usuario o contrasena incorrectos.'
      ? ok('Usuario inexistente da el MISMO mensaje', 'no revela que cuentas existen')
      : falla('El mensaje delata si la cuenta existe', r.datos.mensaje);

    r = await c.post('/api/auth/login', { usuario: '_zz_admin', password: CLAVE });
    if (r.estado === 200 && c.cookies.has('acceso') && c.cookies.has('refresco')) {
      ok('Ingreso correcto', `rol ${r.datos.usuario.rol}`);
    } else {
      falla('Ingreso correcto', `estado ${r.estado}`);
    }

    // ================================================================
    seccion('2. Bloqueo por intentos fallidos');

    const cb = crearCliente();
    let bloqueado = false;
    for (let i = 0; i < env.LOGIN_MAX_INTENTOS; i++) {
      const rr = await cb.post('/api/auth/login', { usuario: '_zz_maestro', password: 'mala' });
      if (rr.estado === 423) bloqueado = true;
    }
    bloqueado ? ok(`Cuenta bloqueada tras ${env.LOGIN_MAX_INTENTOS} intentos`) : falla('No se bloqueo la cuenta');

    r = await cb.post('/api/auth/login', { usuario: '_zz_maestro', password: CLAVE });
    r.estado === 423
      ? ok('Ni siquiera la contrasena correcta entra estando bloqueada')
      : falla('La cuenta bloqueada acepto el ingreso', `estado ${r.estado}`);

    await q('UPDATE usuario SET bloqueado_hasta = NULL, intentos_fallidos = 0 WHERE id = ?', [maestro.id]);
    ok('Desbloqueo manual para continuar las pruebas');

    // ================================================================
    seccion('3. Sesion y cookies');

    r = await c.get('/api/auth/yo');
    r.estado === 200 ? ok('Perfil accesible con sesion') : falla('Perfil con sesion', `estado ${r.estado}`);

    const sinSesion = crearCliente();
    r = await sinSesion.get('/api/auth/yo');
    r.estado === 401 ? ok('Sin sesion no hay acceso') : falla('Sin sesion', `estado ${r.estado}`);

    const cookieAcceso = c.cookies.get('acceso');
    r = await c.post('/api/auth/refrescar');
    if (r.estado === 200 && c.cookies.get('acceso') !== cookieAcceso) {
      ok('El refresco entrega un token nuevo');
    } else {
      falla('Refresco de sesion', `estado ${r.estado}`);
    }

    // ================================================================
    seccion('4. Deteccion de robo de sesion');

    const ladron = crearCliente();
    const cRot = crearCliente();
    await cRot.post('/api/auth/login', { usuario: '_zz_alumno', password: CLAVE });

    const refrescoViejo = cRot.cookies.get('refresco');
    await cRot.post('/api/auth/refrescar');            // rota: el viejo queda revocado

    ladron.cookies.set('refresco', refrescoViejo);      // el atacante usa el token robado
    r = await ladron.post('/api/auth/refrescar');
    r.estado === 401
      ? ok('El token de refresco reusado es rechazado')
      : falla('Se acepto un token ya usado', `estado ${r.estado}`);

    r = await cRot.post('/api/auth/refrescar');
    r.estado === 401
      ? ok('Al detectar reuso se cierran TODAS las sesiones', 'incluida la legitima')
      : falla('Las demas sesiones siguieron vivas', `estado ${r.estado}`);

    // ================================================================
    seccion('5. Control de roles');

    const cAlumno = crearCliente();
    await cAlumno.post('/api/auth/login', { usuario: '_zz_alumno', password: CLAVE });

    r = await cAlumno.get('/api/usuarios');
    r.estado === 403
      ? ok('Un alumno NO puede listar usuarios')
      : falla('El alumno accedio a la gestion de usuarios', `estado ${r.estado}`);

    const cMaestro = crearCliente();
    await cMaestro.post('/api/auth/login', { usuario: '_zz_maestro', password: CLAVE });
    r = await cMaestro.get('/api/usuarios');
    r.estado === 403 ? ok('Un maestro NO puede listar usuarios') : falla('El maestro accedio', `estado ${r.estado}`);

    r = await c.get('/api/usuarios?porPagina=5');
    r.estado === 200 ? ok('El administrador si puede', `${r.datos.total} usuarios`) : falla('Admin no pudo listar', `estado ${r.estado}`);

    r = await cAlumno.patch(`/api/usuarios/${alumno.id}`, { rol: 'ADMIN' });
    r.estado === 403
      ? ok('Un alumno NO puede ascenderse a administrador')
      : falla('Escalada de privilegios posible', `estado ${r.estado}`);

    r = await c.patch(`/api/usuarios/${admin.id}`, { estado: 'inactivo' });
    r.estado === 400
      ? ok('Un admin no puede desactivarse a si mismo')
      : falla('El admin se desactivo solo', `estado ${r.estado}`);

    // ================================================================
    seccion('6. CSRF: verificacion de origen');

    const cookiesAdmin = [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const rf = await fetch(`${base}/api/usuarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookiesAdmin, Origin: 'https://sitio-malicioso.com' },
      body: JSON.stringify({ usuario: 'zzhack', rol: 'ADMIN', primerNombre: 'X', primerApellido: 'Y' }),
    });
    rf.status === 403
      ? ok('Peticion desde otro origen rechazada')
      : falla('Se acepto una peticion de origen externo', `estado ${rf.status}`);

    // ================================================================
    seccion('7. Alta de usuario y cambio de contrasena');

    r = await c.post('/api/usuarios', {
      usuario: '_zz_nuevo', rol: 'MAESTRO',
      primerNombre: 'Nuevo', primerApellido: 'Docente',
      identidad: '0501200500999', correo: 'nuevo@smartcampus.local',
    });

    if (r.estado === 201 && r.datos.passwordTemporal) {
      ok('Usuario creado con contrasena temporal', r.datos.passwordTemporal);

      const cNuevo = crearCliente();
      const login = await cNuevo.post('/api/auth/login', {
        usuario: '_zz_nuevo', password: r.datos.passwordTemporal,
      });

      login.datos.usuario?.debeCambiarPassword
        ? ok('El usuario nuevo debe cambiar la contrasena')
        : falla('No se exigio cambio de contrasena');

      const bloqueada = await cNuevo.get('/api/usuarios');
      bloqueada.estado === 403 && bloqueada.datos.codigo === 'CAMBIO_PASSWORD_REQUERIDO'
        ? ok('Sin cambiar la contrasena, el resto del sistema esta cerrado')
        : falla('Se pudo usar el sistema con la contrasena temporal', `estado ${bloqueada.estado}`);

      const debil = await cNuevo.post('/api/auth/cambiar-password', {
        actual: r.datos.passwordTemporal, nueva: 'corta1',
      });
      debil.estado === 400 ? ok('Contrasena debil rechazada', debil.datos.detalles?.[0] ?? '') : falla('Se acepto una contrasena debil');

      const cambio = await cNuevo.post('/api/auth/cambiar-password', {
        actual: r.datos.passwordTemporal, nueva: 'ClaveNueva2026Segura',
      });
      cambio.estado === 200 ? ok('Cambio de contrasena aceptado') : falla('Cambio de contrasena', cambio.datos.mensaje);

      const trasCambio = await cNuevo.get('/api/auth/yo');
      trasCambio.estado === 401
        ? ok('Al cambiar la contrasena se cierran las sesiones')
        : falla('La sesion sobrevivio al cambio de contrasena', `estado ${trasCambio.estado}`);
    } else {
      falla('Creacion de usuario', JSON.stringify(r.datos).slice(0, 120));
    }

    // ================================================================
    seccion('8. Cifrado de la identidad');

    const cols = await q(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='persona' AND column_name='identidad_cifrada'"
    );

    if (cols.length) {
      const filas = await q(
        `SELECT p.identidad_cifrada, p.identidad_hash FROM persona p
         JOIN usuario u ON u.persona_id = p.id WHERE u.usuario = '_zz_nuevo'`
      );
      const guardado = filas[0]?.identidad_cifrada ?? '';
      !guardado.includes('0501200500999')
        ? ok('La identidad NO se guarda en claro', `${guardado.slice(0, 28)}...`)
        : falla('La identidad quedo legible en la base');

      filas[0]?.identidad_hash?.length === 64
        ? ok('Hash de busqueda generado', 'permite buscar sin descifrar')
        : falla('Falta el hash de busqueda');
    } else {
      console.log(`${GRIS}  --  Cifrado no instalado todavia. Ejecuta sql/05 y npm run migrar:identidad${RESET}`);
    }

    // ================================================================
    seccion('9. Rastro de auditoria');

    const [aud] = await q(
      "SELECT COUNT(*) AS total FROM auditoria WHERE accion IN ('LOGIN','LOGOUT') AND fecha_hora > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)"
    );
    aud.total > 0 ? ok('Los ingresos quedaron registrados', `${aud.total} eventos`) : falla('No se registraron los ingresos');

    const [creaciones] = await q(
      "SELECT COUNT(*) AS total FROM auditoria WHERE entidad='usuario' AND accion='INSERT' AND fecha_hora > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)"
    );
    creaciones.total > 0
      ? ok('La creacion de usuarios quedo auditada con su responsable')
      : falla('No se audito la creacion de usuarios');
  } finally {
    await limpiar();
    servidor.close();
    await pool.end();
  }

  console.log('\n' + '='.repeat(56));
  if (fallaron === 0) {
    console.log(`${VERDE}Las ${pasaron} pruebas pasaron.${RESET}`);
  } else {
    console.log(`${ROJO}${fallaron} prueba(s) fallaron${RESET}, ${pasaron} pasaron.`);
  }
  console.log('Los usuarios de prueba fueron eliminados.');
  console.log('='.repeat(56) + '\n');

  process.exit(fallaron === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('\nError inesperado:', e.stack ?? e.message);
  try { await pool.end(); } catch { /* ya cerrado */ }
  process.exit(1);
});
