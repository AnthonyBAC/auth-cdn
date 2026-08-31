"use client";

import { CloudOutlined, ClockCircleOutlined } from "@ant-design/icons";
import { Alert, Card, Descriptions } from "antd";

import type { WeatherContext } from "@/lib/weather/context";

export function ContextPanel({ context }: { context: WeatherContext }) {
  if (context.status === "unavailable") {
    return <Alert showIcon type="warning" message={context.message} />;
  }

  return (
    <Card>
      <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }}>
        <Descriptions.Item label="Location">{context.locationName}</Descriptions.Item>
        <Descriptions.Item label={<><ClockCircleOutlined /> Local time</>}>{context.localTime}</Descriptions.Item>
        <Descriptions.Item label={<><CloudOutlined /> Weather</>}>{context.summary}</Descriptions.Item>
        <Descriptions.Item label="Temp">{Math.round(context.temperatureC)} C</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
