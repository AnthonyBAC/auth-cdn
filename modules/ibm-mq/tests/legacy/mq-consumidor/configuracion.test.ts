// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readConsumerConfig } from "../../../legacy/mq-consumidor/configuracion";

const base = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  MQ_QUEUE_MANAGER: "QM1",
  MQ_QUEUE: "AVISOS",
  MQ_CHANNEL: "APP.TLS",
  MQ_CONNECTION_NAME: "localhost(1414)",
  MQ_USERNAME: "consumer",
  MQ_PASSWORD: "secreto",
  MQ_TLS_CIPHER_SPEC: "TLS_AES_256_GCM_SHA384",
  MQ_TLS_PEER_NAME: "CN=broker",
  MQ_TLS_KEY_REPOSITORY: "/certs/key",
  MQ_BACKOUT_QUEUE: "AUTHCDN.REMINDERS.BOQ",
  MQ_BACKOUT_THRESHOLD: "5",
};

describe("Configuración del consumidor", () => {
  it("reutiliza las variables de conexión y aplica valores por defecto", () => {
    const config = readConsumerConfig(base);
    expect(config.MQ_QUEUE_MANAGER).toBe("QM1");
    expect(config.MQ_QUEUE).toBe("AVISOS");
    expect(config.MQ_CONSUMER_WAIT_MS).toBe(5000);
    expect(config.MQ_CONSUMER_INTERVAL_MS).toBe(5000);
    expect(config.MQ_BACKOUT_QUEUE).toBe("AUTHCDN.REMINDERS.BOQ");
    expect(config.MQ_BACKOUT_THRESHOLD).toBe(5);
  });

  it("convierte los tiempos numéricos indicados como texto", () => {
    const config = readConsumerConfig({ ...base, MQ_CONSUMER_WAIT_MS: "15000", MQ_CONSUMER_INTERVAL_MS: "2000" });
    expect(config.MQ_CONSUMER_WAIT_MS).toBe(15000);
    expect(config.MQ_CONSUMER_INTERVAL_MS).toBe(2000);
  });

  it("exige las variables de conexión", () => {
    expect(() => readConsumerConfig({ ...base, MQ_PASSWORD: "" })).toThrow(/configuración del consumidor/);
    expect(() => readConsumerConfig({ ...base, NEXT_PUBLIC_SUPABASE_URL: "" })).toThrow(/configuración del consumidor/);
    expect(() => readConsumerConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: "" })).toThrow(/configuración del consumidor/);
  });

  it("rechaza una identidad TLS con comodín", () => {
    expect(() => readConsumerConfig({ ...base, MQ_TLS_PEER_NAME: "CN=*" })).toThrow(/configuración del consumidor/);
  });

  it("acepta ANY_TLS12_OR_HIGHER y rechaza un CipherSpec no acordado", () => {
    const config = readConsumerConfig({ ...base, MQ_TLS_CIPHER_SPEC: "ANY_TLS12_OR_HIGHER" });
    expect(config.MQ_TLS_CIPHER_SPEC).toBe("ANY_TLS12_OR_HIGHER");

    expect(() => readConsumerConfig({ ...base, MQ_TLS_CIPHER_SPEC: "TLS_RSA_WITH_AES_256_CBC_SHA256" })).toThrow(/configuración del consumidor/);
  });

  it("exige un umbral de backout positivo", () => {
    expect(() => readConsumerConfig({ ...base, MQ_BACKOUT_THRESHOLD: "0" })).toThrow(/configuración del consumidor/);
    expect(() => readConsumerConfig({ ...base, MQ_BACKOUT_THRESHOLD: "-3" })).toThrow(/configuración del consumidor/);
  });

  it("exige una cola de backout distinta de la cola principal", () => {
    expect(() => readConsumerConfig({ ...base, MQ_BACKOUT_QUEUE: base.MQ_QUEUE })).toThrow(/configuración del consumidor/);
  });
});
