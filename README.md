# Corporación Ad Astra: credenciales de tripulación

Sitio estático en GitHub Pages: https://adastracorporation.github.io/Membership/

Cada miembro llena sus datos y descarga su credencial en **PNG** o **PDF** (A6).
No hay base de datos ni servidor: los datos viajan comprimidos en el enlace
(`#d=...`), y ese enlace es lo que lleva el **QR**. Al escanearlo, la página
reconstruye la misma credencial.

## Cómo funciona

- Datos: nombre, especie, pronombres, crew, rol, fecha de alta y, opcionalmente,
  un enlace a la imagen. Se comprimen (deflate) y se codifican en base64url.
- El fragmento `#d=` no se envía al servidor, así que GitHub nunca recibe los datos.
- La **foto subida desde el equipo** se usa solo en el navegador para el PNG y el PDF.
  No cabe en un QR. Para que aparezca al escanear, el miembro pega un **enlace
  público** a la imagen.
- El **ID** (`AA-XXXX`) se calcula a partir de los datos, así que siempre es el mismo
  para la misma credencial.
- No hay verificación: cualquiera puede generar una credencial. El QR sirve para
  reconstruirla, no para autenticarla.

## Archivos

```
index.html   página (crear y ver)
app.js       lógica: formulario, codificación del enlace, QR, PNG y PDF
style.css    estilos
config.json  crews (nombre y color) y roles  ← EDITAR
logo.svg     logo (web)   logo.png  logo (para el PNG)
vendor/      html2canvas y qrcode-generator (MIT)
.nojekyll    sirve los archivos tal cual en Pages
```

## Publicación

Pages está configurado como "Deploy from a branch": `main`, carpeta raíz.
Cada push a `main` publica el sitio; no hay paso de compilación.

## Probar en local

```
python3 -m http.server 8000
```
y abre http://localhost:8000
