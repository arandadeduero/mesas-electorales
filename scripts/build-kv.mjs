// Genera data/kv-mesas.json para `wrangler kv bulk put` a partir de data/mesas_electorales.json.
// La clave de cada registro es HMAC-SHA256(NIF_KEY, NIF): el NIF no se sube en claro a Cloudflare.
// Uso: NIF_KEY=… node scripts/build-kv.mjs   (o con NIF_KEY en .dev.vars)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { claveNif, nifValido } from '../src/nif.js';

let nifKey = process.env.NIF_KEY;
if (!nifKey && existsSync('.dev.vars')) {
  nifKey = readFileSync('.dev.vars', 'utf8').match(/^NIF_KEY\s*=\s*"?([^"\n]+)"?/m)?.[1];
}
if (!nifKey) throw new Error('Falta NIF_KEY (variable de entorno o .dev.vars)');

const registros = JSON.parse(readFileSync('data/mesas_electorales.json', 'utf8'));
const vistos = new Set();
const salida = [];
for (const { dni, distrito, seccion, mesa, cargo, tipo, orden } of registros) {
  if (!nifValido(dni)) throw new Error(`NIF con letra incorrecta en el listado (registro ${salida.length + 1})`);
  if (vistos.has(dni)) throw new Error(`NIF repetido en el listado (registro ${salida.length + 1})`);
  vistos.add(dni);
  salida.push({ key: await claveNif(nifKey, dni), value: JSON.stringify({ distrito, seccion, mesa, cargo, tipo, orden }) });
}
writeFileSync('data/kv-mesas.json', JSON.stringify(salida));
console.log(`data/kv-mesas.json: ${salida.length} registros`);
