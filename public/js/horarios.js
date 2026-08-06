import { api, iniciarPantalla, escapar, avisar } from './comun.js';

const $ = (id) => document.getElementById(id);
let usuario, catalogos, datos;

const esAdmin = () => usuario.rol === 'ADMIN';

function llenarValores() {
  const vista = $('f-vista').value;
  const sel = $('f-valor');

  if (vista === 'seccion') {
    sel.innerHTML = catalogos.secciones.map((s) =>
      `<option value="${s.id}">${escapar(`${s.grado}º ${s.letra} — ${s.grado_nombre}`)}</option>`).join('');
  } else if (vista === 'maestro') {
    sel.innerHTML = catalogos.maestros.map((m) => `<option value="${m.id}">${escapar(m.nombre)}</option>`).join('');
  } else {
    sel.innerHTML = catalogos.aulas.map((a) => `<option value="${a.id}">${escapar(`${a.codigo} — ${a.nombre}`)}</option>`).join('');
  }
}

async function cargar() {
  const vista = $('f-vista').value;
  const clave = { seccion: 'seccionId', maestro: 'maestroId', aula: 'aulaId' }[vista];
  const tabla = $('rejilla');
  tabla.innerHTML = '<tbody><tr><td>Cargando…</td></tr></tbody>';

  try {
    datos = await api(`/api/horarios?${clave}=${$('f-valor').value}`);
    dibujar(vista);
  } catch (e) {
    tabla.innerHTML = `<tbody><tr><td style="color:var(--color-error)">${escapar(e.message)}</td></tr></tbody>`;
  }
}

function dibujar(vista) {
  const mapa = new Map();
  for (const c of datos.celdas) mapa.set(`${c.dia_semana}-${c.bloque_horario_id}`, c);

  const encabezado = `<tr><th class="hora">Hora</th>${datos.dias.map((d) => `<th>${escapar(d.nombre)}</th>`).join('')}</tr>`;

  const filas = datos.bloques.map((b) => {
    if (b.esReceso) {
      return `<tr><th class="hora">${escapar(b.hora)}</th><td class="receso" colspan="${datos.dias.length}">${escapar(b.nombre)}</td></tr>`;
    }

    const celdas = datos.dias.map((d) => {
      const c = mapa.get(`${d.id}-${b.id}`);
      if (!c) {
        return `<td class="${esAdmin() && vista === 'seccion' ? 'libre' : ''}" data-dia="${d.id}" data-bloque="${b.id}"></td>`;
      }

      // Según desde dónde se mire, interesa un dato distinto en el segundo renglón.
      const detalle = vista === 'seccion' ? `${c.maestro ?? 'sin maestro'} · ${c.aula}`
        : vista === 'maestro' ? `${c.grado}º ${c.seccion} · ${c.aula}`
          : `${c.grado}º ${c.seccion} · ${c.maestro ?? 'sin maestro'}`;

      return `<td>
        <div class="clase">
          <b>${escapar(c.asignatura)}</b>
          <span>${escapar(detalle)}</span>
          ${esAdmin() ? `<button class="boton-mini" style="margin-top:4px" data-borrar="${c.id}">Quitar</button>` : ''}
        </div></td>`;
    }).join('');

    return `<tr><th class="hora">${escapar(b.hora)}</th>${celdas}</tr>`;
  }).join('');

  $('rejilla').innerHTML = `<thead>${encabezado}</thead><tbody>${filas}</tbody>`;

  $('pista').textContent = esAdmin() && vista === 'seccion'
    ? 'Haz clic en una casilla vacía para asignar una clase.'
    : '';
}

