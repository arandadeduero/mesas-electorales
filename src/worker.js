import { DurableObject } from 'cloudflare:workers';
import { claveNif, nifValido } from './nif.js';

// API de consulta de miembros de mesa (Cloudflare Worker).
//
//   GET  /api/captcha   → { token, imagen }  (imagen: SVG en data URI, dibujado con trazos, sin texto legible)
//   POST /api/consulta  { nif, captcha, token }
//        200 → { designado: false } | { designado: true, distrito, seccion, mesa, cargo, tipo, orden }
//        400 → { error: "captcha" | "nif" | "peticion" }   429 → { error: "limite" }
//
// Datos: KV `MESAS`, clave = HMAC-SHA256(NIF_KEY, NIF) en hex. Nunca se guarda ni se registra el NIF en claro.
// Captcha sin estado: el token lleva caducidad y la firma HMAC(CAPTCHA_KEY, caducidad.nonce.respuesta).
// Límite por IP: Durable Object `LimiteIp` (uno por IP, consistencia fuerte). El binding de rate limiting de Workers
// es aproximado (por ubicación, consistencia eventual) y en producción no frenaba ráfagas, por eso no se usa.
// El Worker solo atiende /api/*; la web estática está en GitHub Pages (en local, `npm run dev` la sirve con --assets).

const CAPTCHA_TTL_MS = 2 * 60 * 1000;
const CAPTCHA_LEN = 5;

// Una consulta cada 10 s por IP (como máximo 6 por minuto, 360 por hora…). Captchas: 10 por minuto.
const LIMITES = {
  consulta: { maximo: 1, ventanaMs: 10_000 },
  captcha: { maximo: 10, ventanaMs: 60_000 },
};
// El estado de una IP se borra tras una hora sin peticiones.
const OLVIDO_MS = 60 * 60 * 1000;

// Fuente de trazos en una rejilla de 6×10 (y hacia abajo). Sin caracteres confundibles (0/O, 1/I/L, 5/S, 8/B, Z/2).
const GLIFOS = {
  A: [[[0, 10], [3, 0], [6, 10]], [[1.2, 6], [4.8, 6]]],
  C: [[[6, 1], [4, 0], [2, 0], [0, 2], [0, 8], [2, 10], [4, 10], [6, 9]]],
  E: [[[6, 0], [0, 0], [0, 10], [6, 10]], [[0, 5], [4, 5]]],
  F: [[[6, 0], [0, 0], [0, 10]], [[0, 5], [4, 5]]],
  H: [[[0, 0], [0, 10]], [[6, 0], [6, 10]], [[0, 5], [6, 5]]],
  K: [[[0, 0], [0, 10]], [[6, 0], [0, 6]], [[2, 4], [6, 10]]],
  M: [[[0, 10], [0, 0], [3, 6], [6, 0], [6, 10]]],
  N: [[[0, 10], [0, 0], [6, 10], [6, 0]]],
  P: [[[0, 10], [0, 0], [5, 0], [6, 1], [6, 4], [5, 5], [0, 5]]],
  R: [[[0, 10], [0, 0], [5, 0], [6, 1], [6, 4], [5, 5], [0, 5]], [[3, 5], [6, 10]]],
  T: [[[0, 0], [6, 0]], [[3, 0], [3, 10]]],
  U: [[[0, 0], [0, 8], [2, 10], [4, 10], [6, 8], [6, 0]]],
  X: [[[0, 0], [6, 10]], [[6, 0], [0, 10]]],
  Y: [[[0, 0], [3, 5], [6, 0]], [[3, 5], [3, 10]]],
  2: [[[0, 2], [2, 0], [4, 0], [6, 2], [6, 4], [0, 10], [6, 10]]],
  3: [[[0, 1], [2, 0], [5, 0], [6, 2], [5, 4.5], [2, 5]], [[5, 5.5], [6, 8], [5, 10], [2, 10], [0, 9]]],
  4: [[[5, 10], [5, 0], [0, 7], [6, 7]]],
  6: [[[5, 0], [2, 0], [0, 3], [0, 8], [2, 10], [4, 10], [6, 8], [6, 6], [4, 4.5], [0, 5.5]]],
  7: [[[0, 0], [6, 0], [2, 10]]],
  9: [[[6, 4.5], [2, 5.5], [0, 4], [0, 2], [2, 0], [4, 0], [6, 2], [6, 7], [4, 10], [1, 10]]],
};
const ALFABETO = Object.keys(GLIFOS).join('');

