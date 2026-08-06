import { api, iniciarPantalla, escapar, avisar, limpiarAviso } from './comun.js';

const $ = (id) => document.getElementById(id);
let usuario, catalogos, pagina = 1;

const puedeGestionar = () => ['ADMIN', 'ASESOR'].includes(usuario.rol);

async function cargarCatalogos() {
  const ctx = await api('/api/contexto');
  catalogos = ctx.catalogos;
  $('f-seccion').innerHTML = '<option value="">Todas</option>' +
    catalogos.secciones.map((s) =>
      `<option value="${s.id}">${escapar(`${s.grado}º ${s.letra} — ${s.grado_nombre}`)} (${s.matriculados}/${s.cupo_maximo})</option>`
    ).join('');
}

async function cargarLista() {
  const cuerpo = $('tabla').querySelector('tbody');
  cuerpo.innerHTML = '<tr><td colspan="5" style="padding:1.5rem;color:var(--color-text-muted)">Cargando…</td></tr>';

  const params = new URLSearchParams({ pagina, porPagina: 30 });
  if ($('q').value.trim()) params.set('busqueda', $('q').value.trim());
  if ($('f-seccion').value) params.set('seccionId', $('f-seccion').value);

  try {
    const r = await api(`/api/alumnos?${params}`);

    if (!r.datos.length) {
      cuerpo.innerHTML = '<tr><td colspan="5" style="padding:1.5rem;color:var(--color-text-muted)">Sin resultados.</td></tr>';
      $('paginacion').textContent = '';
      return;
    }

    cuerpo.innerHTML = r.datos.map((a) => `
      <tr>
        <td><code>${escapar(a.codigo)}</code></td>
        <td>${escapar(a.nombreCompleto)}</td>
        <td>${a.matricula ? escapar(`${a.matricula.grado} "${a.matricula.seccion.split(' ')[1] ?? ''}"`) : '<span style="color:var(--color-text-muted)">sin matrícula</span>'}</td>
        <td><span class="insignia-estado estado-${escapar(a.estado)}">${escapar(a.estado)}</span></td>
        <td class="acciones">
          <button class="boton-mini" data-ver="${a.id}">Ver</button>
          ${puedeGestionar() && !a.matricula ? `<button class="boton-mini" data-matricular="${a.id}">Matricular</button>` : ''}
          ${puedeGestionar() && a.matricula ? `<button class="boton-mini" data-trasladar="${a.matricula.id}">Trasladar</button>` : ''}
        </td>
      </tr>`).join('');

    const desde = (r.pagina - 1) * r.porPagina + 1;
    $('paginacion').textContent = `Mostrando ${desde}–${Math.min(desde + r.datos.length - 1, r.total)} de ${r.total}`;
  } catch (e) {
    cuerpo.innerHTML = `<tr><td colspan="5" style="padding:1.5rem;color:var(--color-error)">${escapar(e.message)}</td></tr>`;
  }
}

function abrirDialogo(titulo, html, alAceptar, textoBoton = 'Guardar') {
  const dlg = $('dlg');
  dlg.innerHTML = `
    <form method="dialog" class="cuerpo">
      <h2>${escapar(titulo)}</h2>
      <div id="dlg-aviso" class="aviso aviso-error" hidden></div>
      <div id="dlg-cuerpo">${html}</div>
      <div style="display:flex;gap:.75rem;margin-top:1.5rem">
        <button type="button" class="boton" id="dlg-ok">${escapar(textoBoton)}</button>
        <button type="button" class="boton boton-secundario" id="dlg-cancelar">Cerrar</button>
      </div>
    </form>`;
  dlg.showModal();
  $('dlg-cancelar').onclick = () => dlg.close();
  if (alAceptar) $('dlg-ok').onclick = () => alAceptar(dlg);
  else $('dlg-ok').hidden = true;
}

