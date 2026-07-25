/**
 * Utilidades compartidas por todas las pantallas.
 * Sin dependencias externas: la CSP bloquea cualquier CDN.
 */

/**
 * Llama a la API y renueva la sesion sola cuando el token de acceso vence.
 * Sin esto, el usuario ve un cierre de sesion cada 15 minutos.
 */
export async function api(ruta, opciones = {}) {
  const enviar = () => fetch(ruta, {
    ...opciones,
    credentials: 'same-origin',
    headers: {
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opciones.headers ?? {}),
    },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });

  let r = await enviar();

  if (r.status === 401) {
    const ref = await fetch('/api/auth/refrescar', { method: 'POST', credentials: 'same-origin' });
    if (ref.ok) r = await enviar();
    else { window.location.href = '/'; throw new Error('sesion terminada'); }
  }

  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(datos.mensaje || 'Ocurrio un error.');
    e.codigo = datos.codigo;
    e.detalles = datos.detalles ?? [];
    e.estado = r.status;
    throw e;
  }
  return datos;
}

/** Carga la sesion y dibuja la barra superior. Redirige si no hay sesion. */
export async function iniciarPantalla(tituloPagina) {
  let usuario;
  try {
    usuario = (await api('/api/auth/yo')).usuario;
  } catch {
    window.location.href = '/';
    throw new Error('sin sesion');
  }

  const menu = [
    { href: '/inicio.html', texto: 'Inicio', roles: ['ADMIN', 'MAESTRO', 'ASESOR', 'ALUMNO'] },
    { href: '/alumnos.html', texto: 'Alumnos', roles: ['ADMIN', 'ASESOR', 'MAESTRO'] },
    { href: '/horarios.html', texto: 'Horarios', roles: ['ADMIN', 'MAESTRO', 'ALUMNO', 'ASESOR'] },
  ].filter((m) => m.roles.includes(usuario.rol));

  const barra = document.createElement('header');
  barra.className = 'barra-superior';
  barra.innerHTML = `
    <div style="display:flex;align-items:center;gap:1.5rem">
      <strong>Smart Campus IA</strong>
      <nav style="display:flex;gap:1rem">
        ${menu.map((m) => `<a href="${m.href}" style="color:var(--color-text);text-decoration:none;font-size:var(--texto-sm)">${m.texto}</a>`).join('')}
      </nav>
    </div>
    <div style="display:flex;align-items:center;gap:1rem">
      <span style="font-size:var(--texto-sm)">${escapar(usuario.persona.nombreCompleto)}</span>
      <span class="etiqueta-rol">${escapar(usuario.rolNombre)}</span>
      <button class="boton boton-secundario" id="salir" style="width:auto;padding:.35rem .9rem">Salir</button>
    </div>`;
  document.body.prepend(barra);

  // Marca visualmente la pantalla actual.
  for (const a of barra.querySelectorAll('nav a')) {
    if (a.getAttribute('href') === window.location.pathname) {
      a.style.color = 'var(--color-primary)';
      a.style.fontWeight = '600';
    }
  }

  document.getElementById('salir').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.href = '/';
  });

  if (tituloPagina) document.title = `${tituloPagina} — Smart Campus IA`;
  return usuario;
}

/** Escapa texto antes de meterlo en HTML. Nunca se concatena entrada sin pasar por aquí. */
export function escapar(texto) {
  const d = document.createElement('div');
  d.textContent = texto ?? '';
  return d.innerHTML;
}

export function avisar(texto, tipo = 'error', detalles = []) {
  let caja = document.getElementById('aviso-global');
  if (!caja) {
    caja = document.createElement('div');
    caja.id = 'aviso-global';
    caja.setAttribute('role', 'alert');
    document.querySelector('main')?.prepend(caja);
  }
  caja.className = `aviso aviso-${tipo}`;
  caja.innerHTML = escapar(texto) +
    (detalles.length ? `<ul>${detalles.map((d) => `<li>${escapar(d)}</li>`).join('')}</ul>` : '');
  caja.hidden = false;
  caja.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (tipo === 'exito') setTimeout(() => { caja.hidden = true; }, 6000);
}

export const limpiarAviso = () => {
  const c = document.getElementById('aviso-global');
  if (c) c.hidden = true;
};
