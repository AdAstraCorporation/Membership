// Calcula el hash de la contraseña de una crew para config.json.
//   node tools/clave.mjs C1 "frase larga de la crew"
// Copia el resultado en config.json → crews.C1.clave y haz push.
// Al cambiarla, los QR anteriores de esa crew dejan de servir para invitar.
import { pbkdf2Sync } from "node:crypto";

const [crew, clave] = process.argv.slice(2);
if (!/^C\d{1,2}$/.test(crew ?? "") || !clave) {
  console.error('Uso: node tools/clave.mjs <C#> "<contraseña>"');
  process.exit(1);
}
if (clave.length < 12) console.warn("Aviso: usa al menos 12 caracteres; el hash es público y se puede atacar por fuerza bruta.");
console.log(pbkdf2Sync(clave.normalize("NFC"), `ad-astra:${crew}`, 210000, 16, "sha256").toString("base64url"));
