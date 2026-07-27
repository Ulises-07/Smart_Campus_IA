# Fase 5 — Repositorio didáctico y finanzas

Estado: **completa y probada**. 27 pruebas de extremo a extremo en verde. Con
las anteriores van **140 pruebas automatizadas**.

Esta fase junta dos módulos con riesgos opuestos: subir archivos (donde el
peligro es que entre algo hostil) y manejar dinero (donde el peligro es perder
un centavo o cobrar de más).

---

## 1. Cómo probarla

No hay migraciones. Reemplaza los archivos y arranca.

```cmd
npm install
npm run probar:finanzas
npm run dev
```

En la pantalla de una clase aparece una pestaña nueva, **Material**. En el menú
superior, **Finanzas** (para administración y asesoría; el alumno ve solo su
propia cuenta).

---

## 2. Material didáctico: cada archivo es hostil hasta probar lo contrario

Subir archivos es la vía de entrada favorita a un servidor. El módulo se
escribió con esa desconfianza. Las defensas, en orden:

### El tipo se valida por los BYTES REALES, no por la extensión

Alguien renombra `virus.exe` a `tarea.pdf` y lo sube. La comprobación lee los
primeros bytes del archivo y detecta su tipo real. Un ejecutable de Windows
empieza con `MZ`; da igual cómo se llame el archivo.

Probado contra el servidor real:

```
Subir un PDF real         → aceptado
Subir un .exe como .pdf   → RECHAZADO
  "El contenido del archivo (application/x-msdownload) no corresponde a un .pdf"
```

Formatos permitidos: PDF, Word, PowerPoint, Excel, JPG, PNG. Los documentos de
Office son ZIP por dentro, así que la validación acepta esa lectura.

### Los archivos viven FUERA del webroot

No están en `/public`. Si lo estuvieran, cualquiera con la URL los bajaría sin
pasar por el control de permisos. Viven en `storage/uploads/{claseId}/`, y solo
se sirven por un endpoint que antes verifica que el usuario puede ver la clase.

Probado: el archivo **no** es accesible como estático; un maestro ajeno recibe
**404** al intentar descargarlo; el alumno inscrito sí puede.

### El nombre en disco es aleatorio

El nombre que eligió el usuario se guarda solo para mostrarlo. En disco, el
archivo se llama con 16 bytes aleatorios. Así el nombre original nunca toca el
sistema de archivos, y no hay forma de hacer path traversal
(`../../algo`) ni de provocar colisiones.

### Baja lógica

Borrar un material lo marca inactivo antes de tocar el disco. Si el borrado
físico falla, el registro ya quedó fuera de circulación.

---

## 3. Finanzas: el dinero no admite aproximaciones

### Todo en DECIMAL, nunca en coma flotante

Los montos se guardan y calculan como `DECIMAL`, no como número de punto
flotante. Con flotantes, `0.1 + 0.2` no da exactamente `0.3`, y en dinero eso
es un centavo que aparece o desaparece. Probado: el estado de cuenta cuadra al
céntimo entre lo cargado, lo pagado y el saldo.

### Un pago nunca sobrepasa el saldo

Registrar un pago bloquea el cargo (`SELECT ... FOR UPDATE`) para que dos cajas
no cobren el mismo saldo a la vez, y rechaza cualquier monto que exceda lo que
se debe. Probado: un pago mayor al saldo es rechazado; un pago parcial deja el
saldo correcto (900 − 400 = 500).

### Los recibos son correlativos

Cada pago genera un número de recibo secuencial: `REC-2026-02792`. La interfaz
abre una ventana lista para imprimir tras cobrar.

### Anular no borra

Anular un pago lo marca anulado y devuelve el cargo a pendiente; el saldo se
recompone. **El pago no se borra**: queda el rastro contable de que existió y
de que se anuló, con su motivo. En finanzas, borrar es sospechoso; anular es
transparente.

### La mora es idempotente

`aplicar-mora` recalcula el 5% sobre los cargos vencidos (pasado el periodo de
gracia). Probado: 5% sobre 900 = 45.00, y **aplicarla dos veces no la
duplica**. Es seguro correrla cuantas veces haga falta.

