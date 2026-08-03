/* ============================================================
   Smart Campus IA — Conmutador de tema (claro / oscuro)
   Guarda la preferencia del usuario y la aplica en <html data-tema>.
   Si nunca eligió, respeta la preferencia del sistema operativo.
   ============================================================ */

import { ico } from './iconos.js';

const CLAVE = 'sc-tema';

/** Aplica el tema al documento. */
function aplicar(tema) {
  document.documentElement.setAttribute('data-tema', tema);
}

/** Devuelve el tema guardado, o el del sistema si no hay ninguno. */
export function temaActual() {
  const guardado = localStorage.getItem(CLAVE);
  if (guardado === 'claro' || guardado === 'oscuro') return guardado;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
}

/** Aplica el tema guardado al cargar. Se llama lo antes posible. */
export function iniciarTema() {
  aplicar(temaActual());
}

/** Alterna entre claro y oscuro y guarda la elección. */
export function alternarTema() {
  const nuevo = temaActual() === 'oscuro' ? 'claro' : 'oscuro';
  localStorage.setItem(CLAVE, nuevo);
  aplicar(nuevo);
  return nuevo;
}

/** Crea el botón de tema para la barra superior. */
export function botonTema() {
  const btn = document.createElement('button');
  btn.className = 'btn-tema';
  btn.title = 'Cambiar tema claro / oscuro';
  const pintar = () => {
    btn.innerHTML = temaActual() === 'oscuro' ? ico('sol') : ico('luna');
  };
  pintar();
  btn.addEventListener('click', () => { alternarTema(); pintar(); });
  return btn;
}
