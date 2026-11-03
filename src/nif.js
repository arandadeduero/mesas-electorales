// Validación del NIF y clave del KV. Lo comparten el Worker y scripts/build-kv.mjs (Node), así que no importa nada
// específico de Workers.
const LETRAS_NIF = 'TRWAGMYFPDXBNJZSQVHLCKE';

export function nifValido(nif) {
  return /^\d{8}[A-Z]$/.test(nif) && LETRAS_NIF[Number(nif.slice(0, 8)) % 23] === nif[8];
}

// Clave de cada registro en KV: HMAC-SHA256(NIF_KEY, NIF) en hex. Sin NIF_KEY no se puede saber de quién es.
export async function claveNif(nifKey, nif) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(nifKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign('HMAC', key, enc.encode(nif));
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
