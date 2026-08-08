import { api, iniciarPantalla, escapar, tablaParciales } from './comun.js';

const $ = (id) => document.getElementById(id);
const L = (n) => `L ${Number(n).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const tarjeta = (titulo, valor, nota = '', color = 'var(--color-primary)') => `
  <div class="tarjeta">
    <div style="font-size:var(--texto-xs);text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-muted)">${escapar(titulo)}</div>
    <div style="font-size:var(--texto-2xl);font-weight:700;color:${color};margin:.25rem 0">${escapar(String(valor))}</div>
    ${nota ? `<div style="font-size:var(--texto-sm);color:var(--color-text-muted)">${escapar(nota)}</div>` : ''}
  </div>`;

const grid = (html) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1rem;margin-bottom:1.5rem">${html}</div>`;

function barra(pct, color) {
  return `<div style="background:var(--color-surface-alt);border-radius:999px;height:8px;overflow:hidden;margin-top:.5rem">
    <div style="width:${Math.min(100, pct)}%;height:100%;background:${color}"></div></div>`;
}

function renderAdmin(d) {
  const m = d.matricula, f = d.finanzas, r = d.rendimiento, a = d.asistencia;
  return `
    <h2 style="font-size:var(--texto-lg);margin:.5rem 0 1rem">Matrícula</h2>
    ${grid(
    tarjeta('Alumnos activos', m.activos, `${m.mujeres} mujeres · ${m.hombres} hombres`) +
    tarjeta('Secciones', d.porGrado.reduce((s) => s + 1, 0), `${d.porGrado.length} grados con alumnos`)
  )}

    <h2 style="font-size:var(--texto-lg);margin:.5rem 0 1rem">Finanzas</h2>
    ${grid(
    tarjeta('Recaudado', L(f.totalPagado), `${f.pctRecaudado}% de lo cargado`, 'var(--color-aprobado)') +
    tarjeta('Saldo pendiente', L(f.totalSaldo), `${f.morosos} alumnos con saldo`, f.totalSaldo > 0 ? 'var(--color-reprobado)' : 'var(--color-aprobado)') +
    tarjeta('Total cargado', L(f.totalCargado))
  )}

    <h2 style="font-size:var(--texto-lg);margin:.5rem 0 1rem">Rendimiento</h2>
    ${grid(
    tarjeta('Promedio general', r.promedioGeneral ?? '—') +
    tarjeta('Aprobación', r.pctAprobacion !== null ? `${r.pctAprobacion}%` : '—', `${r.aprobados} de ${r.conNota} notas`, 'var(--color-aprobado)') +
    tarjeta('Asistencia', a.pctAsistencia !== null ? `${a.pctAsistencia}%` : '—', `${a.ausencias} ausencias registradas`)
  )}

    <h2 style="font-size:var(--texto-lg);margin:.5rem 0 1rem">Alumnos por grado</h2>
    <div class="tarjeta">
      ${d.porGrado.map((g) => {
    const max = Math.max(...d.porGrado.map((x) => x.alumnos));
    return `<div style="margin-bottom:.6rem">
        <div style="display:flex;justify-content:space-between;font-size:var(--texto-sm)">
          <span>${escapar(g.grado_nombre)}</span><b>${g.alumnos}</b>
        </div>${barra((g.alumnos / max) * 100, 'var(--color-primary)')}
      </div>`;
  }).join('')}
    </div>`;
}

function renderMaestro(d) {
  return `
    ${grid(
    tarjeta('Mis clases', d.resumen.totalClases) +
    tarjeta('Mis alumnos', d.resumen.totalAlumnos) +
    tarjeta('Clases con notas', d.resumen.clasesConNotas, `de ${d.resumen.totalClases}`)
  )}
    <h2 style="font-size:var(--texto-lg);margin:.5rem 0 1rem">Detalle por clase</h2>
    <div class="tarjeta" style="padding:0;overflow:auto">
      <table class="tabla">
        <thead><tr><th>Asignatura</th><th>Sección</th><th style="text-align:center">Alumnos</th><th style="text-align:center">Promedio</th><th style="text-align:center">Reprobados</th></tr></thead>
        <tbody>${d.clases.map((c) => `
          <tr style="cursor:pointer" data-clase="${c.id}">
            <td>${escapar(c.asignatura)}</td>
            <td>${escapar(`${c.grado}º ${c.seccion}`)}</td>
            <td style="text-align:center">${c.inscritos}</td>
            <td style="text-align:center">${c.promedio ?? '—'}</td>
            <td style="text-align:center">${c.reprobados ?? 0}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function renderAlumno(d) {
  if (!d.alumno) return '<div class="tarjeta"><p>No hay datos de matrícula.</p></div>';
  return `
    <div class="tarjeta" style="margin-bottom:1.5rem">
      <div style="font-size:var(--texto-lg);font-weight:600">${escapar(d.alumno.nombre)}</div>
      <div style="color:var(--color-text-muted)">${escapar(`${d.alumno.grado ?? ''}º ${d.alumno.seccion ?? ''}`)}</div>
    </div>
    ${grid(
    tarjeta('Mi promedio', d.promedio ?? 'Sin notas', '', d.promedio !== null && d.promedio >= 70 ? 'var(--color-aprobado)' : d.promedio !== null ? 'var(--color-reprobado)' : 'var(--color-primary)') +
    tarjeta('Materias', d.materias, `${d.aprobadas} aprobadas · ${d.reprobadas} reprobadas`) +
    tarjeta('Saldo pendiente', L(d.saldoPendiente), '', d.saldoPendiente > 0 ? 'var(--color-reprobado)' : 'var(--color-aprobado)')
  )}
    ${tablaParciales(d.promediosParciales)}`;
}

(async () => {
  const usuario = await iniciarPantalla('Tablero');
  try {
    const { anio, rol, datos } = await api('/api/tablero');
    $('sub').textContent = anio ? `${anio.nombre}` : '';
    if (!datos) { $('contenido').innerHTML = '<div class="tarjeta"><p>No hay año lectivo activo.</p></div>'; return; }

    if (rol === 'ADMIN' || rol === 'ASESOR') $('contenido').innerHTML = renderAdmin(datos);
    else if (rol === 'MAESTRO') {
      $('contenido').innerHTML = renderMaestro(datos);
      $('contenido').querySelectorAll('[data-clase]').forEach((tr) =>
        tr.addEventListener('click', () => { window.location.href = `/clase.html?id=${tr.dataset.clase}`; }));
    } else $('contenido').innerHTML = renderAlumno(datos);
  } catch (e) {
    $('contenido').innerHTML = `<div class="tarjeta"><p style="color:var(--color-error)">${escapar(e.message)}</p></div>`;
  }
})();
