// Genera códigos de invitación firmados.
//   INVITE_SECRET=... node scripts/make-invite.mjs C3 R2        -> 1 código
//   INVITE_SECRET=... node scripts/make-invite.mjs C3 R2 5      -> 5 códigos
// Formato: C<n>-R<n>-<aleatorio>.<firma>. Cada código sirve una sola vez.
import { createHmac, randomBytes } from "node:crypto";

const [crew, rol, n = "1"] = process.argv.slice(2);
const secret = process.env.INVITE_SECRET;
if (!/^C\d{1,2}$/.test(crew ?? "") || !/^R\d{1,2}$/.test(rol ?? "") || !secret) {
  console.error("Uso: INVITE_SECRET=... node scripts/make-invite.mjs <C#> <R#> [cantidad]");
  process.exit(1);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I
for (let i = 0; i < Number(n); i++) {
  const rand = [...randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  const data = `${crew}-${rol}-${rand}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url").slice(0, 8);
  console.log(`${data}.${sig}`);
}
