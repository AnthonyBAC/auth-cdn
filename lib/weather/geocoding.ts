export type GeocodedPlace = {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  country?: string;
  countryCode?: string;
  admin1?: string;
};

type OpenMeteoResult = {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  country?: string;
  country_code?: string;
  admin1?: string;
};

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

function toPlace(result: OpenMeteoResult): GeocodedPlace {
  return {
    name: result.name,
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone,
    country: result.country,
    countryCode: result.country_code,
    admin1: result.admin1
  };
}

export function placeLabel(place: GeocodedPlace): string {
  const parts = [place.name];
  if (place.admin1 && place.admin1 !== place.name) parts.push(place.admin1);
  if (place.country && place.country !== place.name) parts.push(place.country);
  return parts.join(", ");
}

export async function searchPlaces(query: string): Promise<GeocodedPlace[]> {
  const params = new URLSearchParams({
    name: query,
    count: "10",
    language: "en",
    format: "json"
  });
  const response = await fetch(`${GEOCODING_URL}?${params}`, { next: { revalidate: 86400 } });
  if (!response.ok) throw new Error("Geocoding provider failed");

  const payload = (await response.json()) as { results?: OpenMeteoResult[] };
  return (payload.results ?? [])
    .map(toPlace)
    .filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude) && place.timezone);
}

export async function geocodePlace(query: string): Promise<GeocodedPlace | null> {
  const results = await searchPlaces(query);
  return results[0] ?? null;
}
