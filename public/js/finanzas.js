import { api, iniciarPantalla, escapar, avisar } from './comun.js';

const $ = (id) => document.getElementById(id);
let usuario, monedaFmt, alumnoActual = null, tabActiva = 'cuenta';

const L = (n) => `L ${Number(n).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------- Buscar alumno ----------
async function buscar() {
  const q = $('q').value.trim();
  if (!q) return;
  const cont = $('resultados');
  cont.innerHTML = '<span style="color:var(--color-text-muted)">Buscando…</span>';
  try {
    const r = await api(`/api/alumnos?busqueda=${encodeURIComponent(q)}&porPagina=8`);
    if (!r.datos.length) { cont.innerHTML = '<span style="color:var(--color-text-muted)">Sin resultados.</span>'; return; }
    cont.innerHTML = r.datos.map((a) =>
      `<button class="boton-mini" data-alumno="${a.id}" style="margin:.15rem">${escapar(a.codigo)} · ${escapar(a.nombreCompleto)}</button>`).join('');
    cont.querySelectorAll('[data-alumno]').forEach((b) =>
      b.addEventListener('click', () => verCuenta(Number(b.dataset.alumno), b.textContent)));
  } catch (e) {
    cont.innerHTML = `<span style="color:var(--color-error)">${escapar(e.message)}</span>`;
  }
}

// ---------- Estado de cuenta ----------
async function verCuenta(alumnoId, nombre) {
  alumnoActual = { id: alumnoId, nombre };
  const panel = $('cuenta');
  panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Cargando…</p></div>';

  try {
    const ec = await api(`/api/alumnos/${alumnoId}/estado-cuenta`);
    const puedeCobrar = ['ADMIN', 'ASESOR'].includes(usuario.rol);

    const filas = ec.cargos.map((c) => {
      const venc = c.fecha_vencimiento ? new Date(c.fecha_vencimiento).toLocaleDateString('es-HN') : '—';
      const colorEstado = c.estado === 'pagado' ? 'var(--color-aprobado)'
        : c.estado === 'mora' ? 'var(--color-reprobado)'
          : c.saldo > 0 ? 'var(--color-advertencia)' : 'var(--color-text-muted)';
      return `
        <tr>
          <td>${escapar(c.concepto)}${c.mes ? ` <span style="color:var(--color-text-muted)">(mes ${c.mes})</span>` : ''}</td>
          <td style="text-align:right">${L(c.monto)}</td>
          <td style="text-align:right">${Number(c.monto_mora) > 0 ? `<span style="color:var(--color-reprobado)">${L(c.monto_mora)}</span>` : '—'}</td>
          <td style="text-align:right">${Number(c.descuento) > 0 ? `−${L(c.descuento)}` : '—'}</td>
          <td>${venc}</td>
          <td style="text-align:right;font-weight:600">${L(c.saldo)}</td>
          <td><span style="color:${colorEstado};font-weight:600;font-size:var(--texto-xs)">${escapar(c.estado)}</span></td>
          <td class="acciones">
            ${puedeCobrar && c.saldo > 0 ? `<button class="boton-mini" data-pagar="${c.id}" data-saldo="${c.saldo}" data-concepto="${escapar(c.concepto)}">Cobrar</button>` : ''}
          </td>
        </tr>`;
    }).join('');

    panel.innerHTML = `
      <div class="tarjeta" style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem">
          <div>
            <div style="font-size:var(--texto-lg);font-weight:600">${escapar(nombre)}</div>
            <div style="color:var(--color-text-muted);font-size:var(--texto-sm)">
              Cargado ${L(ec.resumen.totalCargado)} · Pagado ${L(ec.resumen.totalPagado)}
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:var(--texto-xs);text-transform:uppercase;color:var(--color-text-muted)">Saldo</div>
            <div style="font-size:var(--texto-2xl);font-weight:700;color:${ec.resumen.alDia ? 'var(--color-aprobado)' : 'var(--color-reprobado)'}">
              ${L(ec.resumen.totalSaldo)}
            </div>
            ${ec.resumen.alDia ? '<span class="insignia-estado estado-activo">Al día</span>' : ''}
          </div>
        </div>
        ${puedeCobrar && !ec.cargos.length ? '<button class="boton" id="btn-generar" style="width:auto;margin-top:1rem">Generar cargos del año</button>' : ''}
      </div>

      ${ec.cargos.length ? `
      <div class="tarjeta" style="padding:0;overflow:auto">
        <table class="tabla">
          <thead><tr><th>Concepto</th><th style="text-align:right">Monto</th><th style="text-align:right">Mora</th><th style="text-align:right">Desc.</th><th>Vence</th><th style="text-align:right">Saldo</th><th>Estado</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>` : '<div class="tarjeta"><p style="color:var(--color-text-muted)">Este alumno no tiene cargos generados.</p></div>'}`;

    $('btn-generar')?.addEventListener('click', async () => {
      try {
        const r = await api(`/api/alumnos/${alumnoId}/generar-cargos`, { method: 'POST', body: {} });
        avisar(`${r.creados} cargo(s) generados.`, 'exito');
        verCuenta(alumnoId, nombre);
      } catch (e) { avisar(e.message); }
    });

    panel.querySelectorAll('[data-pagar]').forEach((b) =>
      b.addEventListener('click', () => cobrar(Number(b.dataset.pagar), Number(b.dataset.saldo), b.dataset.concepto)));
  } catch (e) {
    panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`;
  }
}

