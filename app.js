// Generador de credenciales de la Corporación Ad Astra.
// - Aislado: no llama a ningún servicio externo (lo refuerza la CSP de index.html).
// - No almacena nada: el QR contiene TODA la credencial (datos, foto y logo de la crew,
//   estos dos en miniatura), y al escanearlo esta página la reconstruye.
// - Crews: cualquiera puede fundar una. Cada crew tiene un ID aleatorio (CR-XXXXXX) y una
//   contraseña cuyo hash viaja en el QR; con ella se valida a quien quiere unirse.
// - Las credenciales vencen al año de su emisión.
//
// Formato del enlace:  <url de la página>#C<base43>
//   base43 usa solo caracteres del modo alfanumérico del QR (0-9 A-Z $ * + - . / :),
//   que ocupa menos espacio que el texto normal. Los bytes, en binario compacto:
//   [3] versión
//   [1] banderas: bit0 líder · bit1 estilo libre · bit2 hay estilo de miembro ·
//       bit3 texto comprimido · bits4-5 estilo de crew-1 · bits6-7 estilo de miembro-1
//   [4] ID de crew (6 símbolos base32 = 30 bits)   [3] color RGB
//   [2] emisión (días desde 2020-01-01)            [16] hash de la contraseña
//   [2] largo del texto + texto UTF-8 (nombre␟especie␟pronombres␟crew␟rol), deflate si ahorra
//   por imagen: [1] tipo<<4 | formato  [2] largo  [n] bytes   (tipo 1 foto, 2 logo; formato 1 WebP, 2 JPEG)

const $ = (id) => document.getElementById(id);

// Campos de la credencial y su largo máximo:
// n nombre · e especie · p pronombres · c crew · i ID de crew · k color · r rol · a emisión · h hash de la crew
// s estilo de la crew · l "1" si cada miembro puede elegir su estilo · y estilo elegido por el miembro
// f "1" si es la credencial del líder (fundador): no vence
const LIMITES = { n: 40, e: 40, p: 20, c: 30, i: 9, k: 7, r: 30, a: 10, h: 22, s: 1, l: 1, y: 1, f: 1 };

// Estilos de credencial: los colores de la muestra son [cabecera, franja, papel].
const ESTILOS = {
  1: { nombre: "Clásica", muestra: ["#1a1d23", "#a8826f", "#ecebe6"] },
  2: { nombre: "Nocturna", muestra: ["#12141a", "#7f98aa", "#1c1f26"] },
  3: { nombre: "Minimal", muestra: ["#f4f3ef", "#8d88a3", "#f4f3ef"] },
  4: { nombre: "Ceremonial", muestra: ["#2a2418", "#b5a27c", "#f1ead9"] },
};
const estiloDe = (d) => (d.l === "1" && ESTILOS[d.y] ? d.y : d.s);
const COLOR_POR_DEFECTO = "#b5a27c";

// Presupuesto de bytes para las imágenes dentro del QR (más bytes = QR más denso).
// El QR guarda solo imágenes fijas. Las animaciones (GIF) se ven únicamente con un enlace.
const PRESUPUESTO_LOGO = 380;
const PRESUPUESTO_IMAGENES = 1450;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- Fechas ----------
const iso = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
const hoy = () => iso(new Date());
function venceDe(a) {
  const [y, m, d] = a.split("-").map(Number);
  return iso(new Date(y + 1, m - 1, d)); // un año después (29-feb pasa a 1-mar)
}
const esLider = (d) => d.f === "1";
const vencida = (d) => !esLider(d) && (!d.a || hoy() > venceDe(d.a));
const textoVence = (d) => (esLider(d) ? "Permanente" : d.a ? venceDe(d.a) : "");

// ---------- Base43 (modo alfanumérico del QR, sin espacio ni %) ----------
const B43 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:";
function aBase43(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let v = bytes[i] * 256 + bytes[i + 1];
      s += B43[v % 43] + B43[Math.floor(v / 43) % 43] + B43[Math.floor(v / 1849)];
    } else {
      const v = bytes[i];
      s += B43[v % 43] + B43[Math.floor(v / 43)];
    }
  }
  return s;
}
function deBase43(s) {
  const val = (ch) => {
    const v = B43.indexOf(ch);
    if (v < 0) throw new Error("carácter inválido");
    return v;
  };
  const out = [];
  for (let i = 0; i < s.length; i += 3) {
    const trozo = s.slice(i, i + 3);
    if (trozo.length === 3) {
      const v = val(trozo[0]) + val(trozo[1]) * 43 + val(trozo[2]) * 1849;
      if (v > 0xffff) throw new Error("valor inválido");
      out.push(v >> 8, v & 0xff);
    } else if (trozo.length === 2) {
      const v = val(trozo[0]) + val(trozo[1]) * 43;
      if (v > 0xff) throw new Error("valor inválido");
      out.push(v);
    } else throw new Error("largo inválido");
  }
  return Uint8Array.from(out);
}

