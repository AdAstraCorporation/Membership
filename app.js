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
//   [2] emisión (días desde 2020-01-01)            [2] ingreso a la crew (días, se conserva al renovar)
//   [16] hash de la contraseña
//   [2] largo del texto + texto UTF-8 (nombre␟especie␟pronombres␟crew␟cargo[␟x]), deflate si ahorra
//       x (opcional) = estadísticas de rol «R1;rol=…;ras=…;s=…;lv=…;xp=…;hp=…;mo=…;t=…». Los lectores
//       viejos ignoran el sexto texto y las credenciales sin x se siguen leyendo.
//   por imagen: [1] tipo<<4 | formato  [2] largo  [n] bytes   (tipo 1 foto, 2 logo; formato 1 WebP, 2 JPEG)

const $ = (id) => document.getElementById(id);

// Campos de la credencial y su largo máximo:
// n nombre · e especie · p pronombres · c crew · i ID de crew · k color · r rol · a emisión · h hash de la crew
// g fecha de ingreso a la crew (la primera; renovar no la cambia)
// s estilo de la crew · l "1" si cada miembro puede elegir su estilo · y estilo elegido por el miembro
// f "1" si es la credencial del líder (fundador): no vence
// x estadísticas de rol (contrato R1 con el Explorador estelar; ver «Estadísticas de rol»)
const LIMITES = { n: 40, e: 40, p: 20, c: 30, i: 9, k: 7, r: 30, a: 10, g: 10, h: 22, s: 1, l: 1, y: 1, f: 1, x: 160 };

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
const VERSION = 4; // la 3 (sin fecha de ingreso) se sigue leyendo
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
  // El sexto texto (x) solo va si hay estadísticas: así una credencial sin ellas pesa lo mismo que antes.
  const textos = [d.n, d.e, d.p, d.c, d.r].map((t) => t ?? "");
  if (d.x) textos.push(d.x);
  const textoPlano = new TextEncoder().encode(textos.join(SEP));
  const textoZ = await comprimir(textoPlano);
  const comprimido = textoZ.length < textoPlano.length;
  const texto = comprimido ? textoZ : textoPlano;
  const hayY = d.l === "1" && ESTILOS[d.y];
  const banderas =
    (d.f === "1" ? 1 : 0) | (d.l === "1" ? 2 : 0) | (hayY ? 4 : 0) | (comprimido ? 8 : 0) |
    ((Number(d.s) - 1) << 4) | ((hayY ? Number(d.y) - 1 : 0) << 6);
  const rgb = d.k.slice(1).match(/../g).map((h) => parseInt(h, 16));
  const dias = diasDe(d.a ?? hoy());
  const ingreso = diasDe(d.g ?? d.a ?? hoy());
  const hash = d.h ? unb64u(d.h) : new Uint8Array(16);
  const partes = [
    Uint8Array.of(VERSION, banderas, ...idABytes(d.i), ...rgb, dias >> 8, dias & 0xff, ingreso >> 8, ingreso & 0xff),
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
  // v3: versión(1) banderas(1) ID(4) color(3) emisión(2) = 11 · hash(16) · largo(2) = 29
  // v4: igual, con ingreso(2) después de la emisión = 13 · hash(16) · largo(2) = 31
  const v = b[0];
  if (v !== 3 && v !== VERSION) throw new Error("versión desconocida");
  const cab = v === 3 ? 11 : 13;
  if (b.length < cab + 18) throw new Error("truncado");
  const banderas = b[1];
  const largo = (b[cab + 16] << 8) | b[cab + 17];
  if (cab + 18 + largo > b.length) throw new Error("truncado");
  let t = b.slice(cab + 18, cab + 18 + largo);
  if (banderas & 8) t = await descomprimir(t);
  const [n, e, p, c, r, x] = new TextDecoder().decode(t).split(SEP);
  const hash = b.slice(cab, cab + 16);
  const crudo = {
    n, e, p, c, r, x,
    i: idDeBytes(b.slice(2, 6)),
    k: "#" + [...b.slice(6, 9)].map((x) => x.toString(16).padStart(2, "0")).join(""),
    a: fechaDeDias((b[9] << 8) | b[10]),
    g: v === 3 ? "" : fechaDeDias((b[11] << 8) | b[12]),
    h: hash.some((x) => x) ? b64u(hash) : "",
    s: String(((banderas >> 4) & 3) + 1),
    l: banderas & 2 ? "1" : "",
    y: banderas & 4 ? String(((banderas >> 6) & 3) + 1) : "",
    f: banderas & 1 ? "1" : "",
  };
  const d = limpiar(crudo);
  const imgs = {};
  let o = cab + 18 + largo;
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
  if (d.g && !/^\d{4}-\d{2}-\d{2}$/.test(d.g)) delete d.g;
  if (!d.g && d.a) d.g = d.a; // credenciales v3: el ingreso es la emisión
  if (d.h && !/^[\w-]{22}$/.test(d.h)) delete d.h;
  if (d.i && !/^CR-[A-Z2-9]{6}$/.test(d.i)) delete d.i;
  if (!ESTILOS[d.s]) d.s = "1";
  if (d.l !== "1") delete d.l;
  if (!d.l || !ESTILOS[d.y]) delete d.y;
  if (d.f !== "1") delete d.f;
  if (d.x) {
    const st = leerX(d.x); // inválido o de otra versión: la credencial se lee sin estadísticas
    if (st) d.x = escribirX(st);
    else delete d.x;
  }
  if (!d.n || !d.c || !d.i) throw new Error("incompleta");
  return d;
}

