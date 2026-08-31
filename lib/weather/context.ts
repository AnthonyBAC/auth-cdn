export type WorkspaceLocation = {
  locationName: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export type WeatherContext =
  | {
      status: "available";
      locationName: string;
      localTime: string;
      temperatureC: number;
      windKph: number;
      summary: string;
      fetchedAt: string;
    }
  | { status: "unavailable"; message: string };

export type ContextProvider = (location: WorkspaceLocation) => Promise<Omit<Extract<WeatherContext, { status: "available" }>, "status">>;

export async function getWorkspaceContext(location: WorkspaceLocation | null | undefined, provider: ContextProvider): Promise<WeatherContext> {
  if (!location) {
    return { status: "unavailable", message: "Workspace location has not been configured." };
  }

  try {
    return { status: "available", ...(await provider(location)) };
  } catch {
    return { status: "unavailable", message: "Time and weather context is temporarily unavailable." };
  }
}
