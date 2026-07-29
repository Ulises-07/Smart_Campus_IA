# Fase 8 — Videovigilancia con detección de objetos peligrosos

Estado: **completa y probada**. 32 pruebas de extremo a extremo en verde. Con
las anteriores van **204 pruebas automatizadas**. Con esto se cierra el plan de
ocho fases.

Esta fase tiene dos partes que se complementan:

1. **Detección en vivo** (lo central): conectar una cámara, verla desde el panel
   de administrador, detectar objetos peligrosos con inteligencia artificial
   local y notificar al instante.
2. **Gobernanza** (la base de confianza): consentimiento, retención y acceso
   auditado, en `docs/FASE-8-consentimiento.md` y `docs/FASE-8-retencion.md`.

---

## 1. Lo primero que debes saber: qué detecta y qué NO

La detección usa **COCO-SSD**, un modelo de IA libre que reconoce unos 80
objetos comunes. De esos, los que se marcan como peligrosos por defecto son:
**cuchillo, tijeras y bate de béisbol** (la botella viene incluida pero
desactivada).

**El modelo estándar NO detecta armas de fuego.** Reconocer pistolas necesita un
modelo especializado, entrenado con miles de imágenes de armas — eso es un
proyecto de machine learning aparte. Para una demostración universitaria, esto
no es una limitación: lo que se demuestra es el **pipeline completo** —cámara →
IA que detecta → alerta → notificación—, y mostrarle unas tijeras a la cámara
dispara exactamente la misma cadena que dispararía una pistola con un modelo
entrenado para ello.

El sistema está armado para que se pueda **cambiar el modelo** por uno
especializado en el futuro: la lista de objetos peligrosos es configurable y la
carga del modelo apunta a una URL local que se puede reemplazar.

---

## 2. Cómo probarla

Tres pasos, uno de ellos por única vez y con internet:

```cmd
:: 1. Descargar el modelo de IA (una sola vez, con internet)
npm run descargar:modelo

:: 2. Aplicar los scripts SQL nuevos
mysql -u root -p smart_campus < sql\08_videovigilancia.sql
mysql -u root -p smart_campus < sql\08b_video_triggers.sql
mysql -u root -p smart_campus < sql\08c_deteccion.sql

:: 3. Instalar y arrancar
npm install
npm run probar:video
npm run dev
```

Entra como administrador → **Videovigilancia** → pestaña **Monitoreo en vivo**.
Dale permiso a la cámara cuando el navegador lo pida, presiona **Iniciar
monitoreo**, y muéstrale a la cámara unas tijeras o un cuchillo de cocina. Verás
la caja roja sobre el objeto y saltará la alerta.

---

## 3. Cómo funciona la detección (y por qué así)

**La IA corre en el navegador del administrador, no en el servidor.** Esto es una
decisión deliberada con dos ventajas grandes:

- **Privacidad:** el video nunca sale de la computadora del administrador. El
  servidor no recibe imágenes; solo recibe el *aviso* de que algo se detectó
  (qué objeto, qué confianza, qué cámara). No hay video de menores viajando por
  la red ni almacenado en ningún lado.
- **Simplicidad y costo:** no hace falta un servidor potente procesando video en
  tiempo real. La detección aprovecha el navegador de la máquina que ya está
  mostrando el monitoreo.

El flujo, paso a paso:

1. El navegador enciende la cámara (con permiso del usuario).
2. TensorFlow.js analiza cada fotograma con el modelo COCO-SSD, todo local.
3. Si detecta un objeto de la lista vigilada con confianza ≥ 60%, dibuja una
   caja roja y **avisa al servidor**.
4. El servidor registra la detección y **notifica a todos los administradores**
   (la campana de la Fase 6 se enciende con el aviso de seguridad).

### Todo corre sin internet

El modelo y TensorFlow.js se sirven desde la propia aplicación
(`public/vendor/`). Después de `npm run descargar:modelo`, el sistema no vuelve a
necesitar conexión: cumple la regla de que todo funciona en la red local del
colegio.

### Defensas que quizá no se ven

- **El servidor no confía en el navegador.** Cuando llega una detección, valida
  que la clase esté realmente en la lista de objetos vigilados. Un cliente
  manipulado no puede inundar de detecciones de cualquier cosa.
