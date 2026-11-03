// Consulta de miembros de mesa. La API la sirve el Worker (src/worker.js):
//   POST /api/consulta  { nif, turnstile } → { designado, distrito, seccion, mesa, cargo, tipo, orden }
//     400 → { error: "captcha" | "nif" }   429 → { error: "limite" } (una consulta cada 10 s por IP)
// El captcha es Cloudflare Turnstile: cada token vale para una sola consulta, así que se reinicia tras cada envío.
//
// El listado de miembros de mesa nunca llega al navegador: solo el Worker lo consulta.
'use strict';

const API = '/api';
// En local se usa la sitekey de prueba pública de Turnstile (siempre aprueba).
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const TURNSTILE_SITEKEY = LOCAL ? '1x00000000000000000000AA' : '0x4AAAAAAFyJA3X6ExeE2YSl';
const LETRAS = 'TRWAGMYFPDXBNJZSQVHLCKE';

function nifValido(nif) {
  if (!/^\d{8}[A-Z]$/.test(nif)) return false;
  return LETRAS[Number(nif.slice(0, 8)) % 23] === nif[8];
}

async function enviarConsulta(datos) {
  const r = await fetch(`${API}/consulta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// ===== Interfaz =====
const form = document.getElementById('form-consulta');
const nifInput = document.getElementById('nif');
const captchaError = document.getElementById('captcha-error');
const boton = document.getElementById('btn-consultar');
const resultado = document.getElementById('resultado');
let widgetId = null;
let tokenTurnstile = '';

function error(input, mensaje) {
  input.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
  document.getElementById(`${input.id}-error`).textContent = mensaje;
}

// api.js de Turnstile se carga después de este script (los dos con defer, en orden), así que se espera a que exista.
function iniciarTurnstile() {
  if (typeof window.turnstile?.render !== 'function') {
    setTimeout(iniciarTurnstile, 100);
    return;
  }
  widgetId = window.turnstile.render('#widget-turnstile', {
    sitekey: TURNSTILE_SITEKEY,
    action: 'consulta',
    language: 'es',
    callback: (t) => {
      tokenTurnstile = t;
      captchaError.textContent = '';
    },
    'expired-callback': () => { tokenTurnstile = ''; },
    'error-callback': () => {
      tokenTurnstile = '';
      captchaError.textContent = 'No se ha podido completar la verificación. Recargue la página e inténtelo de nuevo.';
    },
  });
}

function reiniciarTurnstile() {
  tokenTurnstile = '';
  if (widgetId !== null) window.turnstile.reset(widgetId);
}

function el(tag, texto, clase) {
  const e = document.createElement(tag);
  if (texto) e.textContent = texto;
  if (clase) e.className = clase;
  return e;
}

function mostrar(tipo, titulo, ...parrafos) {
  resultado.replaceChildren(el('h3', titulo, 'resultado__titulo'), ...parrafos.map((p) => (typeof p === 'string' ? el('p', p) : p)));
  resultado.className = `resultado resultado--${tipo}`;
  resultado.hidden = false;
  resultado.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cargoTexto({ cargo, tipo, orden }) {
  if (tipo === 'titular') return `${cargo} (titular)`;
  return `${orden}.º suplente de ${cargo}`;
}

function mostrarDesignado(d) {
  const dl = el('dl');
  for (const [k, v] of [['Cargo', cargoTexto(d)], ['Distrito', d.distrito], ['Sección', d.seccion], ['Mesa', d.mesa]]) {
    dl.append(el('dt', k), el('dd', v));
  }
  mostrar('si', 'Ha sido designado como miembro de mesa', dl,
    'Debe presentarse el 29 de noviembre a las 8:00 en su colegio electoral.',
    'Si tiene una causa para no formar parte de la mesa, dispone de 7 días desde la notificación para alegarla ante la Junta Electoral de Zona de Aranda de Duero.',
    el('p', 'Esta consulta es solo informativa y no tiene validez legal: recibirá la notificación personal de su designación, que es el documento oficial.', 'resultado__aviso'));
}

nifInput.addEventListener('input', () => {
  nifInput.value = nifInput.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
});

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const nif = nifInput.value.trim();
  error(nifInput, nifValido(nif) ? '' : 'Escriba los 8 dígitos y la letra de su NIF (por ejemplo, 12345678Z).');
  if (!nifValido(nif)) return nifInput.focus();
  if (!tokenTurnstile) {
    captchaError.textContent = 'Espere a que se complete la verificación de seguridad.';
    return;
  }

  boton.disabled = true;
  try {
    const { status, body } = await enviarConsulta({ nif, turnstile: tokenTurnstile });
    if (status === 400 && body.error === 'captcha') {
      captchaError.textContent = 'No se ha podido verificar. Espere a que se complete de nuevo la verificación y vuelva a consultar.';
    } else if (status === 429) {
      mostrar('error', 'Demasiadas consultas', 'Solo se permite una consulta cada 10 segundos. Espere un momento y vuelva a intentarlo.');
    } else if (status !== 200) {
      mostrar('error', 'No se ha podido hacer la consulta', 'Inténtelo de nuevo en unos minutos.');
    } else if (body.designado) {
      mostrarDesignado(body);
    } else {
      mostrar('no', 'No ha sido designado como miembro de mesa',
        'Si cree que se trata de un error, consulte con la Junta Electoral de Zona de Aranda de Duero.',
        el('p', 'Esta consulta es solo informativa y no tiene validez legal: lo que cuenta es la notificación personal a los miembros de mesa.', 'resultado__aviso'));
    }
  } catch {
    mostrar('error', 'No se ha podido hacer la consulta', 'Compruebe su conexión e inténtelo de nuevo.');
  } finally {
    boton.disabled = false;
    reiniciarTurnstile();
  }
});

iniciarTurnstile();
