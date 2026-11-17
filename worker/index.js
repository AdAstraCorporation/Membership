// Relay de registro (Cloudflare Worker, plan gratuito).
// Variables/secretos: INVITE_SECRET, GH_TOKEN, GH_REPO ("owner/repo"), ALLOWED_ORIGIN.
// Recibe POST JSON: { code, member: {...}, photo_url }.

const CORS = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
});

const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS(origin) },
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

// Comparación en tiempo constante para no filtrar la firma por tiempos.
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS(origin) });
    if (request.method !== "POST") return json({ error: "método no permitido" }, 405, origin);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "JSON inválido" }, 400, origin);
    }

    const code = typeof body.code === "string" ? body.code : "";
    const dot = code.lastIndexOf(".");
    if (dot < 1) return json({ error: "código inválido" }, 403, origin);

    const data = code.slice(0, dot);
    const sig = code.slice(dot + 1);
    if (!safeEqual(await sign(data, env.INVITE_SECRET), sig)) {
      return json({ error: "código inválido" }, 403, origin);
    }

    const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ad-astra-relay",
      },
      body: JSON.stringify({
        event_type: "register",
        client_payload: { member: body.member, photo_url: body.photo_url, invite: data },
      }),
    });

    if (!res.ok) return json({ error: "no se pudo registrar, intenta más tarde" }, 502, origin);
    return json({ ok: true }, 202, origin);
  },
};
