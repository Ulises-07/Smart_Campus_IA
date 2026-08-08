// Ingreso al sistema. Sin dependencias externas: la CSP bloquea cualquier CDN.
(() => {
  const $ = (id) => document.getElementById(id);
  const formLogin = $('form-login');
  const formCambio = $('form-cambio');
  const aviso = $('aviso');

  function mostrar(texto, tipo = 'error', detalles = []) {
    aviso.className = `aviso aviso-${tipo}`;
    aviso.innerHTML = '';
    aviso.append(document.createTextNode(texto));
    if (detalles.length) {
      const ul = document.createElement('ul');
      for (const d of detalles) {
        const li = document.createElement('li');
        li.textContent = d;
        ul.append(li);
      }
      aviso.append(ul);
    }
    aviso.hidden = false;
  }

  const limpiar = () => { aviso.hidden = true; };

  async function pedir(ruta, cuerpo) {
    const r = await fetch(ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(cuerpo),
    });
    return { ok: r.ok, datos: await r.json().catch(() => ({})) };
  }

  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    limpiar();
    const btn = $('btn-entrar');
    btn.disabled = true;
    btn.textContent = 'Verificando...';

    try {
      const { ok, datos } = await pedir('/api/auth/login', {
        usuario: $('usuario').value.trim(),
        password: $('password').value,
      });

      if (!ok) {
        mostrar(datos.mensaje || 'No se pudo ingresar.', 'error', datos.detalles ?? []);
        return;
      }

      if (datos.usuario.debeCambiarPassword) {
        formLogin.hidden = true;
        formCambio.hidden = false;
        $('actual').value = $('password').value;
        $('nueva').focus();
        return;
      }

      // Acceso correcto: reproducir la animación de bienvenida y luego entrar.
      reproducirAnimacionAcceso(() => { window.location.href = '/inicio.html'; });
    } catch {
      mostrar('No se pudo conectar con el servidor.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    }
  });

  formCambio.addEventListener('submit', async (e) => {
    e.preventDefault();
    limpiar();

    if ($('nueva').value !== $('repetir').value) {
      mostrar('Las dos contraseñas no coinciden.');
      return;
    }

    const btn = $('btn-cambiar');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      const { ok, datos } = await pedir('/api/auth/cambiar-password', {
        actual: $('actual').value,
        nueva: $('nueva').value,
      });

      if (!ok) {
        mostrar(datos.mensaje || 'No se pudo cambiar la contrasena.', 'error', datos.detalles ?? []);
        return;
      }

      // El cambio cierra todas las sesiones a propósito: hay que volver a entrar.
      formCambio.hidden = true;
      formLogin.hidden = false;
      formLogin.reset();
      mostrar('Contraseña actualizada. Ingresa de nuevo con la nueva.', 'exito');
      $('usuario').focus();
    } catch {
      mostrar('No se pudo conectar con el servidor.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar y continuar';
    }
  });

  // ---- Animación de acceso: semáforo en verde + barrera que se levanta ----
  function reproducirAnimacionAcceso(alTerminar) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const overlay = document.createElement('div');
    overlay.id = 'overlay-acceso';
    overlay.innerHTML = `
      <div class="acc-escena">
        <img src="/img/logo-256.png" alt="" class="acc-logo" id="acc-logo-img">
        <p class="acc-titulo">Bienvenido a Smart Campus</p>
        <div class="acc-semaforo" aria-hidden="true">
          <div class="acc-luz roja"></div>
          <div class="acc-luz ambar"></div>
          <div class="acc-luz verde"></div>
        </div>
        <div class="acc-barrera-zona" aria-hidden="true">
          <div class="acc-poste"></div>
          <div class="acc-base"></div>
          <div class="acc-brazo"></div>
        </div>
        <p class="acc-sub">Acceso concedido · Adelante</p>
      </div>`;
    document.body.appendChild(overlay);
    // Si el logo no carga, se oculta (sin handler inline, que la CSP bloquea).
    const img = overlay.querySelector('#acc-logo-img');
    if (img) img.addEventListener('error', () => { img.style.display = 'none'; });
    setTimeout(() => { if (typeof alTerminar === 'function') alTerminar(); }, reduce ? 200 : 3000);
  }
})();
