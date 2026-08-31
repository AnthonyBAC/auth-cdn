"use client";

import { LoginOutlined, UserAddOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const supabase = createSupabaseBrowserClient();

  async function onSubmit(values: { email: string; password: string; name?: string }) {
    setError(null);
    setPending(true);
    const redirectTo = searchParams.get("redirectTo") ?? "/workspaces";

    const result =
      mode === "register"
        ? await supabase.auth.signUp({
            email: values.email,
            password: values.password,
            options: { data: { name: values.name ?? "" }, emailRedirectTo: `${location.origin}/workspaces` }
          })
        : await supabase.auth.signInWithPassword({ email: values.email, password: values.password });

    setPending(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    router.replace(redirectTo);
    router.refresh();
  }

  return (
    <Card className="auth-card">
      <Typography.Title level={1}>{mode === "register" ? "Create account" : "Sign in"}</Typography.Title>
      <Form layout="vertical" onFinish={onSubmit} requiredMark={false}>
      {mode === "register" ? (
        <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter your name." }]}>
          <Input autoComplete="name" />
        </Form.Item>
      ) : null}
        <Form.Item name="email" label="Email" rules={[{ required: true, type: "email", message: "Enter a valid email." }]}>
          <Input autoComplete="email" />
        </Form.Item>
        <Form.Item name="password" label="Password" rules={[{ required: true, min: 8, message: "Use at least 8 characters." }]}>
          <Input.Password autoComplete={mode === "register" ? "new-password" : "current-password"} />
        </Form.Item>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <Button block htmlType="submit" icon={mode === "register" ? <UserAddOutlined /> : <LoginOutlined />} loading={pending} type="primary">
          {mode === "register" ? "Create account" : "Sign in"}
        </Button>
      </Form>
    </Card>
  );
}