Todos los parámetros —porcentaje de mora, días de gracia, prefijo de recibo,
moneda— viven en `config_sistema`.

---

## 4. Quién puede tocar el dinero

Un detalle que una prueba destapó: en la Fase 3, `puedeVerAlumno` permitía a un
maestro ver a los alumnos de su clase. Pero **las finanzas de un alumno no son
asunto del maestro**, aunque el alumno esté en su clase. Se creó una
verificación aparte, `puedeVerFinanzas`, que excluye al maestro.

| Rol | Estado de cuenta | Registrar pagos |
|---|---|---|
| ADMIN | todos | sí |
| ASESOR | todos | sí |
| MAESTRO | **no** (ni siquiera de sus alumnos) | no |
| ALUMNO | solo el suyo | no |

Probado: el maestro recibe 404 en el estado de cuenta de cualquier alumno, y no
puede registrar pagos; el alumno ve el suyo pero no puede cobrar.

---

## 5. Endpoints nuevos

### Material

| Método | Ruta | Quién |
|---|---|---|
| GET | `/api/clases/:id/material` | quien puede ver la clase |
| POST | `/api/clases/:id/material` | maestro de la clase, admin |
| GET | `/api/material/:id/descargar` | quien puede ver la clase → 404 si no |
| DELETE | `/api/material/:id` | maestro de la clase, admin |

### Finanzas

| Método | Ruta | Quién |
|---|---|---|
| GET | `/api/alumnos/:id/estado-cuenta` | admin, asesor, el propio alumno |
| POST | `/api/alumnos/:id/generar-cargos` | admin, asesor |
| POST | `/api/pagos` | admin, asesor |
| POST | `/api/pagos/:id/anular` | admin, asesor |
| GET | `/api/pagos/:id/recibo` | caja; el alumno solo el suyo |
| PATCH | `/api/cargos/:id/ajustar` | admin, asesor (descuento/exoneración) |
| POST | `/api/finanzas/aplicar-mora` | ADMIN |
| GET | `/api/finanzas/morosidad` | admin, asesor |

---

## 6. Qué comprueban las 27 pruebas

| Bloque | Se comprueba |
|---|---|
| Validación de archivos | PDF real aceptado; `.exe` disfrazado rechazado por su contenido; extensión no permitida rechazada |
| Acceso al material | No accesible como estático; descarga solo por endpoint con permiso; maestro ajeno recibe 404; alumno inscrito sí baja |
| Borrado | Maestro ajeno no borra; el dueño sí |
| Cargos | Matrícula + mensualidades generadas; estado de cuenta cuadra |
| Pagos | Recibo correlativo; pago sobre saldo rechazado; parcial deja saldo correcto |
| Anulación | El pago anulado no se borra; el saldo se recompone |
| Permisos | Maestro no ve ni cobra finanzas ajenas; alumno ve lo suyo, no cobra |
| Mora | 5% sobre vencidos; idempotente |
| Reportes y auditoría | Morosidad generada; pagos auditados |

---

## 7. Limitaciones conocidas

- **El recibo imprimible es HTML básico**, pensado para Ctrl+P. El recibo PDF
  con formato institucional entra en la Fase 7, junto con las boletas.
- **La conciliación bancaria** (cruzar pagos por transferencia con el estado de
  cuenta del banco) no existe: el sistema registra la referencia, pero no
  verifica contra el banco. Para un colegio pequeño con caja física es
  suficiente; conviene saber que la verificación es humana.
- **No hay facturación fiscal** (CAI, régimen de la SAR). El recibo es un
  comprobante interno, no un documento tributario. Si el colegio necesita
  facturar formalmente, eso es un módulo aparte que depende de requisitos
  legales que conviene revisar con un contador.

---

## 8. Lo que sigue

**Fase 6 — Chatbot con Ollama y analítica.** El asistente de IA local que
responde preguntas sobre el propio sistema, y las primeras notificaciones
internas (bandeja, sin correo) para avisos de inasistencia y pagos.

Sigue pendiente desde la Fase 0: **los colores del logo** en HEX. Como
acordamos, el diseño visual va al final, sobre pantallas ya estables — cada vez
falta menos para ese momento.