// ---------- Estadísticas de rol (contrato R1 con el Explorador estelar) ----------
// Sexto texto de la credencial (x), máx. 160 caracteres:
//   R1;rol=<código>;ras=<Rasgo>;s=<pil>,<ing>,<cie>,<med>,<seg>,<soc>;lv=<nivel>;xp=<xp>;hp=<0-100>;mo=<0-100>;t=<semilla>.<nº>.<total>
//   Ejemplo: R1;rol=cie;ras=Curioso;s=3,4,9,5,3,4;lv=1;xp=0;hp=100;mo=75;t=8F3A1C2B.1.21
// Opcionales, añadidos por la Carta Estelar al cerrar una misión (van antes de t):
//   fv=<días de vuelo acumulados>;ms=<misiones completadas>;mi=<código HEX8 de la última misión aplicada>
// s guarda los valores repartidos SIN el bonus del rasgo (este se suma al mostrar).
// Al crear: base 3, mín. 1, máx. 10. Al leer se aceptan 1-12 (mejoras ganadas en partida).
const STATS = [
  ["pil", "Pilotaje"],
  ["ing", "Ingeniería"],
  ["cie", "Ciencia"],
  ["med", "Medicina"],
  ["seg", "Seguridad"],
  ["soc", "Diplomacia"],
];
const ROLES = { pil: "Piloto", ing: "Ingeniería", cie: "Ciencia", med: "Medicina", seg: "Seguridad", soc: "Comunicaciones" };
const RASGOS = {
  Valiente: { desc: "+1 Seguridad", bonus: { seg: 1 } },
  Curioso: { desc: "+1 Ciencia", bonus: { cie: 1 } },
  Cauteloso: { desc: "Recibe la mitad de daño", bonus: {} },
  Optimista: { desc: "La moral baja la mitad en los viajes", bonus: {} },
  Gruñón: { desc: "+1 Ingeniería", bonus: { ing: 1 } },
  Carismático: { desc: "+1 Diplomacia", bonus: { soc: 1 } },
  "Manos firmes": { desc: "+1 Pilotaje y +1 Medicina", bonus: { pil: 1, med: 1 } },
  Insomne: { desc: "Más riesgo en hibernación", bonus: {} },
  Veterano: { desc: "+1 Pilotaje, Seguridad e Ingeniería", bonus: { pil: 1, seg: 1, ing: 1 } },
};
const STAT_BASE = 3;
const STAT_MIN = 1;
const STAT_MAX_CREAR = 10;
const STAT_MAX_LEER = 12;
const MAX_TIRADAS = 3; // la primera y dos repeticiones

// Días de vuelo → texto corto («3 a 112 d», «45 d»).
const vuelo = (d) => {
  if (!d) return "sin vuelos";
  let a = Math.floor(d / 365.25), r = Math.round(d - a * 365.25);
  if (r >= 365) (a++, (r = 0));
  return a ? `${a} año${a === 1 ? "" : "s"}${r ? ` y ${r} d` : ""}` : `${r} d`;
};

// Valor con el bonus del rasgo (solo para mostrar y para los derivados; nunca se guarda así).
const bonusDe = (st, k) => RASGOS[st.ras]?.bonus[k] ?? 0;
const totalDe = (st, k) => st.s[k] + bonusDe(st, k);
const saludMax = (st) => 50 + 5 * totalDe(st, "seg") + 5 * totalDe(st, "med");
const moralBase = (st) => 50 + 5 * totalDe(st, "soc");

const entero = (v, min, max) => (/^\d{1,6}$/.test(v ?? "") && +v >= min && +v <= max ? +v : null);

// Texto x → objeto, o null si no es un R1 válido.
function leerX(x) {
  if (typeof x !== "string") return null;
  const partes = x.trim().split(";");
  if (partes.shift() !== "R1") return null;
  const kv = {};
  for (const p of partes) {
    const i = p.indexOf("=");
    if (i > 0) kv[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  if (!ROLES[kv.rol] || !Object.hasOwn(RASGOS, kv.ras ?? "")) return null;
  const vals = (kv.s ?? "").split(",").map((v) => entero(v.trim(), STAT_MIN, STAT_MAX_LEER));
  if (vals.length !== STATS.length || vals.some((v) => v === null)) return null;
  const st = {
    rol: kv.rol,
    ras: kv.ras,
    s: Object.fromEntries(STATS.map(([k], i) => [k, vals[i]])),
    lv: entero(kv.lv, 1, 999) ?? 1,
    xp: entero(kv.xp, 0, 999999) ?? 0,
    hp: entero(kv.hp, 0, 100) ?? 100,
    mo: null,
    t: null,
  };
  st.mo = entero(kv.mo, 0, 100) ?? Math.min(100, moralBase(st));
  st.fv = entero(kv.fv, 0, 9999999) ?? 0;
  st.ms = entero(kv.ms, 0, 99999) ?? 0;
  st.mi = /^[0-9A-F]{8}$/.test(kv.mi ?? "") ? kv.mi : null;
  const t = /^([0-9A-Fa-f]{8})\.([1-9])\.(\d{1,2})$/.exec(kv.t ?? "");
  if (t) st.t = { sem: t[1].toUpperCase(), n: +t[2], total: +t[3] };
  return st;
}

// Objeto → texto x (orden y formato exactos del contrato).
function escribirX(st) {
  const t = st.t ? `;t=${st.t.sem}.${st.t.n}.${st.t.total}` : "";
  const v = (st.fv ? `;fv=${st.fv}` : "") + (st.ms ? `;ms=${st.ms}` : "") + (st.mi ? `;mi=${st.mi}` : "");
  return `R1;rol=${st.rol};ras=${st.ras};s=${STATS.map(([k]) => st.s[k]).join(",")};lv=${st.lv};xp=${st.xp};hp=${st.hp};mo=${st.mo}${v}${t}`;
}

// Tirada reproducible (no usa Math.random):
//   semilla = FNV-1a de 32 bits del nombre normalizado (NFC, sin espacios de sobra, minúsculas), en UTF-8
//   PRNG mulberry32 con semilla (semilla XOR nºtirada × 0x9E3779B1); 3 dados de 6 caras; total = 10 + suma
const normalizarNombre = (n) => String(n ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
function semillaDe(nombre) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(normalizarNombre(nombre))) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).toUpperCase().padStart(8, "0");
}
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function tirada(sem, n) {
  const azar = mulberry32((parseInt(sem, 16) ^ Math.imul(n, 0x9e3779b1)) >>> 0);
  const dados = [0, 0, 0].map(() => 1 + Math.floor(azar() * 6));
  return { sem, n, dados, total: 10 + dados.reduce((a, b) => a + b, 0) };
}
// Dados de una tirada guardada, si cuadran con su total.
const dadosDe = (t) => {
  if (!t) return null;
  const r = tirada(t.sem, t.n);
  return r.total === t.total ? r.dados : null;
};
const CARA_DADO = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

