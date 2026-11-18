# Corporación Ad Astra: credenciales de tripulación

Sitio estático en GitHub Pages: https://adastracorporation.github.io/Membership/

Toma datos y genera la credencial en **PNG** (dos archivos: frente y reverso) o **PDF** (A6,
una cara por página). Al escanear un QR, la vista muestra solo el frente; las descargas
incluyen las dos caras. No guarda nada y funciona aislado: no consume ningún servicio externo.

## Cómo funciona

- **Todo va en el QR.** El QR del reverso contiene la credencial completa: datos, foto y
  logo de la crew (estos dos como miniaturas WebP de unos 100–160 px, o **GIF animados**). Al escanearlo, la página
  la reconstruye. El sitio no recibe nada: los datos van en el fragmento `#C…` del enlace,
  que el navegador no envía al servidor.
- **Crews.** Cualquiera puede fundar una: nombre, color, estilo y contraseña. Recibe un
  **ID único** (`CR-XXXXXX`), así que dos crews con el mismo nombre son distintas.
- **Unirse.** Se escanea el QR de un miembro, se pulsa *Unirme a esta tripulación* y se
  escribe la contraseña de la crew. La credencial nueva hereda la crew (incluido su logo) y su
  QR también puede invitar.
- **Estilos.** Clásica, Nocturna, Minimal y Ceremonial. Los elige el fundador, que además
  decide si cada miembro puede escoger el suyo. Quien se une recibe el estilo de la crew.
- **Vencimiento.** Las credenciales vencen al año de su emisión, salvo la del **líder** (quien
  fundó la crew), que es permanente. La marca de líder no se hereda al unirse. Una vencida muestra el
  sello *VENCIDA*, no sirve para invitar y se puede **renovar** con la contraseña.
- **Imágenes por enlace.** En vez de subir la foto o el logo se puede poner un enlace `https`.
  Entonces el QR guarda solo la dirección (unos pocos bytes en lugar de ~1,5 KB): mucho más
  liviano y la imagen se ve en su calidad original, GIF incluidos. Depende de que el enlace siga
  activo, y el sitio que la aloja verá quién abre la credencial. Si además se sube el archivo,
  se usa solo para el PNG y el PDF. Quien se une hereda el enlace del logo de la crew.
- **Aislado.** La Content-Security-Policy de `index.html` bloquea en el navegador cualquier
  conexión fuera del sitio, salvo las imágenes `https` que el propio usuario enlaza.

## Detalles técnicos

- Enlace: `<página>#C<base43>`. Base43 usa solo caracteres del modo alfanumérico del QR
  (`0-9 A-Z $ * + - . / :`), más compacto que el texto normal. El QR tiene dos segmentos:
  la dirección (modo byte) y los datos (alfanumérico), con corrección de errores M o L.
- Imagen por enlace: bloque de formato 4 con la dirección en UTF-8 (solo `https`, ≤500).
- Enlaces de Google: un archivo compartido de **Google Drive** se convierte solo a imagen
  directa (`lh3.googleusercontent.com/d/<id>`), y una imagen directa de **Google Fotos**
  (`lh3.googleusercontent.com/…`) se ajusta a 512 px (`=s512`). El enlace de *compartir* de
  Google Fotos (`photos.app.goo.gl/…`) es una página, no una imagen, y convertirlo exigiría un
  servidor: la página lo detecta y guía para copiar la dirección de la imagen.
- **Redes sociales:**
  - Sirven X, Reddit, Pinterest, Bluesky, Tumblr, Fur Affinity, DeviantArt e Imgur. Con el
    enlace de una publicación, la página muestra un botón para abrirla y dice qué dirección de
    imagen copiar (p. ej. `https://pbs.twimg.com/…`). Las páginas de Imgur se convierten solas
    y las imágenes de X se ajustan a tamaño mediano.
  - No sirven Instagram, Facebook, Threads, Discord, TikTok, Telegram ni iCloud: abren
    páginas y las direcciones de sus imágenes caducan (Discord, en unas 24 horas). La página
    lo explica y sugiere subir el archivo.
- Imágenes cuyo sitio no permite copiarlas (sin CORS, como Google Fotos o Drive): se ven en
  pantalla, al escanear y en el PDF; en el PNG van con el emblema en su lugar y se avisa.
- Bytes (v3, binario): cabecera de 29 bytes (banderas, ID de crew en 30 bits, color RGB,
  emisión en días desde 2020, hash crudo de 16 bytes), textos separados por `␟` y comprimidos
  solo si ahorra, y por imagen `[tipo<<4|formato][largo][bytes]`.
- Imágenes: presupuesto de ~1,4 KB entre las dos (~2,3 KB si hay GIF animado). Reescalado
  de alta calidad y bisección de la calidad para aprovecharlo; sin canal alfa ni metadatos
  (perfil de color, EXIF), que en miniaturas pesan más que la propia imagen.
- GIF animado: se decodifica con `ImageDecoder` y se recodifica con un encoder GIF propio
  (paleta reducida, menos cuadros, y en cada cuadro solo los píxeles que cambian). La foto
  prima la fluidez; el logo, la nitidez. Sin `ImageDecoder` (algunos Safari) se usa el
  primer cuadro. El PNG y el PDF muestran un cuadro.
- Carga: html2canvas (~200 KB) solo se descarga al pedir el PNG; qrcode va minificado.
- Contraseña: PBKDF2-SHA256, 210 000 iteraciones. La sal incluye el ID de la crew, su estilo
  y si los miembros pueden elegir estilo; alterar eso en un QR invalida la contraseña.
- ID de miembro `AA-XXXX`: derivado de nombre, especie e ID de crew; no cambia al renovar.

## Límites

- Es un control social, no de seguridad: todo ocurre en el navegador y el hash de la
  contraseña va en cada QR. Alguien con conocimientos técnicos puede saltárselo, y una
  contraseña corta se puede adivinar por fuerza bruta. Usa frases largas.
- Con foto y logo el QR es denso (versión ~35, cerca de 40 con GIF animados). Se lee bien desde la pantalla o impreso a
  buen tamaño; muy pequeño puede costar.
- El vencimiento usa el reloj del dispositivo que escanea.
- Una imagen enlazada solo sale en el PNG si su sitio permite CORS (Google no lo permite);
  si no, el PNG lleva el emblema en su lugar. El PDF sí la incluye; subir el archivo también.

## Archivos

```
index.html   página
app.js       lógica: formularios, empaquetado, QR, estilos, PNG y PDF
style.css    estilos de la página y de la credencial
logo.png     emblema   favicon.png  icono
vendor/      html2canvas y qrcode-generator minificado (MIT)
.github/workflows/pages.yml   publica la raíz en Pages en cada push a main
```

## Probar en local

```
python3 -m http.server 8000
```
