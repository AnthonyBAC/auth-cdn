import { generateKeyPairSync } from "node:crypto";

import { createMessageAuthentication } from "../infrastructure/message-jwt";
import type { RestConfig } from "../infrastructure/rest";

export function messageKeySettings(keyId = "test-key") {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  return { issuer: "urn:auth-cdn:mq:test", keyId, privateKey: pair.privateKey, publicKeys: { [keyId]: pair.publicKey } };
}

export function testMessageAuthentication(config: RestConfig) {
  return createMessageAuthentication(config, messageKeySettings());
}
