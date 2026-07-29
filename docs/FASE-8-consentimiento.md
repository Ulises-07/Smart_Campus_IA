# Fase 8 — Política de consentimiento de videovigilancia

> **Este documento va antes que el código.** Define bajo qué condiciones es
> admisible que un colegio grabe a menores de edad. El sistema técnico que
> viene después no hace más que *hacer cumplir* lo que aquí se decide.
>
> Se entrega como parte de un proyecto universitario demostrativo. No sustituye
> la asesoría legal que un colegio real necesitaría antes de instalar cámaras.

---

## 1. El principio de partida

Grabar a un menor es tratar un dato personal sensible de alguien que no puede
consentir por sí mismo. Por eso el punto de partida no es "¿podemos grabar?"
sino "¿bajo qué límites es aceptable, y quién los autoriza?".

Tres ideas ordenan todo lo demás:

1. **Minimización.** Se graba lo mínimo necesario para el fin declarado
   (seguridad de las instalaciones), en las zonas mínimas, por el tiempo
   mínimo. No se graba "por si acaso".
2. **Finalidad única.** Las grabaciones sirven para la seguridad física del
   plantel. No para vigilar el rendimiento de un maestro, ni la conducta
   rutinaria de un alumno, ni para ningún otro uso no declarado.
3. **Consentimiento informado.** Los padres o encargados saben qué se graba,
   dónde, por cuánto tiempo y quién puede verlo, y lo aceptan por escrito.

---

## 2. Dónde SÍ y dónde NUNCA

Esta es la primera línea de defensa, y el sistema la hace cumplir en código: no
se puede registrar una cámara en una zona prohibida.

**Zonas permitidas** (áreas comunes, de tránsito o perímetro):
- Entradas y salidas del plantel
- Pasillos y corredores
- Patios y canchas
- Perímetro exterior
- Áreas administrativas (recepción, secretaría)

**Zonas prohibidas — sin excepción:**
- Baños y servicios sanitarios
- Vestidores y áreas de cambio
- Enfermería y espacios de atención médica
- Cualquier espacio donde exista una expectativa razonable de intimidad

El sistema **rechaza** la creación de una cámara en cualquiera de estas zonas.
No es una recomendación: es una regla que el código no deja saltarse.

Las aulas son un caso intermedio: se permiten solo si el colegio lo declara
explícitamente y con el consentimiento reforzado de los padres, porque una
cámara en el aula sí observa a alumnos concretos de forma sostenida.

---

## 3. Cómo se recoge el consentimiento

Por cada alumno, el sistema guarda el estado del consentimiento de su encargado:

| Estado | Significado |
|---|---|
| `otorgado` | El encargado firmó el documento aceptando la política |
| `denegado` | El encargado NO autoriza; su decisión se respeta y se registra |
| `pendiente` | Aún no hay respuesta; el alumno se trata como sin consentimiento |

Puntos que el sistema respeta:

- **Denegar es una opción real.** No es un trámite de "aceptar para poder
  matricularse". Un encargado puede negarse, y esa negativa queda registrada y
  se respeta.
- **El consentimiento es revocable.** Un encargado que lo otorgó puede
  retirarlo después. El sistema permite cambiar el estado en cualquier momento.
- **Queda constancia de quién y cuándo.** Cada registro guarda qué encargado
  decidió, la fecha y la referencia del documento físico firmado.

### ¿Y si un encargado deniega?

Las cámaras de seguridad en zonas comunes graban el espacio, no a una persona.
Pero cuando una grabación se consulta **para identificar o seguir a un alumno
concreto**, el sistema exige que ese alumno tenga consentimiento `otorgado`. Si
está `denegado` o `pendiente`, el acceso con ese fin se bloquea y el intento
queda auditado.

Es la diferencia entre "hay una cámara en el pasillo" (vigilancia del espacio) y
"quiero ver qué hizo Fulano el martes" (vigilancia de una persona). Lo primero
es admisible con la política general; lo segundo exige consentimiento de esa
familia.

---

## 4. Quién puede ver las grabaciones

- **Solo el administrador.** Ningún maestro, asesor ni alumno tiene acceso a las
  grabaciones. En un despliegue real convendría un rol dedicado de seguridad con
  acceso aún más acotado.
- **Cada acceso se audita.** No existe forma de ver una grabación sin que quede
  registrado quién la vio, cuándo y con qué justificación. La auditoría de la
  Fase 7 ya es inmutable; el acceso a video entra en ese mismo rastro.
- **Se exige una justificación.** El sistema no deja abrir una grabación sin que
  la persona escriba el motivo. Un "porque sí" no es un motivo.

---

## 5. Lo que el sistema NO hace, a propósito

Estas ausencias son decisiones de diseño, no funciones pendientes:

- **No hay reconocimiento facial.** El sistema no identifica automáticamente a
  nadie. Poner biometría sobre menores multiplicaría el riesgo sin un beneficio
  proporcionado para un colegio.
- **No hay seguimiento ni analítica de conducta.** No se cuenta cuántas veces
  pasó un alumno, ni se marcan "comportamientos sospechosos". Eso convierte una
  cámara de seguridad en un sistema de perfilado de menores.
- **No hay captura ni procesamiento de video real en esta demostración.** El
  sistema modela el *ciclo de vida y el control* de las grabaciones (registro,
  retención, acceso, purga), que es la parte que de verdad protege. La captura
  de imagen sería un microservicio aparte, sujeto a estas mismas reglas.

---

## 6. Resumen para los padres (texto de referencia)

Un texto como este sería lo que el colegio entregaría a las familias:

> *El colegio cuenta con cámaras de seguridad en entradas, pasillos, patios y
> perímetro, con el único fin de proteger la seguridad física de las
> instalaciones y de quienes están en ellas. No hay cámaras en baños,
> vestidores ni enfermería. Las grabaciones se conservan un máximo de [30] días
> y luego se eliminan automáticamente. Solo la dirección puede consultarlas, y
> cada consulta queda registrada. Usted puede autorizar o no autorizar, y puede
> cambiar su decisión cuando lo desee, comunicándose con la administración.*

El número de días entre corchetes se define en la política de retención, en el
documento `FASE-8-retencion.md`.
