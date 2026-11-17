const localMetricsUrl = "http://127.0.0.1:9102/metrics";

export function getActivityMetricsConfig() {
  const onVercel = process.env.VERCEL === "1";
  if (process.env.KAFKA_ENABLED !== "true") {
    return {
      enabled: false,
      message: onVercel
        ? "Kafka está desactivado en este preview. Para ver métricas aquí se necesita un broker y un consumidor accesibles desde Vercel."
        : "Kafka está desactivado. Habilita KAFKA_ENABLED para consultar las métricas."
    } as const;
  }

  const endpoint = process.env.KAFKA_METRICS_URL?.trim();
  const url = URL.parse(endpoint || localMetricsUrl);
  const loopback = url && /^(?:localhost\.?$|127\.|\[::1\]$)/i.test(url.hostname);
  if (!url || !["http:", "https:"].includes(url.protocol) || (onVercel && (!endpoint || loopback))) {
    return { enabled: false, message: "Configura KAFKA_METRICS_URL con una dirección del consumidor accesible desde este despliegue." } as const;
  }

  const token = process.env.KAFKA_METRICS_TOKEN;
  if (!token || token.length < 32) {
    return { enabled: false, message: "Falta configurar el token privado que comparten la aplicación y el consumidor de Kafka." } as const;
  }

  return { enabled: true, url, token } as const;
}