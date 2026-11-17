import { createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { errors, importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import type { MqTransport, RestConfig, SendOptions } from "./rest";

const algorithm = "ES256";
const tokenType = "authcdn-mq+jwt";
const keyIdSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
const settingsSchema = z.object({
  MQ_MESSAGE_JWT_ISSUER: z.string().min(1).max(200).default("urn:auth-cdn:mq"),
  MQ_MESSAGE_JWT_KEY_ID: keyIdSchema,
  MQ_MESSAGE_JWT_PRIVATE_KEY: z.string().min(1),
  MQ_MESSAGE_JWT_PUBLIC_KEYS: z.string().min(1)
});
const publicKeysSchema = z.record(keyIdSchema, z.string().min(1)).refine((keys) => Object.keys(keys).length > 0);
const claimsSchema = z.object({
  iss: z.string(), aud: z.string(), iat: z.number().int(), exp: z.number().int(), jti: z.string().uuid(),
  body: z.string().max(500_000),
  context: z.object({ qmgr: z.string(), queue: z.string(), correlationId: z.string().nullable(), replyTo: z.string().nullable() }).strict()
}).strict();

export type MessageMetadata = { correlationId?: string | null; replyTo?: string | null };
export interface MessageAuthentication {
  sign(queue: string, body: string, options?: SendOptions): Promise<string>;
  verify(queue: string, token: string, metadata?: MessageMetadata): Promise<string>;
}

export class MessageAuthenticationError extends Error {
  constructor(readonly code = "INVALID_MESSAGE_SIGNATURE") { super(code); }
}

export class MessageSigningConfigurationError extends Error {
  constructor() { super("MQ_MESSAGE_SIGNING_NOT_CONFIGURED"); }
}

export function readMessageSigningSettings(env: Record<string, string | undefined> = process.env) {
  try {
    const parsed = settingsSchema.parse(env);
    const publicKeys = publicKeysSchema.parse(JSON.parse(parsed.MQ_MESSAGE_JWT_PUBLIC_KEYS));
    if (!Object.hasOwn(publicKeys, parsed.MQ_MESSAGE_JWT_KEY_ID)) throw new Error();
    return { issuer: parsed.MQ_MESSAGE_JWT_ISSUER, keyId: parsed.MQ_MESSAGE_JWT_KEY_ID,
      privateKey: parsed.MQ_MESSAGE_JWT_PRIVATE_KEY.replace(/\\n/g, "\n"), publicKeys };
  } catch { throw new MessageSigningConfigurationError(); }
}

function logicalId(body: string) {
  try {
    const parsed = JSON.parse(body);
    return z.string().uuid().parse(parsed.eventId ?? parsed.requestId ?? parsed.inboxId);
  } catch { return null; }
}

export function createMessageAuthentication(config: RestConfig, settings = readMessageSigningSettings()): MessageAuthentication {
  try {
    const secret = createPrivateKey(settings.privateKey);
    const publicKey = createPublicKey(settings.publicKeys[settings.keyId].replace(/\\n/g, "\n"));
    if (secret.asymmetricKeyType !== "ec" || secret.asymmetricKeyDetails?.namedCurve !== "prime256v1"
      || !createPublicKey(secret).export({ type: "spki", format: "der" }).equals(publicKey.export({ type: "spki", format: "der" }))) {
      throw new Error();
    }
  } catch { throw new MessageSigningConfigurationError(); }
  const allowed = new Set([config.MQ_QUEUE, config.MQ_SUMMARY_REQUEST_QUEUE, config.MQ_SUMMARY_REPLY_QUEUE, config.MQ_BACKOUT_QUEUE]);
  let privateKey: ReturnType<typeof importPKCS8> | undefined;
  const publicKeys = new Map<string, ReturnType<typeof importSPKI>>();
  function audience(queue: string) {
    if (!allowed.has(queue)) throw new MessageAuthenticationError("INVALID_MESSAGE_DESTINATION");
    return `urn:auth-cdn:mq:${config.MQ_QUEUE_MANAGER}:${queue}`;
  }
  function context(queue: string, metadata: MessageMetadata) {
    const correlation = metadata.correlationId?.trim();
    const correlationId = !correlation || /^ID:0{48}$/i.test(correlation) ? null : correlation.toUpperCase();
    const replyTo = metadata.replyTo?.trim().replace(new RegExp(`@${config.MQ_QUEUE_MANAGER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "") || null;
    return { qmgr: config.MQ_QUEUE_MANAGER, queue, correlationId, replyTo };
  }
  async function signingKey() {
    privateKey ??= importPKCS8(settings.privateKey, algorithm);
    try { return await privateKey; } catch { throw new MessageSigningConfigurationError(); }
  }
  async function verificationKey(keyId: string) {
    if (!Object.hasOwn(settings.publicKeys, keyId)) throw new MessageAuthenticationError("UNKNOWN_MESSAGE_SIGNING_KEY");
    if (!publicKeys.has(keyId)) publicKeys.set(keyId, importSPKI(settings.publicKeys[keyId].replace(/\\n/g, "\n"), algorithm));
    try { return await publicKeys.get(keyId)!; } catch { throw new MessageSigningConfigurationError(); }
  }
  return {
    async sign(queue, body, options = {}) {
      if (body.length > 500_000) throw new MessageAuthenticationError("MESSAGE_TOO_LARGE");
      const target = audience(queue);
      const issuedAt = Math.floor(Date.now() / 1000);
      const expiration = options.expiresAt ? Math.ceil(Date.parse(options.expiresAt) / 1000) : issuedAt + 86400;
      if (!Number.isFinite(expiration) || expiration <= issuedAt) throw new MessageAuthenticationError("MESSAGE_TOKEN_EXPIRED");
      const key = await signingKey();
      const token = await new SignJWT({ body, context: context(queue, options) })
        .setProtectedHeader({ alg: algorithm, typ: tokenType, kid: settings.keyId })
        .setIssuer(settings.issuer).setAudience(target).setIssuedAt(issuedAt).setExpirationTime(expiration)
        .setJti(logicalId(body) ?? randomUUID()).sign(key);
      await jwtVerify(token, await verificationKey(settings.keyId), { algorithms: [algorithm], issuer: settings.issuer,
        audience: target, typ: tokenType });
      return token;
    },
    async verify(queue, token, metadata = {}) {
      const target = audience(queue);
      if (token.length > 1_000_000) throw new MessageAuthenticationError("MESSAGE_TOO_LARGE");
      try {
        const { payload } = await jwtVerify(token, async (header) => {
          if (header.alg !== algorithm || header.typ !== tokenType || !keyIdSchema.safeParse(header.kid).success) {
            throw new MessageAuthenticationError();
          }
          return verificationKey(header.kid!);
        }, { algorithms: [algorithm], issuer: settings.issuer, audience: target, typ: tokenType,
          requiredClaims: ["iss", "aud", "iat", "exp", "jti"], clockTolerance: 5 });
        const claims = claimsSchema.parse(payload);
        if (claims.exp <= claims.iat || claims.iat > Math.floor(Date.now() / 1000) + 5
          || JSON.stringify(claims.context) !== JSON.stringify(context(queue, metadata))
          || (logicalId(claims.body) !== null && logicalId(claims.body) !== claims.jti)) {
          throw new MessageAuthenticationError();
        }
        return claims.body;
      } catch (error) {
        if (error instanceof MessageSigningConfigurationError) throw error;
        if (error instanceof MessageAuthenticationError) throw error;
        if (error instanceof errors.JWTExpired) throw new MessageAuthenticationError("MESSAGE_TOKEN_EXPIRED");
        throw new MessageAuthenticationError();
      }
    }
  };
}

export function withMessageSigning(transport: MqTransport, authentication: MessageAuthentication): MqTransport {
  return { ...transport, async send(queue, body, options) {
    return transport.send(queue, await authentication.sign(queue, body, options), options);
  } };
}
