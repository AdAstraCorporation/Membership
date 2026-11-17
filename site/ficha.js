import { esc, cargarDatos, nombreCrew, colorCrew, nombreRol, fecha } from "./common.js";

const slug = new URLSearchParams(location.search).get("m");
const { members, config } = await cargarDatos();
const m = members.find((x) => x.slug === slug);
const cont = document.getElementById("ficha-contenedor");

if (!m) {
  cont.innerHTML = `<p class="vacio">No encontramos esta credencial. Si te acabas de registrar,
    espera unos minutos a que el sitio se actualice y recarga la página.</p>`;
} else {
  // ID de miembro según orden de alta
  const orden = [...members].sort((a, b) => (a.alta + a.slug).localeCompare(b.alta + b.slug));
  const id = `AA-${String(orden.indexOf(m) + 1).padStart(3, "0")}`;
  const crew = nombreCrew(config, m.crew);
  const rol = nombreRol(config, m.rol);
  const url = new URL(`ficha.html?m=${encodeURIComponent(m.slug)}`, location.href).href;
  document.title = `${m.nombre} · Corporación Ad Astra`;

  // QR como data URL (mismo origen, así html2canvas lo incluye en el PNG)
  let qr = "";
  if (window.qrcode) {
    const q = window.qrcode(0, "M");
    q.addData(url);
    q.make();
    qr = q.createDataURL(4, 0);
  }

  cont.innerHTML = `
    <article id="ficha" class="credencial" style="--crew:${esc(colorCrew(config, m.crew))}">
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
      <div class="cred-foto"><img src="${esc(m.imagen)}" alt="${esc(m.nombre)}"></div>
      <div class="cred-nombre">
        <h1>${esc(m.nombre)}</h1>
        <p>${esc(m.especie)}${m.pronombres ? ` · ${esc(m.pronombres)}` : ""}</p>
      </div>
      <div class="cred-datos">
        <dl>
          <dt>Crew</dt><dd>${esc(crew)}</dd>
          <dt>Rol</dt><dd>${esc(rol)}</dd>
          <dt>ID</dt><dd>${id}</dd>
          <dt>Alta</dt><dd>${esc(m.alta)}</dd>
        </dl>
        ${qr ? `<figure class="cred-qr"><img src="${qr}" alt="QR de la credencial"><figcaption>Ver ficha</figcaption></figure>` : ""}
      </div>
      <footer class="cred-franja">Per aspera ad astra</footer>
    </article>`;

  const bio = document.getElementById("bio");
  bio.innerHTML = `<h2>Sobre ${esc(m.nombre)}</h2><p>${esc(m.descripcion)}</p>
    <p class="ayuda">Miembro desde el ${esc(fecha(m.alta))}.</p>`;
  bio.hidden = false;
  document.getElementById("acciones").hidden = false;

  document.getElementById("pdf").addEventListener("click", () => window.print());
  document.getElementById("png").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (!window.html2canvas) return alert("No se pudo cargar el generador de imágenes.");
    btn.disabled = true;
    btn.textContent = "Generando…";
    try {
      const canvas = await window.html2canvas(document.getElementById("ficha"), { scale: 3, backgroundColor: null });
      const a = document.createElement("a");
      a.download = `credencial-${m.slug}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } finally {
      btn.disabled = false;
      btn.textContent = "Descargar PNG";
    }
  });
}
