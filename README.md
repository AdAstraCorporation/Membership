# Corporación Ad Astra: credenciales de tripulación

Sitio estático en GitHub Pages: https://adastracorporation.github.io/Membership/

Toma datos y genera la credencial en **PNG** (frente, ficha de rol y reverso por separado o
juntos en una imagen, a elección) o **PDF** (A6, una cara por página). Al escanear un QR, la
vista muestra el frente y la ficha de rol; las descargas incluyen además el reverso con el QR. No guarda nada y funciona aislado: no consume ningún servicio externo.

## Cómo funciona

- **Calidad.** Una imagen subida como archivo viaja en el QR muy reducida y pierde mucha
  calidad al escanear; la página lo avisa y muestra el tamaño real y cómo se verá. Con un
  enlace se conserva la calidad original.
- **Sin evasiones.** En pantalla nunca se muestran el reverso con el QR ni los IDs de la crew y
  del tripulante: se generan solo en el archivo descargado (PNG o PDF). Así, una captura de la
  vista previa o de una credencial escaneada no sirve como credencial. Al abrir una credencial
  escaneada, el enlace se borra de la barra de direcciones. La única forma de copiarlo es
  *Llevar al Explorador* (ver más abajo), pensado para unirse a una partida.
  Una credencial escaneada **no se puede descargar ni imprimir**: así nadie baja la credencial
  de otra persona. Solo se descarga desde el formulario, al que se llega con la contraseña de la
  crew (al fundarla, al unirse o al renovar).
- **Todo va en el QR.** El QR del reverso contiene la credencial completa: datos, foto y
  logo de la crew (estos dos como miniaturas WebP fijas de unos 100–160 px). Al escanearlo, la página
  la reconstruye. El sitio no recibe nada: los datos van en el fragmento `#C…` del enlace,
  que el navegador no envía al servidor.
- **Entrada.** La página abre directamente el formulario para fundar una crew (sin QR es lo
  único posible); para unirse a una existente se escanea el QR de un miembro.
- **Crews.** Cualquiera puede fundar una: nombre, color, estilo y contraseña. Recibe un
  **ID único** (`CR-XXXXXX`), así que dos crews con el mismo nombre son distintas.
- **Unirse.** Desde la página, *Unirme a una crew* permite escanear con la cámara el QR de un
  miembro o subir una imagen donde se vea (el PNG del reverso, una captura). También se puede
  escanear con la cámara del celular y pulsar *Unirme a esta tripulación*. Luego se escribe la
  contraseña de la crew. La credencial nueva hereda la crew (incluido su logo) y su
  QR también puede invitar.
- **Estilos.** Clásica, Nocturna, Minimal y Ceremonial. Los elige el fundador, que además
  decide si cada miembro puede escoger el suyo. Quien se une recibe el estilo de la crew.
- **Vencimiento.** Las credenciales vencen al año de su emisión, salvo la del **líder** (quien
  fundó la crew), que es permanente. La marca de líder no se hereda al unirse. Una vencida muestra el
  sello *VENCIDA*, no sirve para invitar y se puede **renovar** con la contraseña.
- **Renovar.** Se escanea la credencial vieja, se pulsa *Renovar* y se escribe la contraseña de
  la crew. Sale una credencial nueva, válida por un año, con los mismos datos y la misma fecha de
  **ingreso** (la primera vez que entró a la crew). Solo cambian la emisión y el vencimiento.
