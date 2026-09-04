import type { ContextProvider } from "@/lib/weather/context";

const weatherCodes: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Cloudy",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  61: "Rain",
  71: "Snow",
  80: "Rain showers",
  95: "Thunderstorm"
};

export const openMeteoProvider: ContextProvider = async (location) => {
  const timeoutMs = Number(process.env.OPEN_METEO_TIMEOUT_MS ?? 4500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current: "temperature_2m,weather_code,wind_speed_10m",
      timezone: location.timezone
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: controller.signal,
      next: { revalidate: 300 }
    });

    if (!response.ok) {
      throw new Error("Weather provider failed");
    }

    const payload = (await response.json()) as {
      current?: { time?: string; temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
    };
    const current = payload.current;
    if (!current || typeof current.temperature_2m !== "number") {
      throw new Error("Weather provider returned incomplete data");
    }

    return {
      locationName: location.locationName,
      localTime: current.time ?? new Date().toISOString(),
      temperatureC: current.temperature_2m,
      windKph: current.wind_speed_10m ?? 0,
      summary: weatherCodes[current.weather_code ?? 0] ?? "Current conditions",
      fetchedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeout);
  }
};
