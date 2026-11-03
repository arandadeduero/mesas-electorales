# Mesas electorales · Aranda de Duero

Consulta pública del resultado del sorteo de miembros de mesa (presidentes, vocales y suplentes) para las
Elecciones Generales del 29 de noviembre de 2026 en Aranda de Duero. La persona escribe su NIF, pasa la verificación de
Cloudflare Turnstile y la web le dice si ha sido designada y para qué cargo y mesa. Incluye además la información legal
básica: fechas, dieta, permisos y causas de excusa.

**La web es meramente informativa y no tiene validez legal:** la designación se comunica mediante notificación
personal a cada miembro de mesa. La página lo indica en la cabecera, en cada resultado y en el pie.

Se publica en **https://mesaselectorales.arandadeduero.dev**:

- **La web estática (`web/`)** está en **GitHub Pages**, desplegada con `.github/workflows/deploy-pages.yml`
  en cada push a `main`.
- **La API (`/api/*`)** es un **Cloudflare Worker** (`src/worker.js`) enganchado como ruta en el mismo dominio.
- **El DNS** es un CNAME `mesaselectorales` → `arandadeduero.github.io` **con proxy de Cloudflare**, como el
  resto de webs de `arandadeduero.dev`. El proxy es imprescindible: sin él, la ruta del Worker no intercepta
  `/api/*`.

## ⚠️ Datos personales: nunca al repositorio

Las actas (`pdf/`) y el listado generado (`data/`) contienen DNIs reales. **No se commitean nunca**:

- `.gitignore` excluye `pdf/`, `data/`, `*.pdf`, `mesas_electorales*.json`, `kv-*.json` y `.dev.vars`.
- `scripts/pre-commit` rechaza cualquier commit con esos ficheros o con algo que tenga forma de DNI. Instálalo
  en cada clon:

  ```sh
  cp scripts/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
  ```

- El navegador nunca recibe el listado: solo el Worker lo consulta, y responde únicamente sobre el NIF
  preguntado.
- En Cloudflare tampoco se guardan los NIF en claro. La clave de cada registro en KV es
  `HMAC-SHA256(NIF_KEY, NIF)`, y sin el secreto `NIF_KEY` no se puede saber a quién corresponde. Un hash simple
  no bastaría, porque solo hay 10⁸ DNIs posibles y se podrían probar todos.

## Estructura

```
.
├── web/                  Web estática (se sirve tal cual, sin compilar)
│   ├── index.html        Página única: formulario + información legal
│   ├── styles.css        Paleta corporativa del Ayuntamiento (la de wp-tema-arandadeduero) y fuente Outfit
│   ├── app.js            Formulario: valida el NIF, muestra Turnstile y llama a /api/consulta
│   ├── analytics.js      Google Analytics con consentimiento previo (igual que bienestaranimal y fiestas)
│   ├── CNAME             Dominio de GitHub Pages
│   ├── favicon.ico       Escudo del Ayuntamiento recortado en 1:1 (16, 32 y 48 px) + img/apple-touch-icon.png
│   ├── fonts/  img/      Outfit (OFL) y logo del Ayuntamiento, servidos desde el propio sitio
├── src/worker.js         API: /api/consulta (Siteverify de Turnstile) y Durable Object del límite por IP
├── src/nif.js            Validación del NIF y clave HMAC (compartido con build-kv.mjs)
├── scripts/
│   ├── build-kv.mjs      data/mesas_electorales.json → data/kv-mesas.json (claves HMAC) para cargar en KV
│   └── pre-commit        Bloqueo de datos personales
├── wrangler.jsonc        Configuración del Worker: ruta /api/*, KV, Durable Object y variables
├── .github/workflows/deploy-pages.yml   Publica web/ en GitHub Pages
├── pdf/                  (no versionado) Actas originales de la Junta Electoral de Zona
└── data/                 (no versionado) Listado generado y fichero para KV
```

## API

| Ruta | Respuesta |
|---|---|
| `POST /api/consulta` con `{ nif, turnstile }` | `200 { designado: false }` o `200 { designado: true, distrito, seccion, mesa, cargo, tipo, orden }` |
| | `400 { error: "captcha" \| "nif" \| "peticion" }` |
| | `403`: `Origin` no permitido o cuerpo que no es `application/json` |
| | `413`: cuerpo de más de 4 KB |
| | `429 { error: "limite" }` |

El orden de las comprobaciones es: origen → límite por IP → tamaño y JSON → Turnstile → formato del NIF →
búsqueda en KV. Sin un Turnstile válido no se revela nada sobre el NIF.