async function asignar(dia, bloqueId) {
  const seccionId = Number($('f-valor').value);
  const { clases } = await api(`/api/secciones/${seccionId}/clases`);

  if (!clases.length) {
    avisar('Esta sección todavía no tiene clases creadas. Créalas antes de armar el horario.');
    return;
  }

  const dlg = $('dlg');
  dlg.innerHTML = `
    <div class="cuerpo">
      <h2>Asignar clase</h2>
      <div id="dlg-aviso" class="aviso aviso-error" hidden></div>
      <div class="campo"><label for="a-clase">Clase</label>
        <select id="a-clase" class="control">${clases.map((c) =>
    `<option value="${c.id}">${escapar(c.asignatura)}${c.maestro ? ` — ${escapar(c.maestro)}` : ' — sin maestro'}</option>`).join('')}</select></div>
      <div class="campo"><label for="a-aula">Aula</label>
        <select id="a-aula" class="control"><option>Cargando aulas libres…</option></select></div>
      <div style="display:flex;gap:.75rem;margin-top:1.5rem">
        <button class="boton" id="a-ok">Asignar</button>
        <button class="boton boton-secundario" id="a-cancelar">Cancelar</button>
      </div>
    </div>`;
  dlg.showModal();
  $('a-cancelar').onclick = () => dlg.close();

  // Solo se ofrecen las aulas realmente libres en ese hueco: evita que la
  // persona elija una ocupada y reciba un error después.
  try {
    const { aulas } = await api(`/api/horarios/aulas-libres?diaSemana=${dia}&bloqueId=${bloqueId}`);
    $('a-aula').innerHTML = aulas.length
      ? aulas.map((a) => `<option value="${a.id}">${escapar(`${a.codigo} — ${a.nombre}`)} (${a.capacidad})</option>`).join('')
      : '<option value="">No hay aulas libres en ese horario</option>';
  } catch {
    $('a-aula').innerHTML = '<option value="">No se pudieron cargar las aulas</option>';
  }

  $('a-ok').onclick = async () => {
    const cuerpo = {
      claseId: Number($('a-clase').value),
      diaSemana: dia,
      bloqueId,
      aulaId: Number($('a-aula').value),
    };
    if (!cuerpo.aulaId) { mostrarAviso('Selecciona un aula disponible.'); return; }

    try {
      // Consulta previa: muestra qué chocaría antes de intentar guardar.
      const v = await api('/api/horarios/verificar', { method: 'POST', body: cuerpo });
      if (!v.disponible) {
        mostrarAviso('No se puede programar ahí:', v.conflictos.map((c) => c.mensaje));
        return;
      }
      await api('/api/horarios', { method: 'POST', body: cuerpo });
      dlg.close();
      cargar();
    } catch (e) {
      mostrarAviso(e.message, e.detalles);
    }
  };

  function mostrarAviso(texto, detalles = []) {
    const a = $('dlg-aviso');
    a.innerHTML = escapar(texto) + (detalles.length ? `<ul>${detalles.map((d) => `<li>${escapar(d)}</li>`).join('')}</ul>` : '');
    a.hidden = false;
  }
}

(async () => {
  usuario = await iniciarPantalla('Horarios');
  catalogos = (await api('/api/contexto')).catalogos;

  // Un maestro no necesita el selector: le interesa su propio horario.
  if (usuario.rol === 'MAESTRO') {
    $('f-vista').value = 'maestro';
    llenarValores();
    const propio = catalogos.maestros.find((m) => m.id === usuario.id);
    if (propio) $('f-valor').value = propio.id;
  } else if (usuario.rol === 'ALUMNO') {
    // El alumno solo ve el horario de SU sección actual, sin poder cambiarlo.
    $('f-vista').value = 'seccion';
    llenarValores();
    if (usuario.seccionId) $('f-valor').value = usuario.seccionId;
    // Ocultar los selectores: no hay nada que elegir.
    const filtros = $('f-vista').closest('div');
    if (filtros) filtros.style.display = 'none';
  } else {
    llenarValores();
  }

  $('f-vista').onchange = () => { llenarValores(); cargar(); };
  $('f-valor').onchange = cargar;

  $('rejilla').onclick = async (e) => {
    const borrar = e.target.closest('[data-borrar]');
    if (borrar && esAdmin()) {
      await api(`/api/horarios/${borrar.dataset.borrar}`, { method: 'DELETE' });
      cargar();
      return;
    }
    const celda = e.target.closest('td.libre');
    if (celda && esAdmin() && $('f-vista').value === 'seccion') {
      asignar(Number(celda.dataset.dia), Number(celda.dataset.bloque));
    }
  };

  await cargar();
})();
