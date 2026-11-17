import { WORKER_URL } from "./config.js";
import { cargarConfig, nombreCrew, nombreRol } from "./common.js";

const form = document.getElementById("form");
const estado = document.getElementById("estado");
const config = await cargarConfig();
const MAX_LADO = 800;

const aSlug = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

// El identificador sigue al nombre hasta que el usuario lo edita a mano.
let slugManual = false;
form.slug.addEventListener("input", () => (slugManual = true));
form.nombre.addEventListener("input", () => {
  if (!slugManual) form.slug.value = aSlug(form.nombre.value);
});

form.descripcion.addEventListener("input", () => {
  document.getElementById("contador").textContent = form.descripcion.value.length;
});

// Vista previa de crew y rol a partir del código (la validez real la comprueba el Worker).
form.code.addEventListener("input", () => {
  const m = /^(C\d{1,2})-(R\d{1,2})-[A-Z0-9]{4,12}\.[\w-]{8}$/.exec(form.code.value.trim());
  document.getElementById("code-info").textContent = m
    ? `Crew: ${nombreCrew(config, m[1])} · Rol: ${nombreRol(config, m[2])}`
    : "";
});

let foto = null; // { type, data }
form.foto.addEventListener("change", async () => {
  foto = null;
  const file = form.foto.files[0];
  const preview = document.getElementById("preview");
  preview.hidden = true;
  if (!file) return;
  try {
    foto = await reducir(file);
    preview.src = `data:${foto.type};base64,${foto.data}`;
    preview.hidden = false;
  } catch {
    mostrar("No pude leer esa imagen. Prueba con un JPG o PNG.", true);
  }
});

async function reducir(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_LADO / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  // WebP si el navegador sabe codificarlo; si no, JPEG.
  let blob = await new Promise((r) => canvas.toBlob(r, "image/webp", 0.85));
  if (!blob || blob.type !== "image/webp") blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  const url = await new Promise((r) => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.readAsDataURL(blob);
  });
  return { type: blob.type, data: url.split(",")[1] };
}

function mostrar(msg, error = false, html = false) {
  estado[html ? "innerHTML" : "textContent"] = msg;
  estado.classList.toggle("error", error);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  if (!foto) return mostrar("Falta la imagen.", true);

  const boton = form.querySelector("button[type=submit]");
  boton.disabled = true;
  mostrar("Enviando…");
  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.code.value.trim(),
        member: {
          slug: form.slug.value.trim(),
          nombre: form.nombre.value,
          especie: form.especie.value,
          pronombres: form.pronombres.value,
          descripcion: form.descripcion.value,
        },
        photo: foto,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "No se pudo completar el registro.");
    form.reset();
    foto = null;
    document.getElementById("preview").hidden = true;
    mostrar(
      `¡Bienvenide a bordo! Tu ficha aparecerá en unos minutos en
       <a href="ficha.html?m=${encodeURIComponent(out.slug)}">tu página de miembro</a>.`,
      false,
      true
    );
  } catch (err) {
    mostrar(err.message === "Failed to fetch" ? "No hay conexión con el servidor de registro." : err.message, true);
  } finally {
    boton.disabled = false;
  }
});
