// Consulta el estado del sistema. Sin dependencias externas, a proposito.
(async () => {
  const pintar = (id, texto, clase) => {
    const el = document.getElementById(id);
    el.textContent = texto;
    el.className = 'etiqueta-rol';
  };

  try {
    const respuesta = await fetch('/api/salud');
    const datos = await respuesta.json();

    pintar('e-servidor', `en línea (${datos.entorno})`, 'ok');

    if (datos.componentes.baseDatos.ok) {
      pintar('e-bd', `conectada — ${datos.componentes.baseDatos.bd}`, 'ok');
    } else {
      pintar('e-bd', 'sin conexión', 'falla');
    }

    const ia = datos.componentes.ia;
    if (ia.disponible && ia.modeloDescargado) {
      pintar('e-ia', `lista — ${ia.modeloConfigurado}`, 'ok');
    } else if (ia.disponible) {
      pintar('e-ia', 'activa, falta descargar el modelo', 'espera');
    } else {
      pintar('e-ia', 'no disponible (opcional)', 'espera');
    }

    document.getElementById('e-tz').textContent =
      `${datos.zonaHoraria} — ${new Date(datos.hora).toLocaleString('es-HN')}`;
  } catch (error) {
    pintar('e-servidor', 'sin respuesta', 'falla');
    pintar('e-bd', 'desconocido', 'espera');
    pintar('e-ia', 'desconocido', 'espera');
  }
})();
