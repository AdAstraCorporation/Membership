// Genera _site/ para GitHub Pages: copia site/, img/ y config.json, y crea
// members.json a partir de data/members/*.json. El índice nunca se commitea,
// así que los registros no pueden chocar en un archivo compartido.
import { readdir, readFile, mkdir, cp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const out = join(root, "_site");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, "site"), out, { recursive: true });
await cp(join(root, "img"), join(out, "img"), { recursive: true });
await cp(join(root, "data", "config.json"), join(out, "config.json"));

const dir = join(root, "data", "members");
const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
const members = [];
for (const f of files) {
  try {
    members.push(JSON.parse(await readFile(join(dir, f), "utf8")));
  } catch (e) {
    console.warn(`Ficha ignorada (${f}): ${e.message}`);
  }
}
members.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

await writeFile(join(out, "members.json"), JSON.stringify(members));
console.log(`Build listo: ${members.length} fichas en _site/`);
