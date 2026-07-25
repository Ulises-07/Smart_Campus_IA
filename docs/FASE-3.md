# Fase 3 — Matrícula, clases y horarios

Estado: **completa y probada**. 33 pruebas de extremo a extremo en verde,
verificadas contra un servidor HTTP real y una base con 491 alumnos.

---

## 1. Cómo probarla

No hay migraciones de base de datos en esta fase: el esquema de la Fase 1 ya
tenía todo lo necesario. Solo reemplaza los archivos y arranca.

```cmd
npm install
npm run probar:matricula
npm run dev
```

Abre <http://localhost:3000> y entra como `admin`. Verás tres pantallas nuevas
en la barra superior: **Inicio**, **Alumnos** y **Horarios**.

> Detalle de la Fase 2 que aparecerá aquí: la contraseña no puede contener tu
> nombre de usuario. `AdminSeguro2026` es rechazada para el usuario `admin`.
> No es un fallo, es la regla funcionando.

---

## 2. El orden de las cosas

Esto importa y no es obvio. Para que la inscripción automática funcione, tiene
que existir en qué inscribir:

```
1. Sección          →  7º "A" del año lectivo activo
2. Clases           →  Matemáticas, Español... asignadas a esa sección
3. Alumno           →  ficha personal con su encargado
4. Matrícula        →  el alumno entra a la sección
                       ↳ queda inscrito automáticamente en TODAS sus clases
5. Horario          →  cada clase se coloca en un día y bloque
```

Si matriculas antes de crear las clases, el alumno queda matriculado pero sin
materias. Por eso, cuando se crea una clase nueva en una sección que ya tiene
alumnos, **el sistema los inscribe también**. De lo contrario quedarían fuera
de una materia sin que nadie lo notara hasta que el maestro pasara lista.

---

## 3. Decisiones que conviene entender

### El traslado no arrastra las notas

Cuando un alumno cambia de sección a mitad de parcial, sus notas pertenecen a
las clases de la sección **anterior**. El sistema:

- marca las inscripciones viejas como `retirada` — **no las borra**;
- crea inscripciones nuevas en la sección destino, que empiezan sin notas;
- avisa cuántas notas quedan atrás antes de que se confirme.

```
El alumno tenía 1 nota(s) en su sección anterior. Quedan en su expediente
histórico, pero NO se trasladan a las clases nuevas.
```

Esto es correcto: las notas son de una clase concreta con un maestro concreto,
y trasladarlas falsearía el expediente. Pero **quien autoriza el traslado tiene
que saberlo de antemano**, y por eso el aviso aparece en pantalla y en la
respuesta de la API.

La regla que ordena todo el módulo: **nada se borra**. Un alumno retirado
conserva su historial completo. Un expediente académico incompleto es peor que
uno con datos que ya no aplican.

### La promoción propone; la persona decide

`/api/promocion/vista-previa` calcula, para cada alumno, si aprobó todas sus
clases, y sugiere sección destino. Clasifica en tres:

| Situación | Significado |
|---|---|
| `promueve` | Aprobó todas las clases con nota registrada |
| `repite` | Tiene al menos una clase reprobada |
| `sin_datos` | Faltan notas en una o más clases |

`/api/promocion/ejecutar` recibe una lista revisada. **No promueve solo.**

Un sistema que promueve automáticamente con notas incompletas produce
expedientes falsos que después nadie sabe corregir. En un colegio, esa decisión
la firma una persona.

### Los conflictos de horario se explican, no se codifican

La base de datos rechaza los solapamientos desde la Fase 1. El problema es que
lo hace así:

```
Duplicate entry '1-3-2-4' for key 'uk_horario_aula'
```

Correcto e inútil para quien arma el horario. Esta fase agrega
`POST /api/horarios/verificar`, que consulta antes de guardar y responde:

```
El aula A-101 está ocupada el Lunes a las 07:00 por Administración de 7º "Y".
La sección 7º "Y" ya tiene Administración el Lunes a las 07:00.
```

La interfaz va un paso más allá: al hacer clic en una casilla libre, el selector
de aulas **solo ofrece las que están realmente disponibles** en ese hueco. Así
la persona no puede elegir algo que fallará.

La restricción de la base sigue ahí como última línea de defensa. Las dos capas
son necesarias: la de la interfaz es para que el trabajo sea llevadero, la de la
base es para que sea imposible equivocarse.

### Los filtros por rol van en SQL, no en JavaScript

`alumno.service.js` construye un fragmento `WHERE` distinto según quién
pregunta. La diferencia con filtrar después de traer los datos no es de estilo:
si la base ya entregó las filas, basta un descuido en el serializador —o un
`console.log` en desarrollo— para que se escapen.

| Rol | Alumnos que puede ver |
|---|---|
| ADMIN, ASESOR | todos |
| MAESTRO | solo los inscritos en alguna de sus clases |
| ALUMNO | solo a sí mismo |

