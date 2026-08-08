import { api, iniciarPantalla, escapar } from './comun.js';
import { montarReloj } from './reloj.js';

const $ = (id) => document.getElementById(id);

const tarjeta = (titulo, valor, nota = '') => `
  <div class="tarjeta">
    <div style="font-size:var(--texto-xs);text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-muted)">${escapar(titulo)}</div>
    <div style="font-size:var(--texto-2xl);font-weight:600;color:var(--color-primary);margin:.25rem 0">${escapar(String(valor))}</div>
    ${nota ? `<div style="font-size:var(--texto-sm);color:var(--color-text-muted)">${escapar(nota)}</div>` : ''}
  </div>`;

(async () => {
  const usuario = await iniciarPantalla('Inicio');
  $('saludo').textContent = `Hola, ${usuario.persona.nombreCompleto.split(' ')[0]}`;

  // Reloj flip con la fecha y hora actuales.
  montarReloj('reloj');

  try {
    const ctx = await api('/api/contexto');
    $('sub').textContent = `${ctx.anioLectivo.nombre} · ${usuario.rolNombre}`;

    const c = ctx.catalogos;
    const matriculados = c.secciones.reduce((s, x) => s + Number(x.matriculados), 0);
    const cupo = c.secciones.reduce((s, x) => s + Number(x.cupo_maximo), 0);

    $('tarjetas').innerHTML =
      (['ADMIN', 'ASESOR'].includes(usuario.rol)
        ? tarjeta('Alumnos matriculados', matriculados, `de ${cupo} cupos disponibles`) +
          tarjeta('Secciones activas', c.secciones.length) +
          tarjeta('Maestros', c.maestros.length) +
          tarjeta('Asignaturas', c.asignaturas.length)
        : '');
  } catch (e) {
    $('sub').textContent = e.message;
  }

  try {
    const { clases } = await api('/api/mis-clases');
    const t = $('clases');
    if (!clases.length) {
      t.innerHTML = '<tbody><tr><td style="padding:1.5rem;color:var(--color-text-muted)">Sin clases asignadas.</td></tr></tbody>';
      return;
    }
    t.innerHTML = `
      <thead><tr><th>Asignatura</th><th>Sección</th><th>${usuario.rol === 'ALUMNO' ? 'Maestro' : 'Inscritos'}</th></tr></thead>
      <tbody>${clases.map((k) => `
        <tr style="cursor:pointer" data-clase="${k.id}">
          <td>${escapar(k.asignatura)}</td>
          <td>${escapar(`${k.grado}º ${k.seccion}`)}</td>
          <td>${escapar(String(k.maestro ?? k.inscritos ?? '—'))}</td>
        </tr>`).join('')}</tbody>`;

    t.querySelectorAll('[data-clase]').forEach((tr) =>
      tr.addEventListener('click', () => { window.location.href = `/clase.html?id=${tr.dataset.clase}`; }));
  } catch (e) {
    $('clases').innerHTML = `<tbody><tr><td style="padding:1.5rem;color:var(--color-error)">${escapar(e.message)}</td></tr></tbody>`;
  }
})();
