/**
 * Generación de documentos PDF: boletas de calificaciones y recibos de pago.
 *
 * Se usa pdfkit: JavaScript puro, sin navegador ni dependencias nativas. Un
 * sistema que corre offline en la máquina de un colegio no puede depender de
 * Chromium ni de fuentes descargadas de internet. Las fuentes base de pdfkit
 * (Helvetica) ya incluyen los acentos y la ñ del español.
 *
 * COLORES: se leen de una paleta central. Cuando llegue el logo del colegio,
 * se cambian aquí y en theme.css, y todos los documentos se actualizan.
 */
import PDFDocument from 'pdfkit';
import { q } from '../config/db.js';
import { AppError } from '../middleware/error.js';

// Paleta provisional. Reemplazar por los colores institucionales.
// Colores del logo institucional (azul marino + dorado).
const COLOR = {
  primary: '#0a2f5c',      // azul medio del logo
  primaryDark: '#001937',  // azul marino del escudo
  accent: '#dba018',       // dorado institucional
  texto: '#10233b',
  suave: '#5a6b7f',
  borde: '#d8e0ea',
  aprobado: '#1b7f4d',
  reprobado: '#b3261e',
  fondoAlt: '#f1f5fa',
};

const L = (n) => `L ${Number(n).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Datos de identidad del colegio, desde config. */
async function datosColegio() {
  const filas = await q(
    "SELECT clave, valor FROM config_sistema WHERE clave IN ('colegio.nombre','colegio.direccion','colegio.telefono','colegio.codigo')"
  );
  const m = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  return {
    nombre: m['colegio.nombre'] ?? 'Smart Campus IA',
    direccion: m['colegio.direccion'] ?? '',
    telefono: m['colegio.telefono'] ?? '',
    codigo: m['colegio.codigo'] ?? '',
  };
}

/** Encabezado común: nombre del colegio y título del documento. */
function encabezado(doc, colegio, titulo) {
  doc.fillColor(COLOR.primaryDark).fontSize(18).font('Helvetica-Bold')
    .text(colegio.nombre, { align: 'center' });
  if (colegio.direccion || colegio.telefono) {
    doc.moveDown(0.1).fillColor(COLOR.suave).fontSize(9).font('Helvetica')
      .text([colegio.direccion, colegio.telefono].filter(Boolean).join(' · '), { align: 'center' });
  }
  doc.moveDown(0.5);
  const y = doc.y;
  doc.strokeColor(COLOR.accent).lineWidth(2).moveTo(40, y).lineTo(555, y).stroke();
  doc.moveDown(0.6);
  doc.fillColor(COLOR.texto).fontSize(14).font('Helvetica-Bold').text(titulo, { align: 'center' });
  doc.moveDown(0.8);
}

/** Pie con la fecha de emisión y una nota de validez. */
function pie(doc, nota) {
  const y = 770;
  doc.fontSize(8).fillColor(COLOR.suave).font('Helvetica')
    .text(`Emitido el ${new Date().toLocaleString('es-HN')} · Smart Campus IA`, 40, y, { align: 'left' });
  if (nota) doc.text(nota, 40, y + 12, { width: 515 });
}

/**
 * Boleta de calificaciones de un alumno en un periodo.
 * Recibe datos ya recopilados y autorizados por quien llama.
 */
export async function boletaCalificaciones({ alumnoId, periodoId }) {
  const [alumno] = await q(
    `SELECT a.id, a.codigo,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.segundo_nombre, p.primer_apellido, p.segundo_apellido)) AS nombre,
            g.numero AS grado, g.nombre AS grado_nombre, s.letra AS seccion, ca.nombre AS carrera
       FROM alumno a JOIN persona p ON p.id = a.persona_id
       LEFT JOIN matricula m ON m.alumno_id = a.id AND m.estado = 'activa'
       LEFT JOIN seccion s ON s.id = m.seccion_id
       LEFT JOIN grado g ON g.id = s.grado_id
       LEFT JOIN carrera ca ON ca.id = g.carrera_id
      WHERE a.id = ?`,
    [alumnoId]
  );
  if (!alumno) throw new AppError('No se encontro el alumno.', 404, 'NO_ENCONTRADO');

  const [periodo] = await q('SELECT nombre, anio_lectivo_id FROM periodo WHERE id = ?', [periodoId]);
  if (!periodo) throw new AppError('El periodo no existe.', 404, 'NO_ENCONTRADO');

  const notas = await q(
    `SELECT asg.nombre AS asignatura,
            COALESCE(np.nota_final, sub.suma) AS nota_final,
            np.aprobado,
            TRIM(CONCAT_WS(' ', pm.primer_nombre, pm.primer_apellido)) AS maestro
       FROM inscripcion i
       JOIN clase c ON c.id = i.clase_id
       JOIN asignatura asg ON asg.id = c.asignatura_id
       LEFT JOIN usuario u ON u.id = c.maestro_id
       LEFT JOIN persona pm ON pm.id = u.persona_id
       LEFT JOIN nota_periodo np ON np.alumno_id = i.alumno_id AND np.clase_id = c.id AND np.periodo_id = ?
       LEFT JOIN (
         -- Nota final calculada por SUMA DIRECTA de las evaluaciones del periodo.
         SELECT e.clase_id, n.alumno_id, ROUND(SUM(n.puntaje)) AS suma
           FROM evaluacion e
           JOIN nota n ON n.evaluacion_id = e.id
           JOIN tipo_evaluacion t ON t.id = e.tipo_evaluacion_id
          WHERE e.periodo_id = ? AND e.activa = 1 AND t.es_extra = 0
          GROUP BY e.clase_id, n.alumno_id
       ) sub ON sub.clase_id = c.id AND sub.alumno_id = i.alumno_id
      WHERE i.alumno_id = ? AND i.estado = 'activa'
      ORDER BY asg.nombre`,
    [periodoId, periodoId, alumnoId]
  );

  const colegio = await datosColegio();
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const terminado = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  encabezado(doc, colegio, `Boleta de Calificaciones — ${periodo.nombre}`);

  // Datos del alumno.
  doc.fontSize(10).font('Helvetica');
  const fila = (etiqueta, valor) => {
    doc.fillColor(COLOR.suave).font('Helvetica').text(etiqueta, 40, doc.y, { continued: true, width: 120 });
    doc.fillColor(COLOR.texto).font('Helvetica-Bold').text(`  ${valor}`);
  };
  fila('Alumno:', alumno.nombre);
  fila('Código:', alumno.codigo);
  fila('Grado y sección:', `${alumno.grado_nombre ?? '—'} "${alumno.seccion ?? '—'}"${alumno.carrera ? ` — ${alumno.carrera}` : ''}`);
  doc.moveDown(1);

  // Tabla de notas.
  const x = 40, ancho = 515;
  const colAsig = 250, colNota = 90, colEstado = 90;
  let y = doc.y;

  doc.rect(x, y, ancho, 22).fill(COLOR.primary);
  doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold');
  doc.text('Asignatura', x + 8, y + 6, { width: colAsig });
  doc.text('Maestro', x + 8 + colAsig, y + 6, { width: ancho - colAsig - colNota - colEstado });
  doc.text('Nota', x + ancho - colNota - colEstado, y + 6, { width: colNota, align: 'center' });
  doc.text('Estado', x + ancho - colEstado, y + 6, { width: colEstado, align: 'center' });
  y += 22;

  doc.fontSize(10).font('Helvetica');
  for (const [i, n] of notas.entries()) {
    const alto = 20;
    if (i % 2 === 0) doc.rect(x, y, ancho, alto).fill(COLOR.fondoAlt);
    const tieneNota = n.nota_final !== null;
    doc.fillColor(COLOR.texto).font('Helvetica').text(n.asignatura, x + 8, y + 5, { width: colAsig - 8 });
    doc.fillColor(COLOR.suave).fontSize(8).text(n.maestro ?? '—', x + 8 + colAsig, y + 6, { width: ancho - colAsig - colNota - colEstado - 8 });
    doc.fontSize(10);
    doc.fillColor(tieneNota ? (n.aprobado ? COLOR.aprobado : COLOR.reprobado) : COLOR.suave).font('Helvetica-Bold')
      .text(tieneNota ? String(n.nota_final) : '—', x + ancho - colNota - colEstado, y + 5, { width: colNota, align: 'center' });
    doc.fillColor(tieneNota ? (n.aprobado ? COLOR.aprobado : COLOR.reprobado) : COLOR.suave).font('Helvetica')
      .text(tieneNota ? (n.aprobado ? 'Aprobado' : 'Reprobado') : 'Sin nota', x + ancho - colEstado, y + 5, { width: colEstado, align: 'center' });
    y += alto;
  }

  // Promedio.
  const conNota = notas.filter((n) => n.nota_final !== null);
  const promedio = conNota.length
    ? Math.round((conNota.reduce((s, n) => s + Number(n.nota_final), 0) / conNota.length) * 100) / 100 : null;

  y += 6;
  doc.strokeColor(COLOR.borde).lineWidth(1).moveTo(x, y).lineTo(x + ancho, y).stroke();
  y += 8;
  doc.fillColor(COLOR.texto).fontSize(11).font('Helvetica-Bold')
    .text('Promedio del periodo:', x + 8, y, { continued: true });
  doc.fillColor(promedio !== null && promedio >= 70 ? COLOR.aprobado : COLOR.reprobado)
    .text(`  ${promedio ?? '—'}`);

  doc.y = y + 30;
  doc.fillColor(COLOR.suave).fontSize(9).font('Helvetica')
    .text('La nota mínima de aprobación es 70. Este documento refleja las calificaciones registradas al momento de su emisión.', 40, doc.y, { width: 515 });

  pie(doc, 'Documento interno del colegio. Ante cualquier discrepancia, prevalece el registro del sistema.');
  doc.end();
  return { buffer: await terminado, nombre: `boleta_${alumno.codigo}_${periodo.nombre.replace(/\s+/g, '_')}.pdf` };
}

/** Recibo de pago con formato. */
export async function reciboPago({ pagoId }) {
  const [pago] = await q(
    `SELECT pg.id, pg.numero_recibo, pg.monto, pg.metodo, pg.referencia, pg.fecha_pago, pg.anulado,
            co.nombre AS concepto,
            TRIM(CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)) AS alumno,
            a.codigo AS codigo_alumno,
            TRIM(CONCAT_WS(' ', pc.primer_nombre, pc.primer_apellido)) AS cajero
       FROM pago pg
       JOIN cargo c ON c.id = pg.cargo_id
       JOIN concepto_pago co ON co.id = c.concepto_id
       JOIN alumno a ON a.id = c.alumno_id
       JOIN persona p ON p.id = a.persona_id
       LEFT JOIN usuario u ON u.id = pg.registrado_por
       LEFT JOIN persona pc ON pc.id = u.persona_id
      WHERE pg.id = ?`,
    [pagoId]
  );
  if (!pago) throw new AppError('No se encontro el pago.', 404, 'NO_ENCONTRADO');

  const colegio = await datosColegio();
  const doc = new PDFDocument({ size: [420, 560], margin: 30 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const terminado = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  doc.fillColor(COLOR.primaryDark).fontSize(15).font('Helvetica-Bold').text(colegio.nombre, { align: 'center' });
  doc.moveDown(0.1).fillColor(COLOR.suave).fontSize(8).font('Helvetica')
    .text('Comprobante de pago', { align: 'center' });
  doc.moveDown(0.5);
  let y = doc.y;
  doc.strokeColor(COLOR.primary).lineWidth(2).moveTo(30, y).lineTo(390, y).stroke();
  doc.moveDown(0.8);

  if (pago.anulado) {
    doc.fillColor(COLOR.reprobado).fontSize(16).font('Helvetica-Bold').text('** ANULADO **', { align: 'center' });
    doc.moveDown(0.5);
  }

  const fila = (etiqueta, valor) => {
    const yy = doc.y;
    doc.fillColor(COLOR.suave).fontSize(9).font('Helvetica').text(etiqueta, 30, yy, { width: 130 });
    doc.fillColor(COLOR.texto).font('Helvetica-Bold').text(String(valor), 160, yy, { width: 230, align: 'right' });
    doc.moveDown(0.6);
  };

  fila('Recibo No.', pago.numero_recibo ?? '—');
  fila('Fecha', new Date(pago.fecha_pago).toLocaleString('es-HN'));
  fila('Alumno', pago.alumno);
  fila('Código', pago.codigo_alumno);
  fila('Concepto', pago.concepto);
  fila('Método', pago.metodo);
  if (pago.referencia) fila('Referencia', pago.referencia);
  if (pago.cajero) fila('Recibido por', pago.cajero);

  doc.moveDown(0.4);
  y = doc.y;
  doc.strokeColor(COLOR.borde).lineWidth(1).moveTo(30, y).lineTo(390, y).stroke();
  doc.moveDown(0.6);

  doc.fillColor(COLOR.texto).fontSize(13).font('Helvetica-Bold').text('Total pagado', 30, doc.y, { continued: true });
  doc.fillColor(pago.anulado ? COLOR.reprobado : COLOR.aprobado).fontSize(15)
    .text(`  ${L(pago.monto)}`, { align: 'right' });

  doc.moveDown(2);
  doc.fillColor(COLOR.suave).fontSize(8).font('Helvetica')
    .text('Comprobante interno del colegio. No es un documento fiscal.', 30, doc.y, { width: 360, align: 'center' });
  doc.text(`Impreso el ${new Date().toLocaleString('es-HN')}`, { align: 'center' });

  doc.end();
  return { buffer: await terminado, nombre: `recibo_${pago.numero_recibo ?? pago.id}.pdf` };
}
