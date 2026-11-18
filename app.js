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
const FORMATOS = { 1: "image/webp", 2: "image/jpeg" };
const CODIGO_FORMATO = { "image/webp": 1, "image/jpeg": 2 };
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
    if (tipo === 1) imgs.foto = { mime, bytes };
    if (tipo === 2) imgs.logo = { mime, bytes };
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

const blobDe = (img) => (img ? new Blob([img.bytes], { type: img.mime }) : null);

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
  if (logoUrl) return `<img class="crew-logo" src="${esc(logoUrl)}" alt="${esc(d.c)}">`;
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
          ? `<img src="${esc(foto)}" alt="${esc(d.n)}">`
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

async function descargarPng(boton) {
  boton.disabled = true;
  try {
    await cargarHtml2canvas();
    const caras = document.querySelector("main:not([hidden]) .caras"); // la credencial de la pantalla visible
    if (!caras) return;
    const canvas = await window.html2canvas(caras, { scale: 3, backgroundColor: null });
    const a = document.createElement("a");
    a.download = `${nombreArchivo}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  } catch {
    estado("No se pudo generar el PNG.", true);
  } finally {
    boton.disabled = false;
  }
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-accion]");
  if (!b) return;
  const accion = b.dataset.accion;
  if (accion === "pdf") window.print();
  if (accion === "png") descargarPng(b);
  if (accion === "fundar") modoClave({ modo: "fundar" });
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
  for (const s of ["inicio", "clave", "crear", "ver", "error"]) $(s).hidden = s !== id;
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
  const fotoBlob = blobDe(paquete.foto);
  const logoBlob = blobDe(paquete.logo);
  nombreArchivo = `credencial-${slug(d.n)}`;
  urlActual = base() + datos;
  document.title = `${d.n} · Corporación Ad Astra`;
  const q = generarQr(base(), datos);
  $("vista-ver").innerHTML = await credencial(d, {
    foto: fotoBlob && URL.createObjectURL(fotoBlob),
    logo: logoBlob && URL.createObjectURL(logoBlob),
    qr: q && qrImagen(q),
  });

  const venc = vencida(d);
  $("boton-unirse").hidden = !d.h || venc;
  $("boton-renovar").hidden = !d.h || esLider(d);
  $("boton-unirse").onclick = () => modoClave({ modo: "unirse", d, logo: logoBlob });
  $("boton-renovar").onclick = () => modoClave({ modo: "renovar", d, logo: logoBlob, foto: fotoBlob });
  $("ver-aviso").textContent = esLider(d)
    ? "Credencial del líder de la crew: no vence."
    : !d.a
    ? "Esta credencial no tiene fecha de emisión."
    : venc
      ? `Esta credencial venció el ${venceDe(d.a)}. No sirve para invitar hasta que su titular la renueve.`
      : `Credencial reconstruida a partir de su QR. Válida hasta el ${venceDe(d.a)}.`;
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
  if (fundar) pintarMuestras($("muestras-crew"), "estilo", "1");
  $("campo-confirmar").hidden = !fundar;
  $("clave-eyebrow").textContent = { fundar: "Fundar una crew", unirse: "Unirse a la tripulación", renovar: "Renovar credencial" }[modo];
  $("clave-titulo").textContent = fundar ? "Nueva crew" : `Crew ${d.c}`;
  $("clave-id").textContent = fundar ? "" : d.i;
  $("clave-ayuda").textContent = fundar
    ? "Elige el nombre, el color y la contraseña. La crew recibirá un ID único. Comparte la contraseña solo con quien quieras invitar: cada miembro podrá invitar a otros con su QR."
    : modo === "renovar"
      ? "Escribe la contraseña de la crew para emitir una credencial nueva, válida por un año."
      : "Escribe la contraseña que te dio un miembro de la crew.";
  estado("", false, "clave-estado");
  mostrar("clave");
  (fundar ? form.crew : form.clave).focus();

  let intentos = 0;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const boton = form.querySelector("button[type=submit]");
    if (fundar) {
      const crew = form.crew.value.trim();
      if (!crew) return estado("Escribe el nombre de la crew.", true, "clave-estado");
      if (form.clave.value.length < 10) return estado("Usa una contraseña de al menos 10 caracteres.", true, "clave-estado");
      if (form.clave.value !== form.confirmar.value) return estado("Las contraseñas no coinciden.", true, "clave-estado");
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
    if (!ok) return estado("Contraseña incorrecta.", true, "clave-estado");
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
    ? `Emisión ${emision} · credencial de líder: no vence`
    : `Emisión ${emision} · vence ${venceDe(emision)}`;
  if (lider && !form.r.value) form.r.value = "Líder";
  $("logo-heredado").hidden = !logoHeredado;
  const libre = crew.l === "1";
  $("estilo-miembro").hidden = !libre;
  $("estilo-fijo").hidden = libre;
  $("estilo-fijo").textContent = `Estilo de la crew: ${ESTILOS[crew.s].nombre}`;
  pintarMuestras($("muestras-miembro"), "y", previo?.d.y && libre ? previo.d.y : crew.s);
  mostrar("crear");

  // Fuentes de imagen (archivo local o miniatura heredada) y sus miniaturas para el QR.
  let fotoFuente = previo?.foto ?? null;
  let logoFuente = logoHeredado ?? null;
  let fotoUrl = fotoFuente && URL.createObjectURL(fotoFuente);
  let logoUrl = logoFuente && URL.createObjectURL(logoFuente);
  let miniFoto = null;
  let miniLogo = null;

  // Si el usuario cambia otra imagen mientras se calcula, solo vale el cálculo más reciente.
  let versionMini = 0;
  async function prepararMiniaturas() {
    const mia = ++versionMini;
    try {
      const logoNuevo = logoFuente ? await miniatura(logoFuente, PRESUPUESTO_LOGO, { cuadrado: false }) : null;
      const resto = PRESUPUESTO_IMAGENES - (logoNuevo?.bytes.length ?? 0);
      const fotoNueva = fotoFuente ? await miniatura(fotoFuente, resto, { cuadrado: true }) : null;
      if (mia !== versionMini) return false;
      [miniLogo, miniFoto] = [logoNuevo, fotoNueva];
      estado("");
      return true;
    } catch {
      if (mia === versionMini) estado("No se pudo leer una de las imágenes.", true);
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
      logoFuente = f ?? logoHeredado ?? null;
      logoUrl = logoFuente && URL.createObjectURL(logoFuente);
    }
    estado("Preparando imágenes para el QR…");
    if (await prepararMiniaturas()) pintar();
  };
  form.foto.onchange = cambiar(form.foto, "foto");
  form.logo.onchange = cambiar(form.logo, "logo");

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
    const datos = await empaquetar(d, { foto: miniFoto, logo: miniLogo });
    if (mio !== turno) return; // llegó una edición más reciente
    urlActual = base() + datos;
    nombreArchivo = `credencial-${slug(d.n)}`;
    const q = generarQr(base(), datos);
    if (!q) estado("Los datos no caben en el QR. Prueba con imágenes más simples.", true);
    $("vista-crear").innerHTML = await credencial(d, { foto: fotoUrl, logo: logoUrl, qr: q && qrImagen(q) });
  }

  let espera;
  form.oninput = () => {
    clearTimeout(espera);
    espera = setTimeout(pintar, 150);
  };
  await prepararMiniaturas();
  pintar();
}

// ---------- Arranque ----------
const m = /^#C([0-9A-Z$*+\-./:]+)$/.exec(location.hash);
if (m) modoVer(m[1]);
else mostrar("inicio");
window.addEventListener("hashchange", () => location.reload());
