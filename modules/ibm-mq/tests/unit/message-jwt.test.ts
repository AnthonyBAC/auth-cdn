// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { importPKCS8, SignJWT } from "jose";

import { createMessageAuthentication, MessageSigningConfigurationError, readMessageSigningSettings,
  withMessageSigning } from "../../infrastructure/message-jwt";
import { createRestMq, readRestConfig } from "../../infrastructure/rest";
import { messageKeySettings } from "../message-keys";

const config = readRestConfig({ MQ_REST_BASE_URL: "https://mq.example/ibmmq/rest/v3", MQ_QUEUE_MANAGER: "QM",
  MQ_PRODUCER_USERNAME: "producer", MQ_PRODUCER_PASSWORD: "private", MQ_USERNAME: "consumer", MQ_PASSWORD: "private" });
const settings = messageKeySettings();
const authentication = createMessageAuthentication(config, settings);
const eventId = "11111111-1111-4111-8111-111111111111";
const body = JSON.stringify({ eventId, message: "test" });
const messageId = `ID:${"A".repeat(48)}`;

afterEach(() => vi.useRealTimers());

async function customToken(changes: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: settings.issuer, aud: `urn:auth-cdn:mq:QM:${config.MQ_QUEUE}`, iat: issuedAt,
    exp: issuedAt + 60, jti: eventId, body, context: { qmgr: "QM", queue: config.MQ_QUEUE, correlationId: null, replyTo: null }, ...changes })
    .setProtectedHeader({ alg: "ES256", typ: "authcdn-mq+jwt", kid: settings.keyId, ...header })
    .sign(await importPKCS8(settings.privateKey, "ES256"));
}

