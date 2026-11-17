import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.length !== 3) throw new Error("Indica una carpeta privada fuera del repositorio.");
const directory = path.resolve(process.argv[2]);
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const relative = path.relative(repository, directory);
if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
  throw new Error("La carpeta de claves debe estar fuera del repositorio.");
}
const privateFile = path.join(directory, "mq-private.pem");
const publicFile = path.join(directory, "mq-public.pem");
const environmentFile = path.join(directory, "mq-message-signing.env");
if ([privateFile, publicFile, environmentFile].some((filename) => existsSync(filename))) {
  throw new Error("Ya existen claves o configuración en esa carpeta; no se sobrescriben.");
}
const keyId = `mq-${new Date().toISOString().replace(/[^0-9]/g, "")}`;
const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const environment = ["MQ_MESSAGE_JWT_ISSUER=urn:auth-cdn:mq", `MQ_MESSAGE_JWT_KEY_ID=${keyId}`,
  `MQ_MESSAGE_JWT_PRIVATE_KEY=${JSON.stringify(pair.privateKey)}`,
  `MQ_MESSAGE_JWT_PUBLIC_KEYS=${JSON.stringify({ [keyId]: pair.publicKey })}`, ""].join("\n");
mkdirSync(directory, { recursive: true, mode: 0o700 });
writeFileSync(privateFile, pair.privateKey, { flag: "wx", mode: 0o600 });
writeFileSync(publicFile, pair.publicKey, { flag: "wx", mode: 0o600 });
writeFileSync(environmentFile, environment, { flag: "wx", mode: 0o600 });
console.log(`Configuración creada en ${environmentFile}. Las claves no se imprimen.`);
