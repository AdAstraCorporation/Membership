// Relay de registro (Cloudflare Worker, plan gratuito).
// Secretos: INVITE_SECRET, GH_TOKEN. Variables: GH_REPO ("owner/repo"),
// GH_BRANCH (por defecto "main"), ALLOWED_ORIGIN (URL del sitio en Pages).
//
// POST JSON: { code, member: { slug, nombre, especie, pronombres?, descripcion },
//              photo: { type: "image/webp" | "image/jpeg", data: <base64> } }
//
// Valida el código firmado y crea UN commit con:
//   data/members/<slug>.json, img/<slug>.<ext> y data/invites/<código>.json
// El archivo de data/invites marca el código como usado (un solo uso).

const INVITE_RE = /^(C\d{1,2})-(R\d{1,2})-([A-Z0-9]{4,12})$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const MAX_PHOTO_B64 = 2_000_000; // ~1,5 MB decodificado

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
});

const reply = (obj, status, origin) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });

async function sign(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, 8);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const text = (v, max, optional = false) => {
  if (optional && (v === undefined || v === null || v === "")) return "";
  if (typeof v !== "string") throw new HttpError(400, "datos incompletos");
  const t = v.trim();
  if (!t || t.length > max) throw new HttpError(400, "datos incompletos o demasiado largos");
  return t;
};

function checkPhoto(photo) {
  if (!photo || typeof photo.data !== "string") throw new HttpError(400, "falta la imagen");
  if (photo.data.length > MAX_PHOTO_B64) throw new HttpError(413, "la imagen es demasiado grande");
  let head;
  try {
    head = atob(photo.data.slice(0, 16));
  } catch {
    throw new HttpError(400, "imagen inválida");
  }
  if (photo.type === "image/webp" && head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "webp";
  if (photo.type === "image/jpeg" && head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8) return "jpg";
  throw new HttpError(400, "la imagen debe ser WebP o JPEG");
}

function github(env) {
  const base = `https://api.github.com/repos/${env.GH_REPO}`;
  const call = (path, init = {}) =>
    fetch(base + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ad-astra-relay",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  const json = async (path, init) => {
    const r = await call(path, init);
    if (!r.ok) throw new HttpError(502, `GitHub ${r.status} en ${path}`);
    return r.json();
  };
  const exists = async (path, ref) => {
    const r = await call(`/contents/${path}?ref=${ref}`);
    if (r.status === 404) return false;
    if (r.ok) return true;
    throw new HttpError(502, `GitHub ${r.status} al comprobar ${path}`);
  };
  return { call, json, exists };
}

async function register(body, env) {
  // 1. Código de invitación
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const dot = code.lastIndexOf(".");
  const data = dot > 0 ? code.slice(0, dot) : "";
  const match = INVITE_RE.exec(data);
  if (!match || !safeEqual(await sign(data, env.INVITE_SECRET), code.slice(dot + 1))) {
    throw new HttpError(403, "código de invitación inválido");
  }
  const [, crew, rol] = match; // crew y rol salen del código, no del formulario

  // 2. Datos de la ficha
  const m = body.member || {};
  if (typeof m.slug !== "string" || !SLUG_RE.test(m.slug)) throw new HttpError(400, "identificador inválido");
  const ext = checkPhoto(body.photo);
  const record = {
    slug: m.slug,
    nombre: text(m.nombre, 60),
    especie: text(m.especie, 60),
    pronombres: text(m.pronombres, 30, true),
    crew,
    rol,
    descripcion: text(m.descripcion, 600),
    imagen: `img/${m.slug}.${ext}`,
    alta: new Date().toISOString().slice(0, 10),
  };

  // 3. Commit único con ficha, imagen y marca de código usado
  const gh = github(env);
  const branch = env.GH_BRANCH || "main";
  const memberPath = `data/members/${m.slug}.json`;
  const invitePath = `data/invites/${data}.json`;

  const [imgBlob, memberBlob, inviteBlob] = await Promise.all([
    gh.json("/git/blobs", { method: "POST", body: JSON.stringify({ content: body.photo.data, encoding: "base64" }) }),
    gh.json("/git/blobs", { method: "POST", body: JSON.stringify({ content: JSON.stringify(record, null, 2) + "\n", encoding: "utf-8" }) }),
    gh.json("/git/blobs", { method: "POST", body: JSON.stringify({ content: JSON.stringify({ slug: m.slug, usado: record.alta }) + "\n", encoding: "utf-8" }) }),
  ]);

  // Si otro registro entra a la vez, el ref avanza y se reintenta sobre el nuevo HEAD.
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = await gh.json(`/git/ref/heads/${branch}`);
    const head = ref.object.sha;
    if (await gh.exists(invitePath, head)) throw new HttpError(409, "este código de invitación ya fue usado");
    if (await gh.exists(memberPath, head)) throw new HttpError(409, "ese identificador ya está en uso, elige otro");

    const headCommit = await gh.json(`/git/commits/${head}`);
    const tree = await gh.json("/git/trees", {
      method: "POST",
      body: JSON.stringify({
        base_tree: headCommit.tree.sha,
        tree: [
          { path: record.imagen, mode: "100644", type: "blob", sha: imgBlob.sha },
          { path: memberPath, mode: "100644", type: "blob", sha: memberBlob.sha },
          { path: invitePath, mode: "100644", type: "blob", sha: inviteBlob.sha },
        ],
      }),
    });
    const commit = await gh.json("/git/commits", {
      method: "POST",
      body: JSON.stringify({
        message: `Alta de miembro: ${record.slug}\n\nNombre: ${record.nombre} · Crew: ${crew} · Rol: ${rol}`,
        tree: tree.sha,
        parents: [head],
      }),
    });
    const upd = await gh.call(`/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    if (upd.ok) return record;
    if (upd.status !== 422) throw new HttpError(502, `GitHub ${upd.status} al actualizar la rama`);
  }
  throw new HttpError(503, "hay muchos registros a la vez, intenta de nuevo");
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return reply({ error: "método no permitido" }, 405, origin);

    let body;
    try {
      body = await request.json();
    } catch {
      return reply({ error: "solicitud inválida" }, 400, origin);
    }
    try {
      const record = await register(body, env);
      return reply({ ok: true, slug: record.slug }, 201, origin);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) console.error(e);
      // Los errores 5xx no exponen detalles internos al usuario.
      return reply({ error: status >= 500 ? "no se pudo completar el registro, intenta más tarde" : e.message }, status, origin);
    }
  },
};
