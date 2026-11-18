# Corporación Ad Astra: credenciales de tripulación

Sitio estático en GitHub Pages: https://adastracorporation.github.io/Membership/

Toma datos y genera la credencial en **PNG** (frente y reverso) o **PDF** (A6, una cara por
página). No guarda nada y funciona aislado: no consume ningún servicio externo.

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
- **Aislado.** La Content-Security-Policy de `index.html` bloquea en el navegador cualquier
  conexión fuera del sitio.

## Detalles técnicos

- Enlace: `<página>#C<base43>`. Base43 usa solo caracteres del modo alfanumérico del QR
  (`0-9 A-Z $ * + - . / :`), más compacto que el texto normal. El QR tiene dos segmentos:
  la dirección (modo byte) y los datos (alfanumérico), con corrección de errores M o L.
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
