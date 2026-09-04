import { afterEach, describe, expect, it, vi } from "vitest";

import { geocodePlace, placeLabel, searchPlaces } from "@/lib/weather/geocoding";

const madrid = {
  name: "Madrid",
  latitude: 40.416775,
  longitude: -3.70379,
  timezone: "Europe/Madrid",
  country: "Spain",
  country_code: "ES",
  admin1: "Madrid"
};

describe("geocoding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a readable label for a place", () => {
    expect(placeLabel(madrid)).toBe("Madrid, Spain");
  });

  it("maps and filters geocoding results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [madrid, { name: "Broken", latitude: null, longitude: null }] })
      })
    );

    const places = await searchPlaces("Madrid");
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ name: "Madrid", latitude: 40.416775, timezone: "Europe/Madrid" });
  });

  it("returns the first place from geocodePlace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [madrid] })
      })
    );

    const place = await geocodePlace("Madrid");
    expect(place?.name).toBe("Madrid");
  });

  it("returns null when no place matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] })
      })
    );

    await expect(geocodePlace("Xyzzy")).resolves.toBeNull();
  });
});
