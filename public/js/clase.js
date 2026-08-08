import { api, iniciarPantalla, escapar, avisar } from './comun.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const claseId = Number(params.get('id'));
let usuario, periodos = [], periodoId, tabActiva = 'notas';

const puedeEditar = () => ['ADMIN', 'MAESTRO'].includes(usuario.rol);

// Devuelve el alumnoId del usuario logueado. Usa el del perfil; si no está
// (por alguna razón), lo obtiene del listado, que ya viene filtrado a él mismo.
let _alumnoIdCache = null;
async function miAlumnoId() {
  if (usuario.alumnoId) return usuario.alumnoId;
  if (_alumnoIdCache) return _alumnoIdCache;
  const lista = await api('/api/alumnos?porPagina=1').catch(() => null);
  _alumnoIdCache = lista?.datos?.[0]?.id ?? null;
  return _alumnoIdCache;
}

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
      const boleta = `<a class="boton-mini" href="/api/alumnos/${a.alumnoId}/boleta?periodoId=${periodoId}" target="_blank" title="Descargar boleta PDF">Boleta</a>`;
      return `<tr><td>${escapar(a.nombre)}</td>${celdas}<td style="text-align:center">${nota}${a.bloqueada ? ' 🔒' : ''}</td><td class="acciones">${boleta}</td></tr>`;
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
          <thead><tr><th>Alumno</th>${cabeceras}<th style="text-align:center">Final</th><th></th></tr></thead>
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
// ---------- ASISTENCIA: cuadrícula de fechas del año ----------
const MESES_ASIST = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS_CORTOS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

// Rango del año escolar: 1 de febrero a 30 de noviembre de 2026.
const ASIST_INICIO = '2026-02-01';
const ASIST_FIN = '2026-11-30';

