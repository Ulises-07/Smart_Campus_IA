# Guía detallada de instalación — Smart Campus IA

Guía para **Windows**. Al final hay un apéndice con las diferencias en Linux/macOS.

> **Antes de empezar — usa el Símbolo del sistema (CMD), no PowerShell.**
> Abre el menú Inicio, escribe `cmd`, presiona Enter. PowerShell cambia el comportamiento de
> comandos como `copy` y `curl`, y te va a dar errores confusos. Donde haya diferencia, la anoto.

**Estructura de la guía:** cada paso tiene *qué hacer*, *cómo comprobar que salió bien* y
*qué hacer si falló*. No avances al siguiente paso sin pasar la comprobación.

---

## PASO 1 — Instalar el software base

### 1.1 Node.js

1. Entra a <https://nodejs.org>.
2. Descarga el botón que dice **LTS** (versión 24.x). No el que dice "Current".
3. Ejecuta el `.msi`. Acepta la licencia y dale Siguiente a todo.
4. En la pantalla que ofrece **"Tools for Native Modules"** (instalar Chocolatey y Visual Studio
   Build Tools), **déjala desmarcada**. Este proyecto no usa dependencias que requieran compilación
   — es una decisión de diseño, precisamente para que la instalación sea así de simple.
5. Cuando termine, **cierra todas las ventanas de CMD abiertas y abre una nueva.** El instalador
   modifica el PATH y las terminales ya abiertas no se enteran.

**Comprobación:**

```cmd
node -v
npm -v
```

Debe responder algo como:

```
v24.14.0
10.9.7
```

