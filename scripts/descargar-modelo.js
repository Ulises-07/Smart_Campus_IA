/**
 * Descarga el modelo de detección de objetos (COCO-SSD) para uso 100% offline.
 *
 * Se corre UNA sola vez, en una máquina con internet:
 *     npm run descargar:modelo
 *
 * A partir de ahí, el modelo vive en public/vendor/modelo/ y el sistema no
 * vuelve a necesitar internet: la detección corre en el navegador del
 * administrador, con los archivos servidos por la propia aplicación.
 *
 * Por qué así: el paquete coco-ssd normalmente descarga el modelo desde los
 * servidores de Google en cada carga. Eso rompería la regla de que todo el
 * sistema funciona sin internet. Descargándolo una vez y sirviéndolo local,
 * la regla se mantiene.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Modelo liviano, suficiente para un demo y rápido en hardware modesto.
const BASE = 'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2';
const DESTINO = path.resolve('public/vendor/modelo');

const VERDE = '\x1b[32m', ROJO = '\x1b[31m', GRIS = '\x1b[90m', RESET = '\x1b[0m';

async function bajar(url, rutaDestino) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo descargar ${url} (HTTP ${r.status})`);
  const buffer = Buffer.from(await r.arrayBuffer());
  await writeFile(rutaDestino, buffer);
  return buffer.length;
}

async function main() {
  console.log('\nDescargando el modelo de deteccion de objetos (COCO-SSD)...\n');
  await mkdir(DESTINO, { recursive: true });

  // Primero el manifiesto, que lista los archivos de pesos.
  console.log(`${GRIS}Descargando manifiesto del modelo...${RESET}`);
  let manifiesto;
  try {
    const r = await fetch(`${BASE}/model.json`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    manifiesto = await r.json();
    await writeFile(path.join(DESTINO, 'model.json'), JSON.stringify(manifiesto));
    console.log(`${VERDE}  OK${RESET} model.json`);
  } catch (e) {
    console.error(`${ROJO}Fallo al descargar el modelo:${RESET} ${e.message}`);
    console.error('\nEste script necesita internet la primera vez. Si estas detras de un');
    console.error('proxy o sin conexion, descarga los archivos manualmente desde:');
    console.error(`  ${BASE}/model.json`);
    console.error('  (y los archivos .bin que este liste) y ponlos en public/vendor/modelo/\n');
    process.exit(1);
  }

  // Los pesos vienen en uno o más archivos .bin listados en el manifiesto.
  const archivosPeso = new Set();
  for (const grupo of manifiesto.weightsManifest ?? []) {
    for (const p of grupo.paths ?? []) archivosPeso.add(p);
  }

  let totalBytes = 0;
  for (const nombre of archivosPeso) {
    process.stdout.write(`${GRIS}Descargando ${nombre}...${RESET}`);
    const bytes = await bajar(`${BASE}/${nombre}`, path.join(DESTINO, nombre));
    totalBytes += bytes;
    console.log(`\r${VERDE}  OK${RESET} ${nombre} ${GRIS}(${(bytes / 1024 / 1024).toFixed(1)} MB)${RESET}          `);
  }

  console.log(`\n${VERDE}Modelo descargado${RESET} (${(totalBytes / 1024 / 1024).toFixed(1)} MB en total).`);
  console.log('El sistema de deteccion ya funciona sin internet.\n');
}

main().catch((e) => {
  console.error(`${ROJO}Error:${RESET}`, e.message);
  process.exit(1);
});
