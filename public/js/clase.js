import { api, iniciarPantalla, escapar, avisar } from './comun.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const claseId = Number(params.get('id'));
let usuario, periodos = [], periodoId, tabActiva = 'notas';

const puedeEditar = () => ['ADMIN', 'MAESTRO'].includes(usuario.rol);

async function cargarPeriodos() {
  const { anioLectivo } = await api('/api/contexto');
  // Los periodos vienen de la BD; se piden vía un endpoint ligero.
  periodos = await api(`/api/periodos?anioLectivoId=${anioLectivo.id}`).then((r) => r.periodos).catch(() => []);
  if (!periodos.length) {
    // Fallback: derivar del contexto si no existe el endpoint.
    periodos = [];
  }
}

// ---------- NOTAS ----------
async function cargarNotas() {
  const panel = $('panel-notas');
  panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Cargando…</p></div>';

  try {
    const cuadro = await api(`/api/clases/${claseId}/cuadro?periodoId=${periodoId}`);
    const pond = cuadro.ponderacion;

    const avisoPond = !pond.completa
      ? `<div class="aviso aviso-error">La ponderación suma ${pond.suma}%, debe sumar 100%. Corrígela antes de digitar notas.</div>`
      : '';

    const cabeceras = cuadro.evaluaciones.map((e) =>
      `<th title="${escapar(e.tipo)} · máx ${e.puntaje_maximo}">${escapar(e.titulo)}<br><span style="font-weight:400;color:var(--color-text-muted)">/${e.puntaje_maximo}</span></th>`
    ).join('');

    const filas = cuadro.alumnos.map((a) => {
      const celdas = cuadro.evaluaciones.map((e) =>
        `<td style="text-align:center">${a.notas[e.id] ?? '<span style="color:var(--color-text-muted)">—</span>'}</td>`).join('');
      const nota = a.notaFinal !== null
        ? `<b style="color:${a.aprobado ? 'var(--color-aprobado)' : 'var(--color-reprobado)'}">${a.notaFinal}</b>`
        : '<span style="color:var(--color-text-muted)">—</span>';
      return `<tr><td>${escapar(a.nombre)}</td>${celdas}<td style="text-align:center">${nota}${a.bloqueada ? ' 🔒' : ''}</td></tr>`;
    }).join('');

    panel.innerHTML = `
      ${avisoPond}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
        <div style="font-size:var(--texto-sm);color:var(--color-text-muted)">
          Ponderación: ${pond.ponderaciones.filter((p) => !p.es_extra).map((p) => `${escapar(p.nombre)} ${p.porcentaje}%`).join(' · ') || 'sin definir'}
        </div>
        ${puedeEditar() ? `<div style="display:flex;gap:.5rem">
          <button class="boton-mini" id="btn-pond">Ponderación</button>
          <button class="boton-mini" id="btn-eval">Nueva evaluación</button>
        </div>` : ''}
      </div>
      <div class="tarjeta" style="padding:0;overflow:auto">
        <table class="tabla">
          <thead><tr><th>Alumno</th>${cabeceras}<th style="text-align:center">Final</th></tr></thead>
          <tbody>${filas || '<tr><td colspan="99" style="padding:1.5rem;color:var(--color-text-muted)">Sin alumnos inscritos.</td></tr>'}</tbody>
        </table>
      </div>
      ${puedeEditar() && cuadro.evaluaciones.length ? `
      <p style="color:var(--color-text-muted);font-size:var(--texto-sm);margin-top:.75rem">
        Haz clic en una evaluación para digitar sus notas:
        ${cuadro.evaluaciones.map((e) => `<button class="boton-mini" data-planilla="${e.id}">${escapar(e.titulo)}</button>`).join(' ')}
      </p>` : ''}`;

    if (puedeEditar()) {
      $('btn-pond')?.addEventListener('click', () => editarPonderacion());
      $('btn-eval')?.addEventListener('click', () => nuevaEvaluacion());
      panel.querySelectorAll('[data-planilla]').forEach((b) =>
        b.addEventListener('click', () => digitarPlanilla(Number(b.dataset.planilla))));
    }
  } catch (e) {
    panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`;
  }
}

async function digitarPlanilla(evaluacionId) {
  const { evaluacion, alumnos } = await api(`/api/evaluaciones/${evaluacionId}/planilla`);
  const dlg = $('dlg');
  dlg.innerHTML = `
    <div class="cuerpo">
      <h2>${escapar(evaluacion.titulo)} <span style="font-weight:400;color:var(--color-text-muted)">/ ${evaluacion.puntaje_maximo}</span></h2>
      <div id="dlg-aviso" class="aviso aviso-error" hidden></div>
      <table class="tabla">
        <thead><tr><th>Alumno</th><th style="width:110px">Puntaje</th></tr></thead>
        <tbody>${alumnos.map((a) => `
          <tr>
            <td>${escapar(a.nombre)}</td>
            <td><input class="control nota-input" data-alumno="${a.alumno_id}" type="number" min="0" max="${evaluacion.puntaje_maximo}" step="0.01" value="${a.puntaje ?? ''}" style="padding:.4rem"></td>
          </tr>`).join('')}</tbody>
      </table>
      <div style="display:flex;gap:.75rem;margin-top:1.5rem">
        <button class="boton" id="dlg-guardar">Guardar notas</button>
        <button class="boton boton-secundario" id="dlg-cerrar">Cerrar</button>
      </div>
    </div>`;
  dlg.showModal();
  $('dlg-cerrar').onclick = () => dlg.close();

  // Enter salta al siguiente campo: digitar de corrido, como en una planilla.
  const inputs = [...dlg.querySelectorAll('.nota-input')];
  inputs.forEach((inp, i) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inputs[i + 1]?.focus(); }
    });
  });

  $('dlg-guardar').onclick = async () => {
    const notas = inputs.map((inp) => ({
      alumnoId: Number(inp.dataset.alumno),
      puntaje: inp.value === '' ? '' : Number(inp.value),
    }));
    try {
      await api(`/api/evaluaciones/${evaluacionId}/notas`, { method: 'PUT', body: { notas } });
      dlg.close();
      avisar('Notas guardadas.', 'exito');
      cargarNotas();
    } catch (e) {
      const a = $('dlg-aviso');
      a.innerHTML = escapar(e.message) + (e.detalles?.length ? `<ul>${e.detalles.map((d) => `<li>${escapar(d)}</li>`).join('')}</ul>` : '');
      a.hidden = false;
    }
  };
}

async function nuevaEvaluacion() {
  const { catalogos } = await api('/api/contexto');
  const tipos = await api('/api/tipos-evaluacion').then((r) => r.tipos).catch(() => [
    { id: 1, nombre: 'Tareas' }, { id: 2, nombre: 'Proyectos' }, { id: 3, nombre: 'Exámenes' }, { id: 4, nombre: 'Puntos extra' },
  ]);
  const dlg = $('dlg');
  dlg.innerHTML = `
    <div class="cuerpo">
      <h2>Nueva evaluación</h2>
      <div id="dlg-aviso" class="aviso aviso-error" hidden></div>
      <div class="campo"><label>Título</label><input id="ev-titulo" class="control"></div>
      <div class="rejilla-2">
        <div class="campo"><label>Tipo</label><select id="ev-tipo" class="control">${tipos.map((t) => `<option value="${t.id}">${escapar(t.nombre)}</option>`).join('')}</select></div>
        <div class="campo"><label>Puntaje máximo</label><input id="ev-max" class="control" type="number" value="100" min="1"></div>
      </div>
      <div class="campo"><label>Fecha</label><input id="ev-fecha" class="control" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div style="display:flex;gap:.75rem;margin-top:1rem">
        <button class="boton" id="dlg-crear">Crear</button>
        <button class="boton boton-secundario" id="dlg-cerrar">Cancelar</button>
      </div>
    </div>`;
  dlg.showModal();
  $('dlg-cerrar').onclick = () => dlg.close();
  $('dlg-crear').onclick = async () => {
    try {
      await api(`/api/clases/${claseId}/evaluaciones`, {
        method: 'POST',
        body: {
          periodoId, tipoEvaluacionId: Number($('ev-tipo').value),
          titulo: $('ev-titulo').value.trim(), puntajeMaximo: Number($('ev-max').value),
          fecha: $('ev-fecha').value,
        },
      });
      dlg.close();
      cargarNotas();
    } catch (e) {
      const a = $('dlg-aviso'); a.textContent = e.message; a.hidden = false;
    }
  };
}

async function editarPonderacion() {
  const { ponderaciones } = await api(`/api/clases/${claseId}/ponderacion?periodoId=${periodoId}`);
  const tipos = [{ id: 1, nombre: 'Tareas' }, { id: 2, nombre: 'Proyectos' }, { id: 3, nombre: 'Exámenes' }];
  const actual = Object.fromEntries(ponderaciones.map((p) => [p.tipo_evaluacion_id, p.porcentaje]));

  const dlg = $('dlg');
  dlg.innerHTML = `
    <div class="cuerpo">
      <h2>Ponderación del periodo</h2>
      <div id="dlg-aviso" class="aviso aviso-error" hidden></div>
      <p style="color:var(--color-text-muted);font-size:var(--texto-sm)">Los porcentajes deben sumar 100.</p>
      ${tipos.map((t) => `
        <div class="campo" style="display:flex;align-items:center;gap:1rem">
          <label style="flex:1;margin:0">${escapar(t.nombre)}</label>
          <input class="control pond-input" data-tipo="${t.id}" type="number" min="0" max="100" value="${actual[t.id] ?? 0}" style="width:90px">
          <span>%</span>
        </div>`).join('')}
      <p id="suma" style="text-align:right;font-weight:600"></p>
      <div style="display:flex;gap:.75rem;margin-top:1rem">
        <button class="boton" id="dlg-guardar">Guardar</button>
        <button class="boton boton-secundario" id="dlg-cerrar">Cancelar</button>
      </div>
    </div>`;
  dlg.showModal();
  $('dlg-cerrar').onclick = () => dlg.close();

  const inputs = [...dlg.querySelectorAll('.pond-input')];
  const recalcular = () => {
    const suma = inputs.reduce((s, i) => s + Number(i.value || 0), 0);
    $('suma').textContent = `Suma: ${suma}%`;
    $('suma').style.color = Math.abs(suma - 100) < 0.01 ? 'var(--color-exito)' : 'var(--color-error)';
  };
  inputs.forEach((i) => i.addEventListener('input', recalcular));
  recalcular();

  $('dlg-guardar').onclick = async () => {
    const items = inputs.map((i) => ({ tipoEvaluacionId: Number(i.dataset.tipo), porcentaje: Number(i.value || 0) }));
    items.push({ tipoEvaluacionId: 4, porcentaje: 0, esExtra: true });
    try {
      await api(`/api/clases/${claseId}/ponderacion`, { method: 'PUT', body: { periodoId, items } });
      dlg.close();
      cargarNotas();
    } catch (e) {
      const a = $('dlg-aviso'); a.textContent = e.message; a.hidden = false;
    }
  };
}

// ---------- ASISTENCIA ----------
async function cargarAsistencia() {
  const panel = $('panel-asistencia');
  panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Cargando…</p></div>';
  const hoy = new Date().toISOString().slice(0, 10);

  try {
    const { alumnos, yaTomada } = await api(`/api/clases/${claseId}/asistencia?fecha=${hoy}`);
    const estados = ['presente', 'ausente', 'tarde', 'justificado'];

    panel.innerHTML = `
      <div class="tarjeta" style="margin-bottom:1rem;padding:1rem;display:flex;gap:1rem;align-items:end">
        <div class="campo" style="margin:0"><label>Fecha</label><input id="a-fecha" class="control" type="date" value="${hoy}"></div>
        ${yaTomada ? '<span class="insignia-estado estado-activo">Ya se pasó lista hoy — puedes corregir</span>' : ''}
      </div>
      <div class="tarjeta" style="padding:0;overflow:auto">
        <table class="tabla">
          <thead><tr><th>Alumno</th>${estados.map((e) => `<th style="text-align:center;text-transform:capitalize">${e}</th>`).join('')}</tr></thead>
          <tbody>${alumnos.map((a) => `
            <tr>
              <td>${escapar(a.nombre)}</td>
              ${estados.map((e) => `<td style="text-align:center"><input type="radio" name="al-${a.alumno_id}" value="${e}" ${a.estado === e || (!a.estado && e === 'presente') ? 'checked' : ''}></td>`).join('')}
            </tr>`).join('')}</tbody>
        </table>
      </div>
      ${puedeEditar() ? '<button class="boton" id="a-guardar" style="width:auto;margin-top:1rem">Guardar asistencia</button>' : ''}`;

    $('a-fecha')?.addEventListener('change', async (e) => {
      const f = e.target.value;
      const datos = await api(`/api/clases/${claseId}/asistencia?fecha=${f}`);
      for (const a of datos.alumnos) {
        const radio = panel.querySelector(`input[name="al-${a.alumno_id}"][value="${a.estado ?? 'presente'}"]`);
        if (radio) radio.checked = true;
      }
    });

    $('a-guardar')?.addEventListener('click', async () => {
      const fecha = $('a-fecha').value;
      const registros = alumnos.map((a) => ({
        alumnoId: a.alumno_id,
        estado: panel.querySelector(`input[name="al-${a.alumno_id}"]:checked`)?.value ?? 'presente',
      }));
      try {
        const r = await api(`/api/clases/${claseId}/asistencia`, { method: 'PUT', body: { fecha, registros } });
        avisar(r.mensaje, r.enRiesgo?.length ? 'info' : 'exito',
          r.enRiesgo?.map((a) => `${a.nombre}: ${a.porcentajeInasistencia}% de inasistencia`) ?? []);
      } catch (e) {
        avisar(e.message);
      }
    });
  } catch (e) {
    panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`;
  }
}