async function cargarAsistencia() {
  const panel = $('panel-asistencia');
  panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Cargando…</p></div>';

  try {
    // Fechas que ya tienen asistencia registrada (para marcarlas).
    const { fechas } = await api(`/api/clases/${claseId}/asistencia/fechas`);
    const conRegistro = new Map(fechas.map((f) => [f.fecha, f]));

    // Construir los meses del rango (feb a nov 2026).
    const meses = [];
    let d = new Date(ASIST_INICIO + 'T12:00:00');
    const fin = new Date(ASIST_FIN + 'T12:00:00');
    let mesActual = -1, contenedor = null;
    while (d <= fin) {
      const m = d.getMonth();
      if (m !== mesActual) {
        mesActual = m;
        contenedor = { mes: m, anio: d.getFullYear(), dias: [] };
        meses.push(contenedor);
      }
      const iso = d.toISOString().slice(0, 10);
      contenedor.dias.push({
        iso,
        dia: d.getDate(),
        diaSemana: d.getDay(),
        registro: conRegistro.get(iso) ?? null,
      });
      d.setDate(d.getDate() + 1);
    }

    const celdaDia = (dd) => {
      const tieneReg = !!dd.registro;
      const finde = dd.diaSemana === 0 || dd.diaSemana === 6;
      const clases = ['dia-asist'];
      if (tieneReg) clases.push('con-registro');
      if (finde) clases.push('finde');
      const titulo = tieneReg
        ? `${dd.registro.presentes}P · ${dd.registro.ausentes}A · ${dd.registro.tardes}T · ${dd.registro.justificados}J`
        : 'Sin registro';
      return `<button type="button" class="${clases.join(' ')}" data-fecha="${dd.iso}" title="${titulo}">
        <span class="dia-num">${dd.dia}</span>
        <span class="dia-letra">${DIAS_CORTOS[dd.diaSemana]}</span>
      </button>`;
    };

    panel.innerHTML = `
      <div class="asist-leyenda">
        <span><i class="pt con-registro"></i> Con asistencia registrada</span>
        <span><i class="pt"></i> Sin registro</span>
        <span class="asist-ayuda">Toca una fecha para ver o registrar la asistencia</span>
      </div>
      ${meses.map((mes) => `
        <div class="asist-mes">
          <div class="asist-mes-titulo">${MESES_ASIST[mes.mes]} ${mes.anio}</div>
          <div class="asist-rejilla">
            ${mes.dias.map(celdaDia).join('')}
          </div>
        </div>`).join('')}`;

    // Al hacer clic en una fecha, abrir la ventana flotante con la tabla.
    panel.querySelectorAll('.dia-asist').forEach((b) =>
      b.addEventListener('click', () => abrirAsistenciaFecha(b.dataset.fecha)));
  } catch (e) {
    panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`;
  }
}

/**
 * Abre una ventana flotante con la tabla de alumnos y su asistencia para una
 * fecha. Si el usuario puede editar (admin/maestro), muestra el botón guardar.
 */
async function abrirAsistenciaFecha(fecha) {
  const dlg = $('dlg-asist') || (() => {
    const d = document.createElement('dialog');
    d.id = 'dlg-asist';
    d.className = 'dialogo';
    document.body.appendChild(d);
    return d;
  })();

  const fechaLinda = new Date(fecha + 'T12:00:00').toLocaleDateString('es-HN',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  dlg.innerHTML = '<div class="cuerpo"><p style="color:var(--color-text-muted)">Cargando…</p></div>';
  dlg.showModal();

  try {
    const { alumnos, yaTomada } = await api(`/api/clases/${claseId}/asistencia?fecha=${fecha}`);
    const estados = ['presente', 'ausente', 'tarde', 'justificado'];
    const editable = puedeEditar();

    dlg.innerHTML = `
      <div class="cuerpo">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:1rem;margin-bottom:1rem">
          <div>
            <h2 style="margin:0;color:var(--color-primary);text-transform:capitalize">${escapar(fechaLinda)}</h2>
            <p style="margin:.25rem 0 0;color:var(--color-text-muted)">
              ${yaTomada ? 'Asistencia registrada' : 'Sin registro'} · ${alumnos.length} alumnos
              ${editable ? '' : ' · solo lectura'}
            </p>
          </div>
          <button type="button" class="boton boton-secundario" id="asist-cerrar" style="width:auto">Cerrar</button>
        </div>
        <div class="tarjeta" style="padding:0;overflow:auto;max-height:55vh">
          <table class="tabla">
            <thead><tr><th>Alumno</th>${estados.map((e) => `<th style="text-align:center;text-transform:capitalize">${e}</th>`).join('')}</tr></thead>
            <tbody>${alumnos.map((a) => `
              <tr>
                <td>${escapar(a.nombre)}</td>
                ${estados.map((e) => `<td style="text-align:center">
                  <input type="radio" name="al-${a.alumno_id}" value="${e}"
                    ${a.estado === e || (!a.estado && e === 'presente') ? 'checked' : ''}
                    ${editable ? '' : 'disabled'}>
                </td>`).join('')}
              </tr>`).join('')}</tbody>
          </table>
        </div>
        ${editable ? '<button class="boton" id="asist-guardar" style="width:auto;margin-top:1rem">Guardar asistencia</button>' : ''}
      </div>`;

    $('asist-cerrar').onclick = () => dlg.close();

    const guardar = $('asist-guardar');
    if (guardar) {
      guardar.onclick = async () => {
        const registros = alumnos.map((a) => ({
          alumnoId: a.alumno_id,
          estado: dlg.querySelector(`input[name="al-${a.alumno_id}"]:checked`)?.value ?? 'presente',
        }));
        try {
          const r = await api(`/api/clases/${claseId}/asistencia`, { method: 'PUT', body: { fecha, registros } });
          avisar(r.mensaje || 'Asistencia guardada.', r.enRiesgo?.length ? 'info' : 'exito',
            r.enRiesgo?.filter((a) => a.enRiesgo).map((a) => `${a.nombre}: ${a.porcentajeInasistencia}% de inasistencia`) ?? []);
          dlg.close();
          cargarAsistencia(); // refrescar la cuadrícula para marcar la fecha
        } catch (e) {
          avisar(e.message);
        }
      };
    }
  } catch (e) {
    dlg.innerHTML = `<div class="cuerpo"><p style="color:var(--color-error)">${escapar(e.message)}</p><button type="button" class="boton boton-secundario" onclick="this.closest('dialog').close()">Cerrar</button></div>`;
  }
}


// ---------- MATERIAL ----------
async function cargarMaterial() {
  const panel = $('panel-material');
  panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Cargando…</p></div>';
  try {
    const { material } = await api(`/api/clases/${claseId}/material`);
    const kb = (b) => b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

    panel.innerHTML = `
      ${puedeEditar() ? '<button class="boton" id="m-subir" style="width:auto;margin-bottom:1rem">Subir material</button>' : ''}
      <div class="tarjeta" style="padding:0;overflow:auto">
        <table class="tabla">
          <thead><tr><th>Título</th><th>Archivo</th><th>Tamaño</th><th>Subido</th><th></th></tr></thead>
          <tbody>${material.length ? material.map((m) => `
            <tr>
              <td><b>${escapar(m.titulo)}</b>${m.descripcion ? `<br><span style="color:var(--color-text-muted);font-size:var(--texto-xs)">${escapar(m.descripcion)}</span>` : ''}</td>
              <td>${escapar(m.nombre_original)}</td>
              <td>${kb(m.tamano_bytes)}</td>
              <td style="font-size:var(--texto-xs);color:var(--color-text-muted)">${escapar(m.subido_por ?? '—')}</td>
              <td class="acciones">
                <a class="boton-mini" href="/api/material/${m.id}/descargar">Descargar</a>
                ${esResumible(m.nombre_original) ? `<button class="boton-mini boton-ia" data-resumir="${m.id}" data-titulo="${escapar(m.titulo)}">✨ Resumen con IA</button>` : ''}
                ${puedeEditar() ? `<button class="boton-mini" data-borrar-mat="${m.id}">Borrar</button>` : ''}
              </td>
            </tr>`).join('') : '<tr><td colspan="5" style="padding:1.5rem;color:var(--color-text-muted)">Sin material publicado.</td></tr>'}</tbody>
        </table>
      </div>`;

    $('m-subir')?.addEventListener('click', subirMaterial);
    panel.querySelectorAll('[data-resumir]').forEach((b) =>
      b.addEventListener('click', () => generarResumenIA(b.dataset.resumir, b.dataset.titulo)));
    panel.querySelectorAll('[data-borrar-mat]').forEach((b) =>
      b.addEventListener('click', async () => {
        await api(`/api/material/${b.dataset.borrarMat}`, { method: 'DELETE' });
        cargarMaterial();
      }));
  } catch (e) {
    panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`;
  }
}