**Si falla** con `'node' no se reconoce como un comando`:
- ¿Abriste una terminal *nueva* después de instalar? Es la causa en el 90 % de los casos.
- Si sigue fallando, reinicia Windows.
- Si aún así falla, el PATH quedó mal: Panel de Control → Sistema → Configuración avanzada →
  Variables de entorno → en `Path` debe existir `C:\Program Files\nodejs\`.

---

### 1.2 XAMPP — ya lo tienes, solo verifica

Como ya tienes XAMPP instalado, no lo reinstales. Solo confirma dos cosas.

**a) Que MySQL arranca.** Abre el **XAMPP Control Panel** (búscalo en Inicio; si te pide permisos
de administrador, acéptalos) y presiona **Start** en la fila de **MySQL**. Debe ponerse verde y
mostrar un PID y el puerto 3306.

**b) Qué versión de MariaDB tienes:**

```cmd
C:\xampp\mysql\bin\mysql.exe --version
```

Responde algo como `mysql Ver 15.1 Distrib 10.4.32-MariaDB`. El número importante es **10.4.32**.

| Versión | Qué hacer |
|---|---|
| 10.2 o superior | Sigue, todo bien |
| 10.1 o inferior | Hay que actualizar XAMPP (ver abajo) |

**Si MySQL no arranca** y el panel muestra el texto en rojo:

- **Error `Port 3306 in use`**: tienes otro MySQL instalado (a veces lo deja instalado un programa
  de contabilidad o un instalador anterior). Abre CMD como administrador y ejecuta
  `netstat -ano | findstr :3306` para ver el PID que lo ocupa, luego búscalo en el Administrador de
  tareas → pestaña Detalles. Detén ese servicio, o cambia el puerto de XAMPP (Config → my.ini) y
  actualiza `DB_PORT` en el `.env` más adelante.
- **Error `Attempting to start MySQL... shutdown unexpectedly`**: casi siempre es la carpeta de
  datos corrupta tras un apagón. Los logs están en `C:\xampp\mysql\data\mysql_error.log`.
- **El antivirus lo bloquea**: agrega `C:\xampp` a las exclusiones.

**Si necesitas actualizar XAMPP** (solo si tienes MariaDB 10.1 o menor): descarga XAMPP 8.2.x de
<https://www.apachefriends.org>, desinstala el actual, instala en `C:\xampp`, y en el instalador
**desmarca todo excepto** `MySQL`, `phpMyAdmin` y `Apache`. No instales en `C:\Program Files`:
los permisos de Windows le causan problemas a XAMPP.

---

### 1.3 Ollama

1. Descarga de <https://ollama.com/download> → Windows.
2. Instala (no pregunta nada; se instala para el usuario actual).
3. Al terminar queda corriendo en segundo plano — verás su ícono en la bandeja del sistema,
   junto al reloj.

**Comprobación:**

```cmd
ollama --version
```

**Descargar el modelo.** Esto baja alrededor de **5 GB**, así que hazlo con buena conexión y
paciencia:

```cmd
ollama pull llama3.1:8b
```

> **Si tu servidor tiene 8 GB de RAM o menos**, usa el modelo liviano en su lugar. Anótalo, porque
> después hay que ponerlo en el `.env`:
> ```cmd
> ollama pull qwen2.5:7b
> ```

**Comprobación final** — abre en el navegador:

```
http://localhost:11434
```

Debe mostrar el texto `Ollama is running`.

Y para ver que el modelo quedó:

```cmd
ollama list
```

> **Ollama es opcional hasta la Fase 6.** Si se te complica, sáltalo y continúa: el sistema está
> diseñado para funcionar sin él. Es un criterio de aceptación del proyecto, no un parche.

---

### 1.4 VS Code y Git (recomendados)

- **VS Code**: <https://code.visualstudio.com>. Lo vas a usar para editar el `.env` y el `.sql`,
  y su terminal integrada te evita andar navegando con `cd`.
- **Git**: <https://git-scm.com>. No es obligatorio, pero en un proyecto de este tamaño vas a
  romper algo tarde o temprano y querer volver atrás.

---

### 1.5 Colocar el proyecto

Descomprime la carpeta `smart-campus-ia` en una ruta **corta y sin espacios ni sincronización en la nube**:

```
C:\proyectos\smart-campus-ia
```

**No la pongas** en `Escritorio`, `Documentos` ni dentro de OneDrive. OneDrive sincroniza
`node_modules` (miles de archivos), lo vuelve lentísimo y a veces corrompe la instalación.

---

## PASO 2 — Ponerle contraseña a root de MySQL

XAMPP viene con el usuario `root` **sin contraseña**. Eso significa que cualquier persona en la red
del colegio que llegue a ese puerto tiene control total sobre los datos de los alumnos. No es
opcional arreglarlo.

### 2.1 Elegir la contraseña

Vas a necesitar **tres contraseñas distintas** en total. Escríbelas ahora en un papel o en tu
gestor de contraseñas, porque las vas a usar en varios archivos:

| Usuario | Para qué | Tu contraseña |
|---|---|---|
| `root` | Administración de MySQL | ____________ |
| `sc_app` | La que usa el sistema Node | ____________ |
| `sc_backup` | Respaldos, solo lectura | ____________ |

**Reglas para estas contraseñas** (por limitaciones de los archivos donde van, no por capricho):

- Mínimo 16 caracteres.
- **Solo letras y números.** Evita `; # " ' \ % $ &` y espacios: rompen el archivo `.env`,
  el `.sql` o la línea de comandos, y el error resultante es dificilísimo de diagnosticar.

Puedes generar una así:

```cmd
node -e "console.log(require('crypto').randomBytes(12).toString('hex'))"
```

### 2.2 Aplicarla

Con MySQL corriendo en el panel de XAMPP:

```cmd
cd C:\xampp\mysql\bin
mysql.exe -u root
```

Entrarás a un prompt que dice `MariaDB [(none)]>`. Ahí pega esto, reemplazando el texto de ejemplo:

```sql
ALTER USER 'root'@'localhost' IDENTIFIED BY 'TuClaveDeRootAqui';
FLUSH PRIVILEGES;
EXIT;
```

**Comprobación:**

```cmd
mysql.exe -u root
```

Ahora **debe rechazarte** con `Access denied for user 'root'@'localhost'`. Eso es exactamente lo
que queremos. Ahora prueba con contraseña:

```cmd
mysql.exe -u root -p
```

Te pide la clave (no verás asteriscos mientras escribes, es normal), y debe dejarte entrar.
Escribe `EXIT;` para salir.

### 2.3 Avisarle a phpMyAdmin

phpMyAdmin todavía intenta entrar sin contraseña, así que ahora está roto. Hay que decirle la nueva.

1. Abre `C:\xampp\phpMyAdmin\config.inc.php` con VS Code o el Bloc de notas.
2. Busca la línea (cerca de la línea 21):

```php
$cfg['Servers'][$i]['password'] = '';
```

3. Ponle tu contraseña de root entre las comillas:

