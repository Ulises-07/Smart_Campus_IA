/**
 * Diagnóstico de Ollama. Ejecuta:  npm run probar:ollama
 *
 * Verifica, paso a paso, que Ollama esté listo para generar resúmenes:
 *   1. Que esté encendido y responda.
 *   2. Que el modelo configurado esté descargado.
 *   3. Que pueda generar texto (con un cronómetro, para ver cuánto tarda).
 *
 * Si el resumen de materiales falla, esto dice por qué.
 */
import './_silencio.js';
import { env } from '../src/config/env.js';

const URL = env.OLLAMA_URL;
const MODELO = env.OLLAMA_MODEL;

async function main() {
  console.log('\n=== Diagnóstico de Ollama ===\n');
  console.log(`URL:    ${URL}`);
  console.log(`Modelo: ${MODELO}`);
  console.log(`Habilitado (OLLAMA_ENABLED): ${env.OLLAMA_ENABLED}\n`);

  if (!env.OLLAMA_ENABLED) {
    console.log('⚠  Ollama está DESHABILITADO en tu .env. Pon OLLAMA_ENABLED=true y reinicia.\n');
    return;
  }

  // 1) ¿Responde?
  try {
    const r = await fetch(`${URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`respondió ${r.status}`);
    const datos = await r.json();
    const modelos = (datos.models ?? []).map((m) => m.name);
    console.log('✓ Ollama está encendido y responde.');
    console.log(`  Modelos descargados: ${modelos.join(', ') || '(ninguno)'}\n`);

    // 2) ¿Está el modelo configurado?
    const tiene = modelos.some((m) => m === MODELO || m.startsWith(MODELO.split(':')[0]));
    if (!tiene) {
      console.log(`⚠  El modelo "${MODELO}" NO está descargado.`);
      console.log(`   Descárgalo con:  ollama pull ${MODELO}\n`);
      return;
    }
    console.log(`✓ El modelo "${MODELO}" está disponible.\n`);
  } catch (e) {
    console.log(`✗ Ollama NO responde: ${e.message}`);
    console.log('  ¿Está corriendo? Ábrelo o ejecuta:  ollama serve\n');
    return;
  }

  // 3) ¿Puede generar? (con cronómetro)
  console.log('Probando generación (esto puede tardar)...');
  const t0 = Date.now();
  try {
    const r = await fetch(`${URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODELO,
        prompt: 'Resume en una frase: la fotosíntesis convierte luz en energía.',
        stream: false,
      }),
      signal: AbortSignal.timeout(180000),
    });
    const datos = await r.json();
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✓ Generó respuesta en ${seg} segundos:`);
    console.log(`  "${(datos.response ?? '').trim().slice(0, 120)}"\n`);
    if (Number(seg) > 30) {
      console.log(`⚠  Tardó más de 30 s. Por eso el resumen fallaba con el timeout viejo.`);
      console.log(`   Con este cambio, el resumen ahora espera hasta 3 minutos.\n`);
    }
    console.log('Todo listo: los resúmenes deberían funcionar.\n');
  } catch (e) {
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✗ Falló la generación tras ${seg} s: ${e.message}`);
    console.log('  Si dice "timeout", tu equipo es lento para este modelo.');
    console.log(`  Prueba un modelo más liviano (ej. llama3.2:3b) en OLLAMA_MODEL.\n`);
  }
}

main().catch((e) => { console.error('Fallo:', e.message); process.exit(1); });
