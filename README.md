# Corporación Ad Astra: credenciales de tripulación

Sitio estático en GitHub Pages: https://adastracorporation.github.io/Membership/

Cada miembro llena sus datos y descarga su credencial en **PNG** o **PDF** (A6).
No hay base de datos ni servidor: los datos viajan comprimidos en el enlace
(`#d=...`), y ese enlace es lo que lleva el **QR**. Al escanearlo, la página
reconstruye la misma credencial.

## Cómo funciona

- **Aislado:** no consume ningún servicio externo. La Content-Security-Policy de
  `index.html` hace que el navegador bloquee cualquier conexión fuera del sitio.
- **Sin almacenamiento:** los datos viajan comprimidos (deflate + base64url) en el
  fragmento `#d=` del enlace, que es lo que lleva el QR. El fragmento no llega al
  servidor.
- **Foto:** se usa solo en el navegador para el PNG y el PDF. No cabe en el QR; al
  escanearlo, la credencial muestra el emblema de la corporación.
- **ID** `AA-XXXX`: se calcula a partir de los datos, siempre igual para la misma credencial.

## Unirse a una tripulación

1. Se escanea el QR de un miembro de la crew y se pulsa **Unirme a esta tripulación**.
2. Se escribe la **contraseña de la crew**. El QR lleva su hash (campo `h`) y debe
   coincidir con el hash oficial de `config.json` (`crews.<id>.clave`).
3. La credencial nueva lleva el mismo hash, así que su QR también puede invitar.

La primera credencial de cada crew se crea con **Soy fundador de una tripulación**
(pide la misma contraseña).

Hash: PBKDF2-SHA256, 210 000 iteraciones, sal `ad-astra:<crew>`, 16 bytes.

### Cambiar la contraseña de una crew

```
node tools/clave.mjs C3 "frase larga y difícil de adivinar"
```
Pega el resultado en `config.json` → `crews.C3.clave` y haz push. Los QR anteriores
de esa crew siguen mostrando la credencial, pero ya no sirven para invitar.

### Límites (importante)

Todo ocurre en el navegador y el hash es público (va en cada QR y en `config.json`):
- Es un **control social, no de seguridad**: quien sepa usar las herramientas del
  navegador puede saltárselo.
- Una contraseña corta se puede adivinar por fuerza bruta. Usa frases largas.

## Archivos

```
index.html   página (crear y ver)
app.js       lógica: formulario, codificación del enlace, QR, PNG y PDF
style.css    estilos
config.json  crews (nombre, color, hash de contraseña) y roles  ← EDITAR
tools/       clave.mjs: calcula el hash de la contraseña de una crew
logo.svg     logo (web)   logo.png  logo (para el PNG)
vendor/      html2canvas y qrcode-generator (MIT)
.nojekyll    sirve los archivos tal cual en Pages
```

## Publicación

El workflow `.github/workflows/pages.yml` publica la raíz del repo en cada push a
`main` (fuente de Pages: GitHub Actions). No hay paso de compilación.

## Probar en local

```
python3 -m http.server 8000
```
y abre http://localhost:8000
