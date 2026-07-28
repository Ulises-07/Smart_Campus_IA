# Fase 7 — Tableros, auditoría visible y documentos PDF

Estado: **completa y probada**. 16 pruebas de extremo a extremo en verde,
incluyendo la generación real de PDF. Con las anteriores van **172 pruebas
automatizadas**.

---

## 1. Cómo probarla

Hay una dependencia nueva (`pdfkit`), así que toca instalar. No hay cambios de
base de datos.

```cmd
npm install
npm run probar:reportes
npm run dev
```

En el menú aparecen dos pantallas nuevas: **Tablero** (para todos, cada quien ve
el suyo) y **Auditoría** (solo administrador). En el cuadro de notas de cada
clase hay ahora un botón **Boleta** por alumno, y al registrar un pago se abre
el **recibo en PDF**.

---

## 2. Tableros: cada rol ve el suyo

No es una pantalla con permisos encima; son **tres tableros distintos**, con
consultas distintas, porque cada rol necesita ver cosas distintas y —sobre
todo— no debe ver las del otro.

| Rol | Qué muestra su tablero |
|---|---|
| ADMIN / ASESOR | Matrícula, **finanzas** (recaudado, saldo, morosos), rendimiento global, asistencia, alumnos por grado |
| MAESTRO | Solo sus clases: alumnos, promedio y reprobados por clase. **Nada financiero** |
| ALUMNO | Su propio promedio, materias aprobadas/reprobadas, su saldo |

Probado: el tablero del maestro **no trae el bloque de finanzas** — no es que se
oculte en la interfaz, es que la consulta no lo incluye. Un maestro no tiene por
qué conocer cuánto recauda el colegio.

---

## 3. Auditoría visible: mirar sin poder tocar

Desde la Fase 1, todo lo importante queda registrado en una tabla de auditoría
inmutable. Hasta ahora solo se podía consultar entrando a la base de datos.
Ahora el administrador la ve desde el sistema, con filtros por acción, entidad y
fecha, y puede abrir cada evento para ver **qué cambió exactamente** (el valor
anterior y el nuevo de una nota, un pago, etc.).

La palabra clave es **solo lectura**. El servicio de auditoría no tiene ninguna
función de escritura ni de borrado, y no por descuido:

- Los **triggers** de la Fase 1 bloquean cualquier `UPDATE` o `DELETE` sobre la
  tabla, incluso ejecutado por root.
- Los **permisos** del usuario `sc_app` no incluyen borrado sobre esa tabla.

Probado en el bloque 2: la propia aplicación, con su usuario de base de datos,
**no puede borrar un registro de auditoría** — la operación falla. Es la
garantía de que el rastro no se puede alterar ni siquiera desde adentro.

El visor muestra además dos cifras de vigilancia: eventos de hoy y **logins
fallidos en las últimas 24 horas**. Un pico de logins fallidos es la señal más
temprana de que alguien está probando contraseñas.

---

## 4. Boletas y recibos en PDF

La parte más visible de la fase. Se generan con `pdfkit`: **JavaScript puro, sin
navegador ni dependencias nativas**. Esto importa en un sistema que corre
offline en la máquina de un colegio — no se puede depender de Chromium ni de
fuentes descargadas de internet. Las fuentes base ya traen los acentos y la ñ.

### La boleta de calificaciones

Un documento A4 con el encabezado del colegio, los datos del alumno, la tabla de
notas por asignatura (en verde si aprobó, rojo si reprobó) y el promedio del
periodo. Se genera en el momento, con las notas vigentes.

### El recibo de pago

Un comprobante con el número de recibo correlativo, el concepto, el método y el
total. Si el pago fue anulado, lo dice en grande. Al registrar un pago, se abre
solo, listo para imprimir.

### Quién puede descargar qué

Los PDF no son archivos guardados: se generan al vuelo y **pasan por el mismo
control de permisos que el resto del sistema**.

| Documento | Quién puede bajarlo |
|---|---|
| Boleta | admin, asesor, el maestro del alumno, el propio alumno |
| Recibo | admin, asesor, el propio alumno (solo el suyo) |

Probado: un alumno baja **su** boleta pero recibe 404 en la de otro; un maestro
no puede bajar recibos de pago (no es asunto suyo).

---

## 5. Endpoints nuevos

| Método | Ruta | Quién |
|---|---|---|
| GET | `/api/tablero` | todos (cada rol el suyo) |
| GET | `/api/auditoria` | ADMIN |
| GET | `/api/auditoria/:id` | ADMIN |
| GET | `/api/alumnos/:id/boleta?periodoId=` | según permiso sobre el alumno |
| GET | `/api/pagos/:id/recibo-pdf` | caja; el alumno solo el suyo |

---

## 6. Qué comprueban las 16 pruebas

| Bloque | Se comprueba |
|---|---|
| Tablero por rol | Admin ve finanzas; maestro NO; alumno ve lo suyo |
| Auditoría | Solo admin accede; maestro y alumno reciben 403; el filtro funciona |
| **Inmutabilidad** | La aplicación no puede borrar un registro de auditoría |
| Boleta PDF | Se genera un PDF válido; el alumno baja la suya, no la de otro (404) |
| Recibo PDF | Se genera; un maestro no puede bajarlo |

---

## 7. Sobre los colores del logo

Los documentos PDF y los tableros usan una **paleta central**. En el PDF está en
`src/services/pdf.service.js` (constante `COLOR`), y en las pantallas en
`public/css/theme.css`. Cuando me pases los HEX del logo del colegio, se cambian
en esos dos lugares y **todo** —boletas, recibos, tableros, pantallas— toma la
identidad del colegio. Es el momento ideal para hacerlo, porque estos son los
documentos que salen impresos y llegan a las familias.

---

## 8. Limitaciones conocidas

- **La boleta es por periodo, no acumulativa anual.** Muestra las notas de un
  parcial. Una boleta de fin de año con los cuatro parciales y la nota final
  anual es una variante fácil de agregar cuando el año lo requiera.
- **El PDF no lleva logo en imagen todavía**, solo el nombre del colegio en
  texto. Cuando tengas el archivo del logo (PNG), se inserta en el encabezado
  en una línea.
- **No hay firma digital ni código QR de verificación.** El recibo dice
  claramente que es un comprobante interno, no fiscal. Si el colegio necesitara
  validez tributaria, eso es un módulo aparte que depende de requisitos de la
  SAR.

---

## 9. Lo que sigue

Queda la **Fase 8 — Videovigilancia**, que es distinta a todo lo anterior y
tiene un requisito que va **antes** del código: definir el **consentimiento de
los padres** y la **política de retención** de las grabaciones. Grabar a menores
sin esas dos cosas resueltas no es un problema técnico, es uno legal y ético.
Cuando lleguemos ahí, lo primero será hablar de eso, no de cámaras.

Y sigue en pie lo de los **colores del logo**: la Fase 7 los aprovecha de
inmediato en las boletas y los tableros.