- **Estadísticas de rol.** Cada credencial lleva una ficha de tripulante para el
  [Explorador estelar](#contrato-con-el-explorador-estelar):
  - Seis estadísticas con base 3 (mín. 1, máx. 10 al crear): Pilotaje, Ingeniería, Ciencia,
    Medicina, Seguridad y Diplomacia.
  - **Reserva por tirada:** *Tirar* lanza 10 + 3d6 con una animación. Se puede repetir 2 veces
    (3 tiradas en total) y la última queda fija; repetir reinicia el reparto. La tirada es
    reproducible: sale de una semilla calculada con el nombre (no usa `Math.random`).
  - **Reparto libre** con +/−: se ven los puntos restantes, no se pasa del máximo ni se gasta más
    de la reserva (bajar una estadística de 3 devuelve puntos) y hay un botón para reiniciar. No se
    puede descargar la credencial hasta repartirlos todos y elegir rol y rasgo.
  - **Rol** (Piloto, Ingeniería, Ciencia, Medicina, Seguridad, Comunicaciones) y **rasgo**:
    Valiente (+1 Seguridad), Curioso (+1 Ciencia), Cauteloso (recibe mitad de daño), Optimista
    (moral baja la mitad en viajes), Gruñón (+1 Ingeniería), Carismático (+1 Diplomacia), Manos
    firmes (+1 Pilotaje y +1 Medicina), Insomne (más riesgo en hibernación), Veterano (+1 Pilotaje,
    Seguridad e Ingeniería). El bonus del rasgo se muestra aparte (rayado en las barras) y no se
    guarda sumado.
  - **Derivados:** Salud máx. = 50 + 5×Seguridad + 5×Medicina; Moral base = 50 + 5×Diplomacia
    (ambos con el bonus del rasgo). Nivel 1 y 0 XP al crear; salud actual 100 % y moral = moral
    base (máx. 100).
  - Al **renovar** se conservan; solo cambian con una partida del Explorador. Una credencial
    antigua sin estadísticas se sigue leyendo (con un aviso) y se completan al renovarla; el líder,
    que no renueva, tiene para eso el botón *Completar estadísticas*.
  - El campo del texto libre que antes se llamaba «Rol» ahora es **Cargo en la crew** (Capitán,
    Líder…); el rol de juego es aparte.
- **Imágenes por enlace.** En vez de subir la foto o el logo se puede poner un enlace `https`.
  Entonces el QR guarda solo la dirección (unos pocos bytes en lugar de ~1,5 KB): mucho más
  liviano y la imagen se ve en su calidad original, GIF incluidos. Depende de que el enlace siga
  activo, y el sitio que la aloja verá quién abre la credencial. Si además se sube el archivo,
  se usa solo para el PNG y el PDF. Quien se une hereda el enlace del logo de la crew.
- **Aislado.** La Content-Security-Policy de `index.html` bloquea en el navegador cualquier
  conexión fuera del sitio, salvo las imágenes `https` que el propio usuario enlaza (y wsrv.nl al descargar el PNG).

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
- Imágenes cuyo sitio no permite copiarlas (sin CORS, como Google, X y la mayoría de redes): el
  navegador no deja que la página lea sus píxeles, así que **solo al descargar el PNG** se piden a
  través de [wsrv.nl](https://wsrv.nl), un servicio público y gratuito de imágenes que sí lo
  permite (wsrv.nl ve la dirección de la imagen). En pantalla, al escanear y en el PDF se usa el
  enlace original. Si wsrv.nl no la obtiene, el PNG lleva el emblema y se avisa.
- Bytes (v4, binario): cabecera de 31 bytes (banderas, ID de crew en 30 bits, color RGB,
  emisión e ingreso en días desde 2020 (formato v4; las v3 se siguen leyendo), hash crudo de 16 bytes),
  textos `nombre␟especie␟pronombres␟crew␟cargo[␟x]` (`␟` = `\x1f`) comprimidos solo si ahorra, y por
  imagen `[tipo<<4|formato][largo][bytes]`. El sexto texto `x` (estadísticas) es opcional y no
  cambia la versión: los lectores viejos lo ignoran.
- Imágenes: presupuesto de ~1,4 KB entre las dos. Reescalado
  de alta calidad y bisección de la calidad para aprovecharlo; sin canal alfa ni metadatos
  (perfil de color, EXIF), que en miniaturas pesan más que la propia imagen.
- El QR solo guarda imágenes fijas: un GIF subido como archivo se guarda con su primer cuadro.
  Las animaciones se ven únicamente con un enlace.
- Carga: html2canvas (~200 KB) solo se descarga al pedir el PNG, y jsQR (~130 KB) solo al
  leer un QR sin lector nativo del navegador (BarcodeDetector); qrcode va minificado.
- Contraseña: PBKDF2-SHA256, 210 000 iteraciones. La sal incluye el ID de la crew, su estilo
  y si los miembros pueden elegir estilo; alterar eso en un QR invalida la contraseña.
- ID de miembro `AA-XXXX`: derivado de nombre, especie e ID de crew; no cambia al renovar.

## Contrato con el Explorador estelar

El Explorador estelar (carta estelar y simulador de rol de Ad Astra, en el navegador) lee y
escribe exactamente este formato. Todo viaja en enlaces y QR: no hay servidor ni conexión entre
los dos sitios.

### A) Campo `x` en la credencial

Sexto texto del QR, después de `r` y con el mismo separador (`[n,e,p,c,r,x].join("\x1f")`),
máx. 160 caracteres:

```
R1;rol=<código>;ras=<Rasgo>;s=<pil>,<ing>,<cie>,<med>,<seg>,<soc>;lv=<nivel>;xp=<xp>;hp=<salud actual 0-100>;mo=<moral 0-100>;t=<semilla>.<nºtirada>.<total>
R1;rol=cie;ras=Curioso;s=3,4,9,5,3,4;lv=1;xp=0;hp=100;mo=75;t=8F3A1C2B.1.21
```

- `rol`: `pil` · `ing` · `cie` · `med` · `seg` · `soc` (Piloto, Ingeniería, Ciencia, Medicina,
  Seguridad, Comunicaciones).
- `ras`: nombre exacto del rasgo (`Valiente`, `Curioso`, `Cauteloso`, `Optimista`, `Gruñón`,
  `Carismático`, `Manos firmes`, `Insomne`, `Veterano`).
- `s`: valores repartidos **sin** el bonus del rasgo, en el orden pil, ing, cie, med, seg, soc. Al
  leer se aceptan 1-12 (las mejoras de partida pueden pasar de 10).
- `hp` es la salud actual en porcentaje (0-100); `mo`, la moral actual (0-100).
- `t`: semilla (8 dígitos hexadecimales), número de tirada (1-3) y total (13-28).
- Un `x` inválido se descarta: la credencial se lee sin estadísticas.

**Tirada reproducible.** `semilla` = FNV-1a de 32 bits sobre los bytes UTF-8 del nombre
normalizado (`NFC`, sin espacios al inicio o final, espacios internos colapsados, minúsculas).
Para la tirada `n`, el PRNG es mulberry32 con estado inicial `(semilla XOR (n × 0x9E3779B1)) >>> 0`
(multiplicación de 32 bits, `Math.imul`); cada dado es `1 + floor(azar() × 6)`, tres dados, y
`total = 10 + suma`. Con `semilla` y `n` cualquiera puede recalcular los dados y comprobar el total.

### B) Actualización desde una partida: `#X…`

`<página>#X<base43>`, donde los bytes son deflate-raw de un JSON UTF-8:

```json
{"v":1,"id":"AA-XXXX","n":"Nombre","e":"Especie","x":"R1;...","res":"resumen breve de la partida"}
```

`id` es el ID de miembro: SHA-256 de `[n,e,i].join("|")` normalizado NFC y en minúsculas →
`"AA-"` + 4 símbolos de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (byte % 32), con `i` el ID de la crew.
Al abrirlo, la página borra el fragmento de la barra de direcciones y muestra *Actualización de
personaje desde una partida*, el resumen y las estadísticas nuevas. Luego pide escanear o subir el
QR de la credencial actual (o pegar su enlace), compara antes/después y rechaza la credencial si su
ID no coincide con `id`. Con la contraseña de la crew emite la credencial renovada con el `x`
nuevo, conservando la crew, la fecha de ingreso, la marca de líder y los demás datos.

### C) Exportar al Explorador

En la vista de una credencial escaneada vigente, *Llevar al Explorador* copia al portapapeles el
enlace de la credencial (`<página>#C…`). En el Explorador se pega ese enlace, o se sube el PNG del
reverso, para unirse a una partida.

## Límites

- Es un control social, no de seguridad: todo ocurre en el navegador y el hash de la
  contraseña va en cada QR. Alguien con conocimientos técnicos puede saltárselo, y una
  contraseña corta se puede adivinar por fuerza bruta. Usa frases largas.
- Con foto y logo subidos como archivo el QR es denso (versión ~35); con enlaces es simple. Se lee bien desde la pantalla o impreso a
  buen tamaño; muy pequeño puede costar.
- El vencimiento usa el reloj del dispositivo que escanea.
- Para el PNG, las imágenes enlazadas sin CORS dependen de wsrv.nl; si no responde, el PNG lleva
  el emblema. El PDF siempre las incluye; subir el archivo también lo resuelve.

## Archivos

```
index.html   página
app.js       lógica: formularios, empaquetado, QR, estilos, PNG y PDF
style.css    estilos de la página y de la credencial
logo.png     emblema   favicon.png  icono
vendor/      html2canvas, qrcode-generator (MIT) y jsQR (Apache-2.0), se cargan solo al usarse
.github/workflows/pages.yml   publica la raíz en Pages en cada push a main
```

## Probar en local

```
python3 -m http.server 8000
```
