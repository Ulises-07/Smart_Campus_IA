import { api, iniciarPantalla, escapar, avisar } from './comun.js';

const $ = (id) => document.getElementById(id);
let usuario;

// Roles que el admin puede crear desde aquí. Los alumnos NO se crean aquí:
// se generan solos al registrar al alumno en la sección Alumnos.
const ROLES_CREABLES = [
  { codigo: 'MAESTRO', nombre: 'Maestro' },
  { codigo: 'ASESOR', nombre: 'Asesor' },
  { codigo: 'ADMIN', nombre: 'Administrador' },
];

const NOMBRE_ROL = { ADMIN: 'Administrador', MAESTRO: 'Maestro', ASESOR: 'Asesor', ALUMNO: 'Alumno' };

// ---------- Listado ----------
async function cargar() {
  const cuerpo = $('cuerpo');
  cuerpo.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted)">Cargando…</td></tr>';
  try {
    const params = new URLSearchParams();
    if ($('q').value.trim()) params.set('busqueda', $('q').value.trim());
    if ($('f-rol').value) params.set('rol', $('f-rol').value);
    params.set('porPagina', '100');

    const r = await api(`/api/usuarios?${params}`);
    if (!r.datos || !r.datos.length) {
      cuerpo.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted)">Sin usuarios.</td></tr>';
      return;
    }

    cuerpo.innerHTML = r.datos.map((u) => {
      const nombre = u.persona?.nombreCompleto || '—';
      const rolNom = NOMBRE_ROL[u.rol] || u.rol;
      const estadoColor = u.estado === 'activo' ? 'estado-activo'
        : u.estado === 'bloqueado' ? 'estado-retirado' : '';
      const bloqueado = u.bloqueado ? ' 🔒' : '';
      // El admin no puede editarse a sí mismo el rol/estado (guardado en backend),
      // pero sí puede verse. El botón de editar queda igual.
      return `
        <tr>
          <td style="font-family:var(--fuente-mono,monospace)">${escapar(u.usuario)}${bloqueado}</td>
          <td>${escapar(nombre)}</td>
          <td>${escapar(rolNom)}</td>
          <td><span class="insignia-estado ${estadoColor}">${escapar(u.estado)}</span></td>
          <td class="acciones">
            <button class="boton-mini" data-editar="${u.id}">Editar</button>
            <button class="boton-mini" data-clave="${u.id}" data-usuario="${escapar(u.usuario)}">Reiniciar clave</button>
            ${u.bloqueado ? `<button class="boton-mini" data-desbloquear="${u.id}">Desbloquear</button>` : ''}
          </td>
        </tr>`;
    }).join('');

    // Conectar acciones.
    cuerpo.querySelectorAll('[data-editar]').forEach((b) =>
      b.addEventListener('click', () => formularioEditar(Number(b.dataset.editar))));
    cuerpo.querySelectorAll('[data-clave]').forEach((b) =>
      b.addEventListener('click', () => reiniciarClave(Number(b.dataset.clave), b.dataset.usuario)));
    cuerpo.querySelectorAll('[data-desbloquear]').forEach((b) =>
      b.addEventListener('click', () => desbloquear(Number(b.dataset.desbloquear))));
  } catch (e) {
    cuerpo.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--color-error)">${escapar(e.message)}</td></tr>`;
  }
}

// ---------- Diálogo genérico ----------
function abrirDialogo(titulo, html, alAceptar, textoBoton = 'Guardar') {
  const dlg = $('dlg');
  dlg.innerHTML = `
    <form method="dialog" class="cuerpo">
      ${titulo ? `<h2>${escapar(titulo)}</h2>` : ''}
      <div id="dlg-aviso" class="aviso aviso-error" hidden></div>
      ${html}
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
        <button type="button" class="boton boton-secundario" id="dlg-cancelar" style="width:auto">Cerrar</button>
        ${alAceptar ? `<button type="button" class="boton" id="dlg-aceptar" style="width:auto">${escapar(textoBoton)}</button>` : ''}
      </div>
    </form>`;
  dlg.showModal();
  $('dlg-cancelar').onclick = () => dlg.close();
  if (alAceptar) $('dlg-aceptar').onclick = alAceptar;
  return dlg;
}

