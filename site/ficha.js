import { esc, cargarDatos, nombreCrew, colorCrew, nombreRol, fecha } from "./common.js";

const slug = new URLSearchParams(location.search).get("m");
const { members, config } = await cargarDatos();
const m = members.find((x) => x.slug === slug);
const cont = document.getElementById("ficha-contenedor");

if (!m) {
  cont.innerHTML = `<p class="vacio">No encontramos esta ficha. Si te acabas de registrar,
    espera unos minutos a que el sitio se actualice y recarga la página.</p>`;
} else {
  // Número de miembro según orden de alta
  const orden = [...members].sort((a, b) => (a.alta + a.slug).localeCompare(b.alta + b.slug));
  const numero = String(orden.indexOf(m) + 1).padStart(3, "0");
  document.title = `${m.nombre} · Corporación Ad Astra`;

  cont.innerHTML = `
    <article id="ficha" class="ficha" style="--crew:${esc(colorCrew(config, m.crew))}">
      <header class="ficha-cab">
        <span>✦ Corporación Ad Astra</span><span>Ficha Nº ${numero}</span>
      </header>
      <div class="ficha-cuerpo">
        <img class="ficha-foto" src="${esc(m.imagen)}" alt="${esc(m.nombre)}">
        <div class="ficha-datos">
          <h1>${esc(m.nombre)}</h1>
          <dl>
            <dt>Especie</dt><dd>${esc(m.especie)}</dd>
            ${m.pronombres ? `<dt>Pronombres</dt><dd>${esc(m.pronombres)}</dd>` : ""}
            <dt>Crew</dt><dd><span class="badge">${esc(nombreCrew(config, m.crew))}</span></dd>
            <dt>Rol</dt><dd>${esc(nombreRol(config, m.rol))}</dd>
            <dt>Alta</dt><dd>${esc(fecha(m.alta))}</dd>
          </dl>
        </div>
      </div>
      <p class="ficha-desc">${esc(m.descripcion)}</p>
      <footer class="ficha-pie">Per aspera ad astra</footer>
    </article>`;
  document.getElementById("acciones").hidden = false;

  document.getElementById("pdf").addEventListener("click", () => window.print());
  document.getElementById("png").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (!window.html2canvas) return alert("No se pudo cargar el generador de imágenes. Revisa tu conexión.");
    btn.disabled = true;
    btn.textContent = "Generando…";
    try {
      const canvas = await window.html2canvas(document.getElementById("ficha"), {
        scale: 2,
        backgroundColor: null,
        useCORS: true,
      });
      const a = document.createElement("a");
      a.download = `ficha-${m.slug}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } finally {
      btn.disabled = false;
      btn.textContent = "Descargar PNG";
    }
  });
}