// ---------- RESUMEN CON IA (Ollama) ----------

// Solo se puede resumir lo que tiene texto extraíble: PDF, Word y texto.
function esResumible(nombre) {
  const ext = (nombre.split('.').pop() ?? '').toLowerCase();
  return ['pdf', 'docx', 'txt', 'md', 'csv'].includes(ext);
}

// Guarda el último resumen generado para poder descargarlo en PDF.
let ultimoResumen = null;

async function generarResumenIA(materialId, titulo) {
  mostrarCargandoIA();
  try {
    const r = await api(`/api/material/${materialId}/resumen`, { method: 'POST', body: {} });
    ultimoResumen = { materialId, titulo: r.titulo ?? titulo, resumen: r.resumen };
    mostrarResumenIA(r.titulo ?? titulo, r.resumen, r.recortado);
  } catch (e) {
    cerrarDlgIA();
    avisar(e.message || 'No se pudo generar el resumen.');
  }
}

// Ventana flotante con la animación futurista mientras se genera.
function mostrarCargandoIA() {
  let dlg = $('dlg-ia');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-ia';
    dlg.className = 'dialogo dlg-ia';
    document.body.appendChild(dlg);
  }
  dlg.innerHTML = `
    <div class="ia-cargando">
      <div class="ia-orbe">
        <div class="ia-anillo"></div>
        <div class="ia-anillo"></div>
        <div class="ia-anillo"></div>
        <div class="ia-nucleo">✨</div>
      </div>
      <div class="ia-texto">Generando resumen</div>
      <div class="ia-subtexto">cargando<span class="ia-puntos"></span></div>
      <div class="ia-barra"><div class="ia-barra-fill"></div></div>
    </div>`;
  if (!dlg.open) dlg.showModal();
}

