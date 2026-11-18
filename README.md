# Corporación Ad Astra: credenciales de tripulación

Sitio estático en GitHub Pages: https://adastracorporation.github.io/Membership/

Toma datos y genera la credencial en **PNG** (frente y reverso) o **PDF** (A6, una cara por
página). No guarda nada y funciona aislado: no consume ningún servicio externo.

## Cómo funciona

- **Todo va en el QR.** El QR del reverso contiene la credencial completa: datos, foto y
  logo de la crew (estos dos como miniaturas WebP de unos 100 px). Al escanearlo, la página
  la reconstruye. El sitio no recibe nada: los datos van en el fragmento `#C…` del enlace,
  que el navegador no envía al servidor.
- **Crews.** Cualquiera puede fundar una: nombre, color, estilo y contraseña. Recibe un
  **ID único** (`CR-XXXXXX`), así que dos crews con el mismo nombre son distintas.
- **Unirse.** Se escanea el QR de un miembro, se pulsa *Unirme a esta tripulación* y se
  escribe la contraseña de la crew. La credencial nueva hereda la crew (incluido su logo) y su
  QR también puede invitar.
- **Estilos.** Clásica, Nocturna, Minimal y Ceremonial. Los elige el fundador, que además
  decide si cada miembro puede escoger el suyo. Quien se une recibe el estilo de la crew.
- **Vencimiento.** Las credenciales vencen al año de su emisión. Una vencida muestra el
  sello *VENCIDA*, no sirve para invitar y se puede **renovar** con la contraseña.
- **Aislado.** La Content-Security-Policy de `index.html` bloquea en el navegador cualquier
  conexión fuera del sitio.

## Detalles técnicos

- Enlace: `<página>#C<base43>`. Base43 usa solo caracteres del modo alfanumérico del QR
  (`0-9 A-Z $ * + - . / :`), más compacto que el texto normal. El QR tiene dos segmentos:
  la dirección (modo byte) y los datos (alfanumérico), con corrección de errores M o L.
- Bytes: `[2][largo JSON][JSON deflate-raw]` y por imagen `[tipo][formato][largo][bytes]`.
- Imágenes: se ajustan a un presupuesto (~1,4 KB entre las dos), sin canal alfa y sin
  metadatos (perfil de color, EXIF), que en miniaturas pesan más que la propia imagen.
- Contraseña: PBKDF2-SHA256, 210 000 iteraciones. La sal incluye el ID de la crew, su estilo
  y si los miembros pueden elegir estilo; alterar eso en un QR invalida la contraseña.
- ID de miembro `AA-XXXX`: derivado de nombre, especie e ID de crew; no cambia al renovar.

## Límites

- Es un control social, no de seguridad: todo ocurre en el navegador y el hash de la
  contraseña va en cada QR. Alguien con conocimientos técnicos puede saltárselo, y una
  contraseña corta se puede adivinar por fuerza bruta. Usa frases largas.
- Con foto y logo el QR es denso (versión ~35). Se lee bien desde la pantalla o impreso a
  buen tamaño; muy pequeño puede costar.
- El vencimiento usa el reloj del dispositivo que escanea.

## Archivos

```
index.html   página
app.js       lógica: formularios, empaquetado, QR, estilos, PNG y PDF
style.css    estilos de la página y de la credencial
logo*.png    emblema y constelación   favicon.png  icono
vendor/      html2canvas y qrcode-generator (MIT)
.github/workflows/pages.yml   publica la raíz en Pages en cada push a main
```

## Probar en local

```
python3 -m http.server 8000
```