```php
$cfg['Servers'][$i]['password'] = 'TuClaveDeRootAqui';
```

4. Guarda.

**Comprobación:** arranca **Apache** en el panel de XAMPP y abre
<http://localhost/phpmyadmin>. Debe cargar normalmente.

**Si dice "Access denied"**, la contraseña del archivo no coincide con la que pusiste en MySQL.
Revisa que no hayas dejado un espacio de más dentro de las comillas.

---

## PASO 3 — Crear la base de datos y los usuarios

### 3.1 Editar el script

Abre `C:\proyectos\smart-campus-ia\sql\00_crear_bd_y_usuarios.sql` en VS Code.

Busca estas dos líneas y reemplaza el texto por las contraseñas que anotaste en el paso 2.1:

```sql
CREATE USER IF NOT EXISTS 'sc_app'@'localhost' IDENTIFIED BY 'CAMBIA_ESTA_CLAVE';
...
CREATE USER IF NOT EXISTS 'sc_backup'@'localhost' IDENTIFIED BY 'CAMBIA_ESTA_OTRA_CLAVE';
```

Guarda.

> La contraseña de `sc_app` es la que va después en el `.env`. Tienen que coincidir exactamente.

### 3.2 Ejecutarlo

```cmd
cd C:\proyectos\smart-campus-ia
C:\xampp\mysql\bin\mysql.exe -u root -p < sql\00_crear_bd_y_usuarios.sql
```

Te pide la contraseña de root. Si todo va bien, imprime una tablita como esta y nada más:

```
base_datos      juego_caracteres        cotejamiento
smart_campus    utf8mb4                 utf8mb4_unicode_ci
```

> **En PowerShell el `<` no funciona.** Si insistes en usar PowerShell, el comando es:
> `Get-Content sql\00_crear_bd_y_usuarios.sql | C:\xampp\mysql\bin\mysql.exe -u root -p`
> Por eso recomiendo CMD.

**Alternativa sin terminal:** abre phpMyAdmin → pestaña **SQL** → pega todo el contenido del
archivo → **Continuar**.

### 3.3 Comprobación

Verifica que el usuario de la aplicación puede entrar **y que solo ve su base de datos**:

```cmd
C:\xampp\mysql\bin\mysql.exe -u sc_app -p smart_campus
```

Dentro del prompt:

```sql
SHOW DATABASES;
```

Debe listar `smart_campus` (y quizá `information_schema`), **pero no** `mysql` ni las demás. Si ves
la base `mysql` ahí, los permisos quedaron mal y hay que revisar el script.

Ahora comprueba que **no** puede hacer daño:

```sql
DROP DATABASE smart_campus;
```

Debe responder `ERROR 1044 (42000): Access denied`. Perfecto: eso es el principio de mínimo
privilegio funcionando. Escribe `EXIT;`.

> Esa prueba es la que te confirma que una inyección SQL futura no podrá borrar la base.

---

## PASO 4 — Instalar dependencias y configurar

### 4.1 Instalar los paquetes

```cmd
cd C:\proyectos\smart-campus-ia
npm install
```

Tarda entre 30 segundos y 2 minutos. Al final debe decir algo como:

```
added 137 packages in 8s
```

**Si falla** con errores de red (`ETIMEDOUT`, `ECONNRESET`), suele ser el proxy o el antivirus.
Prueba `npm config set registry https://registry.npmjs.org/` y repite.

### 4.2 Crear el archivo .env

```cmd
copy .env.example .env
```

> En PowerShell: `Copy-Item .env.example .env`
>
> **No intentes crearlo desde el Explorador de Windows.** Un archivo que empieza con punto y no
> tiene nombre antes de la extensión es un dolor de cabeza en el Explorador. Usa el comando.

### 4.3 Generar los secretos JWT

Ejecuta este comando **dos veces**. Cada ejecución da un valor distinto: uno es para el token de
acceso y otro para el de refresco.

```cmd
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copia ambos resultados a un bloc de notas temporal. Son cadenas largas de 96 caracteres.

> **Tienen que ser diferentes entre sí.** Si usas el mismo secreto para ambos, un token de refresco
> robado sirve como token de acceso y se anula el propósito de tener dos. El verificador te lo
> reclama si los pones iguales.

### 4.4 Rellenar el .env

Abre `.env` en VS Code y edita estas líneas:

```ini
DB_PASSWORD=laClaveDeSc_app