// ---------- Compresión ----------
async function transformar(bytes, flujo) {
  const stream = new Blob([bytes]).stream().pipeThrough(flujo);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const comprimir = (bytes) => transformar(bytes, new CompressionStream("deflate-raw"));
const descomprimir = (bytes) => transformar(bytes, new DecompressionStream("deflate-raw"));

// ---------- Empaquetado binario ----------
const VERSION = 3;
const FORMATOS = { 1: "image/webp", 2: "image/jpeg", 4: "enlace" }; // el 3 (GIF) ya no se usa: el QR solo lleva imágenes fijas
const CODIGO_FORMATO = { "image/webp": 1, "image/jpeg": 2, enlace: 4 };

// Imagen por enlace: el QR guarda solo la dirección (https, sin espacios ni comillas).
const ENLACE_RE = /^https:\/\/[^\s"'<>\\]{3,500}$/i;
const enlaceValido = (u) => typeof u === "string" && ENLACE_RE.test(u.trim());

// Enlaces de Google que se pueden convertir sin servidor:
// - Google Drive (archivo compartido) → imagen directa lh3.googleusercontent.com/d/<id>
// - Imagen directa de Google Fotos (lh3.googleusercontent.com/…=w…-h…) → tamaño 512 px
//   (carga más rápido y el enlace queda más corto en el QR)
// Los enlaces de compartir de Google Fotos son páginas, no imágenes: se detectan para guiar.
const TAM_GOOGLE = "=s512";
function normalizarEnlace(valor) {
  const v = (valor ?? "").trim();
  let u;
  try {
    u = new URL(v);
  } catch {
    return v;
  }
  if (u.hostname === "drive.google.com") {
    const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? u.searchParams.get("id");
    if (id) {
      const clave = u.searchParams.get("resourcekey");
      return `https://lh3.googleusercontent.com/d/${id}${clave ? `?resourcekey=${clave}` : ""}`;
    }
  }
  // Imgur: página de una imagen → imagen directa (Imgur sirve la imagen con cualquier extensión)
  if (/^(www\.|m\.)?imgur\.com$/.test(u.hostname)) {
    const id = u.pathname.match(/^\/([A-Za-z0-9]{5,8})$/)?.[1];
    if (id) return `https://i.imgur.com/${id}.jpg`;
  }
  // X: imagen directa a tamaño mediano (name=small, 680 px)
  if (u.hostname === "pbs.twimg.com" && u.pathname.startsWith("/media/")) {
    u.searchParams.set("name", "small");
    if (!u.searchParams.has("format")) {
      const ext = u.pathname.match(/\.(jpe?g|png|webp|gif)$/i)?.[1];
      if (ext) {
        u.pathname = u.pathname.replace(/\.\w+$/, "");
        u.searchParams.set("format", ext.toLowerCase());
      }
    }
    return u.toString();
  }
  if (/^lh\d\.googleusercontent\.com$/.test(u.hostname) && !u.pathname.startsWith("/d/") && !u.search) {
    // El tamaño va al final tras "=" (p. ej. =w2400-h1600-no); se reemplaza por uno fijo.
    const base = u.pathname.replace(/=[\w-]*$/, "");
    return `https://${u.hostname}${base}${TAM_GOOGLE}`;
  }
  return v;
}
// Revisión de enlaces por plataforma. Sin servidor no se puede leer una página para sacar su
// imagen, así que con un enlace de publicación se guía al usuario para copiar la dirección
// directa de la imagen, y se avisa cuando la plataforma hace caducar esas direcciones.
//   motivo: qué pasa · abrir: mostrar botón para abrir el enlace · pista: qué copiar
const COPIAR = "Ábrela, mantén pulsada la imagen (o clic derecho en el computador), toca «Copiar dirección de la imagen» y pégala aquí";
const REGLAS_ENLACES = [
  // No sirven: páginas sin imagen accesible o direcciones que caducan
  [/^https:\/\/((www|share)\.)?icloud\.com\//i, { motivo: "iCloud no deja enlazar sus fotos: los enlaces caducan a las pocas horas. Sube el archivo, o comparte la foto desde Google Drive o Google Fotos." }],
  [/^https:\/\/([\w-]+\.)*(cdninstagram\.com|fbcdn\.net)\//i, { motivo: "Las imágenes de Instagram y Facebook caducan al poco tiempo, y tu credencial se quedaría sin foto. Mejor sube el archivo." }],
  [/^https:\/\/((www|m|web)\.)?(instagram\.com|instagr\.am|facebook\.com|fb\.com|fb\.watch|threads\.net|threads\.com)\//i, { motivo: "Instagram, Facebook y Threads no dejan usar sus imágenes fuera de la app. Mejor sube el archivo." }],
  [/^https:\/\/(cdn|media)\.discordapp\.(com|net)\//i, { motivo: "Los enlaces de Discord dejan de funcionar al día siguiente. Mejor sube el archivo." }],
  [/^https:\/\/((www|ptb|canary)\.)?(discord\.com|discord\.gg|discordapp\.com)\//i, { motivo: "Los enlaces de Discord dejan de funcionar al día siguiente. Mejor sube el archivo." }],
  [/^https:\/\/((www|vm|vt|m)\.)?tiktok\.com\//i, { motivo: "TikTok no deja usar sus imágenes fuera de la app. Mejor sube el archivo." }],
  [/^https:\/\/(t\.me|telegram\.me|web\.telegram\.org)\//i, { motivo: "Telegram no da enlaces a sus imágenes. Mejor sube el archivo." }],
  [/^https:\/\/drive\.google\.com\/drive\/(u\/\d+\/)?folders\//i, { motivo: "Ese enlace es de una carpeta. Abre la imagen en Drive, toca Compartir → Copiar enlace y pega ese." }],
  // Sirven, pero el enlace es de una página: se guía para copiar la imagen directa
  [/^https:\/\/(photos\.app\.goo\.gl|goo\.gl\/photos|photos\.google\.com)\//i, { motivo: "Ese enlace lleva a la página de Google Fotos. Hace falta la dirección de la imagen.", abrir: true, pista: `${COPIAR}. Empieza por https://lh3.googleusercontent.com/, y el álbum tiene que seguir compartido.` }],
  [/^https:\/\/((www|mobile)\.)?(x\.com|twitter\.com)\//i, { motivo: "Ese enlace lleva a la publicación de X. Hace falta la dirección de la imagen.", abrir: true, pista: `${COPIAR}. Empieza por https://pbs.twimg.com/.` }],
  [/^https:\/\/((www|old|new)\.)?(reddit\.com|redd\.it)\//i, { motivo: "Ese enlace lleva a la publicación de Reddit. Hace falta la dirección de la imagen.", abrir: true, pista: `${COPIAR}. Empieza por https://i.redd.it/.` }],
  [/^https:\/\/(([\w-]+\.)?pinterest\.[a-z.]+|pin\.it)\//i, { motivo: "Ese enlace lleva al pin de Pinterest. Hace falta la dirección de la imagen.", abrir: true, pista: `${COPIAR}. Empieza por https://i.pinimg.com/.` }],
  [/^https:\/\/(www\.)?bsky\.app\//i, { motivo: "Ese enlace lleva a la publicación de Bluesky. Hace falta la dirección de la imagen.", abrir: true, pista: `${COPIAR}. Empieza por https://cdn.bsky.app/.` }],
  [/^https:\/\/([\w-]+\.)?tumblr\.com\//i, { motivo: "Ese enlace lleva a la publicación de Tumblr. Hace falta la dirección de la imagen.", abrir: true, pista: `${COPIAR}. Empieza por https://64.media.tumblr.com/.` }],
  [/^https:\/\/(www\.)?furaffinity\.net\//i, { motivo: "Ese enlace lleva a la página de Fur Affinity. Hace falta la dirección de la imagen.", abrir: true, pista: `${COPIAR}. Empieza por https://d.furaffinity.net/.` }],
  [/^https:\/\/(www\.)?deviantart\.com\//i, { motivo: "Ese enlace lleva a la página de DeviantArt. Hace falta la dirección de la imagen.", abrir: true, pista: `${COPIAR}. Algunas imágenes de DeviantArt dejan de verse con el tiempo; si te pasa, sube el archivo.` }],
  [/^https:\/\/(www\.)?imgur\.com\/(a|gallery|t)\//i, { motivo: "Ese enlace es de un álbum de Imgur. Hace falta la dirección de una imagen.", abrir: true, pista: `${COPIAR}. Empieza por https://i.imgur.com/.` }],
];
function revisarEnlace(valor) {
  const v = (valor ?? "").trim();
  for (const [re, info] of REGLAS_ENLACES) if (re.test(v)) return info;
  return null;
}

const imagenEnlace = (u) => ({ mime: "enlace", enlace: u.trim(), bytes: new TextEncoder().encode(u.trim()) });
const SEP = "\x1f"; // separador de los textos
const EPOCA = Date.UTC(2020, 0, 1);
const DIA = 864e5;
const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // base32 sin 0/O ni 1/I

const diasDe = (a) => {
  const [y, m, d] = a.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCA) / DIA);
};
const fechaDeDias = (n) => new Date(EPOCA + n * DIA).toISOString().slice(0, 10);

function idABytes(id) {
  let v = 0;
  for (const ch of id.slice(3)) v = v * 32 + ABC.indexOf(ch);
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}
function idDeBytes(b) {
  let v = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  let s = "";
  for (let i = 0; i < 6; i++, v = Math.floor(v / 32)) s = ABC[v % 32] + s;
  return "CR-" + s;
}

const unir = (partes) => {
  const out = new Uint8Array(partes.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

async function empaquetar(d, { foto, logo } = {}) {
  const textoPlano = new TextEncoder().encode([d.n, d.e, d.p, d.c, d.r].map((t) => t ?? "").join(SEP));
  const textoZ = await comprimir(textoPlano);
  const comprimido = textoZ.length < textoPlano.length;
  const texto = comprimido ? textoZ : textoPlano;
  const hayY = d.l === "1" && ESTILOS[d.y];
  const banderas =
    (d.f === "1" ? 1 : 0) | (d.l === "1" ? 2 : 0) | (hayY ? 4 : 0) | (comprimido ? 8 : 0) |
    ((Number(d.s) - 1) << 4) | ((hayY ? Number(d.y) - 1 : 0) << 6);
  const rgb = d.k.slice(1).match(/../g).map((h) => parseInt(h, 16));
  const dias = diasDe(d.a ?? hoy());
  const hash = d.h ? unb64u(d.h) : new Uint8Array(16);
  const partes = [
    Uint8Array.of(VERSION, banderas, ...idABytes(d.i), ...rgb, dias >> 8, dias & 0xff),
    hash,
    Uint8Array.of(texto.length >> 8, texto.length & 0xff),
    texto,
  ];
  for (const [tipo, img] of [[1, foto], [2, logo]]) {
    if (!img) continue;
    const n = img.bytes.length;
    partes.push(Uint8Array.of((tipo << 4) | CODIGO_FORMATO[img.mime], n >> 8, n & 0xff), img.bytes);
  }
  return aBase43(unir(partes));
}

function firmaValida(mime, b) {
  if (mime === "image/webp") return b.length > 12 && texto4(b, 0) === "RIFF" && texto4(b, 8) === "WEBP";
  if (mime === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8;
  if (mime === "enlace") return enlaceValido(new TextDecoder().decode(b));
  return false;
}

async function desempaquetar(texto) {
  if (texto.length > 4400) throw new Error("demasiado largo");
  const b = deBase43(texto);
  if (b[0] !== VERSION || b.length < 29) throw new Error("versión desconocida");
  const banderas = b[1];
  // cabecera: versión(1) banderas(1) ID(4) color(3) emisión(2) = 11 · hash(16) = 27 · largo(2) = 29
  const largo = (b[27] << 8) | b[28];
  if (29 + largo > b.length) throw new Error("truncado");
  let t = b.slice(29, 29 + largo);
  if (banderas & 8) t = await descomprimir(t);
  const [n, e, p, c, r] = new TextDecoder().decode(t).split(SEP);
  const hash = b.slice(11, 27);
  const crudo = {
    n, e, p, c, r,
    i: idDeBytes(b.slice(2, 6)),
    k: "#" + [...b.slice(6, 9)].map((x) => x.toString(16).padStart(2, "0")).join(""),
    a: fechaDeDias((b[9] << 8) | b[10]),
    h: hash.some((x) => x) ? b64u(hash) : "",
    s: String(((banderas >> 4) & 3) + 1),
    l: banderas & 2 ? "1" : "",
    y: banderas & 4 ? String(((banderas >> 6) & 3) + 1) : "",
    f: banderas & 1 ? "1" : "",
  };
  const d = limpiar(crudo);
  const imgs = {};
  let o = 29 + largo;
  while (o + 3 <= b.length) {
    const tipo = b[o] >> 4;
    const mime = FORMATOS[b[o] & 15];
    const len = (b[o + 1] << 8) | b[o + 2];
    const bytes = b.slice(o + 3, o + 3 + len);
    o += 3 + len;
    if (bytes.length !== len || !mime || !firmaValida(mime, bytes)) continue;
    const img = mime === "enlace" ? imagenEnlace(new TextDecoder().decode(bytes)) : { mime, bytes };
    if (tipo === 1) imgs.foto = img;
    if (tipo === 2) imgs.logo = img;
  }
  return { d, ...imgs };
}

// Solo campos conocidos, como texto, recortados y validados.
function limpiar(o) {
  const d = {};
  for (const [k, max] of Object.entries(LIMITES)) {
    if (typeof o?.[k] === "string" && o[k].trim()) d[k] = o[k].trim().slice(0, max);
  }
  if (!/^#[0-9a-f]{6}$/i.test(d.k ?? "")) d.k = COLOR_POR_DEFECTO;
  if (d.a && !/^\d{4}-\d{2}-\d{2}$/.test(d.a)) delete d.a;
  if (d.h && !/^[\w-]{22}$/.test(d.h)) delete d.h;
  if (d.i && !/^CR-[A-Z2-9]{6}$/.test(d.i)) delete d.i;
  if (!ESTILOS[d.s]) d.s = "1";
  if (d.l !== "1") delete d.l;
  if (!d.l || !ESTILOS[d.y]) delete d.y;
  if (d.f !== "1") delete d.f;
  if (!d.n || !d.c || !d.i) throw new Error("incompleta");
  return d;
}

const base = () => `${location.origin}${location.pathname}#C`;

// ---------- Imágenes en miniatura para el QR ----------
// Los navegadores añaden metadatos (perfil de color ICC, EXIF) de varios cientos de bytes,
// que en una miniatura pesan más que la propia imagen. Se quitan.
const texto4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
function webpMinimo(b) {
  if (texto4(b, 12) !== "VP8X") return b; // ya es un WebP simple
  let o = 12;
  while (o + 8 <= b.length) {
    const tipo = texto4(b, o);
    const n = b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24);
    if (tipo === "VP8 " || tipo === "VP8L") {
      const trozo = b.slice(o, o + 8 + n + (n & 1));
      const total = 4 + trozo.length;
      return unir([Uint8Array.of(82, 73, 70, 70, total & 255, (total >> 8) & 255, (total >> 16) & 255, (total >>> 24) & 255, 87, 69, 66, 80), trozo]);
    }
    o += 8 + n + (n & 1);
  }
  return b;
}
function jpegMinimo(b) {
  const partes = [b.slice(0, 2)];
  let o = 2;
  while (o + 4 <= b.length && b[o] === 0xff && b[o + 1] !== 0xda) {
    const n = (b[o + 2] << 8) | b[o + 3];
    if (!(b[o + 1] >= 0xe1 && b[o + 1] <= 0xef)) partes.push(b.slice(o, o + 2 + n)); // fuera APP1–APP15
    o += 2 + n;
  }
  partes.push(b.slice(o));
  return unir(partes);
}

// Recorta (cuadrado si se pide) y reduce con el reescalado de alta calidad del navegador.
async function escalar(base, lado, cuadrado) {
  let [sx, sy, sw, sh] = [0, 0, base.width, base.height];
  let w, h;
  if (cuadrado) {
    const s = Math.min(sw, sh);
    [sx, sy, sw, sh] = [Math.floor((sw - s) / 2), Math.floor((sh - s) / 2), s, s];
    w = h = lado;
  } else {
    const k = lado / Math.max(sw, sh);
    w = Math.max(1, Math.round(sw * k));
    h = Math.max(1, Math.round(sh * k));
  }
  try {
    return await createImageBitmap(base, sx, sy, sw, sh, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
  } catch {
    const cv = new OffscreenCanvas(w, h);
    const g = cv.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(base, sx, sy, sw, sh, 0, 0, w, h);
    return cv.transferToImageBitmap();
  }
}

// Miniatura opaca sobre el color del papel (sin canal alfa, que pesa mucho) y sin metadatos.
async function comprimirImagen(bmp, calidad) {
  const cv = document.createElement("canvas");
  cv.width = bmp.width;
  cv.height = bmp.height;
  const g = cv.getContext("2d", { alpha: false });
  g.fillStyle = "#ecebe6";
  g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(bmp, 0, 0);
  let blob = await new Promise((r) => cv.toBlob(r, "image/webp", calidad));
  if (!blob || blob.type !== "image/webp") blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", calidad)); // p. ej. Safari
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { mime: blob.type, bytes: blob.type === "image/webp" ? webpMinimo(bytes) : jpegMinimo(bytes) };
}

// Para cada tamaño (de mayor a menor) busca por bisección la calidad más alta que cabe en el
// presupuesto. Se queda con el tamaño más grande que logra una calidad aceptable.
const CALIDAD_ACEPTABLE = 0.35;
async function miniatura(fuente, presupuesto, { cuadrado }) {
  // Un GIF se guarda como imagen fija (su primer cuadro).
  const base = await createImageBitmap(fuente);
  let respaldo = null;
  for (const lado of [160, 144, 128, 112, 96, 80, 64, 48, 32]) {
    const bmp = await escalar(base, lado, cuadrado);
    let [bajo, alto] = [0.05, 0.92];
    let mejor = await comprimirImagen(bmp, bajo);
    if (mejor.bytes.length > presupuesto) continue;
    for (let paso = 0; paso < 6; paso++) {
      const medio = (bajo + alto) / 2;
      const r = await comprimirImagen(bmp, medio);
      if (r.bytes.length <= presupuesto) [mejor, bajo] = [r, medio];
      else alto = medio;
    }
    if (bajo >= CALIDAD_ACEPTABLE) return mejor;
    respaldo ??= mejor; // cabe, pero con calidad baja: se usa solo si ningún tamaño lo hace mejor
  }
  return respaldo;
}

// Imagen recibida en un QR → Blob (si venía embebida) o { enlace } (si venía como enlace).
const fuenteDe = (img) => (!img ? null : img.mime === "enlace" ? { enlace: img.enlace } : new Blob([img.bytes], { type: img.mime }));
const srcDe = (fuente) => (!fuente ? null : fuente.enlace ?? URL.createObjectURL(fuente));

// ---------- Contraseña de la crew ----------
// PBKDF2-SHA256, 210 000 iteraciones, 16 bytes en base64url.
// La sal incluye el ID de la crew, su estilo y si los miembros pueden elegir el suyo:
// así esa configuración del fundador no se puede alterar en un QR sin invalidar la contraseña.
const b64u = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const salDe = (crew) => `ad-astra:${crew.i}:${crew.s}:${crew.l === "1" ? 1 : 0}`;
async function hashClave(clave, crew) {
  const llave = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salDe(crew)), iterations: 210000 },
    llave,
    128
  );
  return b64u(new Uint8Array(bits));
}

const nuevoIdCrew = () => "CR-" + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => ABC[b % 32]).join("");

// ID de miembro estable (no cambia al renovar): nombre, especie e ID de crew.
async function idDe(d) {
  const texto = [d.n, d.e, d.i].join("|").normalize("NFC").toLowerCase();
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
  return "AA-" + [...hash.slice(0, 4)].map((b) => ABC[b % 32]).join("");
}

// ---------- QR ----------
// Dos segmentos: la dirección de la página (modo byte) y los datos (modo alfanumérico).
function generarQr(prefijo, datos) {
  if (!window.qrcode) return null;
  for (const nivel of ["M", "L"]) {
    try {
      const q = window.qrcode(0, nivel);
      q.addData(prefijo, "Byte");
      q.addData(datos, "Alphanumeric");
      q.make();
      return q;
    } catch {
      /* no cabe con este nivel: se prueba el siguiente */
    }
  }
  return null;
}

function qrImagen(q) {
  const n = q.getModuleCount();
  const margen = 4;
  const m = Math.max(4, Math.floor(1200 / (n + margen * 2)));
  const lado = (n + margen * 2) * m;
  const cv = document.createElement("canvas");
  cv.width = cv.height = lado;
  const g = cv.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, lado, lado);
  g.fillStyle = "#111318";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect((c + margen) * m, (r + margen) * m, m, m);
  return cv.toDataURL("image/png");
}

// ---------- Logo de la crew ----------
function logoCrew(d, logoUrl) {
  if (logoUrl) return `<img class="crew-logo" src="${esc(logoUrl)}" alt="${esc(d.c)}" referrerpolicy="no-referrer">`;
  const iniciales = d.c.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => [...p][0]).join("").toUpperCase();
  return `<div class="crew-logo crew-logo-generado" aria-label="${esc(d.c)}"><span>${esc(iniciales)}</span></div>`;
}

// ---------- Credencial (frente y reverso) ----------
async function credencial(d, { foto, logo, qr }) {
  const id = await idDe(d);
  const color = esc(d.k);
  const vence = textoVence(d);
  const venc = vencida(d);
  const sello = venc ? `<div class="sello-vencida" aria-label="Credencial vencida">Vencida</div>` : "";
  return `
  <div class="caras${venc ? " vencida" : ""}">
    <article class="credencial estilo-${estiloDe(d)}" style="--crew:${color}" aria-label="Frente">
      <div class="cred-ranura" aria-hidden="true"></div>
      <header class="cred-cab">
        <img class="cred-logo" src="logo.png" alt="">
        <div>
          <p class="cred-org">Corporación Ad Astra</p>
          <p class="cred-sub">Crew ${esc(d.c)}</p>
        </div>
      </header>
      <div class="cred-banda">
        <p class="cred-titulo">Tripulación</p>
        <p class="cred-rol">${esc(d.r || "Tripulante")}</p>
      </div>
      <div class="cred-foto">
        ${foto
          ? `<img src="${esc(foto)}" alt="${esc(d.n)}" referrerpolicy="no-referrer">`
          : `<div class="cred-sinfoto"><img src="logo.png" alt=""><span>Sin imagen</span></div>`}
        ${sello}
      </div>
      <div class="cred-nombre">
        <h1>${esc(d.n)}</h1>
        <p>${esc(d.e || "")}${d.p ? ` · ${esc(d.p)}` : ""}</p>
      </div>
      <div class="cred-datos">
        <dl>
          <dt>Crew</dt><dd>${esc(d.c)}</dd>
          <dt>Rol</dt><dd>${esc(d.r || "Tripulante")}</dd>
          <dt>ID</dt><dd>${id}</dd>
          <dt>Emisión</dt><dd>${esc(d.a || "")}</dd>
          <dt>Vence</dt><dd class="${venc ? "dato-vencido" : ""}">${esc(vence)}</dd>
        </dl>
        <figure class="cred-crew">${logoCrew(d, logo)}<figcaption>${esc(d.i)}</figcaption></figure>
      </div>
      <footer class="cred-franja">Per aspera ad astra</footer>
    </article>

    <article class="credencial cred-reverso estilo-${estiloDe(d)}" style="--crew:${color}" aria-label="Reverso">
      <div class="cred-ranura" aria-hidden="true"></div>
      <header class="rev-cab">
        <p class="cred-org">Corporación Ad Astra</p>
        <p class="cred-sub">Registro de tripulación</p>
      </header>
      <div class="rev-qr">${qr ? `<img src="${qr}" alt="QR de la credencial">` : `<p class="vacio">No se pudo generar el QR.</p>`}</div>
      <p class="rev-instr">Escanea para ver esta credencial<br>o unirte a la Crew ${esc(d.c)}</p>
      <div class="rev-id"><span>${esc(d.n)}</span><span>${id}</span></div>
      <div class="rev-id rev-id-crew"><span>Crew ${esc(d.i)}</span><span>${esLider(d) ? "Líder · permanente" : `Vence ${esc(vence)}`}</span></div>
      <img class="rev-emblema" src="logo.png" alt="">
      <footer class="cred-franja">Per aspera ad astra</footer>
    </article>
  </div>`;
}

// Si una imagen (p. ej. un enlace caído) no carga, se muestra el marcador.
function respaldoImagenes(contenedor) {
  const foto = contenedor.querySelector(".cred-foto > img");
  foto?.addEventListener("error", () => {
    foto.outerHTML = `<div class="cred-sinfoto"><img src="logo.png" alt=""><span>Imagen no disponible</span></div>`;
  });
  const logo = contenedor.querySelector("img.crew-logo");
  logo?.addEventListener("error", () => logo.replaceWith(Object.assign(document.createElement("div"), { className: "crew-logo crew-logo-generado" })));
}

// Precarga la imagen de un campo de enlace y muestra su estado. Devuelve si cargó.
const precargas = new WeakMap();
function precargarEnlace(campo) {
  const caja = $(`precarga-${campo.name}`);
  const img = caja.querySelector("img");
  const texto = caja.querySelector("small");
  const original = campo.value.trim();
  const valor = normalizarEnlace(original);
  const ayuda = caja.parentElement.querySelector(".ayuda-enlace"); // va junto a la caja, en el mismo campo
  ayuda.hidden = true;
  caja.classList.remove("error");
  if (!valor) {
    caja.hidden = true;
    return Promise.resolve(false);
  }
  caja.hidden = false;
  const revision = revisarEnlace(valor);
  if (revision?.abrir) {
    img.hidden = true;
    caja.classList.add("error");
    texto.textContent = revision.motivo;
    ayuda.querySelector("a").href = valor;
    ayuda.querySelector("small").textContent = revision.pista;
    ayuda.hidden = false;
    precargas.delete(campo);
    return Promise.resolve(false);
  }
  const motivo = revision?.motivo;
  if (motivo || !enlaceValido(valor)) {
    img.hidden = true;
    caja.classList.add("error");
    texto.textContent = motivo || "El enlace tiene que empezar por https:// y no llevar espacios.";
    precargas.delete(campo);
    return Promise.resolve(false);
  }
  if (precargas.get(campo)?.valor === valor) return precargas.get(campo).promesa;
  img.hidden = true;
  texto.textContent = "Cargando…";
  const promesa = new Promise((ok) => {
    img.onload = () => {
      img.hidden = false;
      const google = valor !== original ? " (ajusté el enlace)" : "";
      texto.textContent = `Lista, ${img.naturalWidth}×${img.naturalHeight} px${google}`;
      ok(true);
    };
    img.onerror = () => {
      caja.classList.add("error");
      texto.textContent = /^https:\/\/lh\d\.googleusercontent\.com\/d\//i.test(valor)
        ? "No carga. En Drive, comparte el archivo con «Cualquier persona con el enlace»."
        : "No carga. Revisa que el enlace esté bien copiado.";
      ok(false);
    };
    img.src = valor;
  });
  precargas.set(campo, { valor, promesa });
  return promesa;
}

// Empieza a descargar las imágenes enlazadas antes de armar la credencial.
function precargarImagenes(...fuentes) {
  for (const f of fuentes) if (f?.enlace) Object.assign(new Image(), { referrerPolicy: "no-referrer", src: f.enlace });
}

// ---------- Acciones ----------
let urlActual = "";
let nombreArchivo = "credencial";

const slug = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "credencial";

function estado(msg, error = false, id = "estado") {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("error", error);
}

// html2canvas (~200 KB) solo se descarga la primera vez que alguien pide el PNG.
let html2canvasListo = null;
const cargarHtml2canvas = () =>
  (html2canvasListo ??= new Promise((ok, mal) => {
    const sc = document.createElement("script");
    sc.src = "vendor/html2canvas.min.js";
    sc.onload = ok;
    sc.onerror = () => {
      html2canvasListo = null;
      mal(new Error("no cargó"));
    };
    document.head.append(sc);
  }));

// Para el PNG, cada imagen enlazada tiene que poder copiarse (CORS). Muchos sitios no lo
// permiten (Google, X, etc.): en ese caso, solo para la descarga, la imagen se pide a través de
// wsrv.nl, un servicio público de imágenes que sí lo permite. Si tampoco funciona, va el emblema.
const sePuedeCopiar = (src) =>
  new Promise((ok) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.referrerPolicy = "no-referrer";
    i.onload = () => ok(true);
    i.onerror = () => ok(false);
    i.src = src;
  });
const viaWsrv = (src) => `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=1200&we&output=png`;
async function prepararImagenesExternas(contenedor) {
  const externas = [...contenedor.querySelectorAll("img")].filter((i) => /^https:/i.test(i.getAttribute("src") ?? ""));
  let sinImagen = 0;
  await Promise.all(
    externas.map(async (img) => {
      const original = img.getAttribute("src");
      if (await sePuedeCopiar(original)) {
        img.crossOrigin = "anonymous";
        return;
      }
      const alterna = viaWsrv(original);
      if (await sePuedeCopiar(alterna)) {
        img.crossOrigin = "anonymous";
        img.src = alterna;
        await img.decode().catch(() => null);
        return;
      }
      sinImagen++;
      if (img.matches(".crew-logo")) img.replaceWith(Object.assign(document.createElement("div"), { className: "crew-logo crew-logo-generado" }));
      else img.outerHTML = `<div class="cred-sinfoto"><img src="logo.png" alt=""><span>Imagen enlazada</span></div>`;
    })
  );
  return sinImagen;
}

// Descarga dos PNG individuales: frente y reverso.
const descargar = (url, nombre) => Object.assign(document.createElement("a"), { href: url, download: nombre }).click();
// Antes de descargar, pregunta si las caras van en archivos separados o en una sola imagen.
function preguntarFormatoPng(boton) {
  const dlg = $("dialogo-png");
  dlg.querySelectorAll("[data-formato]").forEach((b) => {
    b.onclick = () => {
      dlg.close();
      if (b.dataset.formato !== "cancelar") descargarPng(boton, b.dataset.formato);
    };
  });
  dlg.showModal();
}

// modo: "separadas" (frente y reverso en dos archivos) o "juntas" (una imagen con las dos caras)
async function descargarPng(boton, modo = "separadas") {
  boton.disabled = true;
  let capa = null;
  try {
    await cargarHtml2canvas();
    const caras = document.querySelector("main:not([hidden]) .caras"); // la credencial de la pantalla visible
    if (!caras) return;
    // Copia fija de la credencial: si la vista se vuelve a dibujar mientras se generan los PNG
    // (una imagen que termina de cargar, el usuario que sigue escribiendo), no afecta la captura.
    capa = document.createElement("div");
    capa.className = "captura";
    const copia = caras.cloneNode(true);
    copia.classList.remove("solo-frente");
    capa.append(copia);
    document.body.append(capa);
    await Promise.all([...copia.querySelectorAll("img")].map((i) => (i.complete ? null : i.decode().catch(() => null))));
    // Imágenes enlazadas cuyo sitio no permite copiarlas (sin CORS, como Google Fotos): en el
    // PNG van con el emblema en su lugar, en vez de dejar un hueco. El PDF sí las incluye.
    estado("Preparando las imágenes…");
    const bloqueadas = await prepararImagenesExternas(copia);
    const [frente, reverso] = copia.querySelectorAll(".credencial");
    const piezas = modo === "juntas" ? [[copia, ""]] : [[frente, "-frente"], [reverso, "-reverso"]];
    if (modo === "juntas") copia.classList.add("juntas");
    for (const [elemento, sufijo] of piezas) {
      const canvas = await window.html2canvas(elemento, { scale: 3, backgroundColor: null, useCORS: true });
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      const url = URL.createObjectURL(blob);
      descargar(url, `${nombreArchivo}${sufijo}.png`);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (piezas.length > 1) await new Promise((r) => setTimeout(r, 400)); // algunos navegadores bloquean dos descargas seguidas
    }
    const hecho = modo === "juntas" ? "Listo: descargaste las dos caras en una imagen." : "Listo: frente y reverso descargados.";
    estado(
      bloqueadas
        ? `${hecho} No pude traer la imagen enlazada para el PNG, así que va el emblema en su lugar. Si la quieres, guarda el PDF o sube el archivo.`
        : hecho
    );
  } catch (e) {
    console.error("PNG:", e);
    estado("Algo falló al crear el PNG. Prueba de nuevo.", true);
  } finally {
    capa?.remove();
    boton.disabled = false;
  }
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-accion]");
  if (!b) return;
  const accion = b.dataset.accion;
  if (accion === "pdf") window.print();
  if (accion === "png") preguntarFormatoPng(b);
  if (accion === "fundar" || accion === "volver-fundar") modoClave({ modo: "fundar" });
  if (accion === "unirse-qr") modoLeerQr();
  if (accion === "copiar") {
    try {
      await navigator.clipboard.writeText(urlActual);
      estado("Enlace copiado.");
    } catch {
      estado(urlActual);
    }
  }
});

function mostrar(id) {
  for (const s of ["clave", "leer-qr", "crear", "ver", "error"]) $(s).hidden = s !== id;
  if (id !== "leer-qr") detenerCamara();
  if (id !== "crear") $("vista-crear").innerHTML = "";
  window.scrollTo(0, 0);
}

// ---------- Ver (llegada desde el QR) ----------
async function modoVer(datos) {
  let paquete;
  try {
    paquete = await desempaquetar(datos);
  } catch (e) {
    console.warn("Credencial inválida:", e.message);
    return mostrar("error");
  }
  const { d } = paquete;
  const fotoBlob = fuenteDe(paquete.foto);
  const logoBlob = fuenteDe(paquete.logo);
  precargarImagenes(fotoBlob, logoBlob);
  nombreArchivo = `credencial-${slug(d.n)}`;
  urlActual = base() + datos;
  document.title = `${d.n} · Corporación Ad Astra`;
  const q = generarQr(base(), datos);
  // Al escanear se muestra solo el frente; el reverso queda fuera de pantalla para las descargas.
  $("vista-ver").innerHTML = await credencial(d, {
    foto: srcDe(fotoBlob),
    logo: srcDe(logoBlob),
    qr: q && qrImagen(q),
  });
  respaldoImagenes($("vista-ver"));
  $("vista-ver").querySelector(".caras").classList.add("solo-frente");

  const venc = vencida(d);
  $("boton-unirse").hidden = !d.h || venc;
  $("boton-renovar").hidden = !d.h || esLider(d);
  $("boton-unirse").onclick = () => modoClave({ modo: "unirse", d, logo: logoBlob });
  $("boton-renovar").onclick = () => modoClave({ modo: "renovar", d, logo: logoBlob, foto: fotoBlob });
  $("ver-aviso").textContent = esLider(d)
    ? "Es la credencial del líder de la crew, así que no vence."
    : !d.a
    ? "A esta credencial le falta la fecha de emisión."
    : venc
      ? `Venció el ${venceDe(d.a)}. Hasta que su dueño la renueve, no sirve para invitar.`
      : `Vigente hasta el ${venceDe(d.a)}.`;
  mostrar("ver");
}

// Selector visual de estilos (radios con una muestra de colores).
function pintarMuestras(contenedor, nombre, elegido) {
  contenedor.innerHTML = Object.entries(ESTILOS)
    .map(
      ([id, e]) => `<label class="muestra">
        <input type="radio" name="${nombre}" value="${id}"${id === elegido ? " checked" : ""}>
        <i style="--a:${e.muestra[0]};--b:${e.muestra[1]};--c:${e.muestra[2]}"></i>
        <span>${e.nombre}</span></label>`
    )
    .join("");
}

// ---------- Contraseña: fundar, unirse o renovar ----------
function modoClave({ modo, d, logo, foto }) {
  const form = $("form-clave");
  form.reset();
  const fundar = modo === "fundar";
  $("clave-fundar").hidden = !fundar;
  $("nota-unirse").hidden = !fundar;
  if (fundar) pintarMuestras($("muestras-crew"), "estilo", "1");
  $("campo-confirmar").hidden = !fundar;
  $("clave-eyebrow").textContent = { fundar: "Fundar una crew", unirse: "Unirse a la tripulación", renovar: "Renovar credencial" }[modo];
  $("clave-titulo").textContent = fundar ? "Nueva crew" : `Crew ${d.c}`;
  $("clave-id").textContent = fundar ? "" : d.i;
  $("clave-id").hidden = fundar;
  $("clave-ayuda").textContent = fundar
    ? "Ponle nombre, color y contraseña. Se le asigna un ID propio, así que puede haber otra con el mismo nombre. Comparte la contraseña solo con quien quieras dentro: cualquier miembro puede invitar con el QR de su credencial."
    : modo === "renovar"
      ? "Con la contraseña de la crew sacas una credencial nueva, válida por un año."
      : "Escribe la contraseña que te pasó alguien de la crew.";
  estado("", false, "clave-estado");
  mostrar("clave");
  (fundar ? form.crew : form.clave).focus();

  let intentos = 0;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const boton = form.querySelector("button[type=submit]");
    if (fundar) {
      const crew = form.crew.value.trim();
      if (!crew) return estado("Falta el nombre de la crew.", true, "clave-estado");
      if (form.clave.value.length < 10) return estado("La contraseña necesita al menos 10 caracteres.", true, "clave-estado");
      if (form.clave.value !== form.confirmar.value) return estado("Las dos contraseñas no son iguales.", true, "clave-estado");
      boton.disabled = true;
      estado("Preparando…", false, "clave-estado");
      const nueva = { c: crew, i: nuevoIdCrew(), k: form.color.value, s: form.estilo.value, ...(form.libre.checked ? { l: "1" } : {}) };
      nueva.h = await hashClave(form.clave.value, nueva);
      boton.disabled = false;
      return modoCrear({ crew: nueva, lider: true });
    }
    boton.disabled = true;
    estado("Comprobando…", false, "clave-estado");
    const ok = (await hashClave(form.clave.value, d)) === d.h;
    // Pausa creciente tras cada fallo: frena intentos a mano desde la página.
    if (!ok) await new Promise((r) => setTimeout(r, Math.min(++intentos, 5) * 600));
    boton.disabled = false;
    if (!ok) return estado("Esa no es la contraseña.", true, "clave-estado");
    modoCrear({
      crew: { c: d.c, i: d.i, k: d.k, s: d.s, ...(d.l ? { l: d.l } : {}), h: d.h },
      logoHeredado: logo,
      previo: modo === "renovar" ? { d, foto } : null,
    });
  };
}

// ---------- Crear ----------
async function modoCrear({ crew, logoHeredado, previo, lider = false }) {
  const form = $("form");
  form.reset();
  if (previo) for (const k of ["n", "e", "p", "r"]) form[k].value = previo.d[k] ?? "";
  const emision = hoy();
  $("crew-fija").textContent = crew.c;
  $("crew-id").textContent = crew.i;
  $("fechas").textContent = lider
    ? `Emitida el ${emision}. Como eres el líder, no vence.`
    : `Emitida el ${emision}. Vence el ${venceDe(emision)}.`;
  if (lider && !form.r.value) form.r.value = "Líder";
  $("logo-heredado").hidden = !logoHeredado;
  for (const id of ["precarga-fotoEnlace", "precarga-logoEnlace"]) $(id).hidden = true;
  $("calidad-qr").hidden = true;
  // Enlaces heredados (logo de la crew) o previos (renovación) se ponen en sus campos.
  if (logoHeredado?.enlace) form.logoEnlace.value = logoHeredado.enlace;
  if (previo?.foto?.enlace) form.fotoEnlace.value = previo.foto.enlace;
  const libre = crew.l === "1";
  $("estilo-miembro").hidden = !libre;
  $("estilo-fijo").hidden = libre;
  $("estilo-fijo").textContent = `Tu crew usa el estilo ${ESTILOS[crew.s].nombre}.`;
  pintarMuestras($("muestras-miembro"), "y", previo?.d.y && libre ? previo.d.y : crew.s);
  mostrar("crear");

  // Fuentes de imagen (archivo local o miniatura heredada) y sus miniaturas para el QR.
  // Si hay enlace, el QR lleva el enlace; el archivo (si lo hay) solo se usa en el PNG y el PDF.
  const archivoInicial = (x) => (x instanceof Blob ? x : null);
  let fotoFuente = archivoInicial(previo?.foto);
  let logoFuente = archivoInicial(logoHeredado);
  let fotoUrl = fotoFuente && URL.createObjectURL(fotoFuente);
  let logoUrl = logoFuente && URL.createObjectURL(logoFuente);
  const enlace = (campo) => {
    const v = normalizarEnlace(campo.value);
    return enlaceValido(v) && !revisarEnlace(v) ? v : "";
  };
  let miniFoto = null;
  let miniLogo = null;

  // Si el usuario cambia otra imagen mientras se calcula, solo vale el cálculo más reciente.
  let versionMini = 0;
  async function prepararMiniaturas() {
    const mia = ++versionMini;
    try {
      // Las imágenes con enlace no se embeben: no gastan presupuesto.
      const fotoEmbebida = enlace(form.fotoEnlace) ? null : fotoFuente;
      const logoEmbebido = enlace(form.logoEnlace) ? null : logoFuente;
      const logoNuevo = logoEmbebido ? await miniatura(logoEmbebido, PRESUPUESTO_LOGO, { cuadrado: false }) : null;
      const resto = PRESUPUESTO_IMAGENES - (logoNuevo?.bytes.length ?? 0);
      const fotoNueva = fotoEmbebida ? await miniatura(fotoEmbebida, resto, { cuadrado: true }) : null;
      if (mia !== versionMini) return false;
      [miniLogo, miniFoto] = [logoNuevo, fotoNueva];
      await mostrarCalidadQr({ foto: fotoNueva, logo: logoNuevo });
      estado("");
      return true;
    } catch {
      if (mia === versionMini) estado("No pude abrir una de las imágenes. Prueba con otra.", true);
      return false;
    }
  }

  const cambiar = (input, tipo) => async () => {
    const f = input.files[0] ?? null;
    if (tipo === "foto") {
      if (fotoUrl) URL.revokeObjectURL(fotoUrl);
      fotoFuente = f;
      fotoUrl = f && URL.createObjectURL(f);
    } else {
      if (logoUrl) URL.revokeObjectURL(logoUrl);
      logoFuente = f ?? archivoInicial(logoHeredado);
      logoUrl = logoFuente && URL.createObjectURL(logoFuente);
    }
    estado("Ajustando las imágenes para el QR…");
    if (await prepararMiniaturas()) pintar();
  };
  form.foto.onchange = cambiar(form.foto, "foto");
  form.logo.onchange = cambiar(form.logo, "logo");
  // Al escribir o pegar un enlace, la imagen se precarga al momento: miniatura y estado junto al
  // campo, y la credencial se actualiza sin esperar a salir del campo.
  for (const campo of [form.fotoEnlace, form.logoEnlace]) {
    let espera;
    const actualizar = async () => {
      await precargarEnlace(campo);
      if (await prepararMiniaturas()) pintar();
    };
    campo.oninput = () => {
      clearTimeout(espera);
      espera = setTimeout(actualizar, 250);
    };
    campo.onchange = () => {
      clearTimeout(espera);
      actualizar();
    };
    if (campo.value) precargarEnlace(campo); // enlace heredado o de la renovación
  }

  // Muestra cómo quedan dentro del QR las imágenes subidas como archivo (tamaño real y vista).
  async function mostrarCalidadQr(minis) {
    const caja = $("calidad-qr");
    const partes = [];
    for (const [img, nombre] of [[minis.foto, "Tu foto"], [minis.logo, "Logo de la crew"]]) {
      if (!img) continue;
      const blob = new Blob([img.bytes], { type: img.mime });
      let tam = "";
      try {
        const bmp = await createImageBitmap(blob);
        tam = `${bmp.width}×${bmp.height} px`;
        bmp.close();
      } catch {
        /* sin tamaño */
      }
      partes.push(`<figure><img src="${URL.createObjectURL(blob)}" alt="">
        <figcaption>${nombre} al escanear: ${tam}</figcaption></figure>`);
    }
    caja.hidden = !partes.length;
    caja.innerHTML = partes.join("");
  }

  let turno = 0;
  async function pintar() {
    const mio = ++turno;
    const crudo = { n: form.n.value, e: form.e.value, p: form.p.value, r: form.r.value, ...crew, a: emision };
    if (lider) crudo.f = "1"; // la marca de líder no está en `crew`, así que nadie la hereda
    if (libre) crudo.y = form.y.value;
    let d;
    try {
      d = limpiar(crudo);
    } catch {
      d = limpiar({ ...crudo, n: "Tu nombre" });
    }
    const [fotoEnlace, logoEnlace] = [enlace(form.fotoEnlace), enlace(form.logoEnlace)];
    const datos = await empaquetar(d, {
      foto: fotoEnlace ? imagenEnlace(fotoEnlace) : miniFoto,
      logo: logoEnlace ? imagenEnlace(logoEnlace) : miniLogo,
    });
    if (mio !== turno) return; // llegó una edición más reciente
    urlActual = base() + datos;
    nombreArchivo = `credencial-${slug(d.n)}`;
    const q = generarQr(base(), datos);
    if (!q) estado("No cabe todo en el QR. Prueba con una imagen más sencilla o usa un enlace.", true);
    // Vista: el archivo local si lo hay (mejor calidad); si no, el enlace.
    $("vista-crear").innerHTML = await credencial(d, { foto: fotoUrl || fotoEnlace, logo: logoUrl || logoEnlace, qr: q && qrImagen(q) });
    respaldoImagenes($("vista-crear"));
  }

  let espera;
  form.oninput = () => {
    clearTimeout(espera);
    espera = setTimeout(pintar, 150);
  };
  await prepararMiniaturas();
  pintar();
}

// ---------- Unirse: leer el QR de un miembro ----------
// Lector nativo del navegador (BarcodeDetector) si existe; si no, jsQR, que se descarga solo aquí.
let jsqrListo = null;
const cargarJsqr = () =>
  (jsqrListo ??= new Promise((ok, mal) => {
    const sc = document.createElement("script");
    sc.src = "vendor/jsqr.min.js";
    sc.onload = ok;
    sc.onerror = () => {
      jsqrListo = null;
      mal(new Error("no cargó"));
    };
    document.head.append(sc);
  }));
const detectorNativo = async () => {
  try {
    if ("BarcodeDetector" in window && (await BarcodeDetector.getSupportedFormats()).includes("qr_code"))
      return new BarcodeDetector({ formats: ["qr_code"] });
  } catch {
    /* sin lector nativo */
  }
  return null;
};

// Lee un QR de una imagen o un cuadro de video. Devuelve el texto o "".
async function leerQr(fuente, ancho, alto) {
  const nativo = await detectorNativo();
  if (nativo) {
    try {
      const r = await nativo.detect(fuente);
      if (r[0]?.rawValue) return r[0].rawValue;
    } catch {
      /* se prueba con jsQR */
    }
  }
  await cargarJsqr();
  // jsQR trabaja con píxeles; las imágenes muy grandes se reducen para ir más rápido.
  const k = Math.min(1, 1600 / Math.max(ancho, alto));
  const cv = document.createElement("canvas");
  cv.width = Math.round(ancho * k);
  cv.height = Math.round(alto * k);
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(fuente, 0, 0, cv.width, cv.height);
  const px = g.getImageData(0, 0, cv.width, cv.height);
  return window.jsQR(px.data, px.width, px.height, { inversionAttempts: "attemptBoth" })?.data ?? "";
}

// Del texto del QR saca los datos de la credencial y pasa a pedir la contraseña.
async function unirseConTexto(texto) {
  const m = /#C([0-9A-Z$*+\-./:]+)\s*$/.exec(texto ?? "");
  if (!m) return estado("Ese QR no es de una credencial de Ad Astra.", true, "qr-estado");
  let paquete;
  try {
    paquete = await desempaquetar(m[1]);
  } catch {
    return estado("Leí el QR, pero la credencial viene incompleta o dañada.", true, "qr-estado");
  }
  const { d } = paquete;
  if (!d.h) return estado("Esa credencial no sirve para invitar.", true, "qr-estado");
  if (vencida(d)) return estado(`Esa credencial venció el ${venceDe(d.a)}, así que ya no sirve para invitar. Pide el QR de otro miembro.`, true, "qr-estado");
  detenerCamara();
  modoClave({ modo: "unirse", d, logo: fuenteDe(paquete.logo) });
}

let camara = null;
function detenerCamara() {
  camara?.getTracks().forEach((t) => t.stop());
  camara = null;
  const v = $("qr-video");
  if (v) {
    v.srcObject = null;
    v.hidden = true;
  }
}

async function usarCamara() {
  if (!navigator.mediaDevices?.getUserMedia) return estado("Este navegador no deja usar la cámara. Sube una imagen del QR.", true, "qr-estado");
  try {
    camara = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch {
    return estado("No pude abrir la cámara. Revisa el permiso o sube una imagen del QR.", true, "qr-estado");
  }
  const v = $("qr-video");
  v.srcObject = camara;
  v.hidden = false;
  await v.play().catch(() => {});
  estado("Apunta al QR y mantenlo quieto un momento…", false, "qr-estado");
  const flujo = camara;
  while (camara === flujo) {
    await new Promise((r) => setTimeout(r, 300));
    if (camara !== flujo || !v.videoWidth) continue;
    const texto = await leerQr(v, v.videoWidth, v.videoHeight).catch(() => "");
    if (texto && camara === flujo) {
      await unirseConTexto(texto);
      if (camara === flujo) await new Promise((r) => setTimeout(r, 1500)); // QR ajeno: se sigue intentando
    }
  }
}

function modoLeerQr() {
  estado("", false, "qr-estado");
  $("qr-archivo").value = "";
  mostrar("leer-qr");
  $("qr-camara").onclick = usarCamara;
  $("qr-archivo").onchange = async () => {
    const f = $("qr-archivo").files[0];
    if (!f) return;
    detenerCamara();
    estado("Leyendo el QR…", false, "qr-estado");
    try {
      const bmp = await createImageBitmap(f);
      const texto = await leerQr(bmp, bmp.width, bmp.height);
      bmp.close();
      if (!texto) return estado("No encontré un QR en esa imagen. Prueba con una más nítida o más cerca.", true, "qr-estado");
      await unirseConTexto(texto);
    } catch {
      estado("No pude abrir esa imagen.", true, "qr-estado");
    }
  };
}

// ---------- Arranque ----------
const m = /^#C([0-9A-Z$*+\-./:]+)$/.exec(location.hash);
if (m) modoVer(m[1]);
else modoClave({ modo: "fundar" }); // sin QR, lo único posible es fundar una crew
window.addEventListener("hashchange", () => location.reload());
