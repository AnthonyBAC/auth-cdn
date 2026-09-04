import { describe, expect, it } from "vitest";

import { boardInput, cardInput, locationInput } from "@/lib/validation/domain";

describe("domain validation", () => {
  it("trims board titles", () => {
    expect(boardInput.parse({ title: "  Roadmap  " }).title).toBe("Roadmap");
  });

  it("rejects empty cards", () => {
    expect(() => cardInput.parse({ title: " " })).toThrow();
  });

  it("validates latitude and longitude ranges", () => {
    expect(() =>
      locationInput.parse({ locationName: "Bad", latitude: 91, longitude: 0, timezone: "UTC" })
    ).toThrow();
    expect(locationInput.parse({ locationName: "Paris", latitude: 48.8, longitude: 2.3, timezone: "Europe/Paris" }).timezone).toBe(
      "Europe/Paris"
    );
  });
});
