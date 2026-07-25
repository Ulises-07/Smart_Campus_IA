# Fase 4 — Notas, asistencia y comportamiento

Estado: **completa y probada**. 30 pruebas de extremo a extremo en verde,
incluyendo la fórmula verificada con números a mano. Con las anteriores van
**113 pruebas automatizadas**.

---

## 1. Cómo probarla

No hay migraciones de base de datos. Reemplaza los archivos y arranca.

```cmd
npm install
npm run probar:notas
npm run dev
```

Entra como `admin` o como un maestro. En **Inicio**, haz clic en cualquier
clase de la tabla "Mis clases": se abre la pantalla de la clase con dos
pestañas, **Notas** y **Asistencia**.

---

## 2. La fórmula, verificada con números

Esto es lo más importante de la fase, así que lo dejo explícito. La prueba no
confía en el código: pone notas concretas y comprueba el resultado a mano.

```
Ponderación: Tareas 30% · Proyectos 30% · Exámenes 40%

Alumno con nota exacta de 69.90:
  Tareas:    20/20  = 100%  × 30  =  30.00
  Proyectos: 60/100 =  60%  × 30  =  18.00
  Exámenes:  54.75/100 = 54.75% × 40 = 21.90
                                    ─────────
                          nota base = 69.90
                          nota final = 69.90  →  REPRUEBA
```

Con la configuración por defecto (redondeo a dos decimales), **69.90 reprueba**.
Es el criterio de aceptación de tu documento, y ahora está garantizado por una
prueba que fallaría si alguien cambiara la lógica.

### Reglas que la fórmula respeta

| Regla | Comprobado |
|---|---|
| Ponderación debe sumar 100 | Una que suma 90 es rechazada |
| Evaluación sin nota cuenta como cero | Una tarea no entregada baja la nota de 100 a 85 |
| Puntos extra no superan el tope | 100 + 10 extra = 100.00, no 110 |
| El redondeo se aplica una sola vez, al final | 69.90 no se convierte en 70 |
| Puntaje sobre el máximo se rechaza | 25 en una evaluación de 20 es rechazado |

### El redondeo sigue siendo configurable

Vive en `config_sistema`, como desde la Fase 1:

| `notas.modo_redondeo` | Efecto |
|---|---|
| `DECIMALES_2` (por defecto) | 69.9 se queda en 69.90 y **reprueba** |
| `ENTERO` | 69.5 sube a 70 y **aprueba** |

Si la dirección del colegio decide cambiarlo, es un registro. Pero por defecto
el sistema hace lo que dice tu documento.

---

## 3. Decisiones que conviene entender

### La nota se recalcula sola

Cada vez que un maestro guarda notas, el sistema recalcula la consolidada del
periodo (`nota_periodo`) de los alumnos afectados. El alumno y la boleta ven
siempre el número vigente sin que nadie oprima "recalcular". Si esto fuera
manual, tarde o temprano alguien olvidaría hacerlo y la boleta mostraría una
nota vieja.

### Guardar notas es todo-o-nada

Al digitar una planilla completa, si **una** nota excede el máximo, se rechaza
**todo el lote**. Guardar la mitad dejaría la planilla en un estado
incoherente: unos alumnos con la nota nueva, otros con la vieja, sin forma de
saber cuáles. Verificado: un puntaje inválido no altera las notas ya correctas.

### Cerrar un periodo bloquea las notas

`POST /api/periodos/:id/cerrar` (solo administrador):

1. recalcula la consolidada de **todos** los alumnos en **todas** las clases
   del año —para capturar el estado final—;
2. marca todas las `nota_periodo` como `bloqueada`;
3. cambia el periodo a `cerrado`.

A partir de ahí, digitar una nota devuelve error. Corregir exige que el
administrador **reabra** el periodo.

### Reabrir desbloquea (un bug que la prueba encontró)

Al escribir la prueba descubrí que reabrir un periodo sin desbloquear las notas
las dejaba **congeladas para siempre**: el maestro no podía tocarlas y un nuevo
cierre chocaba contra el trigger de protección. Lo corregí:
`POST /api/periodos/:id/reabrir` levanta el candado de las notas antes de
reabrir. Es una acción sensible, solo del administrador, y queda en auditoría.

Este es justamente el valor de escribir las pruebas: el hueco no estaba en el
código que se ve, sino en la interacción entre el cierre, el trigger y la
reapertura. Sin la prueba, habría aparecido el día que un colegio necesitara
corregir una nota tras cerrar un parcial.

### La asistencia distingue tres cosas, no dos

No es solo "vino / no vino":

