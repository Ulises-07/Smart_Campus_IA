# Fase 2 — Autenticación, permisos y cifrado

Estado: **completa y probada**. 27 pruebas de extremo a extremo en verde,
ejecutadas contra un servidor HTTP real con cookies reales.

---

## 1. Cómo instalar esta fase

### Paso 1 — Dos claves nuevas en el `.env`

Genera cada una por separado (son **32 bytes**, no 48 como los secretos JWT):

```cmd
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Agrégalas a tu `.env`:

```ini
ENCRYPTION_KEY=el_primer_valor
HASH_PEPPER=el_segundo_valor
```

> **Guarda `ENCRYPTION_KEY` también fuera del servidor.** Si la pierdes, las
> identidades cifradas son irrecuperables — ni con acceso de root a MySQL.
> Anótala junto a las contraseñas de la base, en un lugar seguro y físico.

### Paso 2 — Respaldo antes de migrar

```cmd
npm run backup
```

No es formalidad. El paso siguiente modifica una tabla con datos reales.

### Paso 3 — Migración del cifrado, en tres tiempos

```cmd
C:\xampp\mysql\bin\mysql.exe -u root -p smart_campus < sql\05_cifrado_identidad.sql
npm run migrar:identidad
```

El migrador imprime un conteo. **Solo si los dos números coinciden**, borra la
columna en texto plano:

```cmd
C:\xampp\mysql\bin\mysql.exe -u root -p smart_campus < sql\06_eliminar_identidad_plana.sql
```

Están separados a propósito: si algo falla en el cifrado, todavía tienes el dato
original intacto.

### Paso 4 — Comprobar

```cmd
npm run verificar        # ahora incluye una sección de cifrado
npm run probar:auth      # 27 pruebas de autenticación y permisos
npm run dev
```

Abre <http://localhost:3000>. Ingresa con `admin` / `Admin.2026.Cambiar`.
El sistema te obligará a cambiar la contraseña antes de dejarte pasar.

---

## 2. Cómo funciona la sesión

| Pieza | Dónde vive | Cuánto dura | Por qué así |
|---|---|---|---|
| Token de acceso | Cookie `httpOnly` | 15 min | Un XSS no puede leerlo. Si se filtra, caduca solo |
| Token de refresco | Cookie `httpOnly`, ruta `/api/auth` | 7 días | Solo viaja a la ruta que lo necesita |
| Hash del refresco | Tabla `sesion_refresh` | — | En la base nunca está el token, solo su hash |

Las cookies llevan `SameSite=Strict`, y `Secure` se activa solo cuando pongas
`HTTPS_ENABLED=true`.

### Rotación y detección de robo

Cada vez que se refresca la sesión, el token viejo se revoca y se emite uno
nuevo. Si un token **ya revocado** vuelve a aparecer, la única explicación
razonable es que alguien lo copió: el sistema cierra **todas** las sesiones de
esa persona y lo registra en auditoría.

Es incómodo para el usuario legítimo, que tendrá que volver a entrar. Es el
comportamiento correcto: la alternativa es dejar al intruso adentro.

---

## 3. Las dos capas de autorización

Esta distinción es el corazón de la fase.

```
requiereRol(ADMIN)          → "¿tu rol puede usar esta funcionalidad?"
puedeVerAlumno(usuario, id) → "¿puedes ver los datos DE ESTE alumno?"
```

El control de rol por sí solo **no** protege un sistema escolar. Todos los
alumnos tienen permiso para "ver notas"; el problema es que un alumno cambie
`/api/notas/451` por `/api/notas/452` y lea las de otro. Eso se llama IDOR y es
la vulnerabilidad más común en sistemas de este tipo.

Las funciones de fila están en `src/middleware/auth.js`:

| Rol | Qué alumnos puede ver | Qué clases puede ver |
|---|---|---|
| ADMIN | todos | todas |
| ASESOR | todos (gestiona matrícula) | todas |
| MAESTRO | solo los inscritos en sus clases | solo las que imparte |
| ALUMNO | solo a sí mismo | solo en las que está inscrito |

Los módulos académicos de las fases 4 a 7 las usarán antes de devolver
cualquier dato.

### Por qué devuelve 404 y no 403

Cuando la comprobación de fila falla, la respuesta es **404**, no 403.

Un 403 confirma que el registro existe. Un alumno que recorre
`/api/alumnos/1` hasta `/api/alumnos/999` podría deducir cuántos alumnos hay y
qué identificadores son válidos. Con 404 no aprende nada.

---

## 4. El cifrado de la identidad

Dos columnas con propósitos distintos:

**`identidad_cifrada`** — AES-256-GCM, reversible. Si alguien roba el archivo
`.sql` del respaldo, no obtiene identidades de menores. GCM además autentica:
si se altera un byte, el descifrado falla en vez de devolver basura silenciosa.

**`identidad_hash`** — HMAC-SHA256, irreversible. Permite buscar por identidad
sin descifrar la tabla completa, y sostiene el índice único.

**Por qué HMAC y no SHA-256 a secas:** una identidad hondureña tiene 13 dígitos.
Con SHA-256 simple, un atacante genera todos los hashes posibles en minutos y
revierte la tabla entera. HMAC exige además la clave secreta, que vive en el
`.env` y no en la base de datos.

Verificado en la prueba 8: lo que queda guardado se ve así, y no contiene el
número en ninguna parte.

```
dCv9jr77LZdj9ohEvijaz2yJq+M9...
```

---

## 5. Contra qué está protegido, y contra qué no

### Cubierto

| Ataque | Defensa |
|---|---|
| Fuerza bruta de contraseñas | Bloqueo a los 5 intentos + límite de 20 por IP cada 15 min |
| Enumeración de usuarios | Mismo mensaje y mismo tiempo de respuesta para usuario inexistente |
| Robo de token por XSS | Cookies `httpOnly` + CSP que solo admite scripts propios |
| CSRF | `SameSite=Strict` + verificación de `Origin` en toda escritura |
| Robo de sesión | Rotación de token con detección de reuso |
| Escalada de privilegios | `requiereRol` + un admin no puede modificar su propio rol |
| IDOR | Autorización por fila con respuesta 404 |
| Robo del respaldo | Identidad cifrada, contraseñas con bcrypt coste 12 |
| Inyección SQL | Sentencias preparadas + `sc_app` sin DROP ni ALTER |
| Manipulación del rastro | Auditoría inmutable por permisos y por triggers |

### No cubierto (y hay que saberlo)

- **Segundo factor.** No hay 2FA. Para una red local cerrada es una decisión
  defendible; si el sistema llegara a exponerse a internet, deja de serlo.
- **Contraseña olvidada por el propio usuario.** No hay recuperación por correo,
  porque el sistema no manda correos a propósito. El reinicio lo hace el
  administrador y entrega la clave temporal en persona. Es lento y es correcto:
  la recuperación por correo es la vía de entrada más común a estos sistemas.
- **Acceso físico al servidor.** Quien tenga la máquina tiene el `.env`, y con
  él la clave de cifrado. Mantén el equipo bajo llave.

---

## 6. Endpoints disponibles

### Autenticación

| Método | Ruta | Quién | Qué hace |
|---|---|---|---|
| POST | `/api/auth/login` | público | Inicia sesión |
| POST | `/api/auth/refrescar` | con cookie | Renueva el token rotándolo |
| POST | `/api/auth/logout` | cualquiera | Cierra sesión |
| GET | `/api/auth/yo` | autenticado | Perfil propio, con identidad descifrada |
| POST | `/api/auth/cambiar-password` | autenticado | Cambia la propia contraseña |

### Usuarios (solo ADMIN)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/usuarios` | Lista con filtros y paginación |
| GET | `/api/usuarios/:id` | Detalle |
| POST | `/api/usuarios` | Crea y devuelve contraseña temporal |
| PATCH | `/api/usuarios/:id` | Actualiza datos, rol o estado |
| POST | `/api/usuarios/:id/reiniciar-password` | Nueva contraseña temporal |
| POST | `/api/usuarios/:id/desbloquear` | Quita el bloqueo por intentos |