// Ficha de rol (tercera cara de la credencial).
//   st: estadísticas (o null si la credencial no las tiene) · avance: texto opcional mientras se reparten
function fichaRol(d, st, { avance = "" } = {}) {
  const color = esc(d.k);
  const cab = `<div class="cred-ranura" aria-hidden="true"></div>
      <header class="rev-cab">
        <p class="cred-org">Corporación Ad Astra</p>
        <p class="cred-sub">Ficha de tripulante</p>
      </header>`;
  if (!st) {
    return `<article class="credencial cred-ficha estilo-${estiloDe(d)}" style="--crew:${color}" aria-label="Ficha de rol" data-sufijo="-ficha">
      ${cab}
      <div class="ficha-vacia"><img src="logo.png" alt=""><p>${esc(avance || "Sin estadísticas de rol.")}</p>
        ${avance ? "" : "<small>Se completan al renovar la credencial con la contraseña de la crew.</small>"}</div>
      <footer class="cred-franja">Per aspera ad astra</footer>
    </article>`;
  }
  const filas = STATS.map(([k, nombre]) => {
    const b = bonusDe(st, k);
    const v = st.s[k];
    return `<div class="stat">
        <span class="stat-nombre">${nombre}</span>
        <span class="stat-barra" aria-hidden="true"><i style="width:${(v / STAT_MAX_LEER) * 100}%"></i>${b ? `<b style="width:${(b / STAT_MAX_LEER) * 100}%"></b>` : ""}</span>
        <span class="stat-valor">${v}${b ? `<em>+${b}</em>` : ""}</span>
      </div>`;
  }).join("");
  const dados = dadosDe(st.t);
  const tiradaTxt = st.t
    ? `${dados ? `<span class="dados" aria-hidden="true">${dados.map((x) => CARA_DADO[x]).join("")}</span> 10 + ${dados.join(" + ")} = ` : "Reserva "}<strong>${st.t.total}</strong> · tirada ${st.t.n} de ${MAX_TIRADAS}`
    : "Sin tirada registrada";
  const rasgo = RASGOS[st.ras];
  return `<article class="credencial cred-ficha estilo-${estiloDe(d)}" style="--crew:${color}" aria-label="Ficha de rol" data-sufijo="-ficha">
      ${cab}
      <div class="ficha-quien">
        <p class="ficha-nombre">${esc(d.n)}</p>
        <p class="ficha-nivel">Nivel ${st.lv} · ${st.xp} XP${st.fv || st.ms ? ` · ${vuelo(st.fv)} de vuelo · ${st.ms} misi${st.ms === 1 ? "ón" : "ones"}` : ""}</p>
      </div>
      <dl class="ficha-rol">
        <dt>Rol</dt><dd>${esc(ROLES[st.rol] ?? "—")}</dd>
        <dt>Rasgo</dt><dd>${esc(st.ras || "—")}${rasgo ? ` <small>${esc(rasgo.desc)}</small>` : ""}</dd>
      </dl>
      <div class="ficha-stats">${filas}</div>
      <p class="ficha-leyenda"><i></i> base <b></b> bonus del rasgo</p>
      <dl class="ficha-derivados">
        <div><dt>Salud máx.</dt><dd>${saludMax(st)}</dd></div>
        <div><dt>Salud</dt><dd>${st.hp}%</dd></div>
        <div><dt>Moral base</dt><dd>${moralBase(st)}</dd></div>
        <div><dt>Moral</dt><dd>${st.mo}</dd></div>
      </dl>
      <p class="ficha-tirada">${tiradaTxt}${avance ? `<br><span class="ficha-avance">${esc(avance)}</span>` : ""}</p>
      <footer class="cred-franja">Per aspera ad astra</footer>
    </article>`;
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
// ficha: estadísticas a mostrar (por defecto, las de d.x) · avance: nota mientras se reparten
async function credencial(d, { foto, logo }, { ficha = leerX(d.x), avance = "" } = {}) {
  const color = esc(d.k);
  const vence = textoVence(d);
  const venc = vencida(d);
  const sello = venc ? `<div class="sello-vencida" aria-label="Credencial vencida">Vencida</div>` : "";
  return `
  <div class="caras${venc ? " vencida" : ""}">
    <article class="credencial estilo-${estiloDe(d)}" style="--crew:${color}" aria-label="Frente" data-sufijo="-frente">
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
          <dt>Cargo</dt><dd>${esc(d.r || "Tripulante")}</dd>
          <dt class="solo-descarga">ID</dt><dd class="solo-descarga" data-id-miembro></dd>
          <dt>Ingreso</dt><dd>${esc(d.g || d.a || "")}</dd>
          <dt>Emisión</dt><dd>${esc(d.a || "")}</dd>
          <dt>Vence</dt><dd class="${venc ? "dato-vencido" : ""}">${esc(vence)}</dd>
        </dl>
        <figure class="cred-crew">${logoCrew(d, logo)}<figcaption class="solo-descarga" data-id-crew></figcaption></figure>
      </div>
      <footer class="cred-franja">Per aspera ad astra</footer>
    </article>

    ${fichaRol(d, ficha, { avance })}

    <article class="credencial cred-reverso estilo-${estiloDe(d)}" style="--crew:${color}" aria-label="Reverso" data-sufijo="-reverso">
      <div class="cred-ranura" aria-hidden="true"></div>
      <header class="rev-cab">
        <p class="cred-org">Corporación Ad Astra</p>
        <p class="cred-sub">Registro de tripulación</p>
      </header>
      <div class="rev-qr" data-qr></div>
      <p class="rev-instr">Escanea para ver esta credencial<br>o unirte a la Crew ${esc(d.c)}</p>
      <div class="rev-id"><span>${esc(d.n)}</span><span data-id-miembro></span></div>
      <div class="rev-id rev-id-crew"><span>Crew <span data-id-crew></span></span><span>${esLider(d) ? "Líder · permanente" : `Vence ${esc(vence)}`}</span></div>
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
let credencialActual = null; // { d, datos }: lo necesario para el QR y los IDs, que solo van en las descargas
let statsPendiente = ""; // qué falta de las estadísticas para poder emitir la credencial

// El reverso con el QR y los IDs de crew y tripulante no se muestran en pantalla: se generan
// solo en el archivo descargado (PNG o PDF), para que una captura de la vista no sirva de credencial.
async function completarParaDescarga(contenedor) {
  if (!credencialActual || !contenedor.closest("#crear, .captura")) return;
  const { d, datos } = credencialActual;
  const id = await idDe(d);
  contenedor.querySelectorAll("[data-id-miembro]").forEach((e) => (e.textContent = id));
  contenedor.querySelectorAll("[data-id-crew]").forEach((e) => (e.textContent = d.i));
  const q = generarQr(base(), datos);
  contenedor.querySelectorAll("[data-qr]").forEach((e) => {
    e.innerHTML = q ? `<img src="${qrImagen(q)}" alt="QR de la credencial">` : `<p class="vacio">No se pudo generar el QR.</p>`;
  });
}
function limpiarDescarga(contenedor) {
  contenedor.querySelectorAll("[data-id-miembro], [data-id-crew], [data-qr]").forEach((e) => (e.textContent = ""));
}
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
    await completarParaDescarga(copia);
    estado("Preparando las imágenes…");
    const bloqueadas = await prepararImagenesExternas(copia);
    // Frente, ficha de rol y reverso: un archivo por cara, o todas en una imagen.
    const piezas = modo === "juntas" ? [[copia, ""]] : [...copia.querySelectorAll(".credencial")].map((c) => [c, c.dataset.sufijo]);
    if (modo === "juntas") copia.classList.add("juntas");
    for (const [elemento, sufijo] of piezas) {
      const canvas = await window.html2canvas(elemento, { scale: 3, backgroundColor: null, useCORS: true });
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      const url = URL.createObjectURL(blob);
      descargar(url, `${nombreArchivo}${sufijo}.png`);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (piezas.length > 1) await new Promise((r) => setTimeout(r, 400)); // algunos navegadores bloquean descargas seguidas
    }
    const hecho = modo === "juntas" ? "Listo: descargaste las caras en una imagen." : "Listo: frente, ficha y reverso descargados.";
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
  // No se emite (PNG/PDF) hasta tirar y repartir todos los puntos, con rol y rasgo elegidos.
  if ((accion === "pdf" || accion === "png") && !$("crear").hidden && !credencialActual)
    return estado(statsPendiente || "Completa la credencial antes de descargarla.", true);
  if (accion === "pdf") {
    const caras = document.querySelector("main:not([hidden]) .caras");
    if (caras) {
      await completarParaDescarga(caras);
      window.addEventListener("afterprint", () => limpiarDescarga(caras), { once: true });
    }
    window.print();
  }
  if (accion === "png") preguntarFormatoPng(b);
  if (accion === "fundar" || accion === "volver-fundar") modoClave({ modo: "fundar" });
  if (accion === "unirse-qr") modoLeerQr();

});

function mostrar(id) {
  for (const s of ["clave", "leer-qr", "crear", "ver", "error", "actualizar"]) $(s).hidden = s !== id;
  if (id !== "leer-qr" && id !== "actualizar") detenerCamara();
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
  // Una credencial escaneada no se puede descargar: así nadie baja la credencial de otra persona.
  // Solo se descarga desde el formulario, al que se llega con la contraseña de la crew.
  credencialActual = null;
  document.title = `${d.n} · Corporación Ad Astra`;
  history.replaceState(null, "", location.pathname + location.search); // el enlace no queda en la barra de direcciones
  // En pantalla solo el frente, sin IDs; el reverso con el QR se arma solo al descargar.
  $("vista-ver").innerHTML = await credencial(d, {
    foto: srcDe(fotoBlob),
    logo: srcDe(logoBlob),
  });
  respaldoImagenes($("vista-ver"));

  const venc = vencida(d);
  // El líder no renueva (no vence), salvo para completar las estadísticas de una credencial antigua.
  $("boton-unirse").hidden = !d.h || venc;
  $("boton-renovar").hidden = !d.h || (esLider(d) && d.x);
  $("boton-renovar").textContent = esLider(d) ? "Completar estadísticas" : "Renovar";
  $("boton-unirse").onclick = () => modoClave({ modo: "unirse", d, logo: logoBlob });
  $("boton-renovar").onclick = () => modoClave({ modo: "renovar", d, logo: logoBlob, foto: fotoBlob });
  // Llevar al Explorador estelar: copia el enlace de esta credencial (#C…) para pegarlo allí.
  $("boton-explorador").hidden = venc;
  $("boton-explorador").onclick = () => copiarParaExplorador(base() + datos, d);
  estado("", false, "ver-estado");
  $("ver-aviso").textContent = (esLider(d)
    ? "Es la credencial del líder de la crew, así que no vence."
    : !d.a
    ? "A esta credencial le falta la fecha de emisión."
    : venc
      ? `Venció el ${venceDe(d.a)}. Hasta que su dueño la renueve, no sirve para invitar.`
      : `Vigente hasta el ${venceDe(d.a)}.`) +
    (d.x ? "" : " No tiene estadísticas de rol: se completan al renovarla con la contraseña de la crew.");
  mostrar("ver");
}

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Respaldo para navegadores sin permiso de portapapeles
    const area = Object.assign(document.createElement("textarea"), { value: texto });
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;left:-9999px";
    document.body.append(area);
    area.select();
    const ok = document.execCommand?.("copy") ?? false;
    area.remove();
    return ok;
  }
}
async function copiarParaExplorador(enlace, d) {
  const ok = await copiarTexto(enlace);
  const sinStats = d.x ? "" : " Ojo: esta credencial aún no tiene estadísticas de rol; renuévala para completarlas.";
  estado(
    ok
      ? `Enlace copiado. En el Explorador estelar, pégalo (o sube el PNG del reverso de tu credencial) para unirte a una partida.${sinStats}`
      : "No pude copiar el enlace. En el Explorador estelar también puedes subir el PNG del reverso de tu credencial.",
    !ok,
    "ver-estado"
  );
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
// modo: fundar · unirse · renovar · actualizar (desde una partida del Explorador; xNuevo = estadísticas nuevas)
function modoClave({ modo, d, logo, foto, xNuevo }) {
  const form = $("form-clave");
  form.reset();
  const fundar = modo === "fundar";
  $("clave-fundar").hidden = !fundar;
  $("nota-unirse").hidden = !fundar;
  if (fundar) pintarMuestras($("muestras-crew"), "estilo", "1");
  $("campo-confirmar").hidden = !fundar;
  $("clave-eyebrow").textContent = { fundar: "Fundar una crew", unirse: "Unirse a la tripulación", renovar: "Renovar credencial", actualizar: "Actualizar personaje" }[modo];
  $("clave-titulo").textContent = fundar ? "Nueva crew" : `Crew ${d.c}`;
  $("clave-id").hidden = true; // el ID de la crew solo aparece en los archivos descargados
  $("clave-ayuda").textContent = fundar
    ? "Ponle nombre, color y contraseña. Se le asigna un ID propio, así que puede haber otra con el mismo nombre. Comparte la contraseña solo con quien quieras dentro: cualquier miembro puede invitar con el QR de su credencial."
    : modo === "actualizar"
      ? `Con la contraseña de la crew sacas tu credencial renovada con las estadísticas de la partida. Se conservan tus datos, tu crew y la fecha en que entraste (${d.g || d.a}).`
      : modo === "renovar"
      ? `Con la contraseña de la crew sacas una credencial nueva, válida por un año. Se conservan tus datos y la fecha en que entraste a la crew (${d.g || d.a}).`
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
      previo: modo === "renovar" || modo === "actualizar" ? { d, foto } : null,
      // Renovar o actualizar conserva la marca de líder; unirse nunca la hereda.
      lider: modo !== "unirse" && esLider(d),
      xFijo: modo === "actualizar" ? xNuevo : null,
    });
  };
}

// ---------- Estadísticas en el formulario: tirada, reparto, rol y rasgo ----------
// fijo: estadísticas que no se tocan (vienen de una partida o de la credencial que se renueva).
// origen: nueva · completar (credencial vieja sin estadísticas) · renovar · partida
// Devuelve { ficha(), pendiente() }: lo que se muestra y qué falta para poder emitir.
const reducirMovimiento = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function prepararStats(form, fijo, { origen, alCambiar }) {
  $("stats-editable").hidden = !!fijo;
  $("stats-fijo").hidden = !fijo;
  const aviso = {
    partida: "Estas estadísticas vienen de una partida del Explorador estelar y se guardan tal cual.",
    renovar: "Se conservan las estadísticas de tu credencial. Solo cambian con una partida del Explorador estelar.",
    completar: "Tu credencial no tenía estadísticas de rol. Tíralas y repártelas para renovarla.",
  }[origen];
  $("stats-aviso").hidden = !aviso;
  $("stats-aviso").textContent = aviso ?? "";

  const tiradas = []; // { sem, n, dados, total }
  const inicial = () => Object.fromEntries(STATS.map(([k]) => [k, STAT_BASE]));
  let s = inicial();
  let animando = false;
  const ultima = () => tiradas.at(-1);
  const gastados = () => STATS.reduce((t, [k]) => t + s[k] - STAT_BASE, 0);
  const restantes = () => (ultima()?.total ?? 0) - gastados();

  function ficha() {
    if (fijo) return fijo;
    const t = ultima();
    if (!t) return null;
    const st = { rol: form.rolJuego.value, ras: form.rasgo.value, s: { ...s }, lv: 1, xp: 0, hp: 100, mo: 0, t: { sem: t.sem, n: t.n, total: t.total } };
    st.mo = Math.min(100, moralBase(st));
    return st;
  }
  function pendiente() {
    if (fijo) return "";
    if (!ultima()) return "Tira los dados para obtener tu reserva de puntos de rol.";
    const r = restantes();
    if (r > 0) return `Te ${r === 1 ? "queda 1 punto" : `quedan ${r} puntos`} de rol por repartir.`;
    if (!ROLES[form.rolJuego.value]) return "Elige el rol de tu personaje.";
    if (!Object.hasOwn(RASGOS, form.rasgo.value)) return "Elige un rasgo para tu personaje.";
    return "";
  }

  function pintarDados(dados) {
    $("dados").innerHTML = dados.map((x) => `<span class="dado">${x || "?"}</span>`).join("");
  }
  function pintarStats() {
    const st = ficha() ?? { ras: form.rasgo.value, s };
    if (fijo) {
      const dados = dadosDe(fijo.t);
      $("stats-fijo").innerHTML = `<dl class="stats-resumen">
        <dt>Rol</dt><dd>${esc(ROLES[fijo.rol])}</dd>
        <dt>Rasgo</dt><dd>${esc(fijo.ras)} · ${esc(RASGOS[fijo.ras].desc)}</dd>
        ${STATS.map(([k, nombre]) => `<dt>${nombre}</dt><dd>${fijo.s[k]}${bonusDe(fijo, k) ? ` <em class="bonus">+${bonusDe(fijo, k)}</em>` : ""}</dd>`).join("")}
        <dt>Nivel</dt><dd>${fijo.lv} · ${fijo.xp} XP</dd>
        <dt>Tirada</dt><dd>${fijo.t ? `${dados ? `10 + ${dados.join(" + ")} = ` : ""}${fijo.t.total}` : "—"}</dd>
      </dl>`;
    } else {
      const t = ultima();
      const r = restantes();
      $("tirada-total").textContent = t ? `Reserva: ${t.total} puntos` : "Reserva: sin tirar";
      $("tirada-info").textContent = t
        ? t.n >= MAX_TIRADAS
          ? `Tirada ${t.n} de ${MAX_TIRADAS}: queda fija.`
          : `Tirada ${t.n} de ${MAX_TIRADAS}. Puedes repetir ${MAX_TIRADAS - t.n === 1 ? "1 vez más" : `${MAX_TIRADAS - t.n} veces más`} (se reinicia el reparto).`
        : "10 + 3d6. Puedes repetir la tirada hasta 2 veces; la última queda.";
      $("boton-tirar").textContent = !t ? "Tirar" : t.n >= MAX_TIRADAS ? "Tirada fija" : "Repetir tirada";
      $("boton-tirar").disabled = animando || (t?.n ?? 0) >= MAX_TIRADAS;
      if (!animando) pintarDados(t ? t.dados : [0, 0, 0]);
      $("reparto").innerHTML = STATS.map(([k, nombre]) => {
        const b = bonusDe(st, k);
        return `<div class="reparto-fila">
          <span>${nombre}</span>
          <button type="button" class="boton secundario mini" data-stat="${k}" data-delta="-1" aria-label="Quitar un punto a ${nombre}"${!t || s[k] <= STAT_MIN ? " disabled" : ""}>−</button>
          <output>${s[k]}${b ? `<em class="bonus">+${b}</em>` : ""}</output>
          <button type="button" class="boton secundario mini" data-stat="${k}" data-delta="1" aria-label="Sumar un punto a ${nombre}"${!t || r <= 0 || s[k] >= STAT_MAX_CREAR ? " disabled" : ""}>+</button>
        </div>`;
      }).join("");
      $("restantes").textContent = t ? `Puntos restantes: ${r}` : "Puntos restantes: —";
      $("restantes").classList.toggle("listo", !!t && r === 0);
      $("reiniciar-reparto").disabled = !t || STATS.every(([k]) => s[k] === STAT_BASE);
      const ras = RASGOS[form.rasgo.value];
      $("rasgo-desc").textContent = ras ? `${form.rasgo.value}: ${ras.desc}. El bonus se muestra aparte y no se suma a los puntos repartidos.` : "";
    }
    const f = ficha();
    $("derivados").innerHTML = f
      ? `<div><dt>Salud máx.</dt><dd>${saludMax(f)}</dd></div><div><dt>Moral base</dt><dd>${moralBase(f)}</dd></div>
         <div><dt>Nivel</dt><dd>${f.lv}</dd></div><div><dt>XP</dt><dd>${f.xp}</dd></div>`
      : "";
  }
  const cambio = () => {
    pintarStats();
    alCambiar();
  };

  form.rolJuego.innerHTML = `<option value="">Elige…</option>` + Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  form.rasgo.innerHTML = `<option value="">Elige…</option>` + Object.entries(RASGOS).map(([k, v]) => `<option value="${esc(k)}">${esc(k)} (${esc(v.desc)})</option>`).join("");
  form.rolJuego.onchange = form.rasgo.onchange = cambio;

  $("boton-tirar").onclick = async () => {
    if (fijo || animando || tiradas.length >= MAX_TIRADAS) return;
    if (!form.n.value.trim()) {
      $("tirada-info").textContent = "Escribe primero el nombre de tu fursona: la tirada sale de él.";
      return form.n.focus();
    }
    const t = tirada(semillaDe(form.n.value), tiradas.length + 1);
    animando = true;
    pintarStats();
    const caja = $("dados");
    caja.classList.add("rodando");
    if (!reducirMovimiento()) {
      for (let cuadro = 0; cuadro < 9; cuadro++) {
        pintarDados([0, 1, 2].map((i) => ((cuadro * 5 + i * 2 + t.n) % 6) + 1));
        await new Promise((r) => setTimeout(r, 70));
      }
    }
    caja.classList.remove("rodando");
    animando = false;
    tiradas.push(t);
    s = inicial(); // nueva reserva: el reparto empieza de cero
    cambio();
  };
  $("reparto").onclick = (e) => {
    const b = e.target.closest("[data-stat]");
    if (!b || b.disabled) return;
    const k = b.dataset.stat;
    const v = s[k] + Number(b.dataset.delta);
    if (v < STAT_MIN || v > STAT_MAX_CREAR) return;
    if (Number(b.dataset.delta) > 0 && restantes() <= 0) return;
    s[k] = v;
    cambio();
  };
  $("reiniciar-reparto").onclick = () => {
    s = inicial();
    cambio();
  };
  pintarStats();
  return { ficha, pendiente };
}

// ---------- Crear ----------
async function modoCrear({ crew, logoHeredado, previo, lider = false, xFijo = null }) {
  const form = $("form");
  form.reset();
  credencialActual = null;
  if (previo) for (const k of ["n", "e", "p", "r"]) form[k].value = previo.d[k] ?? "";
  const emision = hoy();
  // Al renovar se conserva la fecha en que entró a la crew por primera vez.
  const ingreso = previo?.d.g || previo?.d.a || emision;
  $("crew-fija").textContent = crew.c;
  $("crew-id").textContent = ""; // el ID de la crew solo aparece en los archivos descargados
  $("fechas").textContent = lider
    ? `Emitida el ${emision}. Como eres el líder, no vence.`
    : `${previo ? `En la crew desde el ${ingreso}. ` : ""}Emitida el ${emision}. Vence el ${venceDe(emision)}.`;
  // Estadísticas: fijas si vienen de una partida (xFijo) o de la credencial que se renueva;
  // si no, se tiran y se reparten aquí.
  const rol = prepararStats(form, leerX(xFijo ?? previo?.d.x), {
    origen: xFijo ? "partida" : previo?.d.x ? "renovar" : previo ? "completar" : "nueva",
    alCambiar: () => pintar(),
  });
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
  let estadoPrevio = "";
  async function pintar() {
    const mio = ++turno;
    const crudo = { n: form.n.value, e: form.e.value, p: form.p.value, r: form.r.value, ...crew, a: emision, g: ingreso };
    if (lider) crudo.f = "1"; // la marca de líder no está en `crew`, así que nadie la hereda
    if (libre) crudo.y = form.y.value;
    const ficha = rol.ficha();
    statsPendiente = rol.pendiente();
    if (!statsPendiente) crudo.x = escribirX(ficha);
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
    // Sin estadísticas completas no se puede emitir: no hay QR ni descarga.
    credencialActual = statsPendiente ? null : { d, datos };
    for (const b of document.querySelectorAll('#crear [data-accion="png"], #crear [data-accion="pdf"]')) b.classList.toggle("bloqueado", !!statsPendiente);
    if (statsPendiente) estado(statsPendiente);
    else if ($("estado").textContent === estadoPrevio) estado("");
    estadoPrevio = statsPendiente;
    nombreArchivo = `credencial-${slug(d.n)}`;
    if (!generarQr(base(), datos)) estado("No cabe todo en el QR. Prueba con una imagen más sencilla o usa un enlace.", true);
    // Vista: el archivo local si lo hay (mejor calidad); si no, el enlace.
    $("vista-crear").innerHTML = await credencial(d, { foto: fotoUrl || fotoEnlace, logo: logoUrl || logoEnlace }, { ficha, avance: statsPendiente });
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
const extraerC = (texto) => /#C([0-9A-Z$*+\-./:]+)\s*$/.exec(String(texto ?? "").trim());
async function unirseConTexto(texto) {
  const m = extraerC(texto);
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
  for (const v of [$("qr-video"), $("act-video")]) {
    if (!v) continue;
    v.srcObject = null;
    v.hidden = true;
  }
}

// Lee QR con la cámara hasta que alLeer acepte uno (o se cambie de pantalla).
async function usarCamara(videoId = "qr-video", estadoId = "qr-estado", alLeer = unirseConTexto) {
  if (!navigator.mediaDevices?.getUserMedia) return estado("Este navegador no deja usar la cámara. Sube una imagen del QR.", true, estadoId);
  detenerCamara();
  try {
    camara = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch {
    return estado("No pude abrir la cámara. Revisa el permiso o sube una imagen del QR.", true, estadoId);
  }
  const v = $(videoId);
  v.srcObject = camara;
  v.hidden = false;
  await v.play().catch(() => {});
  estado("Apunta al QR y mantenlo quieto un momento…", false, estadoId);
  const flujo = camara;
  while (camara === flujo) {
    await new Promise((r) => setTimeout(r, 300));
    if (camara !== flujo || !v.videoWidth) continue;
    const texto = await leerQr(v, v.videoWidth, v.videoHeight).catch(() => "");
    if (texto && camara === flujo) {
      await alLeer(texto);
      if (camara === flujo) await new Promise((r) => setTimeout(r, 1500)); // QR ajeno: se sigue intentando
    }
  }
}

function modoLeerQr() {
  estado("", false, "qr-estado");
  $("qr-archivo").value = "";
  mostrar("leer-qr");
  $("qr-camara").onclick = () => usarCamara();
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

// ---------- Actualización desde el Explorador estelar (#X…) ----------
// Enlace: <página>#X<base43>. Los bytes son deflate-raw de un JSON UTF-8:
//   {"v":1,"id":"AA-XXXX","n":"Nombre","e":"Especie","x":"R1;…","res":"resumen de la partida"}
// id es el ID de miembro (idDe). Se aplica sobre la credencial actual, que hay que escanear o
// subir: su ID tiene que coincidir. Luego se pide la contraseña de la crew, como al renovar.
// v2 = QR general de fin de misión de la Carta Estelar (uno para toda la tripulación):
//   {"v":2,"mi":{"id":"HEX8","f":"AAAA-MM-DD","nave":"…","dn":<días a bordo>,"ye":<años en la Tierra>,"ly":<años luz>,
//    "sj":<saltos>,"ss":<sistemas>,"q":<misiones de historia>},"c":[{"id":"AA-XXXX","n","e","x":"R1;…","dv":<días de vuelo>,"res"}]}
// Cada jugador escanea ese QR y después su credencial: se aplica la entrada cuyo id coincide.
async function leerActualizacion(texto) {
  if (texto.length > 4400) throw new Error("demasiado largo");
  const j = JSON.parse(new TextDecoder().decode(await descomprimir(deBase43(texto))));
  const txt = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const persona = (p) => {
    if (typeof p?.id !== "string" || !/^AA-[A-Z2-9]{4}$/.test(p.id)) throw new Error("sin ID");
    const st = leerX(p.x);
    if (!st || p.x.length > LIMITES.x) throw new Error("estadísticas inválidas");
    return { id: p.id, n: txt(p.n, LIMITES.n), e: txt(p.e, LIMITES.e), st, x: escribirX(st), res: txt(p.res, 500), dv: entero(String(p.dv ?? 0), 0, 9999999) ?? 0 };
  };
  if (j?.v === 1) return { ...persona(j), mision: null, todos: null };
  if (j?.v !== 2 || !Array.isArray(j.c) || !j.c.length || j.c.length > 12) throw new Error("versión desconocida");
  const mi = j.mi ?? {};
  if (!/^[0-9A-F]{8}$/.test(mi.id ?? "")) throw new Error("misión sin código");
  const num = (v) => (Number.isFinite(+v) && +v >= 0 ? +v : 0);
  const mision = { id: mi.id, f: txt(mi.f, 10), nave: txt(mi.nave, 60), dn: num(mi.dn), ye: num(mi.ye), ly: num(mi.ly), sj: num(mi.sj), ss: num(mi.ss), q: num(mi.q) };
  return { mision, todos: j.c.map(persona) };
}

// Tabla: estadísticas anteriores (si ya se leyó la credencial) frente a las nuevas.
function tablaComparativa(antes, nueva) {
  const celda = (st, k) => (!st ? "—" : `${st.s[k]}${bonusDe(st, k) ? ` <em class="bonus">+${bonusDe(st, k)}</em>` : ""}`);
  const filas = [
    ["Rol", (st) => esc(ROLES[st.rol])],
    ["Rasgo", (st) => esc(st.ras)],
    ...STATS.map(([k, nombre]) => [nombre, (st) => celda(st, k), k]),
    ["Nivel", (st) => st.lv],
    ["XP", (st) => st.xp],
    ["Tiempo de vuelo", (st) => vuelo(st.fv)],
    ["Misiones", (st) => st.ms],
    ["Salud", (st) => `${st.hp}% de ${saludMax(st)}`],
    ["Moral", (st) => st.mo],
  ];
  const cambia = (f) => antes && String(f(antes)) !== String(f(nueva));
  return `<table class="comparar">
    <thead><tr><th></th><th>Antes</th><th>Después</th></tr></thead>
    <tbody>${filas
      .map(([nombre, f]) => `<tr class="${cambia(f) ? "cambia" : ""}"><th>${nombre}</th><td>${antes ? f(antes) : antes === null ? "sin estadísticas" : "—"}</td><td>${f(nueva)}</td></tr>`)
      .join("")}</tbody></table>`;
}

async function modoActualizar(texto) {
  history.replaceState(null, "", location.pathname + location.search); // el enlace no queda en la barra de direcciones
  let act;
  try {
    act = await leerActualizacion(texto);
  } catch (e) {
    console.warn("Actualización inválida:", e.message);
    $("error").querySelector(".vacio").textContent = "Este enlace no trae una actualización de personaje válida.";
    return mostrar("error");
  }
  const mision = act.mision;
  if (mision) {
    const m = mision;
    document.title = "Fin de misión · Corporación Ad Astra";
    $("act-titulo").textContent = "Fin de misión: actualiza tu personaje";
    $("act-quien").textContent = `Tripulación: ${act.todos.map((p) => p.n).join(", ")}`;
    $("act-resumen").textContent = `Misión ${m.id}${m.f ? ` del ${m.f}` : ""}${m.nave ? ` a bordo de ${m.nave}` : ""}: ${vuelo(Math.round(m.dn))} a bordo, ${m.ye.toFixed(1)} años en la Tierra, ${m.ly.toFixed(1)} años luz, ${m.sj} saltos, ${m.ss} sistemas registrados.`;
    $("act-tabla").innerHTML = "";
  } else {
    document.title = `Actualizar a ${act.n || "tu personaje"} · Corporación Ad Astra`;
    $("act-titulo").textContent = "Actualización de personaje desde una partida";
    $("act-quien").textContent = [act.n, act.e].filter(Boolean).join(" · ");
    $("act-resumen").textContent = act.res || "La partida no trae resumen.";
    $("act-tabla").innerHTML = tablaComparativa(undefined, act.st);
  }
  $("act-continuar").hidden = true;
  $("act-enlace").value = "";
  $("act-archivo").value = "";
  estado("", false, "act-estado");

  // Lee la credencial actual (QR o enlace #C…) y comprueba que es del mismo personaje.
  let lista = null;
  async function alLeer(textoQr) {
    const m = extraerC(textoQr);
    if (!m) return estado("Eso no es una credencial de Ad Astra.", true, "act-estado");
    let paquete;
    try {
      paquete = await desempaquetar(m[1]);
    } catch {
      return estado("Leí la credencial, pero viene incompleta o dañada.", true, "act-estado");
    }
    const { d } = paquete;
    const idLeido = await idDe(d);
    if (mision) {
      const p = act.todos.find((q) => q.id === idLeido);
      if (!p) return estado(`${d.n} no aparece en esta misión. Los personajes de la misión son: ${act.todos.map((q) => q.n).join(", ")}.`, true, "act-estado");
      Object.assign(act, p);
      $("act-quien").textContent = [p.n, p.e].filter(Boolean).join(" · ");
      if (p.res) $("act-resumen").textContent += " " + p.res;
    } else if (idLeido !== act.id)
      return estado(`Esa credencial no es la de ${act.n || "este personaje"}: el ID no coincide. Usa la credencial actual del personaje de la partida.`, true, "act-estado");
    const previo = leerX(d.x);
    if (mision && previo?.mi === mision.id) return estado("Esta misión ya está aplicada en esa credencial.", true, "act-estado");
    if (!d.h) return estado("Esa credencial no tiene crew con contraseña, así que no se puede renovar.", true, "act-estado");
    detenerCamara();
    lista = { d, logo: fuenteDe(paquete.logo), foto: fuenteDe(paquete.foto) };
    $("act-tabla").innerHTML = tablaComparativa(previo, act.st);
    $("act-continuar").hidden = false;
    estado(`Credencial de ${d.n} (crew ${d.c}) verificada. Revisa los cambios y continúa con la contraseña de la crew.`, false, "act-estado");
  }
  $("act-camara").onclick = () => usarCamara("act-video", "act-estado", alLeer);
  $("act-archivo").onchange = async () => {
    const f = $("act-archivo").files[0];
    if (!f) return;
    detenerCamara();
    estado("Leyendo el QR…", false, "act-estado");
    try {
      const bmp = await createImageBitmap(f);
      const t = await leerQr(bmp, bmp.width, bmp.height);
      bmp.close();
      if (!t) return estado("No encontré un QR en esa imagen. Prueba con una más nítida o más cerca.", true, "act-estado");
      await alLeer(t);
    } catch {
      estado("No pude abrir esa imagen.", true, "act-estado");
    }
  };
  $("act-usar-enlace").onclick = () => alLeer($("act-enlace").value);
  $("act-continuar").onclick = () => lista && modoClave({ modo: "actualizar", ...lista, xNuevo: act.x });
  mostrar("actualizar");
}

// ---------- Webapp: instalar y actualizar ----------
// sw.js guarda los archivos del sitio para usarlo sin conexión (nunca datos de credenciales).
// «Actualizar» sirve para dos cosas: aplicar el enlace que da el Explorador al terminar cada
// partida (#X…) y buscar una versión nueva de la app.
const instalada = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let registroSw = null;
let recargarAlCambiar = false;

function marcarVersionNueva() {
  const hay = !!registroSw?.waiting;
  document.querySelector("#boton-actualizar .punto-nuevo").hidden = !hay;
  if (hay) estado("Hay una versión nueva de la app. Pulsa «Buscar versión nueva» para usarla.", false, "upd-app-estado");
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .then((r) => {
      registroSw = r;
      marcarVersionNueva();
      r.addEventListener("updatefound", () => {
        const nuevo = r.installing;
        nuevo?.addEventListener("statechange", () => nuevo.state === "installed" && navigator.serviceWorker.controller && marcarVersionNueva());
      });
    })
    .catch((e) => console.warn("Sin modo sin conexión:", e.message));
  // Solo se recarga cuando lo pide el usuario (la primera instalación también cambia el controlador).
  navigator.serviceWorker.addEventListener("controllerchange", () => recargarAlCambiar && location.reload());
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.version) $("upd-version").textContent = `Versión instalada: ${e.data.version}. Con conexión, la app se actualiza sola; sin conexión usa la última copia guardada.`;
  });
}

// Instalar: Chrome, Edge y Android ofrecen el aviso propio; en iPhone/iPad se explica cómo.
let avisoInstalar = null;
const esIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
$("boton-instalar").hidden = instalada() || !esIos;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  avisoInstalar = e;
  $("boton-instalar").hidden = instalada();
});
window.addEventListener("appinstalled", () => {
  avisoInstalar = null;
  $("boton-instalar").hidden = true;
});
$("boton-instalar").onclick = async () => {
  if (avisoInstalar) {
    avisoInstalar.prompt();
    await avisoInstalar.userChoice.catch(() => null);
    avisoInstalar = null;
    $("boton-instalar").hidden = true;
    return;
  }
  $("instalar-pasos").textContent = esIos
    ? "En Safari, toca el botón Compartir (el cuadrado con la flecha) y elige «Añadir a pantalla de inicio». La app queda con su ícono y funciona sin conexión."
    : "Abre el menú del navegador y elige «Instalar app» o «Añadir a pantalla de inicio».";
  $("dialogo-instalar").showModal();
};
$("instalar-cerrar").onclick = () => $("dialogo-instalar").close();

// Diálogo «Actualizar»
$("boton-actualizar").onclick = () => {
  $("upd-enlace").value = "";
  estado("", false, "upd-estado");
  if (!registroSw?.waiting) estado("", false, "upd-app-estado");
  $("upd-version").textContent = "serviceWorker" in navigator ? "" : "Este navegador no permite usar la app sin conexión.";
  navigator.serviceWorker?.controller?.postMessage("version");
  marcarVersionNueva();
  $("dialogo-actualizar").showModal();
  $("upd-enlace").focus();
};
$("upd-cerrar").onclick = () => {
  detenerCamara();
  $("dialogo-actualizar").close();
};
$("upd-pegar").onclick = async () => {
  try {
    $("upd-enlace").value = (await navigator.clipboard.readText()).trim();
  } catch {
    estado("No pude leer el portapapeles. Mantén pulsado el campo y elige Pegar.", true, "upd-estado");
  }
};
// Acepta el enlace completo, solo el fragmento (#X…) o el código; también un enlace de credencial (#C…).
$("upd-aplicar").onclick = () => {
  const v = $("upd-enlace").value.trim();
  const x = /(?:^|#)X([0-9A-Z$*+\-./:]+)$/.exec(v);
  const c = /(?:^|#)C([0-9A-Z$*+\-./:]+)$/.exec(v);
  if (!x && !c)
    return estado("Eso no parece un enlace de partida. Cópialo completo desde el Explorador estelar (termina en #X…).", true, "upd-estado");
  $("dialogo-actualizar").close();
  if (x) modoActualizar(x[1]);
  else modoVer(c[1]);
};
// QR general de fin de misión: con la cámara o subiendo la imagen.
async function aplicarTextoMision(t) {
  const x = /(?:^|#)X([0-9A-Z$*+\-./:]+)$/.exec(String(t ?? "").trim());
  if (!x) return estado("Ese QR no es de una misión de la Carta Estelar.", true, "upd-estado");
  detenerCamara();
  $("dialogo-actualizar").close();
  modoActualizar(x[1]);
}
$("upd-camara").onclick = () => usarCamara("upd-video", "upd-estado", aplicarTextoMision);
$("upd-archivo").onchange = async () => {
  const f = $("upd-archivo").files[0];
  if (!f) return;
  estado("Leyendo el QR…", false, "upd-estado");
  try {
    const bmp = await createImageBitmap(f);
    const t = await leerQr(bmp, bmp.width, bmp.height);
    bmp.close();
    $("upd-archivo").value = "";
    if (!t) return estado("No encontré un QR en esa imagen.", true, "upd-estado");
    aplicarTextoMision(t);
  } catch {
    estado("No pude abrir esa imagen.", true, "upd-estado");
  }
};
$("upd-buscar").onclick = async () => {
  if (!registroSw) return estado("La app no tiene modo sin conexión en este navegador: recarga la página para tener la última versión.", true, "upd-app-estado");
  const boton = $("upd-buscar");
  boton.disabled = true;
  estado("Buscando…", false, "upd-app-estado");
  try {
    await registroSw.update();
    const nuevo = registroSw.installing;
    if (nuevo)
      await new Promise((ok) => nuevo.addEventListener("statechange", () => ["installed", "redundant", "activated"].includes(nuevo.state) && ok()));
    if (registroSw.waiting) {
      estado("Versión nueva lista. Recargando…", false, "upd-app-estado");
      recargarAlCambiar = true;
      registroSw.waiting.postMessage("activar");
    } else estado("Ya tienes la última versión.", false, "upd-app-estado");
  } catch {
    estado("No pude buscar: revisa tu conexión.", true, "upd-app-estado");
  } finally {
    boton.disabled = false;
  }
};

// ---------- Arranque ----------
const m = /^#C([0-9A-Z$*+\-./:]+)$/.exec(location.hash);
const mx = /^#X([0-9A-Z$*+\-./:]+)$/.exec(location.hash);
if (m) modoVer(m[1]);
else if (mx) modoActualizar(mx[1]); // actualización de personaje desde el Explorador estelar
else modoClave({ modo: "fundar" }); // sin QR, lo único posible es fundar una crew
window.addEventListener("hashchange", () => location.reload());