function avisoDialogo(mensaje) {
  const a = $('dlg-aviso');
  if (a) { a.textContent = mensaje; a.hidden = false; a.scrollIntoView({ block: 'nearest' }); }
}

// ---------- Crear ----------
function formularioNuevo() {
  const opcionesRol = ROLES_CREABLES.map((r) => `<option value="${r.codigo}">${r.nombre}</option>`).join('');
  abrirDialogo('Nuevo usuario', `
    <div class="rejilla-2">
      <div class="campo"><label>Rol *</label><select id="f-rol-nuevo" class="control">${opcionesRol}</select></div>
      <div class="campo"><label>Usuario *</label><input id="f-usuario" placeholder="ej. jperez"></div>
      <div class="campo"><label>Primer nombre *</label><input id="f-nom1"></div>
      <div class="campo"><label>Segundo nombre</label><input id="f-nom2"></div>
      <div class="campo"><label>Primer apellido *</label><input id="f-ape1"></div>
      <div class="campo"><label>Segundo apellido</label><input id="f-ape2"></div>
      <div class="campo"><label>Identidad</label><input id="f-identidad"></div>
      <div class="campo"><label>Correo</label><input id="f-correo" type="email"></div>
      <div class="campo"><label>Teléfono</label><input id="f-telefono"></div>
      <div class="campo"><label>Sexo</label><select id="f-sexo" class="control"><option value="">—</option><option value="M">Masculino</option><option value="F">Femenino</option><option value="otro">Otro</option></select></div>
    </div>
    <p class="ayuda">El usuario recibirá una contraseña temporal que deberá cambiar en su primer ingreso.</p>
  `, async () => {
    const cuerpo = {
      rol: $('f-rol-nuevo').value,
      usuario: $('f-usuario').value.trim(),
      primerNombre: $('f-nom1').value.trim(),
      segundoNombre: $('f-nom2').value.trim() || null,
      primerApellido: $('f-ape1').value.trim(),
      segundoApellido: $('f-ape2').value.trim() || null,
      identidad: $('f-identidad').value.trim() || null,
      correo: $('f-correo').value.trim() || null,
      telefono: $('f-telefono').value.trim() || null,
      sexo: $('f-sexo').value || null,
    };
    if (!cuerpo.usuario || !cuerpo.primerNombre || !cuerpo.primerApellido) {
      avisoDialogo('Usuario, primer nombre y primer apellido son obligatorios.');
      return;
    }
    try {
      const r = await api('/api/usuarios', { method: 'POST', body: cuerpo });
      $('dlg').close();
      mostrarCredenciales(r.usuario, r.passwordTemporal);
      cargar();
    } catch (e) {
      avisoDialogo(e.message + (e.detalles?.length ? ' ' + e.detalles.join(' ') : ''));
    }
  }, 'Crear usuario');
}

