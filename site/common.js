export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function cargarConfig() {
  return fetch("config.json").then((r) => r.json());
}

export async function cargarDatos() {
  const [members, config] = await Promise.all([fetch("members.json").then((r) => r.json()), cargarConfig()]);
  return { members, config };
}

export const nombreCrew = (config, id) => config.crews[id]?.nombre ?? id;
export const colorCrew = (config, id) => config.crews[id]?.color ?? "#8fb8ff";
export const nombreRol = (config, id) => config.roles[id] ?? id;

export const fecha = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es", { year: "numeric", month: "long", day: "numeric" });
