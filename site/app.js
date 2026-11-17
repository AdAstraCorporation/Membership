// Carga members.json (generado en el build) y pinta una tarjeta por miembro.
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

fetch("members.json")
  .then((r) => r.json())
  .then((members) => {
    document.getElementById("lista").innerHTML = members
      .map(
        (m) => `
        <article class="ficha">
          <img src="${esc(m.imagen)}" alt="${esc(m.nombre)}">
          <h2>${esc(m.nombre)}</h2>
          <p><strong>Especie:</strong> ${esc(m.especie)}</p>
          <p><strong>Crew:</strong> ${esc(m.crew)} · <strong>Rol:</strong> ${esc(m.rol)}</p>
          <p>${esc(m.descripcion)}</p>
          <button onclick="window.print()">Imprimir / PDF</button>
        </article>`
      )
      .join("");
  });