- **Captcha: Cloudflare Turnstile** (widget `mesas-electorales`, modo *managed*, sitekey
  `0x4AAAAAAFyJA3X6ExeE2YSl` en `web/app.js`).
  - El Worker valida cada token en Siteverify y exige `success`, la acción `consulta` y un hostname de
    `TURNSTILE_HOSTNAMES`.
  - Cada token vale una sola vez: el navegador reinicia el widget tras cada consulta.
  - Si Siteverify falla o tarda más de 10 s, la consulta se rechaza.
- **Origen:** solo se aceptan peticiones con `Origin` de `ORIGENES` y `Content-Type: application/json`. Así otra
  web no puede lanzar consultas desde el navegador de un visitante ni gastarle su cupo.
- **Límite por IP exacto, además de Turnstile.** Turnstile frena a los bots, pero cada token resuelto vale para
  una consulta y existen servicios que resuelven captchas a cambio de dinero. El límite pone un techo a cuántos NIF
  se pueden probar. Se hace con un Durable Object (`LimiteIp`), uno por IP, o por bloque /64 en IPv6:
  - 1 consulta cada 10 s, lo que equivale como máximo a 6 por minuto y 360 por hora.
  - Cuentan todas las peticiones del propio origen, también las de captcha incorrecto.
  - El valor está en `LIMITES`, en `src/worker.js`.
  - Solo se guardan marcas de tiempo, y se borran tras una hora sin peticiones.
  - No se usa el binding de rate limiting de Workers porque es aproximado (por ubicación y con consistencia
    eventual): en producción dejaba pasar ráfagas.
  - Los Durable Objects exigen que la cuenta tenga un subdominio `workers.dev` (`willyaranda.workers.dev`). El
    Worker tiene `workers_dev: false` y no se publica en él.

## Seguridad: por qué el listado no se puede descargar

- **Repositorio:** `pdf/` y `data/` están en `.gitignore`, el *hook* `scripts/pre-commit` bloquea esos ficheros
  y cualquier cosa con forma de DNI, y el workflow de Pages aborta si `web/` contiene un PDF o un JSON.
  Comprobado el 3-11-2026: ningún commit, rama ni artefacto de Actions contiene datos.
- **GitHub Pages** solo publica `web/`, que no tiene datos.
- **KV:** no tiene URL pública. Solo se accede con credenciales de la cuenta o a través del Worker, que solo hace
  `MESAS.get(HMAC(NIF))`: no hay ningún `list` ni ruta que devuelva más de un registro. Las claves son HMAC, así
  que ni con acceso a la cuenta se sabe a quién pertenece cada registro sin `NIF_KEY`. Los valores no llevan DNI
  ni nombre.
- **Enumeración por fuerza bruta:** hay 10⁸ NIF posibles. Con Turnstile por consulta y 1 consulta cada 10 s por
  IP (o /64), recorrerlos no es viable.
- **Inyección:** no hay base de datos SQL ni plantillas en el servidor. El NIF se valida con
  `/^\d{8}[A-Z]$/` y la letra de control, y solo se usa como entrada del HMAC. En el navegador todo se pinta con
  `textContent`, nunca con `innerHTML`, y la CSP no permite scripts en línea.
- **Logs:** `observability` está desactivado y el Worker no registra el NIF.

### Verificado en producción (3-11-2026)

- **Navegador real:** Turnstile se resuelve solo y en español. El NIF ficticio `12345678Z` devuelve «No ha sido
  designado», con el aviso legal.
- **Con `curl`:**
  - Segunda consulta en menos de 10 s: 429.
  - `Origin` ajeno: 403.
  - Formulario `text/plain` (CSRF): 403.
  - Token falso: 400.
  - Cuerpo de 1 MB: 413.
  - `http://` redirige con un 301 a `https://`.
- **Sin vías de descarga del listado:**
  - Las rutas candidatas dan 404.
  - Ni el historial de git ni los artefactos de Pages contienen datos.
  - El Worker desplegado solo usa `MESAS.get`.
  - `workers.dev` y las *previews* están desactivados.

## Cómo se genera `data/mesas_electorales.json` a partir de los PDF

### Qué contienen los PDF

La Junta Electoral de Zona entrega un PDF por distrito censal
(`ACTAS_COMPOSICION_MIEMBROS_MESAS_ELECTORALES_DISTRITO_N.pdf`). Son **escaneos sin capa de texto**, así que
`pdftotext` no devuelve nada y hay que leerlos como imagen.

- **Una página = una mesa.**
- **Cabecera:** Circunscripción, Municipio, **Distrito Censal** (`01`), **Sección** (`001`) y **Mesa** (`U`,
  `A`, `B` o `C`).
