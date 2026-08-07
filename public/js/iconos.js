/* ============================================================
   Smart Campus IA — Iconos SVG
   Iconos de trazo (stroke) que heredan el color del texto y se
   animan con CSS (.ico). Livianos, sin dependencias, escalables.
   Uso:  ico('tablero')  ->  string con el <svg>
   ============================================================ */

const TRAZOS = {
  inicio: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9"/><path d="M9 20v-6h6v6"/>',
  tablero: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  alumnos: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 8a3 3 0 0 1 0 6"/><path d="M18 20a5.2 5.2 0 0 0-2.5-4.4"/>',
  horarios: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 2.5v4M16 2.5v4"/><path d="M8 13h3M8 16.5h6"/>',
  finanzas: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M14.5 9.2c0-1-1.1-1.7-2.5-1.7s-2.5.8-2.5 1.9c0 2.6 5 1.4 5 4 0 1.1-1.1 1.9-2.5 1.9s-2.5-.7-2.5-1.7"/>',
  auditoria: '<path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4"/><path d="M9 3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z"/><path d="m8 13 2.5 2.5L16 10"/>',
  video: '<path d="m16 10 4.5-2.5v9L16 14"/><rect x="2" y="6.5" width="14" height="11" rx="2"/><circle cx="8" cy="12" r="2.2"/>',
  campana: '<path d="M18 8a6 6 0 0 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14 18 8"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
  chat: '<path d="M21 11.5a8 8 0 0 1-11.6 7.1L3 20.5l1.9-6.4A8 8 0 1 1 21 11.5"/><circle cx="8.5" cy="12" r=".6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r=".6" fill="currentColor" stroke="none"/><circle cx="15.5" cy="12" r=".6" fill="currentColor" stroke="none"/>',
  ia: '<rect x="5" y="7" width="14" height="12" rx="2"/><path d="M12 7V4M9 4h6"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M9.5 16h5"/><path d="M2 12h3M19 12h3"/>',
  salir: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h12"/>',
  enviar: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  cerrar: '<path d="M18 6 6 18M6 6l12 12"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  descargar: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  documento: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alerta: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 5-5"/>',
  escudo: '<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  camara: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  luna: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  micro: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3M8 21h8"/>',
};

/**
 * Devuelve el string del icono SVG. Hereda color, tamaño y animación
 * de la clase CSS .ico (definida en app.css).
 * @param {string} nombre  clave en TRAZOS
 * @param {string} extra   clases CSS adicionales opcionales
 */
export function ico(nombre, extra = '') {
  const trazo = TRAZOS[nombre] || TRAZOS.documento;
  return `<svg class="ico ${extra}" viewBox="0 0 24 24" aria-hidden="true">${trazo}</svg>`;
}

/** Mapa de secciones del menú a su icono, para la navegación. */
export const ICONO_SECCION = {
  '/inicio.html': 'inicio',
  '/tablero.html': 'tablero',
  '/alumnos.html': 'alumnos',
  '/horarios.html': 'horarios',
  '/finanzas.html': 'finanzas',
  '/usuarios.html': 'alumnos',
  '/auditoria.html': 'auditoria',
  '/video.html': 'video',
};