JWT_ACCESS_SECRET=el_primer_valor_generado
JWT_REFRESH_SECRET=el_segundo_valor_generado

MYSQLDUMP_PATH=C:/xampp/mysql/bin/mysqldump.exe
```

Y si descargaste el modelo liviano de Ollama:

```ini
OLLAMA_MODEL=qwen2.5:7b
```

**Cuatro errores clásicos al editar un `.env`:**

1. **Nada de comillas.** Se escribe `DB_PASSWORD=abc123`, no `DB_PASSWORD="abc123"`. Las comillas
   pasarían a formar parte de la contraseña.
2. **Nada de espacios alrededor del `=`**. `DB_PASSWORD = abc` está mal.
3. **Cuidado con el espacio invisible al final** de la línea. Si copias y pegas, revisa.
4. **Barras normales `/` en las rutas**, no `\`. La barra invertida es un carácter de escape.

> El `.env` contiene las llaves de todo el sistema. Está en el `.gitignore` a propósito: nunca lo
> subas a Git ni lo mandes por WhatsApp.

---

## PASO 5 — Verificar el entorno

```cmd
npm run verificar
```

Este es el momento de la verdad. Debe verse así:

```
=== Verificacion de entorno: Smart Campus IA ===

1. Node.js
----------
  OK   Version de Node.js v24.14.0

2. Configuracion (.env)
-----------------------
  OK   Archivo .env encontrado
  OK   Secretos configurados
  OK   Zona horaria America/Tegucigalpa

3. Carpetas de trabajo
----------------------
  OK   Escritura permitida ./storage/uploads
  OK   Escritura permitida ./storage/backups
  OK   Escritura permitida ./storage/logs

4. Base de datos (MariaDB / XAMPP)
----------------------------------
  OK   Conexion establecida smart_campus @ MySQL/MariaDB 10.4.32-MariaDB
 AVISO La base de datos esta vacia
        -> Normal en Fase 0. El esquema se crea en la Fase 1.
  OK   Juego de caracteres utf8mb4 / utf8mb4_unicode_ci

5. IA local (Ollama)
--------------------
  OK   Ollama responde http://127.0.0.1:11434
  OK   Modelo disponible llama3.1:8b

6. HTTPS
--------
 AVISO HTTPS deshabilitado
        -> Correcto en desarrollo.

7. Respaldos
------------
  OK   Ruta de mysqldump C:/xampp/mysql/bin/mysqldump.exe