Verificado en la prueba: el listado de un alumno devuelve exactamente un
registro, el suyo.

---

## 4. Endpoints nuevos

### Contexto y catálogos

| Método | Ruta | Quién |
|---|---|---|
| GET | `/api/contexto` | autenticado |
| GET | `/api/mis-clases` | autenticado (filtra por rol) |

### Alumnos

| Método | Ruta | Quién |
|---|---|---|
| GET | `/api/alumnos` | autenticado (filtrado por rol) |
| GET | `/api/alumnos/:id` | según permiso de fila → **404** si no |
| POST | `/api/alumnos` | ADMIN, ASESOR |
| PATCH | `/api/alumnos/:id` | ADMIN, ASESOR |
| GET | `/api/alumnos/buscar/identidad/:identidad` | ADMIN, ASESOR |

### Matrícula

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/matriculas` | Matricula e inscribe en todas las clases |
| POST | `/api/matriculas/:id/trasladar` | Cambia de sección avisando de las notas |
| POST | `/api/matriculas/:id/retirar` | Retira conservando el historial |
| GET | `/api/secciones/:id/alumnos` | Lista de la sección |

### Secciones y clases

| Método | Ruta | Quién |
|---|---|---|
| POST | `/api/secciones` | ADMIN |
| GET | `/api/secciones/:id/clases` | autenticado |
| POST | `/api/secciones/:id/clases` | ADMIN — crea e inscribe a los matriculados |
| PATCH | `/api/clases/:id/maestro` | ADMIN |

### Horarios

| Método | Ruta | Quién |
|---|---|---|
| GET | `/api/horarios` | autenticado — el maestro ve el suyo por defecto |
| POST | `/api/horarios/verificar` | ADMIN — consulta sin guardar |
| GET | `/api/horarios/disponibilidad` | ADMIN — huecos libres de una clase |
| GET | `/api/horarios/aulas-libres` | ADMIN |
| POST | `/api/horarios` | ADMIN |
| DELETE | `/api/horarios/:id` | ADMIN |

### Promoción

| Método | Ruta | Quién |
|---|---|---|
| GET | `/api/promocion/vista-previa` | ADMIN |
| POST | `/api/promocion/ejecutar` | ADMIN |

---

## 5. Qué comprueban las 33 pruebas

| Bloque | Se comprueba |
|---|---|
| Secciones y clases | Sección duplicada rechazada; clases creadas correctamente |
| Matrícula | Inscripción automática en las 3 clases; doble matrícula rechazada; cupo respetado; clase nueva inscribe a los ya matriculados |
| Traslado | Avisa de las notas; la nota **no** se borra; inscripciones viejas quedan `retirada` |
| Horarios | Choque de sección y de aula detectados con mensaje legible; disponibilidad sugiere huecos |
| **Permisos por fila** | Un alumno ve lo suyo y recibe **404** en el expediente de otro; su listado se contiene a sí mismo; no puede crear ni matricular; cada maestro ve solo a sus estudiantes; el maestro no toca horarios |
| Promoción | Vista previa clasifica a todos; solo el administrador accede |
| Auditoría | Las matrículas quedan registradas **con su responsable** |

El bloque de permisos es el que importa. Es la prueba de que cambiar el número
en `/api/alumnos/451` por `/452` no sirve de nada.

---

## 6. Limitaciones conocidas

- **La promoción necesita las notas finales de la Fase 4.** Ahora mismo casi
  todos los alumnos salen como `sin_datos`, porque `nota_periodo` se llena al
  cerrar cada parcial y eso todavía no existe. El mecanismo funciona; le faltan
  los datos.
- **No hay generador automático de horarios.** El sistema valida y sugiere
  huecos libres, pero el horario se arma a mano. Un generador automático que
  respete disponibilidad de maestros es un problema de optimización que
  merecería su propia fase.
- **La edición de encargados** se hace al crear el alumno. Modificar un
  encargado existente todavía no tiene interfaz.

---

## 7. Lo que sigue

**Fase 4 — Notas, asistencia y comportamiento.** Es el corazón académico:

- ponderación por clase y periodo (Tareas 30 / Proyectos 30 / Exámenes 40),
- digitación de notas con la fórmula acordada y redondeo a dos decimales,
- cálculo y bloqueo de `nota_periodo` al cerrar el parcial,
- pase de lista con el estado de asistencia,
- alerta automática al superar el umbral de inasistencia,
- registro de incidencias de comportamiento,
- boletas imprimibles.

Ahí es donde `puedeVerClase()` empieza a trabajar: un maestro solo debe poder
digitar notas de las clases que imparte.

Sigue pendiente lo mismo desde la Fase 0: **los colores del logo institucional**
en HEX, para reemplazar la paleta provisional de `theme.css`.