- **Anti-ruido:** un objeto frente a la cámara dispara decenas de fotogramas por
  segundo. El sistema no crea una detección (ni una notificación) por cada uno:
  agrupa las repeticiones de la misma clase en una ventana de 10 segundos.
- **Solo administrador.** Todo el módulo, incluida la detección, es exclusivo del
  administrador. Un maestro que intente reportar una detección recibe 403.

---

## 4. La gobernanza sigue ahí, y ahora importa más

Cuando el sistema solo administraba reglas, la gobernanza era prudente. Ahora que
hay una cámara encendida mirando a menores, es indispensable. Todo lo de la capa
de gobernanza sigue vigente:

- **Zonas prohibidas:** no se puede registrar una cámara en baños, vestidores ni
  enfermería. Se revisa el nombre Y la zona, en tres capas (ENUM, código,
  trigger). *(Durante las pruebas, una versión temprana dejó pasar una cámara con
  "baño" en el nombre; la prueba lo detectó y se cerró el hueco.)*
- **Consentimiento revocable** de las familias, respetado en el acceso a
  grabaciones dirigidas a un alumno.
- **Retención con purga automática y auditada.**
- **Todo acceso auditado**, con motivo obligatorio.

Estas piezas responden a las preguntas que un jurado o un padre de familia hará:
¿quién puede ver esto?, ¿por cuánto tiempo se guarda?, ¿cómo sé que no se abusa?

---

## 5. Ausencias deliberadas

- **No hay reconocimiento facial.** El sistema detecta *objetos*, no identifica
  personas.
- **No hay seguimiento de individuos** entre cámaras.
- **El video no se graba ni se transmite** por la red: se procesa en el momento,
  en el navegador, y se descarta.
- **No hay acceso remoto** ni exposición a internet.

---

## 6. Endpoints nuevos de detección (todos solo ADMIN)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/video/objetos` | Lista de objetos vigilados (para el navegador) |
| PATCH | `/api/video/objetos/:id` | Activar / desactivar un objeto |
| POST | `/api/video/detecciones` | El navegador reporta una detección; el servidor notifica |
| GET | `/api/video/detecciones` | Historial de detecciones |
| POST | `/api/video/detecciones/:id/atender` | Marcar una detección como revisada |

---

## 7. Qué comprueban las 32 pruebas

Las 23 de gobernanza (zonas prohibidas, consentimiento, retención, auditoría)
más 9 nuevas de detección:

| Se comprueba |
|---|
| El servidor entrega la lista de objetos vigilados |
| Un maestro no puede reportar detecciones (403) |
| Una detección de cuchillo se registra y **notifica a los administradores** |
| La notificación de seguridad llega a la bandeja |
| Una detección repetida en 10s no se duplica (anti-ruido) |
| Un objeto no vigilado es rechazado (el servidor valida) |
| El historial muestra las detecciones |
| Una detección se marca como atendida |
| Desactivar un objeto lo saca de la vigilancia |

Lo que **no** se prueba automáticamente es la cámara y la IA del navegador
(requieren webcam y una pantalla real). Eso se verifica a mano en tu máquina, y
el pipeline del servidor —que sí se prueba— es el que garantiza que cuando el
navegador detecta algo, el aviso llega a donde debe.

---

## 8. Limitaciones honestas

- **Detecta lo que el modelo conoce.** Cuchillo y tijeras sí; pistola no, sin un
  modelo especializado. Ya explicado arriba.
- **La detección depende de la luz y el ángulo.** Como toda visión por
  computadora, funciona mejor con buena iluminación y el objeto visible. No es
  infalible: es una ayuda, no un reemplazo de la vigilancia humana.
- **Un solo navegador, una cámara a la vez** en esta versión. Monitorear varias
  cámaras simultáneas pediría una arquitectura distinta.
- **El modelo pesa unos 5–13 MB** y la primera carga tarda unos segundos. Una vez
  cargado, la detección es fluida en hardware modesto.

---

## 9. El plan de ocho fases queda cerrado

**204 pruebas automatizadas** cubren el sistema completo: entorno, datos,
seguridad, matrícula, notas, finanzas, IA, reportes PDF y videovigilancia con
detección.

Lo único pendiente: los **colores del logo del colegio** en HEX, para
`theme.css` y `pdf.service.js`. Es el último toque.
