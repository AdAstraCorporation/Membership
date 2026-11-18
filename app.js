// Generador de credenciales de la Corporación Ad Astra.
// Funciona aislado: no llama a ningún servicio externo (lo refuerza la CSP de index.html).
// Sin servidor ni base de datos: los datos viajan comprimidos en el fragmento
// de la URL (#d=...), que es lo que lleva el QR. El fragmento no se envía al
// servidor, así que GitHub Pages nunca recibe los datos.

const $ = (id) => document.getElementById(id);
const config = await fetch("config.json").then((r) => r.json());

const LIMITES = { n: 40, e: 40, p: 20, c: 4, r: 4, a: 10, h: 22 };
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nombreCrew = (id) => config.crews[id]?.nombre ?? id;
const colorCrew = (id) => config.crews[id]?.color ?? "#8c919b";
const nombreRol = (id) => config.roles[id] ?? id;

// ---------- Codificación del enlace ----------
const b64u = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function codificar(datos) {
  const json = new TextEncoder().encode(JSON.stringify(datos));
  if ("CompressionStream" in window) {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return "z" + b64u(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return "j" + b64u(json);
}

async function decodificar(texto) {
  if (texto.length > 2000) throw new Error("demasiado largo");
  const bytes = unb64u(texto.slice(1));
  let json;
  if (texto[0] === "z") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    json = await new Response(stream).text();
  } else if (texto[0] === "j") {
    json = new TextDecoder().decode(bytes);
  } else throw new Error("formato desconocido");
  return limpiar(JSON.parse(json));
}

// Solo se aceptan los campos conocidos, como texto y recortados.
function limpiar(o) {
  const d = {};
  for (const [k, max] of Object.entries(LIMITES)) {
    if (typeof o?.[k] === "string" && o[k].trim()) d[k] = o[k].trim().slice(0, max);
  }
  if (d.a && !/^\d{4}-\d{2}-\d{2}$/.test(d.a)) delete d.a;
  if (d.h && !/^[\w-]{22}$/.test(d.h)) delete d.h;
  if (!d.n) throw new Error("sin nombre");
  return d;
}

// ---------- Contraseña de la crew ----------
// PBKDF2-SHA256, 210 000 iteraciones, sal = "ad-astra:<crew>", 16 bytes en base64url.
// El hash viaja en el QR (campo h) y el oficial vive en config.json (crews.<id>.clave).
async function hashClave(clave, crew) {
  const llave = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(`ad-astra:${crew}`), iterations: 210000 },
    llave,
    128
  );
  return b64u(new Uint8Array(bits));
}

const claveOficial = (crew) => config.crews[crew]?.clave || "";
// Un QR puede invitar si lleva el hash vigente de su crew.
const puedeInvitar = (d) => Boolean(d.h && d.c && d.h === claveOficial(d.c));

const urlDe = (codigo) => `${location.origin}${location.pathname}#d=${codigo}`;

// ID estable derivado de los datos (no hay registro central que asigne números).
async function idDe(d) {
  const base = [d.n, d.e, d.c, d.r, d.a].join("|");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base)));
  const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "AA-" + [...hash.slice(0, 4)].map((b) => ABC[b % 32]).join("");
}

// ---------- QR con el emblema al centro ----------
const imagenes = {};
const cargarImagen = (src) =>
  (imagenes[src] ??= new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = mal;
    img.src = src;
  }));

// Corrección de errores H (30 %): el centro se puede tapar con el logo y el QR sigue leyéndose.
async function qrConLogo(texto) {
  if (!window.qrcode) return "";
  const q = window.qrcode(0, "H");
  q.addData(texto);
  q.make();
  const n = q.getModuleCount();
  const m = 12; // px por módulo
  const margen = 3; // zona de silencio, en módulos
  const lado = (n + margen * 2) * m;
  const cv = document.createElement("canvas");
  cv.width = cv.height = lado;
  const g = cv.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, lado, lado);

  // Hueco central (~24 % del ancho) para el emblema
  let caja = Math.round(n * 0.24);
  if ((n - caja) % 2) caja++;
  const ini = (n - caja) / 2;
  const fin = ini + caja;

  g.fillStyle = "#1a1d23";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (r >= ini && r < fin && c >= ini && c < fin) continue;
      if (q.isDark(r, c)) g.fillRect((c + margen) * m, (r + margen) * m, m, m);
    }
  }
  try {
    const logo = await cargarImagen("logo-negro.png");
    const espacio = caja * m * 0.86;
    const k = espacio / Math.max(logo.width, logo.height);
    const w = logo.width * k;
    const h = logo.height * k;
    g.drawImage(logo, (lado - w) / 2, (lado - h) / 2, w, h);
  } catch {
    /* sin logo, el QR sigue siendo válido */
  }
  return cv.toDataURL("image/png");
}

