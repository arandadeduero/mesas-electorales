// Consulta de miembros de mesa. La API la sirve el Worker (src/worker.js):
//   GET  /api/captcha  → { token, imagen }
//   POST /api/consulta   { nif, captcha, token } → { designado, distrito, seccion, mesa, cargo, tipo, orden }
//     400 → { error: "captcha" | "nif" }   429 → { error: "limite" } (una consulta cada 10 s por IP)
//
// El listado de miembros de mesa nunca llega al navegador: solo el Worker lo consulta.
'use strict';

const API = '/api';
const LETRAS = 'TRWAGMYFPDXBNJZSQVHLCKE';

function nifValido(nif) {
  if (!/^\d{8}[A-Z]$/.test(nif)) return false;
  return LETRAS[Number(nif.slice(0, 8)) % 23] === nif[8];
}

async function pedirCaptcha() {
  const r = await fetch(`${API}/captcha`, { cache: 'no-store' });
  if (!r.ok) throw new Error('captcha');
  return r.json();
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
const captchaInput = document.getElementById('captcha');
const captchaImg = document.getElementById('captcha-img');
const boton = document.getElementById('btn-consultar');
const resultado = document.getElementById('resultado');
let token = '';

function error(input, mensaje) {
  input.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
  document.getElementById(`${input.id}-error`).textContent = mensaje;
}

async function nuevoCaptcha() {
  captchaInput.value = '';
  try {
    const c = await pedirCaptcha();
    token = c.token;
    captchaImg.src = c.imagen;
  } catch {
    mostrar('error', 'No se ha podido cargar el código de seguridad', 'Inténtelo de nuevo en unos minutos.');
  }
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
    'Debe presentarse el 29 de noviembre a las 8:00 en su colegio electoral. Recibirá la notificación oficial en los próximos días.',
    'Si tiene una causa para no formar parte de la mesa, dispone de 7 días desde la notificación para alegarla ante la Junta Electoral de Zona de Aranda de Duero.');
}

nifInput.addEventListener('input', () => {
  nifInput.value = nifInput.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
});
captchaInput.addEventListener('input', () => {
  captchaInput.value = captchaInput.value.toUpperCase().replace(/\s/g, '');
});
document.getElementById('captcha-reload').addEventListener('click', nuevoCaptcha);

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const nif = nifInput.value.trim();
  const captcha = captchaInput.value.trim();
  error(nifInput, nifValido(nif) ? '' : 'Escriba los 8 dígitos y la letra de su NIF (por ejemplo, 12345678Z).');
  error(captchaInput, captcha ? '' : 'Escriba el código de la imagen.');
  if (!nifValido(nif)) return nifInput.focus();
  if (!captcha) return captchaInput.focus();

  boton.disabled = true;
  try {
    const { status, body } = await enviarConsulta({ nif, captcha, token });
    if (status === 400 && body.error === 'captcha') {
      error(captchaInput, 'El código no es correcto. Pruebe con la nueva imagen.');
      captchaInput.focus();
    } else if (status === 429) {
      mostrar('error', 'Demasiadas consultas', 'Solo se permite una consulta cada 10 segundos. Espere un momento y vuelva a intentarlo.');
    } else if (status !== 200) {
      mostrar('error', 'No se ha podido hacer la consulta', 'Inténtelo de nuevo en unos minutos.');
    } else if (body.designado) {
      mostrarDesignado(body);
    } else {
      mostrar('no', 'No ha sido designado como miembro de mesa',
        'Si cree que se trata de un error, consulte con la Junta Electoral de Zona de Aranda de Duero.');
    }
  } catch {
    mostrar('error', 'No se ha podido hacer la consulta', 'Compruebe su conexión e inténtelo de nuevo.');
  } finally {
    boton.disabled = false;
    nuevoCaptcha();
  }
});

nuevoCaptcha();
