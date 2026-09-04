"use client";

import { EnvironmentOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, AutoComplete, Button, Card, Form, Input } from "antd";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { placeLabel, type GeocodedPlace } from "@/lib/weather/geocoding";

type LocationValues = {
  locationName: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
};

export function LocationSettings({ workspaceId, initial, canEdit }: { workspaceId: string; initial: Partial<LocationValues>; canEdit: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const places = useRef(new Map<string, GeocodedPlace>());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(query: string) {
    if (query.length < 2) {
      setOptions([]);
      return;
    }
    try {
      const response = await fetch(`/api/geocode?query=${encodeURIComponent(query)}`);
      if (!response.ok) return;
      const body = (await response.json()) as { places: GeocodedPlace[] };
      const next: { value: string; label: string }[] = [];
      const map = new Map<string, GeocodedPlace>();
      for (const place of body.places) {
        const label = placeLabel(place);
        next.push({ value: label, label });
        map.set(label, place);
      }
      places.current = map;
      setOptions(next);
    } catch {
      setOptions([]);
    }
  }

  function onSearch(value: string) {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(value.trim()), 300);
  }

  async function save(values: LocationValues) {
    setPending(true);
    setError(null);
    setMessage(null);
    const selected = places.current.get(values.locationName);
    const payload: LocationValues = {
      locationName: values.locationName,
      ...(selected ? { latitude: selected.latitude, longitude: selected.longitude, timezone: selected.timezone } : {})
    };
    const response = await fetch(`/api/workspaces/${workspaceId}/location`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    setPending(false);
    if (!response.ok) {
      const body = await response.json();
      setError(body.error?.message ?? "Location could not be saved.");
      return;
    }
    setMessage("Location saved.");
    router.refresh();
  }

  return (
    <Card title="Location context">
      <Form
        disabled={!canEdit}
        initialValues={{ locationName: initial.locationName }}
        layout="vertical"
        onFinish={save}
        requiredMark={false}
      >
        <Form.Item name="locationName" label="Location" rules={[{ required: true, message: "Search for a place." }]}>
          <AutoComplete options={options} onSearch={onSearch} filterOption={false} placeholder="Search for a city, region or country">
            <Input prefix={<EnvironmentOutlined />} />
          </AutoComplete>
        </Form.Item>
        {!canEdit ? <Alert showIcon type="info" message="Only owners can update workspace location." /> : null}
        {error ? <Alert showIcon type="error" message={error} /> : null}
        {message ? <Alert showIcon type="success" message={message} /> : null}
        <Button disabled={!canEdit} htmlType="submit" icon={<SaveOutlined />} loading={pending} type="primary">
          Save location
        </Button>
      </Form>
    </Card>
  );
}
