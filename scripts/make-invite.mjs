// Uso: INVITE_SECRET=... node scripts/make-invite.mjs C3-R2-7F9K
// Imprime un código firmado: datos.firma (firma = HMAC-SHA256 truncada a 8).
import { createHmac } from "node:crypto";

const data = process.argv[2];
const secret = process.env.INVITE_SECRET;
if (!data || !secret) {
  console.error("Uso: INVITE_SECRET=... node scripts/make-invite.mjs <datos>");
  process.exit(1);
}
const sig = createHmac("sha256", secret)
  .update(data)
  .digest("base64url")
  .slice(0, 8);
console.log(`${data}.${sig}`);