function cambiarTab(tab) {
  tabActiva = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('activa', b.dataset.tab === tab));
  $('panel-notas').hidden = tab !== 'notas';
  $('panel-asistencia').hidden = tab !== 'asistencia';
  if (tab === 'notas') cargarNotas(); else cargarAsistencia();
}

(async () => {
  usuario = await iniciarPantalla('Clase');

  // Datos de la clase desde mis-clases.
  const { clases } = await api('/api/mis-clases');
  const clase = clases.find((c) => c.id === claseId);
  if (clase) {
    $('titulo').textContent = clase.asignatura;
    $('subtitulo').textContent = `${clase.grado}º ${clase.seccion}${clase.maestro ? ` · ${clase.maestro}` : ''}`;
  }

  // Periodos: el sistema arranca en el I Parcial abierto.
  const ctx = await api('/api/contexto');
  periodos = (await api(`/api/periodos?anioLectivoId=${ctx.anioLectivo.id}`).then((r) => r.periodos).catch(() => []));
  $('periodo').innerHTML = periodos.map((p) =>
    `<option value="${p.id}" ${p.estado === 'abierto' ? 'selected' : ''}>${escapar(p.nombre)}${p.estado === 'cerrado' ? ' (cerrado)' : ''}</option>`).join('');
  periodoId = Number($('periodo').value) || periodos[0]?.id;

  $('periodo').onchange = () => { periodoId = Number($('periodo').value); cambiarTab(tabActiva); };
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));

  cambiarTab('notas');
})();