// ---------- Logo de la crew ----------
// config.json → crews.<id>.logo (ruta a una imagen del propio sitio, p. ej. "crews/C1.png").
// Sin logo, se dibuja un emblema con las iniciales y el color de la crew.
function logoCrew(id) {
  const c = config.crews[id];
  if (c?.logo && /^[\w./-]+$/.test(c.logo) && !c.logo.includes("..")) {
    return `<img class="crew-logo" src="${esc(c.logo)}" alt="${esc(c.nombre)}">`;
  }
  const iniciales = (c?.nombre ?? id).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return `<div class="crew-logo crew-logo-generado" aria-label="${esc(c?.nombre ?? id)}"><span>${esc(iniciales)}</span></div>`;
}

// ---------- Credencial (frente y reverso) ----------
async function credencial(d, { foto, url }) {
  const crew = nombreCrew(d.c);
  const rol = nombreRol(d.r);
  const id = await idDe(d);
  const qr = await qrConLogo(url);
  const color = esc(colorCrew(d.c));
  return `
  <div id="credencial" class="caras">
    <article class="credencial" style="--crew:${color}" aria-label="Frente">
      <div class="cred-ranura" aria-hidden="true"></div>
      <header class="cred-cab">
        <img class="cred-logo" src="logo.png" alt="">
        <div>
          <p class="cred-org">Corporación Ad Astra</p>
          <p class="cred-sub">Crew ${esc(crew)}</p>
        </div>
      </header>
      <div class="cred-banda">
        <p class="cred-titulo">Tripulación</p>
        <p class="cred-rol">${esc(rol)}</p>
      </div>
      <div class="cred-foto">
        ${foto
          ? `<img src="${esc(foto)}" alt="${esc(d.n)}">`
          : `<div class="cred-sinfoto"><img src="logo.png" alt=""><span>Sin imagen</span></div>`}
      </div>
      <div class="cred-nombre">
        <h1>${esc(d.n)}</h1>
        <p>${esc(d.e || "")}${d.p ? ` · ${esc(d.p)}` : ""}</p>
      </div>
      <div class="cred-datos">
        <dl>
          <dt>Crew</dt><dd>${esc(crew)}</dd>
          <dt>Rol</dt><dd>${esc(rol)}</dd>
          <dt>ID</dt><dd>${id}</dd>
          <dt>Alta</dt><dd>${esc(d.a || "")}</dd>
        </dl>
        <figure class="cred-crew">${logoCrew(d.c)}<figcaption>${esc(crew)}</figcaption></figure>
      </div>
      <footer class="cred-franja">Per aspera ad astra</footer>
    </article>

    <article class="credencial cred-reverso" style="--crew:${color}" aria-label="Reverso">
      <div class="cred-ranura" aria-hidden="true"></div>
      <header class="rev-cab">
        <p class="cred-org">Corporación Ad Astra</p>
        <p class="cred-sub">Registro de tripulación</p>
      </header>
      <div class="rev-qr">
        ${qr ? `<img src="${qr}" alt="QR de la credencial">` : ""}
      </div>
      <p class="rev-instr">Escanea para ver esta credencial<br>o unirte a la Crew ${esc(crew)}</p>
      <div class="rev-id">
        <span>${esc(d.n)}</span>
        <span>${id}</span>
      </div>
      <img class="rev-emblema" src="logo.png" alt="">
      <footer class="cred-franja">Per aspera ad astra</footer>
    </article>
  </div>`;
}

// Si la imagen no carga, se muestra el marcador "sin imagen".
function respaldoFoto(contenedor) {
  const img = contenedor.querySelector(".cred-foto > img");
  img?.addEventListener("error", () => {
    img.outerHTML = `<div class="cred-sinfoto"><img src="logo.png" alt=""><span>Imagen no disponible</span></div>`;
  });
}

// ---------- Acciones ----------
let urlActual = "";
let nombreArchivo = "credencial";

async function descargarPng(boton) {
  if (!window.html2canvas) return estado("No se pudo cargar el generador de imágenes.", true);
  boton.disabled = true;
  try {
    const canvas = await window.html2canvas($("credencial"), { scale: 3, backgroundColor: null });
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
  if (b.dataset.accion === "pdf") window.print();
  if (b.dataset.accion === "png") descargarPng(b);
  if (b.dataset.accion === "copiar") {
    try {
      await navigator.clipboard.writeText(urlActual);
      estado("Enlace copiado.");
    } catch {
      estado(urlActual);
    }
  }
});

function estado(msg, error = false) {
  const el = $("estado");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("error", error);
}