const avisoDialogo = (texto, detalles = []) => {
  const a = $('dlg-aviso');
  a.innerHTML = escapar(texto) + (detalles.length ? `<ul>${detalles.map((d) => `<li>${escapar(d)}</li>`).join('')}</ul>` : '');
  a.hidden = false;
};

const campo = (id, etiqueta, tipo = 'text', extra = '') =>
  `<div class="campo"><label for="${id}">${escapar(etiqueta)}</label><input id="${id}" type="${tipo}" ${extra}></div>`;

function formularioNuevo() {
  abrirDialogo('Nuevo alumno', `
    <div class="rejilla-2">
      ${campo('n-pn', 'Primer nombre *')}
      ${campo('n-sn', 'Segundo nombre')}
      ${campo('n-pa', 'Primer apellido *')}
      ${campo('n-sa', 'Segundo apellido')}
      ${campo('n-id', 'Identidad')}
      ${campo('n-nac', 'Fecha de nacimiento', 'date')}
      ${campo('n-tel', 'Teléfono')}
      <div class="campo"><label for="n-sexo">Sexo</label>
        <select id="n-sexo" class="control"><option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option></select></div>
    </div>
    ${campo('n-dir', 'Dirección')}
    <h3 style="font-size:var(--texto-base);margin:1.5rem 0 .5rem">Encargado principal</h3>
    <div class="rejilla-2">
      ${campo('e-pn', 'Nombre *')}
      ${campo('e-pa', 'Apellido *')}
      ${campo('e-tel', 'Teléfono')}
      <div class="campo"><label for="e-par">Parentesco</label>
        <select id="e-par" class="control"><option value="madre">Madre</option><option value="padre">Padre</option><option value="tutor">Tutor</option></select></div>
    </div>`, async (dlg) => {
    const cuerpo = {
      primerNombre: $('n-pn').value.trim(),
      segundoNombre: $('n-sn').value.trim() || null,
      primerApellido: $('n-pa').value.trim(),
      segundoApellido: $('n-sa').value.trim() || null,
      identidad: $('n-id').value.trim() || null,
      fechaNacimiento: $('n-nac').value || null,
      sexo: $('n-sexo').value || null,
      telefono: $('n-tel').value.trim() || null,
      direccion: $('n-dir').value.trim() || null,
      encargados: $('e-pn').value.trim() ? [{
        primerNombre: $('e-pn').value.trim(),
        primerApellido: $('e-pa').value.trim(),
        telefono: $('e-tel').value.trim() || null,
        parentesco: $('e-par').value,
        esPrincipal: true,
      }] : [],
    };

    try {
      const r = await api('/api/alumnos', { method: 'POST', body: cuerpo });
      dlg.close();
      avisar(`Alumno ${r.alumno.codigo} registrado. Ahora puedes matricularlo.`, 'exito');
      cargarLista();
    } catch (e) {
      avisoDialogo(e.message, e.detalles);
    }
  }, 'Registrar');
}

function opcionesSeccion(excluir = null) {
  return catalogos.secciones
    .filter((s) => s.id !== excluir)
    .map((s) => {
      const lleno = s.matriculados >= s.cupo_maximo;
      return `<option value="${s.id}" ${lleno ? 'disabled' : ''}>${escapar(`${s.grado}º ${s.letra}`)} — ${escapar(s.grado_nombre)} (${s.matriculados}/${s.cupo_maximo})${lleno ? ' LLENA' : ''}</option>`;
    }).join('');
}

function formularioMatricula(alumnoId) {
  abrirDialogo('Matricular alumno', `
    <p style="color:var(--color-text-muted);font-size:var(--texto-sm)">
      Al matricular, el alumno queda inscrito automáticamente en todas las clases activas de la sección.
    </p>
    <div class="campo"><label for="m-sec">Sección</label>
      <select id="m-sec" class="control">${opcionesSeccion()}</select></div>`,
  async (dlg) => {
    try {
      const r = await api('/api/matriculas', {
        method: 'POST', body: { alumnoId, seccionId: Number($('m-sec').value) },
      });
      dlg.close();
      avisar(r.mensaje, 'exito');
      await cargarCatalogos();
      cargarLista();
    } catch (e) {
      avisoDialogo(e.message, e.detalles);
    }
  }, 'Matricular');
}

