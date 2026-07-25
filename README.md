# Smart Campus IA

Sistema de gestión académica **100 % local** para colegio de educación media (7.º a 12.º), Honduras.

> **Estado actual: Fases 0 a 4 completas.** 113 pruebas automatizadas en verde.
> Entorno, modelo de datos, seguridad, matrícula, horarios y **notas,
> asistencia y comportamiento** listos. Ver los documentos `docs/FASE-*.md`.

---

## 1. Decisión de arquitectura: un solo backend

El requerimiento original mencionaba **Node.js y PHP simultáneamente**. Este proyecto implementa
**únicamente Node.js/Express**. XAMPP se instala solo por dos cosas: su motor **MariaDB** y
**phpMyAdmin** como herramienta de administración visual.

Por qué:

- Dos backends obligan a duplicar autenticación, sesiones, validaciones y reglas de negocio.
- Los sistemas híbridos filtran seguridad **en la costura entre ambos**: un endpoint PHP que olvida
  una verificación de rol anula todo el RBAC del lado Node.
- Un alumno solo necesita cambiar de puerto para saltarse el control más débil de los dos.
- El mantenimiento futuro lo hará una persona, no dos equipos.

Apache de XAMPP **no sirve la aplicación**. Solo phpMyAdmin.

---

## 2. Qué se instala

| # | Software | Versión | Para qué |
|---|---|---|---|
| 1 | **Node.js LTS** | 24.x (Krypton) | Servidor de aplicación |
| 2 | **XAMPP** | 8.2.x | MariaDB + phpMyAdmin |
| 3 | **Ollama** | última | IA local (fase 6) |
| 4 | **Python** | 3.11 o 3.12 | Microservicio de visión (fase 8) |
| 5 | **Git** | última | Control de versiones |
| 6 | **VS Code** | última | Editor |

Requisitos de hardware mínimos del servidor:

- 8 GB de RAM para todo menos IA. **16 GB** si vas a correr `llama3.1:8b` cómodamente.
- 20 GB libres en disco (el modelo de IA solo ya pesa ~5 GB).
- Para la fase 8 (visión), una GPU ayuda mucho pero no es obligatoria.

---

## 3. Instalación paso a paso

### Paso 1 — Node.js

Descarga la versión **LTS 24.x** de <https://nodejs.org>. En Windows, instalador `.msi`, siguiente,
siguiente. No marques la opción de instalar herramientas de compilación de Chocolatey: este
proyecto no usa dependencias nativas a propósito.

Comprueba:

```bash
node -v      # debe mostrar v24.x.x o superior
npm -v
```

### Paso 2 — XAMPP (MariaDB y phpMyAdmin)

1. Descarga XAMPP 8.2 de <https://www.apachefriends.org>.
2. En el instalador **desmarca todo excepto**: `MySQL`, `phpMyAdmin` y `Apache` (Apache solo hace
   falta para abrir phpMyAdmin).
3. Instálalo en `C:\xampp`.
4. Abre el **XAMPP Control Panel** y arranca `Apache` y `MySQL`.

**Configuración obligatoria: poner contraseña a root.** XAMPP viene con root sin contraseña, lo cual
es inaceptable en un sistema con datos de menores de edad.

Abre una terminal:

```bash
cd C:\xampp\mysql\bin
mysql.exe -u root
```

Dentro de MySQL:

```sql
ALTER USER 'root'@'localhost' IDENTIFIED BY 'una_clave_fuerte_de_root';
FLUSH PRIVILEGES;
EXIT;
```

Después, edita `C:\xampp\phpMyAdmin\config.inc.php` y pon esa misma clave:

```php
$cfg['Servers'][$i]['password'] = 'una_clave_fuerte_de_root';
```

### Paso 3 — Crear la base de datos y los usuarios

Desde la terminal, en la carpeta del proyecto:

```bash
C:\xampp\mysql\bin\mysql.exe -u root -p < sql/00_crear_bd_y_usuarios.sql
```

> Antes de ejecutarlo, **abre `sql/00_crear_bd_y_usuarios.sql` y cambia las dos contraseñas de
> ejemplo**. Ese archivo crea:
> - la base `smart_campus` en `utf8mb4_unicode_ci` (necesario para acentos y ñ);
> - el usuario `sc_app`, que es el que usa Node — **sin permisos de DROP, ALTER ni GRANT**;
> - el usuario `sc_backup`, de solo lectura, para `mysqldump`.