function cerrarDlgIA() {
  const dlg = $('dlg-ia');
  if (dlg?.open) dlg.close();
}

// Ventana flotante con el resumen ya generado + botón de descargar PDF.
function mostrarResumenIA(titulo, resumen, recortado) {
  let dlg = $('dlg-ia');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-ia';
    dlg.className = 'dialogo dlg-ia';
    document.body.appendChild(dlg);
  }
  dlg.innerHTML = `
    <div class="cuerpo ia-resultado">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:1rem;margin-bottom:1rem">
        <div>
          <div class="ia-etiqueta">✨ Resumen generado con IA</div>
          <h2 style="margin:.25rem 0 0;color:var(--color-primary)">${escapar(titulo)}</h2>
        </div>
        <button type="button" class="boton boton-secundario" id="ia-cerrar" style="width:auto">Cerrar</button>
      </div>
      ${recortado ? '<p class="ia-aviso">El material era extenso; se resumió su primera parte.</p>' : ''}
      <div class="ia-scroll">${escapar(resumen).replace(/\n/g, '<br>')}</div>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
        <button class="boton" id="ia-pdf" style="width:auto">Descargar PDF</button>
      </div>
    </div>`;
  if (!dlg.open) dlg.showModal();

  $('ia-cerrar').onclick = () => dlg.close();
  $('ia-pdf').onclick = () => descargarResumenPDF();
}