function formularioTraslado(matriculaId) {
  abrirDialogo('Trasladar de sección', `
    <div class="aviso aviso-info">
      Las notas obtenidas en la sección actual quedan en el expediente histórico,
      pero <strong>no se trasladan</strong> a las clases de la sección nueva.
    </div>
    <div class="campo"><label for="t-sec">Sección destino</label>
      <select id="t-sec" class="control">${opcionesSeccion()}</select></div>
    ${campo('t-motivo', 'Motivo')}`,
  async (dlg) => {
    try {
      const r = await api(`/api/matriculas/${matriculaId}/trasladar`, {
        method: 'POST',
        body: { seccionDestinoId: Number($('t-sec').value), motivo: $('t-motivo').value.trim() || undefined },
      });
      dlg.close();
      avisar(r.aviso ?? 'Traslado realizado.', r.aviso ? 'info' : 'exito');
      await cargarCatalogos();
      cargarLista();
    } catch (e) {
      avisoDialogo(e.message, e.detalles);
    }
  }, 'Trasladar');
}

async function verAlumno(id) {
  try {
    const { alumno: a } = await api(`/api/alumnos/${id}`);
    // Traer el resumen de comportamiento en paralelo (no bloquea si falla).
    let comp = null;
    try { comp = await api(`/api/comportamiento/alumno/${id}`); } catch { /* opcional */ }

    // Iniciales para el avatar.
    const iniciales = a.nombreCompleto.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
    const mat = a.matricula ? `${a.matricula.grado} "${a.matricula.seccion.split(' ')[1] ?? ''}"` : 'Sin matrícula';

    // Color del puntaje de comportamiento.
    const pts = comp?.puntaje ?? null;
    const colorPts = pts === null ? 'var(--color-text-muted)'
      : pts >= 85 ? 'var(--color-exito)' : pts >= 60 ? 'var(--color-advertencia)' : 'var(--color-error)';

    const html = `
      <div class="ficha">
        <!-- Encabezado con avatar -->
        <div class="ficha-cabecera">
          <div class="ficha-avatar">${escapar(iniciales)}</div>
          <div class="ficha-titulo">
            <h2 style="margin:0">${escapar(a.nombreCompleto)}</h2>
            <div class="ficha-sub">
              <span class="insignia-estado estado-${escapar(a.estado)}">${escapar(a.estado)}</span>
              <span>${escapar(a.codigo)}</span>
              <span>·</span>
              <span>${escapar(mat)}</span>
            </div>
          </div>
        </div>

        <!-- Tarjetas resumen -->
        <div class="ficha-stats">
          <div class="ficha-mini">
            <span class="ficha-mini-label">Comportamiento</span>
            <span class="ficha-mini-valor" style="color:${colorPts}">${pts === null ? '—' : pts}</span>
            <span class="ficha-mini-nota">${comp ? `${comp.meritos} méritos · ${comp.demeritos} faltas` : 'sin datos'}</span>
          </div>
          <div class="ficha-mini">
            <span class="ficha-mini-label">Encargados</span>
            <span class="ficha-mini-valor">${a.encargados.length}</span>
            <span class="ficha-mini-nota">registrados</span>
          </div>
          <div class="ficha-mini">
            <span class="ficha-mini-label">Historial</span>
            <span class="ficha-mini-valor">${a.historial.length}</span>
            <span class="ficha-mini-nota">matrículas</span>
          </div>
        </div>

        <!-- Pestañas -->
        <div class="ficha-tabs">
          <button class="ficha-tab activa" data-ft="datos">Datos</button>
          <button class="ficha-tab" data-ft="encargados">Encargados</button>
          <button class="ficha-tab" data-ft="historial">Historial</button>
          <button class="ficha-tab" data-ft="comportamiento">Comportamiento</button>
        </div>

        <div class="ficha-panel" data-panel="datos">
          <dl class="ficha-dl">
            ${fichaFila('Código', a.codigo)}
            ${a.identidad !== undefined ? fichaFila('Identidad', a.identidad) : ''}
            ${fichaFila('Nacimiento', a.fechaNacimiento?.slice(0, 10))}
            ${fichaFila('Teléfono', a.telefono)}
            ${fichaFila('Matrícula', mat + (a.matricula ? ` — ${a.matricula.anio}` : ''))}
            ${fichaFila('Estado', a.estado)}
          </dl>
        </div>

        <div class="ficha-panel" data-panel="encargados" hidden>
          ${a.encargados.length
            ? a.encargados.map((e) => `
              <div class="ficha-item">
                <b>${escapar(e.nombre)}</b>
                <span>${escapar(e.parentesco)}${e.telefono ? ` · ${escapar(e.telefono)}` : ''}</span>
              </div>`).join('')
            : '<p class="ficha-vacio">Sin encargados registrados.</p>'}
        </div>

        <div class="ficha-panel" data-panel="historial" hidden>
          ${a.historial.length
            ? `<table class="tabla"><thead><tr><th>Año</th><th>Grado</th><th>Estado</th></tr></thead><tbody>${a.historial.map((h) =>
              `<tr><td>${h.anio}</td><td>${escapar(h.grado_nombre)} "${escapar(h.letra)}"</td><td>${escapar(h.estado)}</td></tr>`).join('')}</tbody></table>`
            : '<p class="ficha-vacio">Sin matrículas previas.</p>'}
        </div>

        <div class="ficha-panel" data-panel="comportamiento" hidden>
          ${comp && comp.registros.length
            ? comp.registros.map((r) => {
                const esMerito = r.clase === 'merito';
                return `<div class="ficha-conducta ${esMerito ? 'merito' : 'demerito'}">
                  <div class="conducta-signo">${esMerito ? '+' : ''}${r.puntos}</div>
                  <div class="conducta-cuerpo">
                    <b>${escapar(r.descripcion)}</b>
                    <span>${new Date(r.fecha_hora).toLocaleDateString('es-HN')}${r.clase_nombre ? ` · ${escapar(r.clase_nombre)}` : ''}${r.registrado_por ? ` · ${escapar(r.registrado_por)}` : ''}</span>
                  </div>
                </div>`;
              }).join('')
            : '<p class="ficha-vacio">Sin registros de comportamiento.</p>'}
        </div>
      </div>`;

    abrirDialogo('', html, null);

    // Navegación de pestañas dentro de la ficha.
    document.querySelectorAll('.ficha-tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('.ficha-tab').forEach((x) => x.classList.toggle('activa', x === t));
      document.querySelectorAll('.ficha-panel').forEach((p) => { p.hidden = p.dataset.panel !== t.dataset.ft; });
    }));
  } catch (e) {
    avisar(e.message);
  }
}

const fichaFila = (k, v) => `<dt>${escapar(k)}</dt><dd>${escapar(v ?? '—')}</dd>`;

(async () => {
  usuario = await iniciarPantalla('Alumnos');
  await cargarCatalogos();
  if (puedeGestionar()) $('btn-nuevo').hidden = false;

  $('btn-nuevo').onclick = formularioNuevo;
  $('btn-buscar').onclick = () => { pagina = 1; limpiarAviso(); cargarLista(); };
  $('q').onkeydown = (e) => { if (e.key === 'Enter') { pagina = 1; cargarLista(); } };
  $('f-seccion').onchange = () => { pagina = 1; cargarLista(); };

  $('tabla').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.ver) verAlumno(Number(b.dataset.ver));
    if (b.dataset.matricular) formularioMatricula(Number(b.dataset.matricular));
    if (b.dataset.trasladar) formularioTraslado(Number(b.dataset.trasladar));
  };

  await cargarLista();
})();
