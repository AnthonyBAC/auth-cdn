"use client";

import { Card, List } from "antd";
import Link from "next/link";

type WorkspaceSummary = {
  id: string;
  name: string;
  role: string;
  locationName: string | null;
};

export function WorkspaceList({ workspaces }: { workspaces: WorkspaceSummary[] }) {
  return (
    <List
      grid={{ gutter: 16, xs: 1, sm: 2, md: 3 }}
      dataSource={workspaces}
      locale={{ emptyText: "No workspace access yet." }}
      renderItem={(workspace) => (
        <List.Item>
          <Link href={`/workspaces/${workspace.id}`}>
            <Card hoverable title={workspace.name}>
              <p className="muted">{workspace.role}</p>
              <p>{workspace.locationName ?? "No location configured"}</p>
            </Card>
          </Link>
        </List.Item>
      )}
    />
  );
}
