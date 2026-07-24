# Fase 1 — Modelo de datos

Estado: **completa y probada** contra MariaDB. 34 tablas, 60 claves foráneas,
22 triggers, 23 pruebas de aceptación en verde.

---

## 1. Cómo instalar esta fase

Con MySQL corriendo, desde la carpeta del proyecto y en **CMD** (no PowerShell):

```cmd
cd C:\proyectos\smart-campus-ia
C:\xampp\mysql\bin\mysql.exe -u root -p smart_campus < sql\01_esquema.sql
C:\xampp\mysql\bin\mysql.exe -u root -p smart_campus < sql\02_triggers.sql
C:\xampp\mysql\bin\mysql.exe -u root -p smart_campus < sql\03_datos_semilla.sql
C:\xampp\mysql\bin\mysql.exe -u root -p               < sql\04_permisos_auditoria.sql
```

El orden importa: los triggers necesitan las tablas, y los permisos necesitan
que la tabla `auditoria` exista.

Luego comprueba que la base cumple los criterios de aceptación:

```cmd
npm run probar:esquema
```

Y genera un colegio de demostración para poder ver algo en pantalla:

```cmd
npm run demo
```

> `npm run demo` **borra** alumnos, notas, asistencia y pagos anteriores.
> Los catálogos y la configuración se conservan. Pide confirmación.

Credenciales tras la carga:

| Usuario | Contraseña | Rol |
|---|---|---|
| `admin` | `Admin.2026.Cambiar` | Administrador |
| `asesor` | `Demo.2026.Cambiar` | Asesor de matrícula |
| ver tabla `usuario` | `Demo.2026.Cambiar` | Maestros |

Todas obligan a cambiar la contraseña en el primer ingreso (`debe_cambiar_password = 1`).

---

## 2. La fórmula de la nota

El documento original definía el umbral del 70 % pero no cómo se llega a la
nota. Esta es la regla implementada:

```
Para cada tipo de evaluación con ponderación (Tareas, Proyectos, Exámenes):

    aporte(tipo) = ( Σ puntajes obtenidos / Σ puntajes máximos ) × porcentaje(tipo)

    nota_base = Σ aporte(tipo)

    nota_final = MIN(100, nota_base + puntos_extra)

    aprobado = nota_final >= notas.minima_aprobacion
```

Ponderación por defecto, según lo acordado: **Tareas 30 %, Proyectos 30 %,
Exámenes 40 %**. Está en la tabla `ponderacion`, por clase y por periodo, así
que el administrador puede cambiarla donde haga falta sin tocar código.

### El redondeo, y por qué no es al entero

Acordamos que hubiera redondeo. Lo implementé **a dos decimales**, no a entero,
y la razón es que el redondeo a entero contradice un criterio de aceptación de
tu propio documento:

> *"Una nota final de 69.9 marca reprobado; 70.0 marca aprobado."*

Si se redondeara al entero más cercano, 69.9 pasaría a 70 y **aprobaría**. Las
dos reglas no pueden convivir. Con dos decimales, 69.9 se queda en 69.90 y
reprueba: se cumplen ambas.

No lo dejé quemado en el código. Vive en `config_sistema`:

| Clave | Valor por defecto | Efecto |
|---|---|---|
| `notas.minima_aprobacion` | `70.00` | Umbral de aprobación |
| `notas.modo_redondeo` | `DECIMALES_2` | 69.9 reprueba |
| | `ENTERO` | 69.5 aprueba |
| `notas.tope_maximo` | `100.00` | Los puntos extra nunca lo superan |

Si la dirección del colegio decide otra cosa, se cambia un registro. Pero
conviene que **lo decidan ellos por escrito**: es la diferencia entre aprobar y
reprobar a un menor, y no es una decisión de ingeniería.

### La nota congela la regla vigente

`nota_periodo` guarda `nota_minima_aplicada` junto a cada nota consolidada.

Suena redundante, pero no lo es: si dentro de dos años el colegio sube la nota
mínima a 75, las boletas de 2026 deben seguir mostrando quién aprobó **con la
regla de 2026**. Sin esa columna, un cambio de configuración reescribiría
retroactivamente la historia académica de todos los alumnos.

---

## 3. Decisiones del modelo que conviene entender

### Año lectivo en todo

Toda tabla académica cuelga de `anio_lectivo_id`. Era el punto crítico n.º 2 de
la revisión de ingeniería: sin esta dimensión, el sistema funciona el primer año
y colapsa el segundo, porque las notas se mezclan y no hay forma de promover
alumnos de grado.

