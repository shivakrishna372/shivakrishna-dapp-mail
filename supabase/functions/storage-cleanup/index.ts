// DAPP Mail — nightly cleanup. Called only by the database cron job (shared secret).
// Deletes mails nobody has any more, then removes attachment files no mail uses.
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { data: cfg, error: cfgError } = await admin.rpc("get_push_config");
    if (cfgError || !cfg?.hook_secret) throw new Error("config unavailable");
    if (!sameSecret(req.headers.get("x-hook-secret") || "", cfg.hook_secret)) return json({ error: "Forbidden" }, 403);

    const { data: paths, error } = await admin.rpc("collect_garbage");
    if (error) throw error;
    const list = (paths || []) as string[];

    let removed = 0;
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const { data, error: rmError } = await admin.storage.from("attachments").remove(chunk);
      if (rmError) console.error("remove failed:", rmError.message);
      removed += data?.length || 0;
    }
    console.log(`cleanup: ${removed} file(s) removed`);
    return json({ removed });
  } catch (e) {
    console.error("storage-cleanup error:", e instanceof Error ? e.message : e);
    return json({ error: "failed" }, 500);
  }
});
