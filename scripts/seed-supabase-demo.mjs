import { createClient } from "@supabase/supabase-js";

// Load credentials from the project .env when present (Next.js does not load
// .env for plain Node scripts).
try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional: variables may come from the environment.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const supabase = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const password = process.env.SEED_PASSWORD;
const ownerEmail = process.env.SEED_OWNER_EMAIL;
const editorEmail = process.env.SEED_EDITOR_EMAIL;
const viewerEmail = process.env.SEED_VIEWER_EMAIL;

if (!password || !ownerEmail || !editorEmail || !viewerEmail) {
  throw new Error("SEED_PASSWORD, SEED_OWNER_EMAIL, SEED_EDITOR_EMAIL, and SEED_VIEWER_EMAIL are required.");
}

const users = [
  { email: ownerEmail, name: "Demo Owner", role: "owner" },
  { email: editorEmail, name: "Demo Editor", role: "editor" },
  { email: viewerEmail, name: "Demo Viewer", role: "viewer" }
];

async function findUserByEmail(email) {
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 100) return null;
    page += 1;
  }
}

async function ensureUser({ email, name }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    await supabase.auth.admin.updateUserById(existing.id, {
      email_confirm: true,
      password,
      user_metadata: { name }
    });
    return existing;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name }
  });
  if (error) throw error;
  return data.user;
}

async function upsertProfile(user, name) {
  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email.toLowerCase(),
    name,
    totp_enabled: false,
    totp_recovery_code_hash: null
  });
  if (error) throw error;
}

async function ensureDemoWorkspace(ownerId) {
  const { data: existing, error: lookupError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("name", "Demo Workspace")
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("workspaces")
    .insert({
      name: "Demo Workspace",
      location_name: "Santiago, Chile",
      latitude: -33.4489,
      longitude: -70.6693,
      timezone: "America/Santiago"
    })
    .select("id")
    .single();
  if (error) throw error;

  await supabase
    .from("memberships")
    .upsert(
      {
        workspace_id: data.id,
        user_id: ownerId,
        role: "owner",
        status: "active"
      },
      { onConflict: "workspace_id,user_id" }
    );
  return data.id;
}

async function seedBoard(workspaceId) {
  const { data: existing, error: lookupError } = await supabase
    .from("boards")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("title", "MVP Roadmap")
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return;

  const { data: board, error: boardError } = await supabase
    .from("boards")
    .insert({ workspace_id: workspaceId, title: "MVP Roadmap", position: 0 })
    .select("id")
    .single();
  if (boardError) throw boardError;

  const listTitles = ["Todo", "Doing", "Done"];
  for (const [position, title] of listTitles.entries()) {
    const { data: list, error: listError } = await supabase
      .from("lists")
      .insert({ board_id: board.id, title, position })
      .select("id")
      .single();
    if (listError) throw listError;

    if (title === "Todo") {
      const { error: cardError } = await supabase.from("cards").insert([
        {
          board_id: board.id,
          list_id: list.id,
          title: "Create first production board",
          description: "Owner and editor can modify this card; viewer cannot.",
          position: 0
        },
        {
          board_id: board.id,
          list_id: list.id,
          title: "Verify Supabase RLS",
          description: "Use the diagnostics page and role accounts.",
          position: 1
        }
      ]);
      if (cardError) throw cardError;
    }
  }
}

const createdUsers = [];
for (const user of users) {
  const authUser = await ensureUser(user);
  await upsertProfile(authUser, user.name);
  createdUsers.push({ ...user, id: authUser.id });
}

const workspaceId = await ensureDemoWorkspace(createdUsers[0].id);
for (const user of createdUsers) {
  const { error } = await supabase
    .from("memberships")
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: user.id,
        role: user.role,
        status: "active"
      },
      { onConflict: "workspace_id,user_id" }
    );
  if (error) throw error;
}

await seedBoard(workspaceId);

console.log(
  JSON.stringify(
    {
      workspace: "Demo Workspace",
      workspaceId,
      password,
      users: createdUsers.map(({ email, role }) => ({ email, role }))
    },
    null,
    2
  )
);