### Persona, usuario y alumno son tres cosas distintas

- `persona` — los datos personales.
- `usuario` — las credenciales de acceso.
- `alumno` — la condición de estudiante.

Un encargado existe como `persona` sin tener `usuario`: no accede al sistema
pero hay que poder contactarlo. Un maestro que pasa a coordinador cambia de
`rol_id` sin duplicar sus datos. Y el día que un exalumno regrese como docente,
su `persona` ya está ahí.

### El choque de horario lo rechaza la base, no el backend

`horario` repite `maestro_id`, `seccion_id` y `anio_lectivo_id` aunque se
puedan deducir de `clase_id`. Es deliberado: sin esas columnas no se pueden
crear los tres índices únicos que hacen imposible el solapamiento.

```
uk_horario_seccion  (anio, seccion, dia, bloque)
uk_horario_aula     (anio, aula,    dia, bloque)
uk_horario_maestro  (anio, maestro, dia, bloque)
```

Dos triggers mantienen esas copias sincronizadas con la clase, para que nadie
pueda desalinearlas a mano.

La prueba de que sirve: al generar los datos de demostración, la base **rechazó
96 intentos de horario** que se solapaban. Ninguna línea de código de aplicación
participó en esa validación.

### La auditoría tiene dos candados independientes

1. **Permisos de MySQL** — `sc_app` solo tiene `SELECT` e `INSERT` sobre
   `auditoria`. Verificado: un `DELETE` responde *command denied*.
2. **Triggers** — bloquean `UPDATE` y `DELETE` incluso conectándose como root
   desde phpMyAdmin.

Y la tabla **no tiene claves foráneas** a propósito. Si algún día se borra un
usuario, su rastro debe sobrevivir. Un registro de auditoría que desaparece
junto con el responsable no sirve de nada.

Para que los triggers sepan quién actúa, el backend declara el contexto al
inicio de cada transacción que escribe datos sensibles:

```sql
SET @app_usuario_id = 42, @app_rol = 'maestro', @app_ip = '192.168.1.20';
```

Si no se declara, la auditoría se escribe igual con usuario `NULL`. Intencional:
mejor un registro incompleto que ningún registro.

### El campo `identidad` no está cifrado todavía

El requisito A.9 pide cifrado en reposo de campos sensibles de menores. En esta
fase `persona.identidad` es texto plano, por una razón práctica: mientras se
construye el sistema hay que poder inspeccionar la base en phpMyAdmin.

**Esto hay que resolverlo en la Fase 2**, no dejarlo pasar. El plan es cifrado a
nivel de aplicación (AES-256-GCM con clave en `.env`) más una columna
`identidad_hash` para poder buscar sin descifrar. Lo dejo escrito aquí porque
migrar una columna única cifrada con datos reales adentro es incómodo, y es
mejor hacerlo antes de que haya 500 alumnos cargados.

---

## 4. Qué comprueban las pruebas

`npm run probar:esquema` corre 23 pruebas dentro de una transacción que se
revierte al final, así que no deja basura en tu base.

| Área | Se comprueba que la base rechace |
|---|---|
| Horarios | choque de sección, de aula y de maestro |
| Estructura | grado duplicado, BTP sin carrera, quinto parcial |
| Matrícula | exceso de cupo, doble matrícula en el mismo año |
| Notas | puntaje sobre el máximo, negativo, duplicado, periodo cerrado |
| Auditoría | `UPDATE` y `DELETE`; y que un cambio de nota deje valor anterior y nuevo |

---

## 5. Lo que sigue

**Fase 2 — Autenticación y RBAC.** Ahí se implementa:

- login con bcrypt y bloqueo tras 5 intentos,
- JWT de vida corta + refresh token en cookie `httpOnly`,
- cambio obligatorio de contraseña en el primer ingreso,
- middleware de rol **y** de autorización a nivel de fila (el IDOR es el riesgo
  real: que un alumno cambie `/api/notas/123` por `/124`),
- el middleware que declara `@app_usuario_id` para la auditoría,
- cifrado del campo `identidad`.

Antes de arrancarla, dos cosas ayudarían:

1. **Los colores del logo** (primario, secundario y acento en HEX), para dejar
   de trabajar con la paleta provisional de `theme.css`.
2. **Confirmación por escrito de la dirección** sobre el redondeo. Ahora mismo
   el sistema hace lo correcto según tu documento, pero conviene que quede
   asentado quién tomó esa decisión.