La contraseña temporal se muestra **una sola vez** y no se guarda en claro en
ningún lado. El administrador la entrega en persona.

---

## 7. Qué comprueban las 27 pruebas

`npm run probar:auth` levanta el servidor en un puerto libre, hace peticiones
HTTP reales con cookies y borra sus usuarios de prueba al terminar.

| Bloque | Se comprueba |
|---|---|
| Ingreso | Contraseña incorrecta y usuario inexistente dan el mismo mensaje |
| Bloqueo | A los 5 fallos la cuenta se cierra, y ni la contraseña buena entra |
| Sesión | Sin cookie no hay acceso; el refresco entrega token nuevo |
| Robo de sesión | Token reusado rechazado y todas las sesiones cerradas |
| Roles | Alumno y maestro no listan usuarios; alumno no se asciende a admin |
| CSRF | Petición con `Origin` externo rechazada |
| Alta de usuario | Contraseña temporal, cambio obligatorio, sistema bloqueado hasta cambiarla |
| Cifrado | La identidad no aparece en claro; el hash es determinista |
| Auditoría | Ingresos y altas quedan registrados con su responsable |

---

## 8. Lo que sigue

**Fase 3 — Matrícula, clases y horarios.** Ahí se implementa:

- alta de alumnos con sus encargados,
- matrícula con inscripción automática a las clases de la sección,
- constructor de horarios con detección de choques en la interfaz
  (la base ya los rechaza; falta que el usuario lo vea antes de guardar),
- traslados entre secciones y promoción de grado,
- primeros usos reales de `puedeVerAlumno` y `puedeVerClase`.

Sigue pendiente lo mismo de antes: **los colores del logo institucional** en
HEX, para reemplazar la paleta provisional de `theme.css`.