const slug = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "credencial";

// ---------- Modo ver (llegada desde el QR) ----------
async function modoVer(codigo) {
  try {
    const d = await decodificar(codigo);
    nombreArchivo = `credencial-${slug(d.n)}`;
    document.title = `${d.n} · Corporación Ad Astra`;
    $("vista-ver").innerHTML = await credencial(d, { url: urlDe(codigo) });
    respaldoFoto($("vista-ver"));
    if (puedeInvitar(d)) {
      $("boton-unirse").hidden = false;
      $("boton-unirse").onclick = () => modoUnirse({ crew: d.c, h: d.h });
    } else if (d.h) {
      $("ver-aviso").textContent = "Credencial reconstruida a partir de su QR. Este QR ya no sirve para invitar: la contraseña de la crew cambió.";
    }
    $("ver").hidden = false;
  } catch {
    $("error").hidden = false;
  }
}

// ---------- Modo crear ----------
async function modoCrear({ crew, h }) {
  ocultarTodo();
  const form = $("form");
  $("crew-fija").textContent = nombreCrew(crew);
  for (const [id, nombre] of Object.entries(config.roles)) form.r.add(new Option(nombre, id));
  const hoy = new Date();
  form.a.value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
  $("crear").hidden = false;

  let foto = null; // object URL local, nunca sale del navegador
  form.foto.addEventListener("change", () => {
    if (foto) URL.revokeObjectURL(foto);
    foto = form.foto.files[0] ? URL.createObjectURL(form.foto.files[0]) : null;
    pintar();
  });

  let turno = 0;
  async function pintar() {
    const mio = ++turno;
    const crudo = { ...Object.fromEntries(Object.keys(LIMITES).map((k) => [k, form[k]?.value ?? ""])), c: crew, h };
    let d;
    try {
      d = limpiar(crudo);
    } catch {
      d = { ...crudo, n: "Tu nombre" };
    }
    const codigo = await codificar(d);
    if (mio !== turno) return; // llegó una edición más reciente
    urlActual = urlDe(codigo);
    nombreArchivo = `credencial-${slug(d.n)}`;
    $("vista-crear").innerHTML = await credencial(d, { foto, url: urlActual });
    respaldoFoto($("vista-crear"));
  }

  let espera;
  form.addEventListener("input", () => {
    clearTimeout(espera);
    espera = setTimeout(pintar, 150);
  });
  pintar();
}

// ---------- Unirse (contraseña) ----------
function ocultarTodo() {
  for (const id of ["inicio", "unirse", "crear", "ver", "error"]) $(id).hidden = true;
}

// Con QR: la crew viene del QR. Sin QR (fundador): se elige la crew.
function modoUnirse({ crew, h } = {}) {
  ocultarTodo();
  const form = $("form-unirse");
  const fundador = !crew;
  $("unirse-crew").hidden = !fundador;
  if (fundador && !form.c.options.length) {
    for (const [id, c] of Object.entries(config.crews)) if (c.clave) form.c.add(new Option(c.nombre, id));
  }
  const crewActual = () => (fundador ? form.c.value : crew);
  const titulo = () => ($("unirse-titulo").textContent = fundador ? "Fundar credencial de crew" : `Crew ${nombreCrew(crew)}`);
  titulo();
  form.c.onchange = titulo;
  $("unirse").hidden = false;
  form.clave.value = "";
  form.clave.focus();

  let intentos = 0;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const est = $("unirse-estado");
    const c = crewActual();
    const oficial = claveOficial(c);
    if (!oficial) return (est.textContent = "Esta crew todavía no tiene contraseña configurada.");
    if (h && h !== oficial) return (est.textContent = "Este QR ya no sirve para invitar.");
    est.textContent = "Comprobando…";
    est.classList.remove("error");
    const boton = form.querySelector("button");
    boton.disabled = true;
    const ok = (await hashClave(form.clave.value, c)) === oficial;
    // Pausa creciente tras cada fallo: solo frena intentos a mano desde la página.
    if (!ok) await new Promise((r) => setTimeout(r, Math.min(++intentos, 5) * 600));
    boton.disabled = false;
    if (!ok) {
      est.textContent = "Contraseña incorrecta.";
      est.classList.add("error");
      return;
    }
    modoCrear({ crew: c, h: oficial });
  };
}

function modoInicio() {
  ocultarTodo();
  $("inicio").hidden = false;
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-accion=fundar]")) modoUnirse();
});

// ---------- Arranque ----------
const m = /^#d=([\w-]+)$/.exec(location.hash);
if (m) modoVer(m[1]);
else modoInicio();
window.addEventListener("hashchange", () => location.reload());