==================================================
Entorno listo. 2 aviso(s) sin bloqueo.
==================================================
```

**Los avisos amarillos están bien.** Los que no puedes dejar pasar son los rojos.

### Diccionario de fallas

| Lo que dice | Qué pasó | Cómo se arregla |
|---|---|---|
| `No existe el archivo .env` | Se saltó el paso 4.2 | `copy .env.example .env` |
| `JWT_ACCESS_SECRET conserva el valor de ejemplo` | No reemplazaste el texto `CAMBIA_...` | Paso 4.3 y 4.4 |
| `JWT_ACCESS_SECRET debe tener al menos 32 caracteres` | Pusiste algo corto inventado | Genera uno real con el comando |
| Los dos secretos son iguales | Pegaste el mismo valor dos veces | Ejecuta el comando otra vez |
| `ECONNREFUSED 127.0.0.1:3306` | MySQL está apagado | Start MySQL en el panel de XAMPP |
| `Access denied for user 'sc_app'` | `DB_PASSWORD` no coincide con la del paso 3.1 | Compara ambos archivos, carácter por carácter |
| `Unknown database 'smart_campus'` | El script SQL no se ejecutó | Repite el paso 3.2 |
| `Juego de caracteres latin1` | La base se creó sin utf8mb4 | Bórrala en phpMyAdmin y repite el paso 3 |
| `No se puede escribir en ./storage/...` | Permisos, o el proyecto está en `Program Files` | Muévelo a `C:\proyectos\` |

> **Repite `npm run verificar` después de cada arreglo.** Solo avanza cuando el resumen final diga
> `Entorno listo` en verde.

---

## PASO 6 — Arrancar el sistema

```cmd
npm run dev
```

Debe imprimir:

```
[10:23:41] INFO: Base de datos conectada: smart_campus (MySQL/MariaDB 10.4.32-MariaDB)
[10:23:41] INFO: Smart Campus IA escuchando en http://localhost:3000
[10:23:41] INFO: Estado del sistema: http://localhost:3000/api/salud
```

La terminal se queda "colgada" mostrando eso. **Es correcto**: el servidor está corriendo y espera
peticiones. No la cierres.

### 6.1 Comprobar en el navegador

Abre <http://localhost:3000>. Debes ver la página de estado con:

- **Servidor Node.js / Express** → verde, `en línea (development)`
- **Base de datos MariaDB** → verde, `conectada — smart_campus`
- **IA local (Ollama)** → verde si la instalaste, gris si no (ambas cosas están bien)

### 6.2 Comprobar el endpoint directo

Abre <http://localhost:3000/api/salud>. Debe devolver un JSON parecido a:

```json
{
  "ok": true,
  "servicio": "Smart Campus IA",
  "entorno": "development",
  "zonaHoraria": "America/Tegucigalpa",
  "componentes": {
    "baseDatos": { "ok": true, "bd": "smart_campus" },
    "ia": { "disponible": true, "modeloDescargado": true }
  }
}
```

### 6.3 La comprobación más importante: que sea realmente local

Este es el requisito innegociable del proyecto y conviene verificarlo desde el primer día, cuando
todavía es fácil.

1. En la página de estado, presiona **F12**.
2. Ve a la pestaña **Network** (o **Red**).
3. Recarga con `Ctrl + Shift + R`.
4. Mira la columna de dominio de cada petición.

**Todas** deben apuntar a `localhost`. Si aparece `fonts.googleapis.com`, `cdn.jsdelivr.net` o
cualquier otro dominio, algo se coló y hay que quitarlo.

La política de seguridad de contenido configurada en `src/app.js` ya bloquea esto por diseño: el
navegador rechazará cualquier script, estilo o fuente externa aunque alguien la agregue por
descuido. Si te aparece un error rojo en la consola mencionando "Content Security Policy", el
sistema está haciendo su trabajo.

### 6.4 Detener el servidor

En la terminal, `Ctrl + C`. Verás `Cierre limpio completado.`

---

## Rutina diaria de trabajo

Cada vez que te sientes a trabajar en el proyecto:

1. Abrir **XAMPP Control Panel** → **Start** en MySQL.
2. Abrir CMD, `cd C:\proyectos\smart-campus-ia`.
3. `npm run dev`.

Nada más. Ollama arranca solo con Windows.

Con `npm run dev` no hace falta reiniciar cuando edites código: Node detecta los cambios y se
recarga solo.

---

## Checklist final del Paso 0

Marca cada uno antes de pasar a la Fase 1:

- [ ] `node -v` responde v24 o superior
- [ ] MySQL arranca en el panel de XAMPP y muestra puerto 3306
- [ ] `mysql.exe -u root` **sin** contraseña es rechazado
- [ ] phpMyAdmin abre correctamente con la nueva contraseña
- [ ] `sc_app` puede entrar a `smart_campus` pero **no** puede hacer `DROP DATABASE`
- [ ] `.env` existe, con contraseña real y dos secretos JWT distintos
- [ ] `npm run verificar` termina en verde con `Entorno listo`
- [ ] `http://localhost:3000` muestra servidor y base de datos en verde
- [ ] La pestaña Network no muestra ni un solo dominio externo
- [ ] Las tres contraseñas están anotadas en un lugar seguro
- [ ] `npm run backup` genera un `.sql` en `storage\backups\`

---

## Apéndice — Linux / macOS

Las diferencias son pocas:

| Windows | Linux / macOS |
|---|---|
| `copy .env.example .env` | `cp .env.example .env` |
| `C:\xampp\mysql\bin\mysql.exe` | `mysql` (si está en el PATH) |
| `MYSQLDUMP_PATH=C:/xampp/...` | `MYSQLDUMP_PATH=/usr/bin/mysqldump` |
| XAMPP Control Panel | `sudo /opt/lampp/lampp start` |

En Linux tiene más sentido instalar MariaDB directamente (`sudo apt install mariadb-server`) y
phpMyAdmin aparte, en vez de XAMPP. El resto del proyecto es idéntico.

En macOS con Homebrew: `brew install node mariadb ollama`.
