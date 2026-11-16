# Actividad del tablero con Apache Kafka

El tablero publica `CARD_MOVED` cuando Supabase confirma una solicitud de movimiento. El mismo comando permite reposicionar una tarjeta dentro de su lista. El consumidor valida el evento y la clave, y actualiza las métricas de actividad del tablero. También registra los eventos procesados junto con la partición y el offset.

## Inicio local

1. Configura Supabase y arranca la aplicación con Node 22 y pnpm, según el [README principal](../../README.md#local-setup).
2. En `.env.local`, agrega las variables del productor y reinicia Next.js si estaba en ejecución.

   ```dotenv
   KAFKA_ENABLED=true
   KAFKA_BROKERS=127.0.0.1:9092
   ```

3. Desde la raíz del repositorio, ejecuta:

   ```sh
   docker compose -f compose.kafka.yml up -d --build
   docker compose -f compose.kafka.yml logs -f kafka-consumer
   ```

4. En el tablero, mueve una tarjeta a otra lista con un usuario `owner` o `editor`. Abre [las métricas locales](http://127.0.0.1:9102/metrics) y revisa cómo cambian los contadores del tablero y de la lista destino.
5. Para comprobar la recuperación, detén solo el consumidor con `docker compose -f compose.kafka.yml stop kafka-consumer`, mueve otra tarjeta y vuelve a iniciarlo con `docker compose -f compose.kafka.yml start kafka-consumer`. El mismo grupo reanuda el consumo según su offset confirmado.

El servicio `kafka-init` crea el topic `auth-cdn.card-events.v1` con una partición y una réplica. Sale con código 0 al completar su trabajo. `kafka` y `kafka-consumer` quedan en ejecución. El broker publica el puerto 9092 solo en el equipo local. El volumen del broker conserva los registros y offsets al ejecutar `docker compose -f compose.kafka.yml down`.

## Métricas en tiempo real

`GET http://127.0.0.1:9102/metrics` devuelve el total de movimientos y el total del último minuto, tanto globales como por tablero. Cada tablero muestra además el acumulado por lista destino. La ventana de 60 segundos usa la hora del evento y se calcula al consultar, así que disminuye aunque no lleguen movimientos nuevos.

Para observar la actualización continua en PowerShell mientras mueves tarjetas:

```powershell
while ($true) {
  Invoke-RestMethod http://127.0.0.1:9102/metrics | ConvertTo-Json -Depth 5
  Start-Sleep -Seconds 2
}
```

El consumidor mantiene los totales y los offsets procesados en el volumen `kafka-metrics`. El grupo `auth-cdn-board-metrics-v1` toma el historial disponible en el topic durante su primera ejecución. Al reiniciar, restaura el acumulado y descarta offsets ya contabilizados.

## Contrato y entrega

La clave del mensaje es `cardId`. El valor JSON incluye `eventId`, `schemaVersion`, `type`, `occurredAt`, `cardId`, `boardId` y `destinationListId`. El consumidor procesa los eventos en orden de partición y guarda las métricas antes de que Kafka confirme el offset.

La publicación está desactivada por defecto. Con Kafka habilitado, la ruta espera hasta dos segundos por el envío. Si el envío falla o supera ese plazo, registra `KAFKA_CARD_PUBLISH_FAILED` y devuelve el resultado del movimiento ya guardado. Un fallo entre Supabase y Kafka puede dejar un movimiento sin evento. Los recordatorios y el resumen mantienen su transporte IBM MQ.
