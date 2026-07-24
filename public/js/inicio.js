(async () => {
  const salir = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.href = '/';
  };

  document.getElementById('salir').addEventListener('click', salir);

  try {
    let r = await fetch('/api/auth/yo', { credentials: 'same-origin' });

    // Token de acceso vencido: se intenta refrescar una vez antes de rendirse.
    if (r.status === 401) {
      const ref = await fetch('/api/auth/refrescar', { method: 'POST', credentials: 'same-origin' });
      if (!ref.ok) return (window.location.href = '/');
      r = await fetch('/api/auth/yo', { credentials: 'same-origin' });
    }

    if (!r.ok) return (window.location.href = '/');

    const { usuario } = await r.json();
    document.getElementById('nombre').textContent = usuario.persona.nombreCompleto;
    document.getElementById('rol').textContent = usuario.rolNombre;

    const dl = document.getElementById('detalle');
    const filas = [
      ['Usuario', usuario.usuario],
      ['Rol', `${usuario.rolNombre} (${usuario.rol})`],
      ['Identidad', usuario.persona.identidad ?? 'no registrada'],
      ['Correo', usuario.persona.correo ?? 'no registrado'],
      ['Último acceso', usuario.ultimoAcceso ? new Date(usuario.ultimoAcceso).toLocaleString('es-HN') : '—'],
    ];
    for (const [k, v] of filas) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      dt.style.color = 'var(--color-text-muted)';
      const dd = document.createElement('dd');
      dd.textContent = v;
      dd.style.margin = '0';
      dl.append(dt, dd);
    }
  } catch {
    window.location.href = '/';
  }
})();
