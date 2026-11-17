# Corporación Ad Astra: directorio de miembros

Sitio estático (GitHub Pages) con autoregistro por código de invitación.

## Piezas

```
data/members/<slug>.json    una ficha por fursona (la escribe el pipeline)
img/<slug>.webp             una imagen por fursona (la escribe el pipeline)
site/                       HTML/JS estático
scripts/build-site.mjs      genera _site/ (incluye members.json) en el build de Pages
scripts/register.mjs        valida y crea ficha + imagen (lo ejecuta register.yml)
worker/index.js             relay: valida el código firmado y dispara el registro
.github/workflows/
  register.yml              repository_dispatch "register": crea ficha y commit
  deploy.yml                build y publicación en Pages
```

## Flujo de registro

1. El formulario envía datos y URL de la foto al Worker.
2. El Worker verifica la firma HMAC del código de invitación (secreto `INVITE_SECRET`).
3. Si es válido, dispara `repository_dispatch` con `event_type: register` usando `GH_TOKEN`.
4. `register.yml` descarga la foto, la redimensiona a WebP y escribe `data/members/<slug>.json`.
5. Commit y push con `concurrency`, así los registros se procesan de uno en uno.
6. `deploy.yml` se dispara con el push y publica en Pages.

## Formato del código de invitación

`<datos>.<firma>`, por ejemplo `C3-R2-7F9K.a1b2c3d4`.

- `datos` lleva los campos que quieras (crew, rol, etc.).
- `firma` es HMAC-SHA256 de `datos` con `INVITE_SECRET`, en base64url, truncada a 8 caracteres.
- Para generar códigos: `node scripts/make-invite.mjs C3-R2-7F9K` (usa `INVITE_SECRET`).

## Secretos necesarios

| Dónde | Nombre | Uso |
|---|---|---|
| Worker | `INVITE_SECRET` | verificar códigos |
| Worker | `GH_TOKEN` | disparar `repository_dispatch` (fine-grained, solo este repo, Contents: write) |
| Worker | `GH_REPO` | `owner/repo` |

## Pendiente de decidir

- Códigos de un solo uso o reutilizables (de un solo uso requiere guardar estado).
- Edición y baja de fichas por parte del miembro.
- Campos públicos y datos personales a excluir.
- Consentimiento para publicar fotos de personas reales.

El historial de git es público: un dato borrado sigue en commits anteriores.
