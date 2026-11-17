import { esc, cargarDatos, nombreCrew, colorCrew, nombreRol } from "./common.js";

const $ = (id) => document.getElementById(id);
const { members, config } = await cargarDatos();

$("resumen").textContent =
  `${members.length} ${members.length === 1 ? "miembro" : "miembros"} en ${Object.keys(config.crews).length} crews`;

// Selectores
for (const [id, c] of Object.entries(config.crews)) $("f-crew").add(new Option(c.nombre, id));
for (const [id, nombre] of Object.entries(config.roles)) $("f-rol").add(new Option(nombre, id));

// Resumen por crew (clic = filtrar)
$("crews").innerHTML = Object.entries(config.crews)
  .map(([id, c]) => {
    const n = members.filter((m) => m.crew === id).length;
    return `<button class="crew" data-crew="${esc(id)}" style="--crew:${esc(c.color)}">
      <span class="crew-nombre">${esc(c.nombre)}</span><span class="crew-n">${n}</span></button>`;
  })
  .join("");
$("crews").addEventListener("click", (e) => {
  const b = e.target.closest(".crew");
  if (!b) return;
  $("f-crew").value = $("f-crew").value === b.dataset.crew ? "" : b.dataset.crew;
  pintar();
});

function pintar() {
  const q = $("buscar").value.trim().toLowerCase();
  const crew = $("f-crew").value;
  const rol = $("f-rol").value;
  const visibles = members.filter(
    (m) =>
      (!crew || m.crew === crew) &&
      (!rol || m.rol === rol) &&
      (!q || `${m.nombre} ${m.especie}`.toLowerCase().includes(q))
  );
  document.querySelectorAll(".crew").forEach((b) => b.classList.toggle("activa", b.dataset.crew === crew));
  $("vacio").hidden = visibles.length > 0;
  $("lista").innerHTML = visibles
    .map(
      (m) => `
      <a class="tarjeta" href="ficha.html?m=${encodeURIComponent(m.slug)}" style="--crew:${esc(colorCrew(config, m.crew))}">
        <img src="${esc(m.imagen)}" alt="" loading="lazy">
        <div class="tarjeta-cuerpo">
          <h2>${esc(m.nombre)}</h2>
          <p class="especie">${esc(m.especie)}</p>
          <p class="etiquetas"><span class="badge">${esc(nombreCrew(config, m.crew))}</span>
            <span class="rol">${esc(nombreRol(config, m.rol))}</span></p>
        </div>
      </a>`
    )
    .join("");
}

["buscar", "f-crew", "f-rol"].forEach((id) => $(id).addEventListener("input", pintar));
pintar();