// ---------- Editar ----------
async function formularioEditar(id) {
  let u;
  try { u = (await api(`/api/usuarios/${id}`)).usuario; }
  catch (e) { avisar(e.message); return; }

  const esYoMismo = usuario.id === id;
  const opcionesRol = ['ADMIN', 'MAESTRO', 'ASESOR', 'ALUMNO']
    .map((c) => `<option value="${c}" ${u.rol === c ? 'selected' : ''}>${NOMBRE_ROL[c]}</option>`).join('');
  const opcionesEstado = ['activo', 'inactivo', 'bloqueado']
    .map((e) => `<option value="${e}" ${u.estado === e ? 'selected' : ''}>${e}</option>`).join('');

  abrirDialogo(`Editar: ${u.usuario}`, `
    <div class="rejilla-2">
      <div class="campo"><label>Rol</label><select id="e-rol" class="control" ${esYoMismo ? 'disabled' : ''}>${opcionesRol}</select></div>
      <div class="campo"><label>Estado</label><select id="e-estado" class="control" ${esYoMismo ? 'disabled' : ''}>${opcionesEstado}</select></div>
      <div class="campo"><label>Correo</label><input id="e-correo" value="${escapar(u.persona?.correo || '')}"></div>
      <div class="campo"><label>Teléfono</label><input id="e-telefono" value="${escapar(u.persona?.telefono || '')}"></div>
    </div>
    ${esYoMismo ? '<p class="ayuda">No puedes cambiar tu propio rol ni estado.</p>' : ''}
  `, async () => {
    const cuerpo = {
      correo: $('e-correo').value.trim() || null,
      telefono: $('e-telefono').value.trim() || null,
    };
    if (!esYoMismo) { cuerpo.rol = $('e-rol').value; cuerpo.estado = $('e-estado').value; }
    try {
      await api(`/api/usuarios/${id}`, { method: 'PATCH', body: cuerpo });
      $('dlg').close();
      avisar('Usuario actualizado.', 'exito');
      cargar();
    } catch (e) {
      avisoDialogo(e.message + (e.detalles?.length ? ' ' + e.detalles.join(' ') : ''));
    }
  }, 'Guardar cambios');
}

// ---------- Reiniciar contraseña ----------
async function reiniciarClave(id, usuarioNombre) {
  if (!confirm(`¿Reiniciar la contraseña de "${usuarioNombre}"? Se generará una nueva contraseña temporal.`)) return;
  try {
    const r = await api(`/api/usuarios/${id}/reiniciar-password`, { method: 'POST', body: {} });
    mostrarCredenciales(usuarioNombre, r.passwordTemporal);
  } catch (e) { avisar(e.message); }
}

// ---------- Desbloquear ----------
async function desbloquear(id) {
  try {
    await api(`/api/usuarios/${id}/desbloquear`, { method: 'POST', body: {} });
    avisar('Usuario desbloqueado.', 'exito');
    cargar();
  } catch (e) { avisar(e.message); }
}

// ---------- Mostrar credenciales ----------
function mostrarCredenciales(usuarioNombre, passwordTemporal) {
  abrirDialogo('', `
    <div style="text-align:center">
      <h2 style="color:var(--color-primary);margin:0 0 .5rem">Credenciales de acceso</h2>
      <p style="color:var(--color-text-muted);margin:0 0 1rem">
        Anota estos datos y entrégalos a la persona. La contraseña no se volverá a mostrar.
        Deberá cambiarla en su primer ingreso.
      </p>
      <div class="tarjeta" style="border-left:3px solid var(--color-accent-fuerte);background:var(--color-surface-alt);text-align:left">
        <div style="margin-bottom:.75rem">
          <div style="font-size:var(--texto-xs);text-transform:uppercase;color:var(--color-text-muted)">Usuario</div>
          <div style="font-size:var(--texto-lg);font-weight:700;font-family:var(--fuente-mono,monospace)">${escapar(usuarioNombre)}</div>
        </div>
        <div>
          <div style="font-size:var(--texto-xs);text-transform:uppercase;color:var(--color-text-muted)">Contraseña temporal</div>
          <div style="font-size:var(--texto-lg);font-weight:700;font-family:var(--fuente-mono,monospace)">${escapar(passwordTemporal)}</div>
        </div>
      </div>
    </div>
  `, null);
}

// ---------- Arranque ----------
(async () => {
  usuario = await iniciarPantalla('Usuarios');

  // Seguridad extra en el frontend: solo el admin ve esta pantalla.
  if (usuario.rol !== 'ADMIN') {
    document.querySelector('.contenido').innerHTML =
      '<div class="tarjeta"><p style="color:var(--color-error)">Solo un administrador puede acceder a esta sección.</p></div>';
    return;
  }

  $('btn-nuevo').onclick = formularioNuevo;
  $('btn-buscar').onclick = cargar;
  $('q').onkeydown = (e) => { if (e.key === 'Enter') cargar(); };
  $('f-rol').onchange = cargar;

  await cargar();
})();
