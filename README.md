# Corporación Ad Astra: directorio de miembros

Sitio estático en GitHub Pages con autoregistro por código de invitación.
Todo funciona en planes gratuitos: GitHub Pages, GitHub Actions y Cloudflare Workers.

## Cómo funciona

```
registro.html ──POST──▶ Worker (Cloudflare) ──commit──▶ repo ──push──▶ deploy.yml ──▶ Pages
   (reduce la foto       valida el código firmado,        data/members/<slug>.json
    a 800 px en el       toma crew y rol del código       img/<slug>.webp
    navegador)           y hace UN commit                 data/invites/<código>.json
```

- Cada miembro tiene su propio JSON e imagen, así que los registros nunca chocan.
- `members.json` (el índice) se genera en el build; nunca se commitea.
- Cada código sirve **una sola vez**: el commit de alta crea `data/invites/<código>.json`.
- Si dos registros llegan a la vez, el Worker reintenta sobre el nuevo HEAD.

## Estructura

```
site/                  páginas: index (directorio), ficha (PNG/PDF), registro
site/config.js         URL del Worker  ← EDITAR
site/logo.svg|png      logo (SVG para la web, PNG para la credencial descargable)
site/vendor/           html2canvas y qrcode-generator (MIT), sin depender de un CDN
data/config.json       nombres y colores de crews, nombres de roles  ← EDITAR
data/members/          una ficha por fursona (la escribe el Worker)
data/invites/          códigos ya usados (los escribe el Worker)
img/                   imágenes (las escribe el Worker)
worker/                relay de registro (Cloudflare Worker)
scripts/build-site.mjs genera _site/ para Pages
scripts/make-invite.mjs genera códigos de invitación
.github/workflows/deploy.yml  build y publicación en Pages
```

## Puesta en marcha

1. **Repo:** ya creado en `AdAstraCorporation/Membership`. Sitio: https://adastracorporation.github.io/Membership/
   ```
   git remote add origin https://github.com/AdAstraCorporation/Membership.git
   git push -u origin main
   ```
2. **Pages:** Settings → Pages → Source: **GitHub Actions**.
3. **Token para el Worker:** crea un *fine-grained personal access token* con acceso
   **solo** a este repo y permiso **Contents: Read and write**.
4. **Worker:**
   ```
   cd worker
   npx wrangler login
   npx wrangler secret put INVITE_SECRET   # una frase larga y aleatoria
   npx wrangler secret put GH_TOKEN        # el token del paso 3
   npx wrangler deploy
   ```
   Revisa en `worker/wrangler.toml` que `GH_REPO` y `ALLOWED_ORIGIN` sean correctos.
5. **URL del Worker:** pon la URL que te dio `wrangler deploy` en `site/config.js`, commit y push.
6. **Crews y roles:** edita `data/config.json`.
7. **Ejemplo:** borra `data/members/ejemplo-fursona.json` e `img/ejemplo-fursona.svg`.

## Generar códigos de invitación

```
INVITE_SECRET=<el mismo del Worker> node scripts/make-invite.mjs C3 R2       # 1 código
INVITE_SECRET=<el mismo del Worker> node scripts/make-invite.mjs C1 R1 5     # 5 códigos
```

El formato es `C<n>-R<n>-<aleatorio>.<firma>`. La crew y el rol salen del código, así que
el formulario no puede cambiarlos. Sin `INVITE_SECRET` nadie puede fabricar códigos válidos.

## Editar o dar de baja a un miembro

Edita o borra `data/members/<slug>.json` y su imagen directamente en GitHub. Ten en cuenta
que el historial de git es público: lo borrado sigue en commits anteriores. Para eliminarlo
del todo hay que reescribir el historial (`git filter-repo`).

## Probar en local

```
npm run serve
```