describe("JWT message signatures", () => {
  it("authenticates the exact body and keeps the stable business event ID as jti", async () => {
    const token = await authentication.sign(config.MQ_QUEUE, body);
    expect(await authentication.verify(config.MQ_QUEUE, token)).toBe(body);
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(claims.jti).toBe(eventId);
    expect(claims.body).toBe(body);
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it("rejects a changed payload even when the changed JSON is otherwise valid", async () => {
    const parts = (await authentication.sign(config.MQ_QUEUE, body)).split(".");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    claims.body = JSON.stringify({ eventId, message: "tampered" });
    parts[1] = Buffer.from(JSON.stringify(claims)).toString("base64url");
    await expect(authentication.verify(config.MQ_QUEUE, parts.join("."))).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
  });

  it("rejects unsigned JSON and a token with no signature", async () => {
    await expect(authentication.verify(config.MQ_QUEUE, body)).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
    const parts = (await authentication.sign(config.MQ_QUEUE, body)).split(".");
    await expect(authentication.verify(config.MQ_QUEUE, `${parts[0]}.${parts[1]}.`)).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
  });

  it("rejects an alg none token instead of accepting the algorithm from the message", async () => {
    const parts = (await authentication.sign(config.MQ_QUEUE, body)).split(".");
    parts[0] = Buffer.from(JSON.stringify({ alg: "none", typ: "authcdn-mq+jwt", kid: settings.keyId })).toString("base64url");
    await expect(authentication.verify(config.MQ_QUEUE, `${parts[0]}.${parts[1]}.`)).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
  });

  it("rejects a signature made by another key with the same kid", async () => {
    const other = createMessageAuthentication(config, messageKeySettings(settings.keyId));
    await expect(authentication.verify(config.MQ_QUEUE, await other.sign(config.MQ_QUEUE, body))).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
  });

  it("rejects unknown key IDs without retrieving keys from the network", async () => {
    await expect(authentication.verify(config.MQ_QUEUE, await customToken({}, { kid: "unknown", jku: "https://attacker.example/keys" })))
      .rejects.toThrow("UNKNOWN_MESSAGE_SIGNING_KEY");
  });

  it("rejects another issuer and a token with the session JWT type", async () => {
    await expect(authentication.verify(config.MQ_QUEUE, await customToken({ iss: "untrusted" }))).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
    await expect(authentication.verify(config.MQ_QUEUE, await customToken({}, { typ: "JWT" }))).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
  });

  it("rejects use on another queue or queue manager", async () => {
    const token = await authentication.sign(config.MQ_QUEUE, body);
    await expect(authentication.verify(config.MQ_SUMMARY_REQUEST_QUEUE, token)).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
    const otherManager = createMessageAuthentication({ ...config, MQ_QUEUE_MANAGER: "OTHER" }, settings);
    await expect(otherManager.verify(config.MQ_QUEUE, token)).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
    await expect(authentication.sign("OTHER.Q", body)).rejects.toThrow("INVALID_MESSAGE_DESTINATION");
  });

  it("binds reply routing and correlation metadata to the signature", async () => {
    const request = await authentication.sign(config.MQ_SUMMARY_REQUEST_QUEUE, body, { replyTo: config.MQ_SUMMARY_REPLY_QUEUE });
    expect(await authentication.verify(config.MQ_SUMMARY_REQUEST_QUEUE, request, { replyTo: `${config.MQ_SUMMARY_REPLY_QUEUE}@QM` })).toBe(body);
    await expect(authentication.verify(config.MQ_SUMMARY_REQUEST_QUEUE, request, { replyTo: "OTHER.Q" })).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
    const reply = await authentication.sign(config.MQ_SUMMARY_REPLY_QUEUE, body, { correlationId: messageId });
    expect(await authentication.verify(config.MQ_SUMMARY_REPLY_QUEUE, reply, { correlationId: messageId.toLowerCase() })).toBe(body);
    await expect(authentication.verify(config.MQ_SUMMARY_REPLY_QUEUE, reply, { correlationId: `ID:${"B".repeat(48)}` })).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
  });

  it("normalizes empty IBM metadata without weakening signed destinations", async () => {
    const token = await authentication.sign(config.MQ_QUEUE, body);
    expect(await authentication.verify(config.MQ_QUEUE, token, { correlationId: `ID:${"0".repeat(48)}`, replyTo: "@QM" })).toBe(body);
  });

  it("enforces expiration while preserving the business deadline on the token", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    const token = await authentication.sign(config.MQ_QUEUE, body, { expiresAt: "2026-10-21T12:00:10Z" });
    vi.setSystemTime(new Date("2026-10-21T12:00:16Z"));
    await expect(authentication.verify(config.MQ_QUEUE, token)).rejects.toThrow("MESSAGE_TOKEN_EXPIRED");
    await expect(authentication.sign(config.MQ_QUEUE, body, { expiresAt: "2026-10-21T12:00:10Z" })).rejects.toThrow("MESSAGE_TOKEN_EXPIRED");
  });

  it("rejects future issuance, invalid validity intervals and inconsistent logical identifiers", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(authentication.verify(config.MQ_QUEUE, await customToken({ iat: now + 60, exp: now + 120 }))).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
    await expect(authentication.verify(config.MQ_QUEUE, await customToken({ iat: now + 60, exp: now + 30 }))).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
    await expect(authentication.verify(config.MQ_QUEUE, await customToken({ jti: "22222222-2222-4222-8222-222222222222" }))).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
    await expect(authentication.verify(config.MQ_QUEUE, await customToken({ exp: undefined }))).rejects.toThrow("INVALID_MESSAGE_SIGNATURE");
  });

  it("keeps old verification keys during rotation and rejects retired keys", async () => {
    const next = messageKeySettings("next-key");
    const oldToken = await authentication.sign(config.MQ_QUEUE, body);
    const rotated = createMessageAuthentication(config, { ...next, publicKeys: { ...settings.publicKeys, ...next.publicKeys } });
    expect(await rotated.verify(config.MQ_QUEUE, oldToken)).toBe(body);
    expect(await rotated.verify(config.MQ_QUEUE, await rotated.sign(config.MQ_QUEUE, body))).toBe(body);
    await expect(createMessageAuthentication(config, next).verify(config.MQ_QUEUE, oldToken)).rejects.toThrow("UNKNOWN_MESSAGE_SIGNING_KEY");
  });

  it("fails closed for absent settings or a mismatched key pair without exposing secrets", () => {
    expect(() => readMessageSigningSettings({})).toThrow(MessageSigningConfigurationError);
    const other = messageKeySettings(settings.keyId);
    expect(() => createMessageAuthentication(config, { ...settings, publicKeys: other.publicKeys })).toThrow("MQ_MESSAGE_SIGNING_NOT_CONFIGURED");
    expect(() => readMessageSigningSettings({ MQ_MESSAGE_JWT_KEY_ID: "test-key", MQ_MESSAGE_JWT_PRIVATE_KEY: "do-not-leak",
      MQ_MESSAGE_JWT_PUBLIC_KEYS: "invalid-json" })).toThrow("MQ_MESSAGE_SIGNING_NOT_CONFIGURED");
  });

  it("parses explicit public key trust and escaped PEM newlines", () => {
    const parsed = readMessageSigningSettings({ MQ_MESSAGE_JWT_ISSUER: settings.issuer, MQ_MESSAGE_JWT_KEY_ID: settings.keyId,
      MQ_MESSAGE_JWT_PRIVATE_KEY: settings.privateKey.replace(/\n/g, "\\n"), MQ_MESSAGE_JWT_PUBLIC_KEYS: JSON.stringify(settings.publicKeys) });
    expect(parsed.privateKey).toBe(settings.privateKey);
    expect(parsed.publicKeys).toEqual(settings.publicKeys);
  });

  it("signs the wire body while preserving REST authentication, expiry and selectors", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 201, headers: { "ibm-mq-md-messageId": messageId } }));
    const signed = withMessageSigning(createRestMq(config, "producer", fetcher), authentication);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    expect(await signed.send(config.MQ_QUEUE, body, { expiresAt })).toBe(messageId);
    const init = fetcher.mock.calls[0][1];
    expect(init.body).not.toBe(body);
    expect(await authentication.verify(config.MQ_QUEUE, init.body)).toBe(body);
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(init.headers["ibm-mq-md-persistence"]).toBe("persistent");
    expect(Number(init.headers["ibm-mq-md-expiry"])).toBeGreaterThan(0);
  });
});