// Descarga el resumen actual como PDF (lo genera el backend con pdfkit).
async function descargarResumenPDF() {
  if (!ultimoResumen) return;
  const btn = $('ia-pdf');
  if (btn) { btn.disabled = true; btn.textContent = 'Generando PDF…'; }
  try {
    const resp = await fetch(`/api/material/${ultimoResumen.materialId}/resumen/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo: ultimoResumen.titulo, resumen: ultimoResumen.resumen }),
    });
    if (!resp.ok) throw new Error('No se pudo generar el PDF.');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resumen-${ultimoResumen.titulo.replace(/[^\w.\-]/g, '_')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    avisar(e.message || 'No se pudo descargar el PDF.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Descargar PDF'; }
  }
}

function subirMaterial() {
  const dlg = $('dlg');
  dlg.innerHTML = `
    <div class="cuerpo">
      <h2>Subir material</h2>
      <div id="dlg-aviso" class="aviso aviso-error" hidden></div>
      <div class="campo"><label>Título</label><input id="m-titulo" class="control"></div>
      <div class="campo"><label>Descripción (opcional)</label><input id="m-desc" class="control"></div>
      <div class="campo"><label>Archivo</label><input id="m-archivo" class="control" type="file" accept=".pdf,.docx,.pptx,.xlsx,.jpg,.jpeg,.png"></div>
      <p style="color:var(--color-text-muted);font-size:var(--texto-xs)">Formatos: PDF, Word, PowerPoint, Excel, imágenes. Máx 25 MB.</p>
      <div style="display:flex;gap:.75rem;margin-top:1rem">
        <button class="boton" id="m-ok">Subir</button>
        <button class="boton boton-secundario" id="m-cerrar">Cancelar</button>
      </div>
    </div>`;
  dlg.showModal();
  $('m-cerrar').onclick = () => dlg.close();
  $('m-ok').onclick = async () => {
    const archivo = $('m-archivo').files[0];
    const titulo = $('m-titulo').value.trim();
    if (!archivo || !titulo) { mostrarErr('Falta el título o el archivo.'); return; }

    const fd = new FormData();
    fd.append('titulo', titulo);
    if ($('m-desc').value.trim()) fd.append('descripcion', $('m-desc').value.trim());
    fd.append('archivo', archivo);

    try {
      const r = await fetch(`/api/clases/${claseId}/material`, { method: 'POST', credentials: 'same-origin', body: fd });
      const datos = await r.json().catch(() => ({}));
      if (r.status === 401) { const ref = await fetch('/api/auth/refrescar', { method: 'POST', credentials: 'same-origin' }); if (ref.ok) return $('m-ok').click(); window.location.href = '/'; return; }
      if (!r.ok) { mostrarErr(datos.mensaje || 'No se pudo subir.', datos.detalles); return; }
      dlg.close();
      avisar('Material subido.', 'exito');
      cargarMaterial();
    } catch { mostrarErr('No se pudo conectar.'); }
  };
  function mostrarErr(texto, detalles = []) {
    const a = $('dlg-aviso');
    a.innerHTML = escapar(texto) + (detalles?.length ? `<ul>${detalles.map((d) => `<li>${escapar(d)}</li>`).join('')}</ul>` : '');
    a.hidden = false;
  }
}

// ---------- COMPORTAMIENTO ----------
let catalogoComp = null;

async function cargarComportamiento() {
  const panel = $('panel-comportamiento');
  panel.innerHTML = '<p style="color:var(--color-text-muted)">Cargando…</p>';

  try {
    // Alumnos de la clase (del cuadro) y catálogo de tipos, en paralelo.
    const [cuadro, cat] = await Promise.all([
      api(`/api/clases/${claseId}/cuadro?periodoId=${periodoId}`),
      catalogoComp ? Promise.resolve({ catalogo: catalogoComp }) : api('/api/comportamiento/catalogo'),
    ]);
    catalogoComp = cat.catalogo;
    const alumnos = cuadro.alumnos || [];

    if (!alumnos.length) {
      panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Sin alumnos inscritos en esta clase.</p></div>';
      return;
    }

    const opcionesAlumnos = alumnos.map((a) => `<option value="${a.alumnoId}">${escapar(a.nombre)}</option>`).join('');
    const opcMeritos = catalogoComp.meritos.map((t) => `<option value="m-${t.id}">＋ ${escapar(t.nombre)} (+${t.puntos})</option>`).join('');
    const opcDemeritos = catalogoComp.demeritos.map((t) => `<option value="d-${t.id}">－ ${escapar(t.nombre)} (${t.puntos})</option>`).join('');

    panel.innerHTML = `
      <div class="tarjeta" style="margin-bottom:1rem">
        <h3 style="margin:0 0 1rem;font-size:var(--texto-base)">Registrar comportamiento</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem 1rem">
          <div class="campo" style="margin:0">
            <label>Alumno</label>
            <select id="cmp-alumno" class="control">${opcionesAlumnos}</select>
          </div>
          <div class="campo" style="margin:0">
            <label>Tipo</label>
            <select id="cmp-tipo" class="control">
              <optgroup label="Méritos (buena conducta)">${opcMeritos}</optgroup>
              <optgroup label="Deméritos (faltas)">${opcDemeritos}</optgroup>
            </select>
          </div>
          <div class="campo" style="margin:0;grid-column:1/-1">
            <label>Detalle / observación</label>
            <input id="cmp-desc" class="control" placeholder="Describe brevemente lo ocurrido…" maxlength="2000">
          </div>
          <div class="campo" style="margin:0;grid-column:1/-1" id="cmp-medida-wrap" hidden>
            <label>Medida disciplinaria (opcional)</label>
            <input id="cmp-medida" class="control" placeholder="Ej: llamado de atención, citación a encargado…" maxlength="255">
          </div>
        </div>
        <button class="boton" id="cmp-guardar" style="width:auto;margin-top:1rem">Registrar</button>
        <div id="cmp-aviso" class="aviso" hidden style="margin-top:1rem"></div>
      </div>
      <div id="cmp-historial"></div>`;

    // Mostrar campo de medida solo para deméritos.
    const selTipo = $('cmp-tipo');
    const toggleMedida = () => { $('cmp-medida-wrap').hidden = !selTipo.value.startsWith('d-'); };
    selTipo.onchange = toggleMedida; toggleMedida();

    $('cmp-guardar').onclick = () => registrarComportamiento();

    await cargarHistorialClase(alumnos);
  } catch (e) {
    panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`;
  }
}

async function registrarComportamiento() {
  const alumnoId = Number($('cmp-alumno').value);
  const val = $('cmp-tipo').value;              // 'm-3' o 'd-7'
  const descripcion = $('cmp-desc').value.trim();
  const aviso = $('cmp-aviso');
  if (!descripcion) { aviso.hidden = false; aviso.className = 'aviso aviso-error'; aviso.textContent = 'Escribe un detalle.'; return; }

  const [tipoClase, tipoId] = [val[0], Number(val.slice(2))];
  try {
    if (tipoClase === 'm') {
      await api('/api/comportamiento/meritos', { method: 'POST', body: { alumnoId, claseId, tipoId, descripcion } });
    } else {
      // Demérito = incidencia. Se toma la gravedad del catálogo.
      const tipo = catalogoComp.demeritos.find((t) => t.id === tipoId);
      await api('/api/incidencias', { method: 'POST', body: {
        alumnoId, claseId, gravedad: tipo?.gravedad || 'leve',
        descripcion, medidaDisciplinaria: $('cmp-medida').value.trim() || null,
      } });
    }
    aviso.hidden = false; aviso.className = 'aviso aviso-exito'; aviso.textContent = 'Comportamiento registrado.';
    $('cmp-desc').value = ''; if ($('cmp-medida')) $('cmp-medida').value = '';
    const cuadro = await api(`/api/clases/${claseId}/cuadro?periodoId=${periodoId}`);
    await cargarHistorialClase(cuadro.alumnos || []);
  } catch (e) {
    aviso.hidden = false; aviso.className = 'aviso aviso-error'; aviso.textContent = e.message;
  }
}

/** Muestra el historial de comportamiento de todos los alumnos de la clase. */
async function cargarHistorialClase(alumnos) {
  const cont = $('cmp-historial');
  if (!cont) return;
  cont.innerHTML = '<p style="color:var(--color-text-muted)">Cargando historial…</p>';

  // Trae el comportamiento de cada alumno (el backend filtra por permisos).
  const resultados = await Promise.all(alumnos.map((a) =>
    api(`/api/comportamiento/alumno/${a.alumnoId}`).then((r) => ({ alumno: a, ...r })).catch(() => null)
  ));

  const conRegistros = resultados.filter((r) => r && r.total > 0);
  if (!conRegistros.length) {
    cont.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Aún no hay registros de comportamiento en esta clase.</p></div>';
    return;
  }

  cont.innerHTML = conRegistros.map(({ alumno, registros, puntaje, meritos, demeritos }) => {
    const color = puntaje >= 85 ? 'var(--color-exito)' : puntaje >= 60 ? 'var(--color-advertencia)' : 'var(--color-error)';
    const filas = registros.slice(0, 6).map((r) => {
      const merito = r.clase === 'merito';
      return `<div class="ficha-conducta ${merito ? 'merito' : 'demerito'}">
        <div class="conducta-signo">${merito ? '+' : ''}${r.puntos}</div>
        <div class="conducta-cuerpo"><b>${escapar(r.descripcion)}</b>
        <span>${new Date(r.fecha_hora).toLocaleDateString('es-HN')}${r.registrado_por ? ` · ${escapar(r.registrado_por)}` : ''}</span></div>
      </div>`;
    }).join('');
    return `<div class="tarjeta" style="margin-bottom:1rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
        <b>${escapar(alumno.nombre)}</b>
        <span style="font-weight:800;color:${color}">${puntaje} pts <span style="font-weight:400;color:var(--color-text-muted);font-size:var(--texto-xs)">· ${meritos}✓ ${demeritos}✗</span></span>
      </div>${filas}</div>`;
  }).join('');
}

function cambiarTab(tab) {
  tabActiva = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('activa', b.dataset.tab === tab));
  $('panel-notas').hidden = tab !== 'notas';
  $('panel-asistencia').hidden = tab !== 'asistencia';
  $('panel-comportamiento').hidden = tab !== 'comportamiento';
  $('panel-material').hidden = tab !== 'material';

  // El alumno ve su vista personal (solo lo suyo) en cada pestaña.
  if (usuario.rol === 'ALUMNO') {
    if (tab === 'notas') cargarMisNotas();
    else if (tab === 'asistencia') cargarMiAsistencia();
    else if (tab === 'comportamiento') cargarMiComportamiento();
    else cargarMaterial();
    return;
  }

  if (tab === 'notas') cargarNotas();
  else if (tab === 'asistencia') cargarAsistencia();
  else if (tab === 'comportamiento') cargarComportamiento();
  else cargarMaterial();
}

