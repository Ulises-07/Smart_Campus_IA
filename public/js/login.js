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

      window.location.href = '/inicio.html';
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
})();