Esto no es burocracia: si alguien logra una inyección SQL a través de `sc_app`, no puede borrar
tablas ni escalar privilegios.

### Paso 4 — Ollama (IA local)

1. Descarga de <https://ollama.com/download> e instala.
2. Descarga el modelo:

```bash
ollama pull llama3.1:8b
```

Si el servidor tiene 8 GB de RAM o menos, usa el modelo más liviano y cambia `OLLAMA_MODEL` en `.env`:

```bash
ollama pull qwen2.5:7b
```

3. Comprueba que responde:

```bash
curl http://localhost:11434/api/tags
```

**Ollama es opcional para las fases 0 a 5.** Si no está, el sistema debe seguir funcionando: eso es
un criterio de aceptación del proyecto y el código ya lo respeta.

### Paso 5 — Python (solo para la fase 8)

Instala Python 3.11 o 3.12 desde <https://python.org>, marcando **"Add Python to PATH"**.
El microservicio de visión se configura cuando lleguemos a esa fase; por ahora basta con tenerlo.

### Paso 6 — El proyecto

```bash
cd smart-campus-ia
npm install
```

Crea tu archivo de configuración:

```bash
copy .env.example .env        # Windows
# cp .env.example .env        # Linux / macOS
```

Genera los dos secretos JWT (ejecuta el comando **dos veces**, uno para cada secreto):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Abre `.env` y rellena como mínimo:

- `DB_PASSWORD` → la clave que le diste a `sc_app`
- `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` → los dos valores generados, **distintos entre sí**
- `MYSQLDUMP_PATH` → `C:/xampp/mysql/bin/mysqldump.exe` en Windows

### Paso 7 — Verificar

```bash
npm run verificar
```

Este script revisa una por una todas las piezas y, cuando algo falla, dice exactamente qué hacer.
**No avances a la Fase 1 hasta que salga sin fallas.** Los avisos amarillos (Ollama apagado, base
vacía, HTTPS desactivado) son normales en esta fase.

### Paso 8 — Arrancar

```bash
npm run dev
```

Abre <http://localhost:3000>. Deberías ver la página de estado con el servidor y la base de datos
en verde.

Prueba también el endpoint directo: <http://localhost:3000/api/salud>

---

## 4. HTTPS en la red del colegio

En desarrollo, `HTTPS_ENABLED=false` está bien. Antes de desplegar en la red real:

```bash
npm run cert
```

Genera un certificado autofirmado válido para `localhost` y para la IP del servidor.
Luego pon `HTTPS_ENABLED=true` en `.env` y reinicia.

Los navegadores mostrarán una advertencia la primera vez. Para quitarla en los equipos del colegio,
instala `certs/server.crt` como autoridad de confianza en cada máquina (por directiva de grupo si
hay dominio Windows).

---

## 5. Respaldos

```bash
npm run backup
```

Crea un `.sql` con sello de tiempo en `storage/backups/` y borra automáticamente los mayores de
14 días.

**Prográmalo.** En Windows, Programador de tareas → tarea diaria a las 11:00 p.m. que ejecute:

```
C:\Program Files\nodejs\node.exe  C:\ruta\smart-campus-ia\scripts\respaldo.js
```

Un respaldo que nunca se probó no es un respaldo. Al menos una vez, restaura un archivo en una
base de prueba y verifica que los datos están completos:

```bash
mysql -u root -p -e "CREATE DATABASE prueba_restauracion"
mysql -u root -p prueba_restauracion < storage/backups/smart_campus_XXXX.sql
```

---

## 6. Estructura del proyecto

```
smart-campus-ia/
├── src/
│   ├── config/        env.js, db.js, logger.js
│   ├── middleware/    error.js, auth.js (roles y permisos por fila), seguridad.js
│   ├── routes/        definición de endpoints
│   ├── controllers/   entrada/salida HTTP
│   ├── services/      reglas de negocio (aquí vive el cálculo de notas)
│   ├── models/        acceso a datos
│   ├── app.js         configuración de Express
│   └── server.js      arranque
├── public/            frontend estático — lo ÚNICO servido públicamente
│   ├── css/theme.css  todos los colores del sistema
│   ├── js/
│   ├── fonts/         .woff2 locales, nunca Google Fonts
│   └── vendor/        Chart.js descargado, nunca CDN
├── storage/           FUERA del webroot, a propósito
│   ├── uploads/       material didáctico
│   ├── backups/
│   └── logs/
├── sql/               esquema, triggers, semilla y permisos
├── docs/              FASE-1.md y diagrama entidad-relación
├── scripts/           utilidades de operación
└── certs/             certificados (no se versionan)
```

