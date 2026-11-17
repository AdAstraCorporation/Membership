// Lo ejecuta register.yml. Recibe el payload de repository_dispatch en
// CLIENT_PAYLOAD (JSON): { member: {...}, photo_url: "https://..." }.
// Valida, descarga la foto, la guarda como WebP y escribe la ficha.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const root = new URL("..", import.meta.url).pathname;
const { member, photo_url } = JSON.parse(process.env.CLIENT_PAYLOAD || "{}");

const slugOk = (s) => typeof s === "string" && /^[a-z0-9-]{3,40}$/.test(s);
const text = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

if (!member || !slugOk(member.slug)) throw new Error("slug inválido");
if (!text(member.nombre, 60)) throw new Error("nombre inválido");
if (!text(member.especie, 60)) throw new Error("especie inválida");
if (!text(member.descripcion, 500)) throw new Error("descripción inválida");
if (!/^C\d+$/.test(member.crew ?? "")) throw new Error("crew inválido");
if (!/^R\d+$/.test(member.rol ?? "")) throw new Error("rol inválido");
if (typeof photo_url !== "string" || !photo_url.startsWith("https://")) {
  throw new Error("URL de foto inválida");
}

const dataPath = join(root, "data", "members", `${member.slug}.json`);
try {
  await readFile(dataPath);
  throw new Error(`ya existe una ficha con slug ${member.slug}`);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

const res = await fetch(photo_url);
if (!res.ok) throw new Error(`no se pudo descargar la foto (${res.status})`);
const input = Buffer.from(await res.arrayBuffer());
if (input.length > 10 * 1024 * 1024) throw new Error("foto mayor a 10 MB");

const img = await sharp(input)
  .rotate()
  .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
  .webp({ quality: 80 })
  .toBuffer();

await mkdir(join(root, "img"), { recursive: true });
await mkdir(join(root, "data", "members"), { recursive: true });
await writeFile(join(root, "img", `${member.slug}.webp`), img);

const record = {
  slug: member.slug,
  nombre: member.nombre.trim(),
  especie: member.especie.trim(),
  crew: member.crew,
  rol: member.rol,
  descripcion: member.descripcion.trim(),
  imagen: `img/${member.slug}.webp`,
  alta: new Date().toISOString().slice(0, 10),
};
await writeFile(dataPath, JSON.stringify(record, null, 2) + "\n");
console.log(`Ficha creada: ${member.slug}`);
