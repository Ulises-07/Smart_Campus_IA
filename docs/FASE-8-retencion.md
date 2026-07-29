# Fase 8 — Política de retención de grabaciones

> Segundo documento que va antes del código. Define cuánto tiempo se guardan las
> grabaciones y cómo se destruyen. La retención es la otra mitad del respeto a la
> privacidad: no basta con grabar poco; hay que dejar de guardar a tiempo.

---

## 1. Por qué la retención importa tanto

Una grabación que nunca se borra es un riesgo que solo crece. Cada día que se
conserva de más es un día más en que puede filtrarse, robarse o usarse para algo
distinto de su fin. El principio es simple: **la grabación se conserva el tiempo
mínimo para cumplir su propósito, y ni un día más.**

Guardar "por si algún día sirve" es exactamente lo que esta política prohíbe.

---

## 2. El plazo

| Parámetro | Valor por defecto | Dónde se configura |
|---|---|---|
| Retención general | **30 días** | `config_sistema`, clave `video.retencion_dias` |
| Retención de un incidente marcado | hasta **180 días** | por grabación, si se marca como evidencia |

**30 días** es un plazo razonable para seguridad de instalaciones: suficiente
para revisar un incidente reciente, corto para no acumular. Es configurable,
pero la política recomienda no subirlo sin una razón concreta.

La excepción de los 180 días cubre el caso legítimo: ocurre un incidente (un
robo, un accidente) y esa grabación específica debe conservarse mientras se
resuelve. Se marca **una grabación concreta** como evidencia, no todas. Y aun
así tiene un tope: la evidencia tampoco se guarda para siempre.

---

## 3. Cómo se destruye

- **Automáticamente.** Un proceso de purga (`npm run purgar:video`) elimina toda
  grabación cuya fecha de expiración ya pasó. Está pensado para correr a diario
  como tarea programada, igual que el respaldo.
- **Sin intervención humana para lo rutinario.** La purga normal no pide que
  nadie decida qué borrar: borra todo lo vencido. Que dependa de que alguien se
  acuerde es la forma más común de que las grabaciones se acumulen para siempre.
- **La destrucción queda auditada.** Cada purga registra cuántas grabaciones
  eliminó y cuándo. Se puede demostrar que la política se cumple.
- **La eliminación es efectiva.** En un despliegue real, purgar significa borrar
  el archivo de video del disco, no solo marcar una fila. En esta demostración,
  donde no hay video real, se elimina el registro de metadatos que representa la
  grabación y su referencia.

---

## 4. El ciclo de vida de una grabación

```
  Se registra                Vence a los N días            Se purga
  la grabación   ─────────►  (fecha_expiracion)  ─────────► (borrada + auditada)
       │                            │                            │
  fecha_inicio              retención cumplida           deja de existir
       │
       └── si se marca como evidencia, su fecha_expiracion
           se extiende hasta el tope de 180 días
```

Cada grabación conoce su propia fecha de expiración desde que se crea. No hay
que calcularla después ni recordar cuándo tocaba borrar: la fecha viaja con el
registro.

---

## 5. Qué se guarda de cada grabación

Incluso en metadatos, se aplica minimización. De cada grabación se guarda:

- la cámara y su zona,
- la fecha y hora de inicio y fin,
- la fecha de expiración (calculada),
- si es evidencia de un incidente,
- una referencia al archivo (en la demo, un identificador; en producción, la
  ruta al video cifrado en un almacenamiento restringido).

No se guarda: quién aparece en la grabación, ni etiquetas de personas, ni
análisis de contenido. El sistema no sabe *quién* está en un video, y eso es
deliberado.

---

## 6. Responsabilidades

| Quién | Qué le toca |
|---|---|
| Administrador | Configurar el plazo, marcar evidencias, revisar la auditoría de accesos |
| Tarea programada | Ejecutar la purga a diario, sin intervención |
| El sistema | Calcular expiraciones, bloquear zonas prohibidas, auditar todo acceso |

---

## 7. Cómo probar que la política se cumple

El sistema incluye pruebas automatizadas que verifican, entre otras cosas:

- que una grabación vencida se purga y una vigente no,
- que marcar algo como evidencia extiende su expiración pero no la elimina el
  tope,
- que la purga es idempotente (correrla dos veces no rompe nada),
- que cada purga queda en la auditoría.

Que la política sea *demostrable* —y no solo un documento— es el punto de todo
esto. Una política de retención que nadie puede comprobar es una promesa, no una
garantía.
