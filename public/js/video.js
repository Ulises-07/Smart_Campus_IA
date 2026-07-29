import { api, iniciarPantalla, escapar, avisar } from './comun.js';

const $ = (id) => document.getElementById(id);
let tabActiva = 'camaras';

// ---------- Resumen de gobernanza ----------
async function cargarResumen() {
  try {
    const r = await api('/api/video/resumen');
    const t = (titulo, valor, nota, color = 'var(--color-primary)') => `
      <div class="tarjeta">
        <div style="font-size:var(--texto-xs);text-transform:uppercase;color:var(--color-text-muted)">${titulo}</div>
        <div style="font-size:var(--texto-2xl);font-weight:700;color:${color};margin:.2rem 0">${valor}</div>
        <div style="font-size:var(--texto-sm);color:var(--color-text-muted)">${nota}</div>
      </div>`;
    $('resumen').innerHTML =
      t('Cámaras', r.camaras.total, `${r.camaras.activas} activas`) +
      t('Consentimiento otorgado', r.consentimiento.otorgado, `${r.consentimiento.denegado} denegados · ${r.consentimiento.pendiente} pendientes`, 'var(--color-aprobado)') +
      t('Grabaciones vigentes', r.grabaciones.vigentes, `${r.grabaciones.evidencias} marcadas como evidencia`) +
      t('Por purgar', r.grabaciones.porPurgar, 'vencidas, pendientes de purga', r.grabaciones.porPurgar > 0 ? 'var(--color-advertencia)' : 'var(--color-aprobado)');
  } catch (e) { $('resumen').innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`; }
}

// ---------- Cámaras ----------
async function tabCamaras() {
  const panel = $('panel');
  panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Cargando…</p></div>';
  try {
    const { camaras } = await api('/api/video/camaras');
    panel.innerHTML = `
      <div style="margin-bottom:1rem"><button class="boton" id="nueva-camara" style="width:auto">Registrar cámara</button></div>
      <div class="tarjeta" style="background:var(--color-primary-light);border-left:3px solid var(--color-primary);margin-bottom:1rem">
        <p style="margin:0;font-size:var(--texto-sm)">
          <b>Zonas prohibidas:</b> el sistema rechaza registrar cámaras en baños, vestidores o enfermería.
          Es una regla, no una recomendación: se bloquea en el código y en la base de datos.
        </p>
      </div>
      ${camaras.length ? `
      <div class="tarjeta" style="padding:0;overflow:auto">
        <table class="tabla">
          <thead><tr><th>Código</th><th>Nombre / Zona</th><th>Tipo</th><th>Retención</th><th style="text-align:center">Estado</th><th></th></tr></thead>
          <tbody>${camaras.map((c) => `
            <tr>
              <td>${escapar(c.codigo)}</td>
              <td>${escapar(c.nombre)}<br><span style="color:var(--color-text-muted);font-size:var(--texto-xs)">${escapar(c.zona ?? '')}</span></td>
              <td>${escapar(c.tipo_zona)}</td>
              <td>${c.retencion_dias} días</td>
              <td style="text-align:center"><span class="insignia-estado ${c.activa ? 'estado-activo' : 'estado-inactivo'}">${c.activa ? 'activa' : 'inactiva'}</span></td>
              <td class="acciones"><button class="boton-mini" data-toggle="${c.id}" data-activa="${c.activa}">${c.activa ? 'Desactivar' : 'Activar'}</button></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>` : '<div class="tarjeta"><p style="color:var(--color-text-muted)">No hay cámaras registradas.</p></div>'}`;

    $('nueva-camara').onclick = dialogoNuevaCamara;
    panel.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/video/camaras/${b.dataset.toggle}`, { method: 'PATCH', body: { activa: b.dataset.activa !== 'true' } });
        tabCamaras(); cargarResumen();
      } catch (e) { avisar(e.message); }
    }));
  } catch (e) { panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`; }
}

function dialogoNuevaCamara() {
  const dlg = $('dlg');
  dlg.innerHTML = `
    <div class="cuerpo">
      <h2>Registrar cámara</h2>
      <div id="dlg-aviso" class="aviso aviso-error" hidden></div>
      <div class="campo"><label>Código</label><input id="c-codigo" class="control" placeholder="CAM-01"></div>
      <div class="campo"><label>Nombre</label><input id="c-nombre" class="control" placeholder="Pasillo principal"></div>
      <div class="campo"><label>Zona / ubicación</label><input id="c-zona" class="control" placeholder="Edificio A, planta baja"></div>
      <div class="rejilla-2">
        <div class="campo"><label>Tipo de zona</label>
          <select id="c-tipo" class="control">
            <option value="acceso">Acceso / entrada</option>
            <option value="pasillo">Pasillo</option>
            <option value="patio">Patio / áreas comunes</option>
            <option value="perimetro">Perímetro exterior</option>
            <option value="administrativa">Zona administrativa</option>
          </select></div>
        <div class="campo"><label>Retención (días)</label><input id="c-ret" class="control" type="number" min="1" max="180" value="30"></div>
      </div>
      <p style="font-size:var(--texto-xs);color:var(--color-text-muted)">Las zonas privadas (baño, vestidor, enfermería) no están en la lista y serán rechazadas si se intentan por nombre.</p>
      <div style="display:flex;gap:.75rem;margin-top:1rem">
        <button class="boton" id="c-ok">Registrar</button>
        <button class="boton boton-secundario" id="c-cancelar">Cancelar</button>
      </div>
    </div>`;
  dlg.showModal();
  $('c-cancelar').onclick = () => dlg.close();
  $('c-ok').onclick = async () => {
    try {
      await api('/api/video/camaras', { method: 'POST', body: {
        codigo: $('c-codigo').value.trim(), nombre: $('c-nombre').value.trim(),
        zona: $('c-zona').value.trim(), tipoZona: $('c-tipo').value, retencionDias: Number($('c-ret').value),
      } });
      dlg.close(); avisar('Cámara registrada.', 'exito'); tabCamaras(); cargarResumen();
    } catch (e) {
      const a = $('dlg-aviso');
      a.innerHTML = escapar(e.message) + (e.detalles?.length ? `<ul>${e.detalles.map((x) => `<li>${escapar(x)}</li>`).join('')}</ul>` : '');
      a.hidden = false;
    }
  };
}

// ---------- Consentimientos ----------
async function tabConsentimientos() {
  const panel = $('panel');
  panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Cargando…</p></div>';
  try {
    const r = await api('/api/video/consentimientos?porPagina=50');
    panel.innerHTML = `
      <div class="tarjeta" style="background:var(--color-primary-light);border-left:3px solid var(--color-primary);margin-bottom:1rem">
        <p style="margin:0;font-size:var(--texto-sm)">
          El consentimiento es <b>revocable</b>: una familia puede cambiar de <i>otorgado</i> a <i>denegado</i> cuando quiera.
          Cuando el acceso a una grabación se dirige a un alumno concreto, el sistema exige su consentimiento; si está denegado, <b>bloquea el acceso</b> y lo audita.
        </p>
      </div>
      <div class="tarjeta" style="padding:0;overflow:auto">
        <table class="tabla">
          <thead><tr><th>Alumno</th><th>Código</th><th style="text-align:center">Estado</th><th>Referencia</th><th></th></tr></thead>
          <tbody>${r.consentimientos.map((c) => `
            <tr>
              <td>${escapar(c.alumno)}</td>
              <td>${escapar(c.codigo)}</td>
              <td style="text-align:center">${insigniaConsent(c.estado)}</td>
              <td style="font-size:var(--texto-xs);color:var(--color-text-muted)">${escapar(c.documento_referencia ?? '—')}</td>
              <td class="acciones"><button class="boton-mini" data-alumno="${c.alumno_id}" data-nombre="${escapar(c.alumno)}" data-estado="${c.estado}">Cambiar</button></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
    panel.querySelectorAll('[data-alumno]').forEach((b) => b.addEventListener('click', () =>
      dialogoConsentimiento(Number(b.dataset.alumno), b.dataset.nombre, b.dataset.estado)));
  } catch (e) { panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`; }
}

function insigniaConsent(estado) {
  const map = { otorgado: ['estado-activo', 'otorgado'], denegado: ['estado-inactivo', 'denegado'], pendiente: ['', 'pendiente'] };
  const [clase, txt] = map[estado] ?? ['', estado];
  const color = estado === 'otorgado' ? 'var(--color-aprobado)' : estado === 'denegado' ? 'var(--color-reprobado)' : 'var(--color-text-muted)';
  return `<span style="color:${color};font-weight:600;font-size:var(--texto-sm)">${txt}</span>`;
}

function dialogoConsentimiento(alumnoId, nombre, estadoActual) {
  const dlg = $('dlg');
  dlg.innerHTML = `
    <div class="cuerpo">
      <h2>Consentimiento de videovigilancia</h2>
      <p style="color:var(--color-text-muted)">${escapar(nombre)}</p>
      <div class="campo"><label>Estado</label>
        <select id="cv-estado" class="control">
          <option value="otorgado" ${estadoActual === 'otorgado' ? 'selected' : ''}>Otorgado</option>
          <option value="denegado" ${estadoActual === 'denegado' ? 'selected' : ''}>Denegado</option>
          <option value="pendiente" ${estadoActual === 'pendiente' ? 'selected' : ''}>Pendiente</option>
        </select></div>
      <div class="campo"><label>Referencia del documento (opcional)</label><input id="cv-ref" class="control" placeholder="Ej: Formulario firmado 2026-03-01"></div>
      <div class="campo"><label>Observación (opcional)</label><input id="cv-obs" class="control"></div>
      <div style="display:flex;gap:.75rem;margin-top:1rem">
        <button class="boton" id="cv-ok">Guardar</button>
        <button class="boton boton-secundario" id="cv-cancelar">Cancelar</button>
      </div>
    </div>`;
  dlg.showModal();
  $('cv-cancelar').onclick = () => dlg.close();
  $('cv-ok').onclick = async () => {
    try {
      await api(`/api/video/consentimientos/${alumnoId}`, { method: 'PUT', body: {
        estado: $('cv-estado').value, documentoReferencia: $('cv-ref').value.trim() || null, observacion: $('cv-obs').value.trim() || null,
      } });
      dlg.close(); avisar('Consentimiento actualizado.', 'exito'); tabConsentimientos(); cargarResumen();
    } catch (e) { avisar(e.message); }
  };
}

// ---------- Grabaciones ----------
async function tabGrabaciones() {
  const panel = $('panel');
  panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Cargando…</p></div>';
  try {
    const [{ grabaciones }, { camaras }] = await Promise.all([
      api('/api/video/grabaciones?porPagina=50'), api('/api/video/camaras'),
    ]);
    panel.innerHTML = `
      <div style="display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap">
        <button class="boton" id="registrar-grab" style="width:auto" ${camaras.length ? '' : 'disabled'}>Registrar grabación</button>
        <button class="boton boton-secundario" id="purgar" style="width:auto">Purgar vencidas</button>
      </div>
      <div class="tarjeta" style="background:var(--color-primary-light);border-left:3px solid var(--color-primary);margin-bottom:1rem">
        <p style="margin:0;font-size:var(--texto-sm)">
          Cada grabación tiene fecha de expiración. <b>Acceder a una exige un motivo</b> y queda auditado.
          Marcarla como evidencia extiende su retención, con un tope de 180 días.
        </p>
      </div>
      ${grabaciones.length ? `
      <div class="tarjeta" style="padding:0;overflow:auto">
        <table class="tabla">
          <thead><tr><th>Cámara</th><th>Inicio</th><th>Expira</th><th style="text-align:center">Evidencia</th><th></th></tr></thead>
          <tbody>${grabaciones.map((g) => `
            <tr>
              <td>${escapar(g.camara_codigo ?? g.camara_id)}</td>
              <td style="font-size:var(--texto-xs)">${new Date(g.fecha_inicio).toLocaleString('es-HN')}</td>
              <td style="font-size:var(--texto-xs)">${g.fecha_expiracion ? new Date(g.fecha_expiracion).toLocaleDateString('es-HN') : '—'}</td>
              <td style="text-align:center">${g.es_evidencia ? '⭐' : ''}</td>
              <td class="acciones">
                <button class="boton-mini" data-acceder="${g.id}">Acceder</button>
                ${g.es_evidencia ? '' : `<button class="boton-mini" data-evidencia="${g.id}">Marcar evidencia</button>`}
              </td>
            </tr>`).join('')}</tbody>
        </table>
      </div>` : '<div class="tarjeta"><p style="color:var(--color-text-muted)">No hay grabaciones registradas.</p></div>'}`;

    $('registrar-grab').onclick = () => dialogoRegistrarGrabacion(camaras);
    $('purgar').onclick = async () => {
      if (!confirm('¿Purgar todas las grabaciones vencidas? Esta acción queda auditada.')) return;
      try {
        const r = await api('/api/video/purgar', { method: 'POST', body: {} });
        avisar(`${r.purgadas} grabación(es) purgada(s).`, 'exito'); tabGrabaciones(); cargarResumen();
      } catch (e) { avisar(e.message); }
    };
    panel.querySelectorAll('[data-acceder]').forEach((b) => b.addEventListener('click', () => dialogoAcceder(Number(b.dataset.acceder))));
    panel.querySelectorAll('[data-evidencia]').forEach((b) => b.addEventListener('click', () => dialogoEvidencia(Number(b.dataset.evidencia))));
  } catch (e) { panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`; }
}

function dialogoRegistrarGrabacion(camaras) {
  const dlg = $('dlg');
  const ahora = new Date();
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  dlg.innerHTML = `
    <div class="cuerpo">
      <h2>Registrar grabación</h2>
      <p style="font-size:var(--texto-xs);color:var(--color-text-muted)">Demostrativo: registra el metadato de una grabación (cámara y rango horario), no captura video.</p>
      <div id="dlg-aviso" class="aviso aviso-error" hidden></div>
      <div class="campo"><label>Cámara</label>
        <select id="g-camara" class="control">${camaras.map((c) => `<option value="${c.id}">${escapar(c.codigo)} — ${escapar(c.nombre)}</option>`).join('')}</select></div>
      <div class="rejilla-2">
        <div class="campo"><label>Inicio</label><input id="g-inicio" class="control" type="datetime-local" value="${iso(new Date(ahora.getTime() - 3600000))}"></div>
        <div class="campo"><label>Fin</label><input id="g-fin" class="control" type="datetime-local" value="${iso(ahora)}"></div>
      </div>
      <div style="display:flex;gap:.75rem;margin-top:1rem">
        <button class="boton" id="g-ok">Registrar</button>
        <button class="boton boton-secundario" id="g-cancelar">Cancelar</button>
      </div>
    </div>`;
  dlg.showModal();
  $('g-cancelar').onclick = () => dlg.close();
  $('g-ok').onclick = async () => {
    try {
      await api('/api/video/grabaciones', { method: 'POST', body: {
        camaraId: Number($('g-camara').value),
        fechaInicio: $('g-inicio').value.replace('T', ' ') + ':00',
        fechaFin: $('g-fin').value.replace('T', ' ') + ':00',
      } });
      dlg.close(); avisar('Grabación registrada.', 'exito'); tabGrabaciones(); cargarResumen();
    } catch (e) {
      const a = $('dlg-aviso'); a.textContent = e.message; a.hidden = false;
    }
  };
}

function dialogoAcceder(grabacionId) {
  const dlg = $('dlg');
  dlg.innerHTML = `
    <div class="cuerpo">
      <h2>Acceder a la grabación</h2>
      <div id="dlg-aviso" class="aviso aviso-error" hidden></div>
      <p style="font-size:var(--texto-sm);color:var(--color-text-muted)">
        Todo acceso queda auditado. Si indicas un alumno, el sistema verificará su consentimiento antes de permitir el acceso.
      </p>
      <div class="campo"><label>Motivo (obligatorio, mínimo 5 caracteres)</label>
        <input id="a-motivo" class="control" placeholder="Ej: Revisión de incidente reportado el 12/03"></div>
      <div class="campo"><label>ID de alumno (opcional, para acceso dirigido)</label>
        <input id="a-alumno" class="control" type="number" placeholder="Dejar vacío para acceso general"></div>
      <div style="display:flex;gap:.75rem;margin-top:1rem">
        <button class="boton" id="a-ok">Acceder</button>
        <button class="boton boton-secundario" id="a-cancelar">Cancelar</button>
      </div>
    </div>`;
  dlg.showModal();
  $('a-cancelar').onclick = () => dlg.close();
  $('a-ok').onclick = async () => {
    try {
      const r = await api(`/api/video/grabaciones/${grabacionId}/acceder`, { method: 'POST', body: {
        motivo: $('a-motivo').value.trim(), alumnoId: $('a-alumno').value ? Number($('a-alumno').value) : null,
      } });
      dlg.close();
      avisar('Acceso concedido y auditado.', 'exito');
    } catch (e) {
      const a = $('dlg-aviso'); a.textContent = e.message; a.hidden = false;
    }
  };
}

function dialogoEvidencia(grabacionId) {
  const dlg = $('dlg');
  dlg.innerHTML = `
    <div class="cuerpo">
      <h2>Marcar como evidencia</h2>
      <div id="dlg-aviso" class="aviso aviso-error" hidden></div>
      <p style="font-size:var(--texto-sm);color:var(--color-text-muted)">Extiende la retención de esta grabación, con un tope de 180 días. Queda auditado.</p>
      <div class="campo"><label>Motivo (mínimo 5 caracteres)</label><input id="e-motivo" class="control" placeholder="Ej: Prueba de incidente disciplinario"></div>
      <div style="display:flex;gap:.75rem;margin-top:1rem">
        <button class="boton" id="e-ok">Marcar evidencia</button>
        <button class="boton boton-secundario" id="e-cancelar">Cancelar</button>
      </div>
    </div>`;
  dlg.showModal();
  $('e-cancelar').onclick = () => dlg.close();
  $('e-ok').onclick = async () => {
    try {
      await api(`/api/video/grabaciones/${grabacionId}/evidencia`, { method: 'POST', body: { motivo: $('e-motivo').value.trim() } });
      dlg.close(); avisar('Marcada como evidencia.', 'exito'); tabGrabaciones(); cargarResumen();
    } catch (e) {
      const a = $('dlg-aviso'); a.textContent = e.message; a.hidden = false;
    }
  };
}

// ============================================================================
// MONITOREO EN VIVO — la cámara y la detección de objetos peligrosos.
// La detección corre aquí, en el navegador, con TensorFlow.js. El video NO
// sale del navegador: al servidor solo se le avisa cuando hay una detección.
// ============================================================================

let modelo = null;          // el modelo COCO-SSD cargado
let stream = null;          // el stream de la cámara
let lazoActivo = false;     // ¿está corriendo el lazo de detección?
let clasesVigiladas = {};   // { 'knife': 'Cuchillo', ... }
const yaNotificado = new Map(); // anti-spam local por clase

async function tabMonitoreo() {
  const panel = $('panel');
  panel.innerHTML = `
    <div class="tarjeta" style="background:var(--color-primary-light);border-left:3px solid var(--color-primary);margin-bottom:1rem">
      <p style="margin:0;font-size:var(--texto-sm)">
        La detección corre en <b>este navegador</b> con inteligencia artificial local. El video no se envía a ningún servidor.
        Cuando se detecta un objeto peligroso, se registra el hecho y se te notifica.
      </p>
    </div>

    <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:end;margin-bottom:1rem">
      <div class="campo" style="margin:0;min-width:180px">
        <label>Fuente de video</label>
        <select id="m-fuente" class="control"><option value="webcam">Cámara de esta computadora</option></select>
      </div>
      <div class="campo" style="margin:0;min-width:180px">
        <label>Asociar a cámara (opcional)</label>
        <select id="m-camara" class="control"><option value="">Sin asociar</option></select>
      </div>
      <button class="boton" id="m-iniciar" style="width:auto">Iniciar cámara</button>
      <button class="boton boton-secundario" id="m-detener" style="width:auto" hidden>Detener</button>
    </div>

    <div style="position:relative;max-width:640px;background:#000;border-radius:var(--radio-lg);overflow:hidden">
      <video id="m-video" playsinline muted style="width:100%;display:block"></video>
      <canvas id="m-canvas" style="position:absolute;top:0;left:0;width:100%;height:100%"></canvas>
      <div id="m-estado" style="position:absolute;top:8px;left:8px;background:rgba(0,0,0,.6);color:#fff;padding:4px 10px;border-radius:999px;font-size:var(--texto-xs)">Cámara apagada</div>
    </div>

    <div id="m-alerta" style="margin-top:1rem"></div>`;

  // Poblar cámaras registradas y clases vigiladas.
  try {
    const [{ camaras }, obj] = await Promise.all([api('/api/video/camaras'), api('/api/video/objetos')]);
    clasesVigiladas = obj.vigiladas ?? {};
    if (camaras.length) {
      $('m-camara').innerHTML = '<option value="">Sin asociar</option>' +
        camaras.filter((c) => c.activa).map((c) => `<option value="${c.id}">${escapar(c.codigo)} — ${escapar(c.nombre)}</option>`).join('');
    }
  } catch { /* si falla, se monitorea sin asociar */ }

  // Cargar el modelo de IA (una vez). Si no está descargado, se avisa claro.
  cargarModelo();

  $('m-iniciar').onclick = iniciarMonitoreo;
  $('m-detener').onclick = () => { detenerMonitoreo(); $('m-iniciar').hidden = false; $('m-detener').hidden = true; $('m-estado').textContent = 'Cámara apagada'; };
}

async function cargarModelo() {
  // La IA es independiente de la cámara: la cámara puede encenderse aunque el
  // modelo aún no esté listo. Aquí solo se carga y se informa su estado.
  if (modelo) return;
  if (typeof cocoSsd === 'undefined' || typeof tf === 'undefined') {
    mostrarAlertaSetup('Las librerías de IA no cargaron. Revisa que exista public/vendor/tfjs/.');
    return;
  }
  try {
    // El modelo se sirve local desde /vendor/modelo (descargado con npm run descargar:modelo).
    modelo = await cocoSsd.load({ modelUrl: '/vendor/modelo/model.json' });
    const al = $('m-alerta');
    if (al && al.dataset.setup) { al.innerHTML = ''; delete al.dataset.setup; }
  } catch (e) {
    mostrarAlertaSetup();
  }
}

function mostrarAlertaSetup(mensaje) {
  const al = $('m-alerta');
  if (!al) return;
  al.dataset.setup = '1';
  al.innerHTML = `
    <div class="tarjeta" style="border-left:3px solid var(--color-advertencia)">
      <p style="margin:0 0 .5rem"><b>${mensaje ? escapar(mensaje) : 'El modelo de IA aún no está descargado.'}</b></p>
      <p style="margin:0;font-size:var(--texto-sm);color:var(--color-text-muted)">
        La cámara funciona igual; solo la <b>detección automática</b> está inactiva hasta descargar el modelo.
        Ejecuta una vez, en una máquina con internet: <code>npm run descargar:modelo</code>, y recarga esta página.
      </p>
    </div>`;
}

async function iniciarMonitoreo() {
  const video = $('m-video');
  const estado = $('m-estado');

  // Comprobación 1: contexto seguro. El navegador solo permite la cámara en
  // https o en localhost/127.0.0.1. Por IP de red (192.168.x.x) la bloquea.
  if (!window.isSecureContext) {
    estado.textContent = 'Contexto no seguro';
    mostrarErrorCamara(
      'El navegador bloquea la cámara en este contexto.',
      `Estás entrando por <code>${escapar(location.origin)}</code>. La cámara solo funciona en ` +
      '<code>http://localhost:3000</code> o <code>http://127.0.0.1:3000</code> (o con HTTPS). ' +
      'Abre el sistema por localhost y vuelve a intentar.'
    );
    return;
  }

  // Comprobación 2: el navegador soporta getUserMedia.
  if (!navigator.mediaDevices?.getUserMedia) {
    estado.textContent = 'Cámara no soportada';
    mostrarErrorCamara(
      'Este navegador no permite acceder a la cámara.',
      'Usa una versión reciente de Chrome, Edge o Firefox.'
    );
    return;
  }

  try {
    estado.textContent = 'Encendiendo cámara…';
    // 'video: true' deja que el navegador use la cámara disponible (en una
    // laptop, la frontal). No se fuerza cámara trasera para no fallar en PC.
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;
    await video.play();
    $('m-iniciar').hidden = true;
    $('m-detener').hidden = false;
    const al = $('m-alerta');
    if (al && !al.dataset.setup) al.innerHTML = '';
    lazoActivo = true;
    estado.textContent = modelo ? '● Monitoreando' : '● Cámara activa (IA cargando…)';
    estado.style.color = '#4ade80';
    detectarLazo();
  } catch (e) {
    estado.textContent = 'No se pudo abrir la cámara';
    // Cada tipo de error dice algo distinto; se traduce a lenguaje claro.
    const porTipo = {
      NotAllowedError: ['Diste "Bloquear" al permiso de la cámara.',
        'Haz clic en el ícono de cámara o el candado en la barra de direcciones, cambia el permiso a "Permitir" y recarga la página.'],
      NotFoundError: ['No se encontró ninguna cámara en esta computadora.',
        'Conecta una webcam y vuelve a intentar.'],
      NotReadableError: ['La cámara está en uso por otro programa.',
        'Cierra Zoom, Teams, Meet o cualquier app que esté usando la cámara, y reintenta.'],
      OverconstrainedError: ['No hay una cámara que cumpla lo pedido.', 'Reintenta; se usará la cámara disponible.'],
      AbortError: ['El navegador interrumpió el acceso a la cámara.', 'Reintenta.'],
      SecurityError: ['El navegador bloqueó la cámara por seguridad.', 'Entra por localhost y reintenta.'],
    };
    const [titulo, ayuda] = porTipo[e.name] ?? [`No se pudo acceder a la cámara (${e.name || 'error'}).`, e.message || 'Revisa los permisos del navegador.'];
    mostrarErrorCamara(titulo, ayuda);
  }
}

function mostrarErrorCamara(titulo, ayuda) {
  const al = $('m-alerta');
  if (!al) return;
  al.innerHTML = `
    <div class="tarjeta" style="border-left:3px solid var(--color-reprobado)">
      <p style="margin:0 0 .4rem"><b style="color:var(--color-reprobado)">${escapar(titulo)}</b></p>
      <p style="margin:0;font-size:var(--texto-sm);color:var(--color-text-muted)">${ayuda}</p>
    </div>`;
}

function detenerMonitoreo() {
  lazoActivo = false;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  const video = $('m-video');
  if (video) video.srcObject = null;
}

async function detectarLazo() {
  const video = $('m-video');
  const canvas = $('m-canvas');
  if (!lazoActivo || !video || video.readyState < 2) {
    if (lazoActivo) requestAnimationFrame(detectarLazo);
    return;
  }
  // Si la cámara está activa pero el modelo aún carga, se muestra el video sin
  // detección y se reintenta. Cuando el modelo llega, la detección arranca sola.
  if (!modelo) {
    const estado = $('m-estado');
    if (estado && estado.textContent.includes('cargando')) { /* sigue esperando */ }
    if (lazoActivo) requestAnimationFrame(detectarLazo);
    return;
  }
  const estado = $('m-estado');
  if (estado && estado.textContent.includes('cargando')) estado.textContent = '● Monitoreando';

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let predicciones = [];
  try { predicciones = await modelo.detect(video); } catch { /* frame perdido */ }

  for (const p of predicciones) {
    const peligroso = clasesVigiladas[p.class];
    const [x, y, w, h] = p.bbox;
    ctx.lineWidth = 3;
    ctx.strokeStyle = peligroso ? '#ef4444' : '#38bdf8';
    ctx.strokeRect(x, y, w, h);
    ctx.font = '16px sans-serif';
    const etiqueta = `${peligroso ?? p.class} ${Math.round(p.score * 100)}%`;
    ctx.fillStyle = peligroso ? '#ef4444' : '#38bdf8';
    const tw = ctx.measureText(etiqueta).width;
    ctx.fillRect(x, y - 20, tw + 10, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(etiqueta, x + 5, y - 5);

    // Si es peligroso y con confianza razonable, se reporta al servidor.
    if (peligroso && p.score >= 0.6) reportarDeteccion(p.class, p.score, etiqueta);
  }

  if (lazoActivo) requestAnimationFrame(detectarLazo);
}

async function reportarDeteccion(clase, score, etiqueta) {
  // Anti-spam local: no reportar la misma clase más de una vez cada 10 s.
  const ahora = Date.now();
  if (yaNotificado.has(clase) && ahora - yaNotificado.get(clase) < 10000) return;
  yaNotificado.set(clase, ahora);

  const camaraId = $('m-camara')?.value || null;
  try {
    await api('/api/video/detecciones', { method: 'POST', body: { camaraId: camaraId ? Number(camaraId) : null, clase, confianza: score } });
    // Alerta visual grande en la propia pantalla.
    const al = $('m-alerta');
    const div = document.createElement('div');
    div.className = 'tarjeta';
    div.style.cssText = 'border-left:4px solid var(--color-reprobado);background:#fef2f2';
    div.innerHTML = `<b style="color:var(--color-reprobado)">⚠️ ¡Objeto peligroso detectado!</b>
      <div style="font-size:var(--texto-sm)">${escapar(etiqueta)} · ${new Date().toLocaleTimeString('es-HN')}. Se registró y se notificó a administración.</div>`;
    al.prepend(div);
    // Sonido de alerta breve.
    try { new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQBvT18AAAAA').play().catch(() => {}); } catch {}
  } catch (e) { /* si falla el reporte, la detección visual ya se mostró */ }
}

// ---------- Detecciones (historial) ----------
async function tabDetecciones() {
  const panel = $('panel');
  panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Cargando…</p></div>';
  try {
    const r = await api('/api/video/detecciones?porPagina=50');
    panel.innerHTML = `
      <p style="color:var(--color-text-muted);font-size:var(--texto-sm)">${r.sinAtender} sin atender de ${r.total} en total.</p>
      ${r.detecciones.length ? `
      <div class="tarjeta" style="padding:0;overflow:auto">
        <table class="tabla">
          <thead><tr><th>Objeto</th><th>Cámara</th><th>Confianza</th><th>Cuándo</th><th style="text-align:center">Estado</th><th></th></tr></thead>
          <tbody>${r.detecciones.map((d) => `
            <tr>
              <td><b style="color:var(--color-reprobado)">⚠️ ${escapar(d.etiqueta)}</b></td>
              <td>${escapar(d.camara_nombre ?? 'Sin asociar')}</td>
              <td>${Math.round(d.confianza * 100)}%</td>
              <td style="font-size:var(--texto-xs)">${new Date(d.detectado_en).toLocaleString('es-HN')}</td>
              <td style="text-align:center">${d.atendida ? `<span style="color:var(--color-aprobado);font-size:var(--texto-xs)">atendida</span>` : '<span style="color:var(--color-advertencia);font-size:var(--texto-xs)">pendiente</span>'}</td>
              <td class="acciones">${d.atendida ? '' : `<button class="boton-mini" data-atender="${d.id}">Marcar atendida</button>`}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>` : '<div class="tarjeta"><p style="color:var(--color-aprobado)">No hay detecciones registradas.</p></div>'}`;
    panel.querySelectorAll('[data-atender]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/api/video/detecciones/${b.dataset.atender}/atender`, { method: 'POST' }); tabDetecciones(); cargarResumen(); }
      catch (e) { avisar(e.message); }
    }));
  } catch (e) { panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`; }
}

// ---------- Navegación ----------
function cambiarTab(tab) {
  tabActiva = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('activa', b.dataset.tab === tab));
  detenerMonitoreo(); // al salir de monitoreo, se apaga la cámara
  if (tab === 'monitoreo') tabMonitoreo();
  else if (tab === 'detecciones') tabDetecciones();
  else if (tab === 'camaras') tabCamaras();
  else if (tab === 'consentimientos') tabConsentimientos();
  else tabGrabaciones();
}

(async () => {
  await iniciarPantalla('Videovigilancia');
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));
  await cargarResumen();
  cambiarTab('monitoreo');
})();