// ---------- Cobrar ----------
function cobrar(cargoId, saldo, concepto) {
  const dlg = $('dlg');
  dlg.innerHTML = `
    <div class="cuerpo">
      <h2>Registrar pago</h2>
      <div id="dlg-aviso" class="aviso aviso-error" hidden></div>
      <p style="color:var(--color-text-muted)">${escapar(concepto)} · saldo <b>${L(saldo)}</b></p>
      <div class="campo"><label>Monto a pagar</label>
        <input id="p-monto" class="control" type="number" min="0.01" max="${saldo}" step="0.01" value="${saldo}"></div>
      <div class="rejilla-2">
        <div class="campo"><label>Método</label>
          <select id="p-metodo" class="control">
            <option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option>
            <option value="deposito">Depósito</option><option value="otro">Otro</option>
          </select></div>
        <div class="campo"><label>Referencia (opcional)</label><input id="p-ref" class="control"></div>
      </div>
      <div style="display:flex;gap:.75rem;margin-top:1rem">
        <button class="boton" id="p-ok">Registrar pago</button>
        <button class="boton boton-secundario" id="p-cancelar">Cancelar</button>
      </div>
    </div>`;
  dlg.showModal();
  $('p-cancelar').onclick = () => dlg.close();
  $('p-ok').onclick = async () => {
    const monto = Number($('p-monto').value);
    if (!(monto > 0) || monto > saldo) { err(`El monto debe estar entre 0.01 y ${L(saldo)}.`); return; }
    try {
      const r = await api('/api/pagos', {
        method: 'POST',
        body: { cargoId, monto, metodo: $('p-metodo').value, referencia: $('p-ref').value.trim() || null },
      });
      dlg.close();
      avisar(`${r.mensaje} Saldo restante: ${L(r.saldoRestante)}.`, 'exito');
      // Abre el recibo PDF con formato en una pestaña nueva, listo para imprimir.
      if (r.pagoId) window.open(`/api/pagos/${r.pagoId}/recibo-pdf`, '_blank');
      verCuenta(alumnoActual.id, alumnoActual.nombre);
    } catch (e) { err(e.message, e.detalles); }
  };
  function err(t, d = []) { const a = $('dlg-aviso'); a.innerHTML = escapar(t) + (d?.length ? `<ul>${d.map((x) => `<li>${escapar(x)}</li>`).join('')}</ul>` : ''); a.hidden = false; }
}