// ---------- Vista personal del ALUMNO ----------
// El alumno no puede ver el cuadro de toda la clase; solo lo suyo. Estas
// funciones usan los endpoints que ya filtran por alumno (puedeVerAlumno).

async function cargarMisNotas() {
  const panel = $('panel-notas');
  panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Cargando…</p></div>';
  try {
    const aid = await miAlumnoId();
    const r = await api(`/api/alumnos/${aid}/notas?periodoId=${periodoId}`);
    // La respuesta trae una fila por clase; nos quedamos con la de ESTA clase.
    const fila = (r.notas || []).find((n) => n.clase_id === claseId);
    const boleta = `<a class="boton-mini" href="/api/alumnos/${aid}/boleta?periodoId=${periodoId}" target="_blank">Descargar mi boleta</a>`;

    if (!fila || fila.nota_final === null || fila.nota_final === undefined) {
      panel.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:.75rem">${boleta}</div>
        <div class="tarjeta"><p style="color:var(--color-text-muted)">Aún no tienes una nota registrada en esta clase para el periodo seleccionado.</p></div>`;
      return;
    }

    // Aprobado se decide por la nota (>= 70), no por el campo que puede venir
    // sin consolidar.
    const aprobado = Number(fila.nota_final) >= 70;
    const color = aprobado ? 'var(--color-aprobado)' : 'var(--color-reprobado)';
    panel.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:.75rem">${boleta}</div>
      <div class="tarjeta" style="text-align:center">
        <div style="font-size:var(--texto-xs);text-transform:uppercase;color:var(--color-text-muted)">Mi nota en ${escapar(fila.asignatura || 'esta clase')}</div>
        <div style="font-size:var(--texto-3xl);font-weight:700;color:${color}">${fila.nota_final}</div>
        <span class="insignia-estado ${aprobado ? 'estado-activo' : ''}" style="color:${color}">${aprobado ? 'Aprobado' : 'Reprobado'}</span>
        ${fila.bloqueada ? '<div style="font-size:var(--texto-sm);color:var(--color-text-muted);margin-top:.5rem">🔒 Nota cerrada</div>' : ''}
      </div>`;
  } catch (e) {
    panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`;
  }
}

async function cargarMiAsistencia() {
  const panel = $('panel-asistencia');
  panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Cargando…</p></div>';
  try {
    const aid = await miAlumnoId();
    const r = await api(`/api/alumnos/${aid}/asistencia`);
    const resumen = r.resumen || [];
    // Buscar el resumen de ESTA clase.
    const c = resumen.find((x) => x.claseId === claseId);
    if (!c || c.total === 0) {
      panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Aún no hay asistencia registrada en esta clase.</p></div>';
      return;
    }
    const colorPct = c.enRiesgo ? 'var(--color-reprobado)' : 'var(--color-aprobado)';
    const dato = (t, v, color) => `
      <div class="tarjeta" style="text-align:center">
        <div style="font-size:var(--texto-xs);text-transform:uppercase;color:var(--color-text-muted)">${t}</div>
        <div style="font-size:var(--texto-2xl);font-weight:700;color:${color || 'var(--color-text)'}">${v}</div>
      </div>`;
    panel.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.75rem;margin-bottom:1rem">
        ${dato('Presente', c.presentes, 'var(--color-aprobado)')}
        ${dato('Ausente', c.ausencias, 'var(--color-reprobado)')}
        ${dato('Tarde', c.tardanzas, 'var(--color-advertencia)')}
        ${dato('Justificado', c.justificadas)}
      </div>
      <div class="tarjeta" style="text-align:center">
        <div style="font-size:var(--texto-xs);text-transform:uppercase;color:var(--color-text-muted)">Mi inasistencia</div>
        <div style="font-size:var(--texto-2xl);font-weight:700;color:${colorPct}">${c.porcentajeInasistencia}%</div>
        ${c.enRiesgo ? '<span class="insignia-estado" style="color:var(--color-reprobado)">En riesgo por inasistencia</span>' : '<span class="insignia-estado estado-activo">Al día</span>'}
      </div>`;
  } catch (e) {
    panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`;
  }
}

async function cargarMiComportamiento() {
  const panel = $('panel-comportamiento');
  panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Cargando…</p></div>';
  try {
    const aid = await miAlumnoId();
    const r = await api(`/api/comportamiento/alumno/${aid}`);
    const puntaje = r.puntaje ?? 100;
    const color = puntaje >= 80 ? 'var(--color-aprobado)' : puntaje >= 60 ? 'var(--color-advertencia)' : 'var(--color-reprobado)';
    const registros = r.registros || [];
    const lista = registros.length
      ? registros.map((x) => {
          const esMerito = x.clase === 'merito';
          return `<div class="tarjeta" style="border-left:3px solid ${esMerito ? 'var(--color-aprobado)' : 'var(--color-reprobado)'};margin-bottom:.5rem">
            <b>${esMerito ? '+' : ''}${x.puntos} · ${escapar(x.descripcion || '')}</b>
            <div style="font-size:var(--texto-sm);color:var(--color-text-muted)">${x.fecha_hora ? new Date(x.fecha_hora).toLocaleDateString('es-HN') : ''}</div>
          </div>`;
        }).join('')
      : '<div class="tarjeta"><p style="color:var(--color-text-muted)">Sin registros de comportamiento.</p></div>';
    panel.innerHTML = `
      <div class="tarjeta" style="margin-bottom:1rem;text-align:center">
        <div style="font-size:var(--texto-xs);text-transform:uppercase;color:var(--color-text-muted)">Mi puntaje de conducta</div>
        <div style="font-size:var(--texto-3xl);font-weight:700;color:${color}">${puntaje}</div>
        <div style="font-size:var(--texto-sm);color:var(--color-text-muted)">${r.meritos ?? 0} méritos · ${r.demeritos ?? 0} deméritos</div>
      </div>
      ${lista}`;
  } catch (e) {
    panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`;
  }
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