const enc = new TextEncoder();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function rnd(min, max) {
  return min + (crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (max - min);
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(clave, texto) {
  const key = await crypto.subtle.importKey('raw', enc.encode(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(texto));
}

function iguales(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function dibujarCaptcha(texto) {
  const f = (n) => n.toFixed(1);
  let trazos = '';
  [...texto].forEach((c, i) => {
    const escala = rnd(3, 3.6);
    const cx = 22 + i * 36 + rnd(-3, 3);
    const cy = 32 + rnd(-4, 4);
    const ang = rnd(-0.35, 0.35);
    const [cos, sin] = [Math.cos(ang), Math.sin(ang)];
    for (const linea of GLIFOS[c]) {
      const pts = linea.map(([x, y]) => {
        const dx = (x - 3 + rnd(-0.35, 0.35)) * escala;
        const dy = (y - 5 + rnd(-0.35, 0.35)) * escala;
        return `${f(cx + dx * cos - dy * sin)} ${f(cy + dx * sin + dy * cos)}`;
      });
      trazos += `M${pts.join('L')}`;
    }
  });
  let ruido = '';
  for (let i = 0; i < 3; i++) {
    ruido += `M0 ${f(rnd(8, 56))}C${f(rnd(40, 80))} ${f(rnd(0, 64))} ${f(rnd(120, 160))} ${f(rnd(0, 64))} 200 ${f(rnd(8, 56))}`;
  }
  let puntos = '';
  for (let i = 0; i < 40; i++) puntos += `M${f(rnd(0, 200))} ${f(rnd(0, 64))}h1.5`;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="64" viewBox="0 0 200 64">'
    + '<rect width="200" height="64" fill="#e9f4f9"/>'
    + `<path d="${ruido}" stroke="#3cb4e5" stroke-width="1.5" fill="none"/>`
    + `<path d="${trazos}" stroke="#3c3c3c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
    + `<path d="${puntos}" stroke="#0083c1" stroke-width="2" stroke-linecap="round"/>`
    + '</svg>';
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

async function nuevoCaptcha(env) {
  let texto = '';
  for (let i = 0; i < CAPTCHA_LEN; i++) texto += ALFABETO[Math.floor(rnd(0, ALFABETO.length))];
  const carga = `${Date.now() + CAPTCHA_TTL_MS}.${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
  const firma = b64url(await hmac(env.CAPTCHA_KEY, `${carga}.${texto}`));
  return { token: `${carga}.${firma}`, imagen: dibujarCaptcha(texto) };
}

async function captchaValido(env, token, respuesta) {
  const partes = String(token || '').split('.');
  if (partes.length !== 3 || !/^[A-Z0-9]{1,10}$/.test(respuesta)) return false;
  const [caduca, nonce, firma] = partes;
  if (!(Number(caduca) > Date.now())) return false;
  return iguales(firma, b64url(await hmac(env.CAPTCHA_KEY, `${caduca}.${nonce}.${respuesta}`)));
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

async function limitar(env, request, tipo) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  return env.LIMITE_IP.get(env.LIMITE_IP.idFromName(ip)).permitir(tipo);
}

async function consulta(request, env) {
  if (!(await limitar(env, request, 'consulta'))) return json({ error: 'limite' }, 429);
  let datos;
  try {
    datos = await request.json();
  } catch {
    return json({ error: 'peticion' }, 400);
  }
  const nif = String(datos?.nif || '').toUpperCase().trim();
  const respuesta = String(datos?.captcha || '').toUpperCase().trim();
  // El captcha se comprueba antes que el NIF: sin captcha correcto no se revela nada.
  if (!(await captchaValido(env, datos?.token, respuesta))) return json({ error: 'captcha' }, 400);
  if (!nifValido(nif)) return json({ error: 'nif' }, 400);
  const registro = await env.MESAS.get(await claveNif(env.NIF_KEY, nif), 'json');
  if (!registro) return json({ designado: false });
  const { distrito, seccion, mesa, cargo, tipo, orden } = registro;
  return json({ designado: true, distrito, seccion, mesa, cargo, tipo, orden });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/captcha' && request.method === 'GET') {
      if (!(await limitar(env, request, 'captcha'))) return json({ error: 'limite' }, 429);
      return json(await nuevoCaptcha(env));
    }
    if (pathname === '/api/consulta' && request.method === 'POST') return consulta(request, env);
    return json({ error: 'no encontrado' }, 404);
  },
};
