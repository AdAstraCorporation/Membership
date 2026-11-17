import { esc, cargarDatos, nombreCrew, colorCrew, nombreRol } from "./common.js";

const $ = (id) => document.getElementById(id);
const { members, config } = await cargarDatos();

$("resumen").textContent =
  `${members.length} ${members.length === 1 ? "miembro" : "miembros"} · ` +
  `${Object.keys(config.crews).length} crews · ${Object.keys(config.roles).length} roles`;

// Selectores
for (const [id, c] of Object.entries(config.crews)) $("f-crew").add(new Option(c.nombre, id));
for (const [id, nombre] of Object.entries(config.roles)) $("f-rol").add(new Option(nombre, id));

// Chips de crews (con color) y de roles (neutros). Clic = filtrar; otro clic = quitar filtro.
const contar = (campo, id) => members.filter((m) => m[campo] === id).length;
$("crews").innerHTML = Object.entries(config.crews)
  .map(
    ([id, c]) => `<button class="chip chip-crew" data-crew="${esc(id)}" style="--crew:${esc(c.color)}">
      <span>${esc(c.nombre)}</span><span class="chip-n">${contar("crew", id)}</span></button>`
  )
  .join("");
$("roles").innerHTML = Object.entries(config.roles)
  .map(
    ([id, nombre]) => `<button class="chip chip-rol" data-rol="${esc(id)}">
      <span>${esc(nombre)}</span><span class="chip-n">${contar("rol", id)}</span></button>`
  )
  .join("");

const alternar = (select, valor) => {
  select.value = select.value === valor ? "" : valor;
  pintar();
};
$("crews").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (b) alternar($("f-crew"), b.dataset.crew);
});
$("roles").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (b) alternar($("f-rol"), b.dataset.rol);
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
  document.querySelectorAll(".chip-crew").forEach((b) => b.classList.toggle("activa", b.dataset.crew === crew));
  document.querySelectorAll(".chip-rol").forEach((b) => b.classList.toggle("activa", b.dataset.rol === rol));
  $("vacio").hidden = visibles.length > 0;
  $("lista").innerHTML = visibles
    .map(
      (m) => `
      <a class="tarjeta" href="ficha.html?m=${encodeURIComponent(m.slug)}" style="--crew:${esc(colorCrew(config, m.crew))}">
        <img src="${esc(m.imagen)}" alt="" loading="lazy">
        <div class="tarjeta-cuerpo">
          <h2>${esc(m.nombre)}</h2>
          <p class="especie">${esc(m.especie)}</p>
          <dl class="meta">
            <dt>Crew</dt><dd><span class="badge">${esc(nombreCrew(config, m.crew))}</span></dd>
            <dt>Rol</dt><dd>${esc(nombreRol(config, m.rol))}</dd>
          </dl>
        </div>
      </a>`
    )
    .join("");
}

["buscar", "f-crew", "f-rol"].forEach((id) => $(id).addEventListener("input", pintar));
pintar();
