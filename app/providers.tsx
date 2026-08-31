"use client";

import { ConfigProvider } from "antd";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#151b31",
          colorError: "#ff5858",
          colorText: "#151b31",
          colorTextSecondary: "#6d6f75",
          colorBgLayout: "#f2f2f2",
          colorBgContainer: "#ffffff",
          borderRadius: 8,
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
        }
      }}
    >
      {children}
    </ConfigProvider>
  );
}
