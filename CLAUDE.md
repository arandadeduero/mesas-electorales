# Reglas del proyecto (mesas-electorales)

Consulta del sorteo de miembros de mesa de Aranda de Duero. Web estática en GitHub Pages (`web/`) y API en un
Cloudflare Worker en `/api/*` (`src/worker.js`), las dos en https://mesaselectorales.arandadeduero.dev. Los detalles
están en [README.md](README.md).

## ⚠️ Datos personales: lo primero, siempre

- **`pdf/` y `data/` NUNCA se commitean**, ni con `git add -f` ni con `--no-verify`, ni se suben a ningún otro
  sitio. Contienen DNIs reales de cientos de vecinos y el repositorio es **público**.
- Nada de DNIs reales en código, tests, README, mocks ni mensajes de commit: usar `12345678Z` y `00000000T`. Los
  números de elector (una letra de mesa seguida de 4 dígitos) tampoco van en ningún sitio.
- **Antes de cada commit o push**, además del *hook* `scripts/pre-commit`:
  1. Revisar `git diff --cached --name-only`.
  2. Buscar en el contenido del índice (`git show :<fichero>`) los 414 DNIs de `data/mesas_electorales.json`,
     también solo los 8 dígitos.
  3. Buscar cualquier `\d{8}[A-Z]`, números de elector `[UABC]\d{4}` y las claves de `.dev.vars*`.

  El usuario lo exige y quiere que se le diga el resultado.
- No enviar los DNIs a servicios remotos, incluido el MCP de Cloudflare. El KV se calcula en local con
  `scripts/build-kv.mjs` (claves HMAC) y se sube con Wrangler. `data/kv-mesas.json` se borra después.
- Las capturas o volcados con DNIs se hacen en el scratchpad y se borran al terminar.

## Secretos

- **Producción:** `NIF_KEY` y `TURNSTILE_SECRET` son secretos del Worker.
  - `NIF_KEY` está también en `.dev.vars.production`, que git ignora. **No regenerarla**: el KV dejaría de
    coincidir.
  - `TURNSTILE_SECRET` no está en disco. Se copió del widget al Worker dentro del MCP sin devolverlo. Si hay que
    rotarlo, hacerlo igual.
- **Local:** `.dev.vars` lleva una `NIF_KEY` propia, las claves de PRUEBA públicas de Turnstile
  (`TURNSTILE_PRUEBAS="1"`, hostname `example.com`) y `ORIGENES="http://mesaselectorales.arandadeduero.dev"`.
- **Nunca** definir `TURNSTILE_PRUEBAS` ni el secreto de prueba en producción: desactivaría el captcha.
- Los secretos se pasan por la entrada estándar (`printf %s … | npx wrangler secret put X`), nunca como argumento
  ni en el chat.

## Cloudflare

- **Cuenta y zona:** la cuenta personal del usuario en Cloudflare, zona `arandadeduero.dev`.
- **Quién hace qué:** el usuario quiere que Claude haga todo lo de Cloudflare. Wrangler ya tiene sesión iniciada y
  el MCP de Cloudflare está autenticado. Wrangler no tiene permiso de DNS ni de Turnstile; para eso, el MCP.
- **Recursos:**
  - DNS: `CNAME mesaselectorales → arandadeduero.github.io`, con proxy (imprescindible para la ruta del Worker).
  - Ruta: `mesaselectorales.arandadeduero.dev/api/*`.
  - KV `mesas-electorales-MESAS`.
  - Durable Object `LimiteIp`.
  - Widget de Turnstile `mesas-electorales` (sitekey `0x4AAAAAAFyJA3X6ExeE2YSl`, en `web/app.js`).
- **HTTPS** está forzado para toda la zona: Always Use HTTPS, HSTS con `preload` y TLS 1.2 como mínimo. No hay que
  tocarlo.
- **Límite por IP:** se hace con el Durable Object, no con el binding `ratelimits`. El binding es aproximado y en
  producción dejaba pasar ráfagas. Los Durable Objects exigen un subdominio `workers.dev`; ya existe
  (`willyaranda`) y el Worker tiene `workers_dev: false`.
- **Despliegue:**
  - API: `npm run deploy`.
  - Web: push a `main` (el workflow publica solo `web/`).
  - Tras desplegar, comprobar en producción: 429, 403 de otro origen, token falso 400, y una consulta real con
    Chrome usando el NIF ficticio.

## Trampas conocidas

- **`wrangler dev` reescribe `Origin`** al dominio de la ruta, en `http`. Por eso `ORIGENES` en `.dev.vars` no es
  `127.0.0.1`.
- **El KV local se guarda por id de namespace.** Si cambia el id en `wrangler.jsonc`, hay que recargarlo:
  `npm run kv:build && npx wrangler kv bulk put data/kv-mesas.json --binding MESAS --local && rm data/kv-mesas.json`.
- **Un elemento con `id="turnstile"` pisa `window.turnstile`** (los ids se exponen como globales). Por eso el
  contenedor se llama `widget-turnstile`.
- **`src/worker.js` importa `cloudflare:workers`**, que no existe en Node. Lo que comparte con
  `scripts/build-kv.mjs` está en `src/nif.js`.
- **`wrangler secret delete` no admite `--force`:** se confirma con `echo y | npx wrangler secret delete X`.
- **Navegadores para probar:**
  - La extensión de Chrome no llega a `localhost`. Para probar en local se usa el Playwright de
    `../fiestas/node_modules/playwright` (tiene Chromium instalado).
  - Chrome sí sirve contra producción. Allí Playwright headless no obtiene un token real de Turnstile.

## Código y contenido

- **Idioma:** español en el contenido, los commits y los mensajes. En la web se trata de «usted».
- **Colores:** solo los de la paleta corporativa (variables del `:root` de `web/styles.css`, la misma que
  `wp-tema-arandadeduero`). Nada de colores escritos a mano ni estilos en línea.
- **Fuente:** solo Outfit, servida desde el propio sitio.
- **Recursos de terceros:** solo Google Analytics (`G-BXMC22W46S`, con consentimiento previo, como bienestaranimal
  y fiestas) y Turnstile. Ninguno más sin preguntar.
- **El NIF y el resultado nunca van a Analytics ni a una URL.** El campo no tiene `name` y la CSP lleva
  `form-action 'none'`.
- **Caché:** al cambiar `app.js`, `analytics.js` o `styles.css`, subir su `?v=N` en `web/index.html`.
- **Pintar en el DOM** siempre con `textContent` o `createElement`, nunca con `innerHTML`.
- **La web es solo informativa:** el aviso legal debe seguir en la cabecera, en cada resultado y en el pie.
- **Información legal:** verificada en el BOE el 3-11-2026 (LOREG, RD 806/2026, RD 605/1999, Orden INT/650/2026,
  Instrucción 6/2011 modificada por la 2/2025). No citar a Onda Cero. Los cambios de contenido legal se verifican
  con fuentes primarias.
- **Commits:** terminan con `Co-Authored-By: Claude <modelo> <noreply@anthropic.com>`.
