// Generador de credenciales de la Corporación Ad Astra.
// Sin servidor ni base de datos: los datos viajan comprimidos en el fragmento
// de la URL (#d=...), que es lo que lleva el QR. El fragmento no se envía al
// servidor, así que GitHub Pages nunca recibe los datos.

const $ = (id) => document.getElementById(id);
const config = await fetch("config.json").then((r) => r.json());

const LIMITES = { n: 40, e: 40, p: 20, c: 4, r: 4, a: 10, i: 300 };
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
  if (d.i && !/^https:\/\//i.test(d.i)) delete d.i;
  if (d.a && !/^\d{4}-\d{2}-\d{2}$/.test(d.a)) delete d.a;
  if (!d.n) throw new Error("sin nombre");
  return d;
}

const urlDe = (codigo) => `${location.origin}${location.pathname}#d=${codigo}`;

// ID estable derivado de los datos (no hay registro central que asigne números).
async function idDe(d) {
  const base = [d.n, d.e, d.c, d.r, d.a].join("|");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base)));
  const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "AA-" + [...hash.slice(0, 4)].map((b) => ABC[b % 32]).join("");
}

function qrDataUrl(texto) {
  if (!window.qrcode) return "";
  const q = window.qrcode(0, "L");
  q.addData(texto);
  q.make();
  return q.createDataURL(4, 0);
}

// ---------- Credencial ----------
async function credencial(d, { foto, url }) {
  const crew = nombreCrew(d.c);
  const rol = nombreRol(d.r);
  const imagen = foto || d.i;
  const qr = qrDataUrl(url);
  return `
    <article id="credencial" class="credencial" style="--crew:${esc(colorCrew(d.c))}">
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
        ${imagen
          ? `<img src="${esc(imagen)}" alt="${esc(d.n)}" referrerpolicy="no-referrer">`
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
          <dt>ID</dt><dd>${await idDe(d)}</dd>
          <dt>Alta</dt><dd>${esc(d.a || "")}</dd>
        </dl>
        ${qr ? `<figure class="cred-qr"><img src="${qr}" alt="QR de la credencial"><figcaption>Escanéame</figcaption></figure>` : ""}
      </div>
      <footer class="cred-franja">Per aspera ad astra</footer>
    </article>`;
}

// Si la imagen enlazada no carga, se muestra el marcador "sin imagen".
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
    const canvas = await window.html2canvas($("credencial"), { scale: 3, backgroundColor: null, useCORS: true });
    const a = document.createElement("a");
    a.download = `${nombreArchivo}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  } catch {
    estado("No se pudo generar el PNG. Si usas un enlace de imagen, prueba subiendo la imagen desde tu equipo.", true);
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
    $("ver").hidden = false;
  } catch {
    $("error").hidden = false;
  }
}

// ---------- Modo crear ----------
async function modoCrear() {
  const form = $("form");
  for (const [id, c] of Object.entries(config.crews)) form.c.add(new Option(c.nombre, id));
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
    const crudo = Object.fromEntries(Object.keys(LIMITES).map((k) => [k, form[k]?.value ?? ""]));
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

// ---------- Inicio ----------
const m = /^#d=([\w-]+)$/.exec(location.hash);
if (m) modoVer(m[1]);
else modoCrear();
window.addEventListener("hashchange", () => location.reload());
