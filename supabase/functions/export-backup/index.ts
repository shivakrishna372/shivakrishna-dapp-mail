// DAPP Mail — admin-only backup. Returns all mail data as one JSON file.
// Attachment files themselves are not included (only their names and sizes).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const TABLES: Record<string, string> = {
  profiles: "id,email,username,display_name,signature,is_admin,created_at",
  threads: "*",
  messages: "*",
  message_recipients: "*",
  mailbox: "*",
  labels: "*",
  mailbox_labels: "*",
  attachments: "*",
  user_security: "user_id,recovery_email,recovery_email_verified,first_login_completed,updated_at",
};

async function readAll(table: string, columns: string) {
  const rows: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Please sign in again" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: authData } = await userClient.auth.getUser();
    const me = authData?.user;
    if (!me) return json({ error: "Please sign in again" }, 401);
    const { data: myProfile } = await admin.from("profiles").select("is_admin").eq("id", me.id).maybeSingle();
    if (!myProfile?.is_admin) return json({ error: "Admins only" }, 403);

    const backup: Record<string, unknown> = {
      app: "DAPP Mail",
      version: 1,
      created_at: new Date().toISOString(),
      created_by: me.email,
      note: "Mail data backup. Attachment files are not included; only their names and sizes.",
    };
    for (const [table, columns] of Object.entries(TABLES)) backup[table] = await readAll(table, columns);

    console.log(`backup exported by ${me.email}`);
    return json(backup);
  } catch (e) {
    console.error("export-backup error:", e instanceof Error ? e.message : e);
    return json({ error: "Backup failed. Please try again." }, 500);
  }
});