**Por qué `storage/` está fuera de `public/`:** si el material didáctico se sirviera como archivo
estático, cualquiera con el enlace podría descargarlo sin estar autenticado, y un archivo subido
con extensión ejecutable podría ser servido por el servidor. Todo archivo se entrega mediante un
endpoint que primero verifica sesión y permisos.

---

## 7. Cómo verificar que el sistema es realmente local

Requisito innegociable del proyecto. Para comprobarlo:

1. Abre el sistema en el navegador, pulsa **F12** → pestaña **Network**.
2. Recarga con `Ctrl+Shift+R`.
3. Ordena por dominio. **Todas** las peticiones deben ir a `localhost`.

Cualquier `fonts.googleapis.com`, `cdn.jsdelivr.net` o similar es un incumplimiento.

La política de seguridad de contenido (CSP) configurada en `src/app.js` bloquea esto por diseño:
el navegador rechazará cualquier script, estilo o fuente que no venga de este mismo servidor.

---

## 8. Plan de fases

| Fase | Alcance | Estado |
|---|---|---|
| **0** | Entorno, esqueleto, seguridad base, respaldos | ✅ **hecho** |
| **1** | Modelo de datos, SQL, ERD, datos semilla | ✅ **hecho** |
| **2** | Autenticación, RBAC, cifrado, gestión de usuarios | ✅ **hecho** |
| **3** | Matrícula, clases, horarios, inscripción automática | ✅ **hecho** |
| **4** | Notas, asistencia, comportamiento | ✅ **hecho** |
| 5 | Repositorio didáctico y finanzas | siguiente |
| 6 | Chatbot Ollama y analítica | pendiente |
| 7 | Dashboards y auditoría | pendiente |
| 8 | Videovigilancia (microservicio Python aparte) | pendiente |

---

## 9. Instalar la base de datos (Fase 1)

Con MySQL corriendo, desde **CMD** (no PowerShell):

```cmd
C:\xampp\mysql\bin\mysql.exe -u root -p smart_campus < sql\01_esquema.sql
C:\xampp\mysql\bin\mysql.exe -u root -p smart_campus < sql\02_triggers.sql
C:\xampp\mysql\bin\mysql.exe -u root -p smart_campus < sql\03_datos_semilla.sql
C:\xampp\mysql\bin\mysql.exe -u root -p               < sql\04_permisos_auditoria.sql
```

Después, el cifrado de datos sensibles (Fase 2):

```cmd
C:\xampp\mysql\bin\mysql.exe -u root -p smart_campus < sql\05_cifrado_identidad.sql
npm run migrar:identidad
C:\xampp\mysql\bin\mysql.exe -u root -p smart_campus < sql\06_eliminar_identidad_plana.sql
```

> Antes de migrar necesitas `ENCRYPTION_KEY` y `HASH_PEPPER` en el `.env`.
> Ver `docs/FASE-2.md`, sección 1.

Y las pruebas:

```cmd
npm run probar            # las 83 pruebas de las fases 1 a 3
npm run demo              # colegio de demostración con datos realistas
```

Credenciales iniciales: `admin` / `Admin.2026.Cambiar` (obliga a cambiarla).

Detalle completo del modelo, la fórmula de notas y las decisiones de diseño:
**`docs/FASE-1.md`**. Diagrama entidad-relación: `docs/modelo-datos.mermaid`.

---

## 10. Pendientes de definición

- [ ] **Colores del logo institucional** (primario, secundario, acento en HEX) → `public/css/theme.css`
- [x] ~~Regla de redondeo de notas~~ → dos decimales, configurable (`docs/FASE-1.md`)
- [x] ~~Ponderación por defecto~~ → Tareas 30 / Proyectos 30 / Exámenes 40
- [x] ~~Cifrado del campo `identidad`~~ → AES-256-GCM + HMAC (`docs/FASE-2.md`)
- [ ] **Umbral de inasistencias** que dispara alerta: sembrado en 15 %, confirmar con la dirección
- [ ] **Monto real de matrícula y mensualidad**, y regla de cálculo de mora
      (sembrados: L 1,500 y L 900; mora 5 % con 5 días de gracia)
- [ ] **Consentimiento informado de padres** para el módulo de videovigilancia, política de retención
      escrita y señalización de las áreas monitoreadas. Esto debe estar resuelto **antes** de la Fase 8,
      no después. Grabar menores sin marco legal expone al colegio y a ti.