- **Tabla:** siempre 9 filas en este orden fijo, con las columnas cargo, 1.er apellido, 2.º apellido, nombre,
  **D.N.I.**, nº de elector y dirección:

  | Fila | Bloque | Cargo en el acta | `cargo` | `tipo` | `orden` |
  |---|---|---|---|---|---|
  | 1 | Titulares | PRESIDENTE/A | `Presidente` | `titular` | `null` |
  | 2 | | 1º VOCAL | `1º Vocal` | `titular` | `null` |
  | 3 | | 2º VOCAL | `2º Vocal` | `titular` | `null` |
  | 4 | Suplentes | 1º DE PRESIDENTE/A | `Presidente` | `suplente` | `1` |
  | 5 | | 2º DE PRESIDENTE/A | `Presidente` | `suplente` | `2` |
  | 6 | | 1º DE 1º VOCAL | `1º Vocal` | `suplente` | `1` |
  | 7 | | 2º DE 1º VOCAL | `1º Vocal` | `suplente` | `2` |
  | 8 | | 1º DE 2º VOCAL | `2º Vocal` | `suplente` | `1` |
  | 9 | | 2º DE 2º VOCAL | `2º Vocal` | `suplente` | `2` |

### Estructura del JSON

Un array con un objeto por persona designada (9 × número de mesas). Solo se guardan los campos necesarios: ni
nombres ni direcciones.

```json
[
  {
    "distrito": "01",
    "seccion": "001",
    "mesa": "U",
    "dni": "12345678Z",
    "cargo": "Presidente",
    "tipo": "titular",
    "orden": null,
    "documento": "ACTAS_COMPOSICION_MIEMBROS_MESAS_ELECTORALES_DISTRITO_1.pdf",
    "pagina": 1
  }
]
```

`distrito`, `seccion` y `mesa` son cadenas con los ceros a la izquierda tal como figuran en el acta.
`documento` y `pagina` sirven para localizar cada registro en el PDF original. El Worker no los usa.

### Procedimiento

1. **Rasterizar:** `pdftoppm -r 150 -png pdf/…DISTRITO_1.pdf d1` (poppler).
2. **Recortar** de cada página solo la cabecera (distrito, sección, mesa) y la columna D.N.I. A 150 ppp, la
   cabecera está más o menos en `x 805–1150, y 140–180` y la tabla en `x 1000–1235, y 375–892`. Juntar los
   recortes de varias páginas en una sola imagen acelera mucho la lectura.
3. **Leer** los recortes. Tesseract sobre la página completa falla mucho por las líneas de la tabla y el texto
   en negrita. Recortado a la columna, con `--psm 6` y lista blanca de caracteres, acierta la mayoría. Lo más
   rápido y fiable fue leer los recortes y usar el OCR solo para contrastar.
4. **Validar antes de dar por bueno el fichero:**
   - Cada página tiene exactamente 9 DNIs.
   - Cada DNI tiene la letra correcta: `"TRWAGMYFPDXBNJZSQVHLCKE"[número % 23]`.
   - No hay DNIs repetidos.
   - La letra de la mesa coincide con la inicial del nº de elector de la página (los de la mesa U
     empiezan por `U`, los de la A por `A`, etc.).
   - El número de mesas por distrito coincide con el número de páginas.
   - `scripts/build-kv.mjs` vuelve a comprobar la letra y los duplicados y aborta si algo falla.

Para 2026 se generaron 414 registros: 46 mesas (19 + 12 + 15 páginas) en los distritos 01, 02 y 03.

## Desarrollo en local

Requisitos: Node 20 o superior.

```sh
npm install
# Variables locales (no versionadas). Turnstile usa sus claves de PRUEBA públicas, que siempre aprueban.
cat > .dev.vars <<VARS
NIF_KEY="$(openssl rand -hex 32)"
TURNSTILE_SECRET="1x0000000000000000000000000000000AA"
TURNSTILE_HOSTNAMES="example.com"
TURNSTILE_PRUEBAS="1"
ORIGENES="http://mesaselectorales.arandadeduero.dev"
VARS
npm run kv:build                                                     # → data/kv-mesas.json
npx wrangler kv bulk put data/kv-mesas.json --binding MESAS --local && rm data/kv-mesas.json
npm run dev                                                          # web + API en http://localhost:8787
```

Notas sobre el entorno local:
- **Claves de prueba de Turnstile:** devuelven `hostname: example.com` y ninguna acción, por eso existe
  `TURNSTILE_PRUEBAS`. Esa variable no debe existir en producción, y aunque existiera no tendría efecto con el
  secreto real.
