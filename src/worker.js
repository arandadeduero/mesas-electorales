import { DurableObject } from 'cloudflare:workers';
import { claveNif, nifValido } from './nif.js';

// API de consulta de miembros de mesa (Cloudflare Worker).
//
//   POST /api/consulta  { nif, turnstile }   (turnstile: token del widget de Cloudflare Turnstile, acción "consulta")
//        200 → { designado: false } | { designado: true, distrito, seccion, mesa, cargo, tipo, orden }
//        400 → { error: "captcha" | "nif" | "peticion" }   403 → origen no permitido   413 → cuerpo demasiado grande
//        429 → { error: "limite" }
//
// Datos: KV `MESAS`, clave = HMAC-SHA256(NIF_KEY, NIF) en hex. Nunca se guarda ni se registra el NIF en claro.
// Captcha: Cloudflare Turnstile. El token se valida en Siteverify (un solo uso) exigiendo éxito, la acción
// "consulta" y un dominio de TURNSTILE_HOSTNAMES. Si Siteverify falla o no responde, se rechaza la consulta.
// Límite por IP: Durable Object `LimiteIp` (uno por IP, consistencia fuerte). El binding de rate limiting de Workers
// es aproximado (por ubicación, consistencia eventual) y en producción no frenaba ráfagas, por eso no se usa.
// El Worker solo atiende /api/*; la web estática está en GitHub Pages (en local, `npm run dev` la sirve con --assets).

// Una consulta cada 10 s por IP (como máximo 6 por minuto, 360 por hora…).
const LIMITES = {
  consulta: { maximo: 1, ventanaMs: 10_000 },
};
// El estado de una IP se borra tras una hora sin peticiones.
const OLVIDO_MS = 60 * 60 * 1000;

const ACCION_TURNSTILE = 'consulta';
// Una consulta válida ocupa menos de 3 KB (NIF + token de Turnstile, de hasta 2048 caracteres).
const MAX_CUERPO = 4096;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function turnstileValido(env, token, ip) {
  const dominios = new Set(String(env.TURNSTILE_HOSTNAMES || '').split(',').map((d) => d.trim()).filter(Boolean));
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048 || dominios.size === 0) return false;
  let r;
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    if (!resp.ok) return false;
    r = await resp.json();
  } catch {
    return false;
  }
  // Las claves de prueba de Turnstile no devuelven acción; solo se aceptan en local (TURNSTILE_PRUEBAS en .dev.vars).
  const accionOk = r.action === ACCION_TURNSTILE || (env.TURNSTILE_PRUEBAS === '1' && r.metadata?.result_with_testing_key === true);
  return r.success === true && accionOk && dominios.has(r.hostname);
}

// Un Durable Object por IP: guarda solo las marcas de tiempo recientes de cada tipo de petición.
export class LimiteIp extends DurableObject {
  async permitir(tipo) {
    const { maximo, ventanaMs } = LIMITES[tipo];
    const ahora = Date.now();
    const recientes = ((await this.ctx.storage.get(tipo)) || []).filter((t) => ahora - t < ventanaMs);
    if (recientes.length >= maximo) return false;
    recientes.push(ahora);
    await this.ctx.storage.put(tipo, recientes);
    await this.ctx.storage.setAlarm(ahora + OLVIDO_MS);
    return true;
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

// IPv6: se limita por bloque /64, porque una sola conexión suele disponer de todo el bloque y podría ir rotando
// direcciones para saltarse el límite.
function claveIp(ip) {
  if (!ip.includes(':')) return ip;
  const [cabeza, cola = ''] = ip.split('::');
  const partes = cabeza.split(':').filter(Boolean);
  const resto = cola.split(':').filter(Boolean);
  const grupos = [...partes, ...Array(8 - partes.length - resto.length).fill('0'), ...resto];
  return `${grupos.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

async function limitar(env, ip, tipo) {
  return env.LIMITE_IP.get(env.LIMITE_IP.idFromName(claveIp(ip))).permitir(tipo);
}

// Solo se aceptan peticiones fetch de la propia web: Origin permitido y cuerpo JSON. Así otra web no puede enviar
// consultas desde el navegador de un visitante (ni gastarle el cupo de su IP) con un formulario text/plain.
function origenPermitido(env, request) {
  const origenes = String(env.ORIGENES || '').split(',').map((o) => o.trim()).filter(Boolean);
  return origenes.includes(request.headers.get('Origin'))
    && (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() === 'application/json';
}

async function consulta(request, env) {
  if (!origenPermitido(env, request)) return json({ error: 'peticion' }, 403);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (!(await limitar(env, ip, 'consulta'))) return json({ error: 'limite' }, 429);
  let datos;
  try {
    const texto = await request.text();
    if (texto.length > MAX_CUERPO) return json({ error: 'peticion' }, 413);
    datos = JSON.parse(texto);
  } catch {
    return json({ error: 'peticion' }, 400);
  }
  // El captcha se comprueba antes que el NIF: sin Turnstile válido no se revela nada.
  if (!(await turnstileValido(env, datos?.turnstile, ip))) return json({ error: 'captcha' }, 400);
  const nif = typeof datos?.nif === 'string' ? datos.nif.toUpperCase().trim() : '';
  if (!nifValido(nif)) return json({ error: 'nif' }, 400);
  const registro = await env.MESAS.get(await claveNif(env.NIF_KEY, nif), 'json');
  if (!registro) return json({ designado: false });
  const { distrito, seccion, mesa, cargo, tipo, orden } = registro;
  return json({ designado: true, distrito, seccion, mesa, cargo, tipo, orden });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/consulta' && request.method === 'POST') return consulta(request, env);
    return json({ error: 'no encontrado' }, 404);
  },
};
