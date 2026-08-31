"use client";

import { LogoutOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const supabase = createSupabaseBrowserClient();

  async function signOut() {
    setPending(true);
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button icon={<LogoutOutlined />} loading={pending} onClick={signOut}>
      Sign out
    </Button>
  );
}