- **`ORIGENES`:** `wrangler dev` reescribe la cabecera `Origin` al dominio de la ruta, en `http`. Por eso el valor
  local no es `127.0.0.1`.
- **KV local:** se guarda por id de namespace. Si cambia el id en `wrangler.jsonc`, hay que volver a cargarlo.

## Despliegue

### Web (GitHub Pages)

- Repositorio `arandadeduero/mesas-electorales`. En *Settings → Pages*, la fuente es **GitHub Actions** y el
  dominio personalizado es `mesaselectorales.arandadeduero.dev`. El dominio `arandadeduero.dev` ya está verificado
  en la organización.
- Cada push a `main` que toque `web/` publica de nuevo. El workflow aborta si `web/` contiene algún PDF o JSON.
- La CSP va en un `<meta>` de `index.html`, porque GitHub Pages no permite cabeceras propias.

### API (Cloudflare Worker)

Cuenta `Willyaranda@gmail.com's Account`, zona `arandadeduero.dev`.

**Ya creado:**
- Registro DNS: `CNAME mesaselectorales → arandadeduero.github.io`, con proxy.
- HTTPS obligatorio para toda la zona: «Always Use HTTPS», HSTS (`includeSubDomains; preload`) y TLS 1.2 como
  mínimo. Además, `.dev` está en la lista HSTS de los navegadores.
- KV `mesas-electorales-MESAS` (id en `wrangler.jsonc`).
- Widget de Turnstile `mesas-electorales`, solo para `mesaselectorales.arandadeduero.dev`.
- Secretos del Worker: `NIF_KEY` y `TURNSTILE_SECRET`. El de Turnstile se copió del widget al Worker sin pasar
  por disco. Si hubiera que rotarlo, se hace desde el panel de Turnstile y se vuelve a poner con
  `wrangler secret put TURNSTILE_SECRET`.

**Para desplegar o actualizar:**

1. **Iniciar sesión:** `npx wrangler login`
2. **`NIF_KEY` de producción** (ya creada; **no regenerarla**, o el KV dejaría de coincidir). Está en
   `.dev.vars.production`, que git ignora. Guárdala también en un gestor de contraseñas.
3. **Cargar los datos** con esa misma `NIF_KEY`:
   ```sh
   NIF_KEY="$(sed -n 's/^NIF_KEY="\(.*\)"$/\1/p' .dev.vars.production)" npm run kv:build
   npx wrangler kv bulk put data/kv-mesas.json --binding MESAS --remote
   rm data/kv-mesas.json
   ```
4. **Publicar:** `npm run deploy`. Crea la ruta `mesaselectorales.arandadeduero.dev/api/*`.
5. **Comprobar** en la web publicada:
   - Un NIF ficticio (`12345678Z`) debe devolver «No ha sido designado».
   - Dos consultas seguidas deben dar el aviso de límite.
   - Una petición con otro `Origin` debe dar 403.

**Si cambian los datos** (por ejemplo, una sustitución tras una alegación): regenerar el JSON, repetir el paso 4
y, si se ha quitado algún registro, borrar su clave con `npx wrangler kv key delete <hash> --binding MESAS
--remote`. `bulk put` no borra lo que ya no está en el fichero.

**Al cambiar `app.js`, `analytics.js` o `styles.css`:** subir su `?v=N` en `web/index.html`, para que la caché
no sirva la versión antigua.

## Analítica

Google Analytics (`G-BXMC22W46S`, la misma propiedad que bienestaranimal y fiestas) con consentimiento previo:

- El script de Google no se descarga ni envía nada hasta que se pulsa «Aceptar».
- Denegar tiene el mismo peso visual que Aceptar.
- Se respeta *Do Not Track*.
- Solo se miden visitas: el NIF y el resultado de la consulta nunca se envían a Google. El formulario no cambia
  la URL ni lanza eventos. Además, el campo NIF no tiene `name` y la CSP lleva `form-action 'none'`, así que ni
  un envío nativo podría poner el NIF en una URL.
- Turnstile (`challenges.cloudflare.com`) es el otro recurso de terceros. La página lo explica junto al widget,
  con enlace a la política de privacidad de Cloudflare.

## Fuentes de la información legal

LOREG (Ley Orgánica 5/1985), Real Decreto 806/2026 de convocatoria, RD 605/1999, Orden INT/650/2026 (dieta de
75 €) e Instrucción 6/2011 de la Junta Electoral Central, modificada por última vez por la Instrucción 2/2025.
Comprobadas en el BOE el 3 de noviembre de 2026. El sorteo se celebró en el pleno del Ayuntamiento del 3 de
noviembre de 2026 a las 9:30.