async function mostrarRecibo(pagoId) {
  try {
    const { recibo } = await api(`/api/pagos/${pagoId}/recibo`);
    // Recibo simple imprimible: se abre en una ventana nueva lista para Ctrl+P.
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    w.document.write(`
      <html><head><title>Recibo ${escapar(recibo.numero_recibo ?? '')}</title>
      <style>body{font-family:system-ui,sans-serif;padding:2rem;color:#111}
      h1{font-size:1.1rem;margin:0}hr{border:none;border-top:1px dashed #999;margin:1rem 0}
      .fila{display:flex;justify-content:space-between;margin:.35rem 0}
      .total{font-size:1.3rem;font-weight:700}</style></head><body>
      <h1>Smart Campus IA</h1><div style="color:#666;font-size:.85rem">Comprobante de pago</div><hr>
      <div class="fila"><span>Recibo</span><b>${escapar(recibo.numero_recibo ?? '')}</b></div>
      <div class="fila"><span>Fecha</span><span>${new Date(recibo.fecha_pago ?? Date.now()).toLocaleString('es-HN')}</span></div>
      <div class="fila"><span>Alumno</span><span>${escapar(recibo.alumno ?? '')}</span></div>
      <div class="fila"><span>Concepto</span><span>${escapar(recibo.concepto ?? '')}</span></div>
      <div class="fila"><span>Método</span><span>${escapar(recibo.metodo ?? '')}</span></div>
      <hr><div class="fila total"><span>Pagado</span><span>L ${Number(recibo.monto ?? 0).toFixed(2)}</span></div>
      <hr><div style="color:#666;font-size:.75rem;text-align:center">Impreso ${new Date().toLocaleString('es-HN')}</div>
      </body></html>`);
    w.document.close();
  } catch { /* el recibo es un extra; si falla, el pago igual se registró */ }
}

// ---------- Morosidad ----------
async function cargarMorosidad() {
  const panel = $('morosidad');
  panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-text-muted)">Cargando…</p></div>';
  try {
    const { morosos } = await api('/api/finanzas/morosidad');
    if (!morosos.length) { panel.innerHTML = '<div class="tarjeta"><p style="color:var(--color-aprobado)">No hay alumnos con saldo pendiente.</p></div>'; return; }
    panel.innerHTML = `
      <p style="color:var(--color-text-muted);font-size:var(--texto-sm)">${morosos.length} alumno(s) con saldo pendiente.</p>
      <div class="tarjeta" style="padding:0;overflow:auto">
        <table class="tabla">
          <thead><tr><th>Código</th><th>Alumno</th><th>Sección</th><th style="text-align:right">Saldo</th><th></th></tr></thead>
          <tbody>${morosos.map((m) => `
            <tr>
              <td>${escapar(m.codigo ?? '')}</td>
              <td>${escapar(m.alumno ?? m.nombre ?? '')}</td>
              <td>${escapar(m.seccion ?? '—')}</td>
              <td style="text-align:right;font-weight:600;color:var(--color-reprobado)">${L(m.saldo ?? m.total_saldo ?? 0)}</td>
              <td class="acciones"><button class="boton-mini" data-ver="${m.alumno_id ?? m.id}" data-nombre="${escapar(m.alumno ?? m.nombre ?? '')}">Ver cuenta</button></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
    panel.querySelectorAll('[data-ver]').forEach((b) =>
      b.addEventListener('click', () => { cambiarTab('cuenta'); verCuenta(Number(b.dataset.ver), b.dataset.nombre); }));
  } catch (e) {
    panel.innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`;
  }
}

function cambiarTab(tab) {
  tabActiva = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('activa', b.dataset.tab === tab));
  $('panel-cuenta').hidden = tab !== 'cuenta';
  $('panel-morosidad').hidden = tab !== 'morosidad';
  if (tab === 'morosidad') cargarMorosidad();
}

(async () => {
  usuario = await iniciarPantalla('Finanzas');

  // Un alumno solo ve su propia cuenta: no hay buscador para él.
  if (usuario.rol === 'ALUMNO') {
    document.querySelector('[data-tab="morosidad"]').hidden = true;
    $('panel-cuenta').querySelector('.tarjeta').hidden = true;
    // Su listado de alumnos contiene solo a él mismo (filtro por fila de la Fase 3).
    const lista = await api('/api/alumnos?porPagina=1');
    if (lista.datos[0]) verCuenta(lista.datos[0].id, lista.datos[0].nombreCompleto);
    return;
  }

  $('btn-buscar').onclick = buscar;
  $('q').onkeydown = (e) => { if (e.key === 'Enter') buscar(); };
  $('btn-mora')?.addEventListener('click', async () => {
    if (!confirm('¿Aplicar mora del 5% a todos los cargos vencidos?')) return;
    try {
      const r = await api('/api/finanzas/aplicar-mora', { method: 'POST', body: {} });
      avisar(`Mora aplicada a ${r.aplicados} cargo(s).`, 'exito');
      cargarMorosidad();
    } catch (e) { avisar(e.message); }
  });
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));
})();

