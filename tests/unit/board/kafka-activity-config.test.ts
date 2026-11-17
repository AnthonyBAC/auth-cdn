import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getActivityMetricsConfig } from "@/modules/kafka/activity-config";

describe("Kafka metrics configuration", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("KAFKA_ENABLED", "true");
    vi.stubEnv("KAFKA_METRICS_TOKEN", "a".repeat(32));
    vi.stubEnv("KAFKA_METRICS_URL", undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("uses the Docker consumer on the local machine", () => {
    const config = getActivityMetricsConfig();
    expect(config.enabled && config.url.href).toBe("http://127.0.0.1:9102/metrics");
  });

  it.each([undefined, "http://127.0.0.1:9102/metrics", "http://localhost:9102/metrics", "http://[::1]:9102/metrics"])(
    "rejects a missing or loopback consumer in Vercel (%s)",
    (endpoint) => {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("KAFKA_METRICS_URL", endpoint);
      expect(getActivityMetricsConfig()).toMatchObject({
        enabled: false, message: expect.stringContaining("KAFKA_METRICS_URL")
      });
    }
  );

  it("allows a configured HTTPS consumer in Vercel when a token is present", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("KAFKA_METRICS_URL", "https://metrics.example.net/metrics");
    expect(getActivityMetricsConfig().enabled).toBe(true);
    vi.stubEnv("KAFKA_METRICS_TOKEN", undefined);
    expect(getActivityMetricsConfig().enabled).toBe(false);
  });
});