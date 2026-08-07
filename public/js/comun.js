/**
 * Utilidades compartidas por todas las pantallas.
 * Sin dependencias externas: la CSP bloquea cualquier CDN.
 */
import { ico, ICONO_SECCION } from './iconos.js';
import { iniciarTema, botonTema } from './tema.js';

// Aplica el tema guardado de inmediato, antes de dibujar nada.
iniciarTema();

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
    { href: '/usuarios.html', texto: 'Usuarios', roles: ['ADMIN'] },
    { href: '/auditoria.html', texto: 'Auditoría', roles: ['ADMIN'] },
    { href: '/video.html', texto: 'Videovigilancia', roles: ['ADMIN'] },
  ].filter((m) => m.roles.includes(usuario.rol));

  const rutaActual = window.location.pathname;

  const barra = document.createElement('header');
  barra.className = 'barra-superior';
  barra.innerHTML = `
    <a href="/inicio.html" class="marca-barra" style="text-decoration:none;color:inherit">
      <img src="/img/logo-64.png" alt="Smart Campus IA" width="40" height="40">
      <span>Smart Campus <span class="ia">IA</span></span>
    </a>
    <div class="zona-derecha">
      <span class="usuario-nombre">${escapar(usuario.persona.nombreCompleto)}</span>
      <span class="etiqueta-rol">${escapar(usuario.rolNombre)}</span>
      <button class="ico-btn" id="salir" title="Cerrar sesión" style="color:var(--color-sobre-marca)">${ico('salir')}</button>
    </div>`;
  document.body.prepend(barra);

  // Botón de tema claro/oscuro, antes del de salir.
  const zona = barra.querySelector('.zona-derecha');
  zona.insertBefore(botonTema(), zona.querySelector('#salir'));

  // Menú de navegación con iconos, al inicio del contenido de la página.
  const nav = document.createElement('nav');
  nav.className = 'menu-nav';
  nav.innerHTML = menu.map((m) => {
    const activa = m.href === rutaActual ? ' activa' : '';
    return `<a href="${m.href}" class="${activa.trim()}">${ico(ICONO_SECCION[m.href] || 'documento')}${m.texto}</a>`;
  }).join('');
  const cont = document.querySelector('.contenido');
  if (cont) cont.prepend(nav); else barra.after(nav);

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
  const barra = document.querySelector('.barra-superior .zona-derecha');
  if (!barra) return;

  const boton = document.createElement('button');
  boton.className = 'campana';
  boton.innerHTML = `${ico('campana')}<span class="punto" hidden>0</span>`;
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
  fab.innerHTML = ico('chat');
  fab.title = 'Asistente IA';
  document.body.appendChild(fab);

  let ventana = null;

  fab.onclick = async () => {
    if (ventana) { ventana.remove(); ventana = null; fab.innerHTML = ico('chat'); return; }
    fab.innerHTML = ico('cerrar');

    ventana = document.createElement('div');
    ventana.className = 'chat-ventana';
    ventana.innerHTML = `
      <header>
        <span class="avatar-ia">${ico('ia')}</span>
        <div><b>Asistente IA</b><span>Pregúntame sobre tus datos</span></div>
      </header>
      <div class="chat-mensajes" id="chat-msgs">
        <div class="chat-burbuja bot">Hola ${escapar(usuario.persona.nombreCompleto.split(' ')[0])}. ¿En qué te ayudo?</div>
      </div>
      <div class="chat-entrada">
        <input id="chat-input" placeholder="Escribe o dicta tu pregunta…" maxlength="500">
        <button class="ico-btn micro" id="chat-micro" title="Dictar por voz">${ico('micro')}</button>
        <button class="ico-btn enviar" id="chat-enviar" title="Enviar">${ico('enviar')}</button>
      </div>`;
    document.body.appendChild(ventana);

    const msgs = ventana.querySelector('#chat-msgs');
    const input = ventana.querySelector('#chat-input');
    const enviar = ventana.querySelector('#chat-enviar');
    const micro = ventana.querySelector('#chat-micro');
    input.focus();

    // Dictado por voz con la API de reconocimiento del navegador.
    montarDictado(micro, input);

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

/**
 * Dictado por voz para el chat. Usa la API de reconocimiento de voz del
 * navegador (SpeechRecognition), disponible en Chrome y Edge. Escribe lo
 * dictado en el campo de texto; el usuario revisa y envía.
 *
 * Si el navegador no lo soporta, el botón se oculta (degradación elegante).
 */
function montarDictado(boton, input) {
  const Recon = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recon) {
    // El navegador no soporta dictado: se oculta el botón sin romper nada.
    boton.style.display = 'none';
    return;
  }

  const recon = new Recon();
  recon.lang = 'es-HN';           // español; el navegador ajusta al acento
  recon.interimResults = true;    // muestra el texto mientras se habla
  recon.continuous = false;       // se detiene al terminar de hablar

  let grabando = false;
  let textoBase = '';

  boton.addEventListener('click', () => {
    if (grabando) { recon.stop(); return; }
    textoBase = input.value ? input.value.trim() + ' ' : '';
    try { recon.start(); } catch { /* ya estaba iniciando */ }
  });

  recon.addEventListener('start', () => {
    grabando = true;
    boton.classList.add('grabando');
    boton.title = 'Escuchando… (clic para detener)';
    input.placeholder = 'Escuchando…';
  });

  recon.addEventListener('result', (e) => {
    let texto = '';
    for (const res of e.results) texto += res[0].transcript;
    input.value = textoBase + texto;
  });

  const terminar = () => {
    grabando = false;
    boton.classList.remove('grabando');
    boton.title = 'Dictar por voz';
    input.placeholder = 'Escribe o dicta tu pregunta…';
    input.focus();
  };
  recon.addEventListener('end', terminar);
  recon.addEventListener('error', (e) => {
    terminar();
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      input.placeholder = 'Permite el micrófono en el navegador para dictar.';
    }
  });
}
