import { api, iniciarPantalla, escapar } from './comun.js';

const $ = (id) => document.getElementById(id);
let pagina = 1;

const ACCIONES = ['INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FALLIDO', 'EXPORT', 'OTRO'];
const colorAccion = (a) => ({
  INSERT: 'var(--color-aprobado)', DELETE: 'var(--color-reprobado)', UPDATE: 'var(--color-advertencia)',
  LOGIN: 'var(--color-info)', LOGIN_FALLIDO: 'var(--color-reprobado)',
}[a] ?? 'var(--color-text-muted)');

async function cargar() {
  const cuerpo = $('tabla').querySelector('tbody');
  cuerpo.innerHTML = '<tr><td colspan="6" style="padding:1.5rem;color:var(--color-text-muted)">Cargando…</td></tr>';

  const p = new URLSearchParams({ pagina, porPagina: 50 });
  if ($('f-accion').value) p.set('accion', $('f-accion').value);
  if ($('f-entidad').value) p.set('entidad', $('f-entidad').value);
  if ($('f-desde').value) p.set('desde', $('f-desde').value);
  if ($('f-hasta').value) p.set('hasta', $('f-hasta').value);

  try {
    const r = await api(`/api/auditoria?${p}`);

    $('resumen').innerHTML = `
      <div class="tarjeta" style="flex:1"><div style="font-size:var(--texto-xs);color:var(--color-text-muted);text-transform:uppercase">Eventos hoy</div><div style="font-size:var(--texto-xl);font-weight:700;color:var(--color-primary)">${r.resumen.eventosHoy}</div></div>
      <div class="tarjeta" style="flex:1"><div style="font-size:var(--texto-xs);color:var(--color-text-muted);text-transform:uppercase">Logins fallidos (24h)</div><div style="font-size:var(--texto-xl);font-weight:700;color:${r.resumen.loginsFallidos24h > 0 ? 'var(--color-reprobado)' : 'var(--color-aprobado)'}">${r.resumen.loginsFallidos24h}</div></div>`;

    if ($('f-entidad').options.length <= 1 && r.entidades?.length) {
      $('f-entidad').innerHTML = '<option value="">Todas</option>' + r.entidades.map((e) => `<option value="${escapar(e)}">${escapar(e)}</option>`).join('');
    }

    if (!r.eventos.length) {
      cuerpo.innerHTML = '<tr><td colspan="6" style="padding:1.5rem;color:var(--color-text-muted)">Sin eventos.</td></tr>';
      $('paginacion').textContent = '';
      return;
    }

    cuerpo.innerHTML = r.eventos.map((e) => `
      <tr style="cursor:pointer" data-id="${e.id}">
        <td style="white-space:nowrap;font-size:var(--texto-xs)">${new Date(e.fecha_hora).toLocaleString('es-HN')}</td>
        <td><b style="color:${colorAccion(e.accion)}">${escapar(e.accion)}</b></td>
        <td>${escapar(e.entidad)}${e.entidad_id ? ` <span style="color:var(--color-text-muted)">#${e.entidad_id}</span>` : ''}</td>
        <td>${escapar(e.usuario_nombre ?? e.usuario_login ?? 'sistema')}</td>
        <td style="font-size:var(--texto-xs)">${escapar(e.rol ?? '—')}</td>
        <td style="font-size:var(--texto-xs);color:var(--color-text-muted)">${escapar(e.ip ?? '—')}</td>
      </tr>`).join('');

    const desde = (r.pagina - 1) * r.porPagina + 1;
    $('paginacion').innerHTML = `Mostrando ${desde}–${desde + r.eventos.length - 1} de ${r.total.toLocaleString('es-HN')} · ` +
      `<button class="boton-mini" id="ant" ${pagina <= 1 ? 'disabled' : ''}>Anterior</button> ` +
      `<button class="boton-mini" id="sig" ${desde + r.eventos.length > r.total ? 'disabled' : ''}>Siguiente</button>`;
    $('ant')?.addEventListener('click', () => { if (pagina > 1) { pagina--; cargar(); } });
    $('sig')?.addEventListener('click', () => { pagina++; cargar(); });

    cuerpo.querySelectorAll('[data-id]').forEach((tr) => tr.addEventListener('click', () => verDetalle(Number(tr.dataset.id))));
  } catch (e) {
    cuerpo.innerHTML = `<tr><td colspan="6" style="padding:1.5rem;color:var(--color-error)">${escapar(e.message)}</td></tr>`;
  }
}

async function verDetalle(id) {
  try {
    const { evento } = await api(`/api/auditoria/${id}`);
    const json = (v) => v ? `<pre style="background:var(--color-surface-alt);padding:.75rem;border-radius:var(--radio-sm);overflow:auto;font-size:var(--texto-xs)">${escapar(JSON.stringify(v, null, 2))}</pre>` : '<span style="color:var(--color-text-muted)">—</span>';
    const dlg = $('dlg');
    dlg.innerHTML = `
      <div class="cuerpo">
        <h2>Evento #${evento.id}</h2>
        <dl style="display:grid;grid-template-columns:auto 1fr;gap:.4rem 1rem;font-size:var(--texto-sm)">
          <dt style="color:var(--color-text-muted)">Fecha</dt><dd style="margin:0">${new Date(evento.fecha_hora).toLocaleString('es-HN')}</dd>
          <dt style="color:var(--color-text-muted)">Acción</dt><dd style="margin:0"><b>${escapar(evento.accion)}</b> sobre ${escapar(evento.entidad)}${evento.entidad_id ? ` #${evento.entidad_id}` : ''}</dd>
          <dt style="color:var(--color-text-muted)">Usuario</dt><dd style="margin:0">${escapar(evento.usuario_nombre ?? 'sistema')} (${escapar(evento.rol ?? '—')})</dd>
          <dt style="color:var(--color-text-muted)">Origen</dt><dd style="margin:0">${escapar(evento.origen)} · IP ${escapar(evento.ip ?? '—')}</dd>
        </dl>
        <h3 style="font-size:var(--texto-base);margin:1rem 0 .3rem">Valor anterior</h3>${json(evento.valor_anterior)}
        <h3 style="font-size:var(--texto-base);margin:1rem 0 .3rem">Valor nuevo</h3>${json(evento.valor_nuevo)}
        <button class="boton boton-secundario" id="cerrar" style="width:auto;margin-top:1rem">Cerrar</button>
      </div>`;
    dlg.showModal();
    $('cerrar').onclick = () => dlg.close();
  } catch (e) { /* silencioso */ }
}

(async () => {
  await iniciarPantalla('Auditoría');
  $('f-accion').innerHTML = '<option value="">Todas</option>' + ACCIONES.map((a) => `<option value="${a}">${a}</option>`).join('');
  $('btn-filtrar').onclick = () => { pagina = 1; cargar(); };
  await cargar();
})();