| Estado | Cuenta como inasistencia |
|---|---|
| Presente | no |
| Justificado | no |
| Tarde | según config (`asistencia.tarde_equivale`, por defecto 0.5) |
| Ausente | sí |

Una llegada tarde no es igual que una falta, pero tampoco es estar presente.
El umbral de alerta también es configurable (`asistencia.umbral_alerta`, 15%).
Cuando un alumno lo cruza, el sistema lo reporta al guardar el pase de lista.

---

## 4. La barrera central: un maestro solo toca lo suyo

Es el equivalente académico del IDOR de la Fase 3. Sin esta barrera, un maestro
autenticado podría cambiar `/api/clases/10/cuadro` por `/api/clases/11/cuadro`
y ver —o peor, modificar— las notas de una clase que no imparte.

Comprobado en la prueba, bloque 6:

| Intento de un maestro sobre una clase ajena | Resultado |
|---|---|
| Ver el cuadro de notas | **404** |
| Crear una evaluación | **404** |
| Modificar notas | **404** |
| Pasar lista | **404** |
| Registrar incidencia de un alumno ajeno | **404** |

Siempre **404**, nunca 403: un 403 confirmaría que la clase existe.

Y del lado del alumno (bloque 7): ve sus propias notas, recibe 404 en las de
otro, y no puede crear evaluaciones.

---

## 5. Endpoints nuevos

### Ponderación y evaluaciones

| Método | Ruta | Quién |
|---|---|---|
| GET/PUT | `/api/clases/:id/ponderacion` | maestro de la clase, admin |
| GET/POST | `/api/clases/:id/evaluaciones` | maestro de la clase, admin |
| DELETE | `/api/evaluaciones/:id` | maestro de la clase, admin |

### Notas

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/evaluaciones/:id/planilla` | Lista para digitar |
| PUT | `/api/evaluaciones/:id/notas` | Guarda el lote y recalcula |
| GET | `/api/clases/:id/cuadro` | Cuadro completo del periodo |
| GET | `/api/clases/:id/calcular/:alumnoId` | Desglose del cálculo |
| GET | `/api/alumnos/:id/notas` | Notas del alumno (según permiso) |

### Cierre

| Método | Ruta | Quién |
|---|---|---|
| POST | `/api/periodos/:id/cerrar` | ADMIN |
| POST | `/api/periodos/:id/reabrir` | ADMIN |

### Asistencia y comportamiento

| Método | Ruta | Quién |
|---|---|---|
| GET/PUT | `/api/clases/:id/asistencia` | maestro de la clase, admin |
| GET | `/api/clases/:id/asistencia/riesgo` | maestro de la clase, admin |
| GET | `/api/alumnos/:id/asistencia` | según permiso |
| GET/POST | `/api/incidencias` | ADMIN, MAESTRO (ASESOR solo lee) |
| PATCH | `/api/incidencias/:id` | ADMIN, MAESTRO |

---

## 6. Lo que hace la interfaz

La pantalla de clase (`clase.html`) tiene dos pestañas:

**Notas** — el cuadro completo: cada alumno, cada evaluación, y la nota final
en verde (aprobado) o rojo (reprobado). Un clic en una evaluación abre la
planilla de digitación, donde **Enter salta al siguiente alumno** para digitar
de corrido. La ponderación se edita en un diálogo que muestra la suma en vivo y
la marca en rojo si no da 100.

**Asistencia** — pase de lista con un radio por estado. Si ya se tomó ese día,
avisa y permite corregir. Al guardar, si algún alumno superó el umbral de
inasistencia, lo muestra.

---

## 7. Limitaciones conocidas

- **Las boletas imprimibles quedan para la Fase 7**, junto con los reportes y
  dashboards. La nota ya se calcula y se guarda; falta el PDF con formato.
- **La notificación al encargado** por inasistencia o incidencia se registra
  (`encargado_notificado`), pero el envío efectivo es la bandeja interna de la
  Fase 6. El sistema no manda correos, a propósito.
- **La edición de una nota individual** desde el cuadro se hace abriendo la
  planilla de su evaluación. No hay edición celda por celda directa en el
  cuadro; es una decisión para que cada cambio pase por la validación del lote.

---

## 8. Lo que sigue

**Fase 5 — Repositorio didáctico y finanzas.**

- subida de material por clase, con los archivos fuera del webroot y servidos
  solo tras verificar permiso (nunca por URL directa);
- validación de tipo real de archivo, no solo por extensión;
- estado de cuenta, cargos, pagos y recibos;
- cálculo de mora sobre saldos vencidos.

Sigue pendiente desde la Fase 0 lo mismo: **los colores del logo** en HEX. Como
acordamos, el diseño visual va al final, sobre pantallas ya estables.
