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
    { href: '/tablero.html', texto: 'Tablero', roles: ['ADMIN', 'MAESTRO', 'ASESOR', 'ALUMNO'] },
    { href: '/alumnos.html', texto: 'Alumnos', roles: ['ADMIN', 'ASESOR', 'MAESTRO'] },
    { href: '/horarios.html', texto: 'Horarios', roles: ['ADMIN', 'MAESTRO', 'ALUMNO', 'ASESOR'] },
    { href: '/finanzas.html', texto: 'Finanzas', roles: ['ADMIN', 'ASESOR', 'ALUMNO'] },
    { href: '/auditoria.html', texto: 'Auditoría', roles: ['ADMIN'] },
    { href: '/video.html', texto: 'Videovigilancia', roles: ['ADMIN'] },
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

  // Campana de notificaciones y asistente, presentes en toda pantalla.
  montarExtras(usuario).catch(() => { /* los extras no deben romper la pantalla */ });

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

// ============================================================================
// Campana de notificaciones y widget de chat.
// Se montan en la barra superior desde iniciarPantalla, así aparecen en todas
// las pantallas sin repetir código.
// ============================================================================

export async function montarExtras(usuario) {
  montarCampana();
  montarChat(usuario);
}

function montarCampana() {
  const barra = document.querySelector('.barra-superior > div:last-child');
  if (!barra) return;

  const boton = document.createElement('button');
  boton.className = 'campana';
  boton.innerHTML = '🔔<span class="punto" hidden>0</span>';
  boton.title = 'Notificaciones';
  barra.insertBefore(boton, barra.firstChild);

  const punto = boton.querySelector('.punto');
  let panel = null;

  async function refrescarContador() {
    try {
      const { noLeidas } = await api('/api/notificaciones/contador');
      if (noLeidas > 0) { punto.textContent = noLeidas > 99 ? '99+' : noLeidas; punto.hidden = false; }
      else punto.hidden = true;
    } catch { /* silencioso: el contador es secundario */ }
  }

  async function abrirPanel() {
    if (panel) { panel.remove(); panel = null; return; }
    const { notificaciones } = await api('/api/notificaciones');
    panel = document.createElement('div');
    panel.className = 'panel-notif';
    panel.innerHTML = `
      <header>
        <strong style="font-size:var(--texto-sm)">Notificaciones</strong>
        <button class="boton-mini" id="leer-todas">Marcar todas</button>
      </header>
      ${notificaciones.length ? notificaciones.map((n) => `
        <div class="notif-item ${n.leida ? '' : 'no-leida'}" data-id="${n.id}">
          <div class="titulo">${escapar(n.titulo)}</div>
          <div class="mensaje">${escapar(n.mensaje)}</div>
          <div class="fecha">${new Date(n.creado_en).toLocaleString('es-HN')}</div>
        </div>`).join('')
        : '<div class="notif-item"><div class="mensaje">Sin notificaciones.</div></div>'}`;
    document.body.appendChild(panel);

    panel.querySelector('#leer-todas').onclick = async () => {
      await api('/api/notificaciones/leer-todas', { method: 'POST' });
      panel.remove(); panel = null;
      refrescarContador();
    };
    panel.querySelectorAll('.notif-item[data-id]').forEach((el) => {
      el.onclick = async () => {
        if (el.classList.contains('no-leida')) {
          await api(`/api/notificaciones/${el.dataset.id}/leer`, { method: 'POST' }).catch(() => {});
          el.classList.remove('no-leida');
          refrescarContador();
        }
      };
    });
  }

  boton.onclick = abrirPanel;
  document.addEventListener('click', (e) => {
    if (panel && !panel.contains(e.target) && e.target !== boton && !boton.contains(e.target)) {
      panel.remove(); panel = null;
    }
  });

  refrescarContador();
  setInterval(refrescarContador, 60000); // revisa cada minuto
}

function montarChat(usuario) {
  const fab = document.createElement('button');
  fab.className = 'chat-fab';
  fab.innerHTML = '💬';
  fab.title = 'Asistente';
  document.body.appendChild(fab);

  let ventana = null;

  fab.onclick = async () => {
    if (ventana) { ventana.remove(); ventana = null; fab.innerHTML = '💬'; return; }
    fab.innerHTML = '✕';

    ventana = document.createElement('div');
    ventana.className = 'chat-ventana';
    ventana.innerHTML = `
      <header><b>Asistente</b><span>Pregúntame sobre tus datos del sistema</span></header>
      <div class="chat-mensajes" id="chat-msgs">
        <div class="chat-burbuja bot">Hola ${escapar(usuario.persona.nombreCompleto.split(' ')[0])}. ¿En qué te ayudo?</div>
      </div>
      <div class="chat-entrada">
        <input id="chat-input" placeholder="Escribe tu pregunta…" maxlength="500">
        <button class="boton" id="chat-enviar" style="width:auto">Enviar</button>
      </div>`;
    document.body.appendChild(ventana);

    const msgs = ventana.querySelector('#chat-msgs');
    const input = ventana.querySelector('#chat-input');
    const enviar = ventana.querySelector('#chat-enviar');
    input.focus();

    const burbuja = (texto, quien) => {
      const d = document.createElement('div');
      d.className = `chat-burbuja ${quien}`;
      d.textContent = texto;
      msgs.appendChild(d);
      msgs.scrollTop = msgs.scrollHeight;
      return d;
    };

    async function preguntar() {
      const texto = input.value.trim();
      if (!texto) return;
      input.value = '';
      burbuja(texto, 'usuario');
      const pensando = burbuja('Pensando…', 'bot');
      enviar.disabled = true;

      try {
        const r = await api('/api/asistente/preguntar', { method: 'POST', body: { pregunta: texto } });
        pensando.textContent = r.respuesta;
      } catch (e) {
        pensando.textContent = e.message || 'No pude responder ahora.';
      } finally {
        enviar.disabled = false;
        input.focus();
      }
    }

    enviar.onclick = preguntar;
    input.onkeydown = (e) => { if (e.key === 'Enter') preguntar(); };
  };
}
