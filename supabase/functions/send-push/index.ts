// DAPP Mail — sends a phone/desktop notification when someone receives mail.
// Called only by the database (trigger on new Inbox mail) with a shared secret.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// Keys come from Supabase Vault (via a server-only database function), loaded once per cold start.
let config: { vapid_public: string; vapid_private: string; hook_secret: string } | null = null;
async function getConfig() {
  if (config) return config;
  const { data, error } = await admin.rpc("get_push_config");
  if (error || !data?.vapid_private || !data?.hook_secret) throw new Error("push config unavailable");
  config = data;
  webpush.setVapidDetails("https://dapp-mail.netlify.app", data.vapid_public, data.vapid_private);
  return config!;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

// Constant-time compare for the shared secret.
function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const cfg = await getConfig();
    if (!sameSecret(req.headers.get("x-hook-secret") || "", cfg.hook_secret)) {
      return json({ error: "Forbidden" }, 403);
    }

    const { mailbox_id } = await req.json();
    if (typeof mailbox_id !== "string") return json({ error: "Bad request" }, 400);

    const { data: row } = await admin
      .from("mailbox")
      .select("id,user_id,folder,is_read,message:messages!inner(id,thread_id,subject,body_text,sender_id)")
      .eq("id", mailbox_id)
      .maybeSingle();
    if (!row || row.folder !== "inbox" || row.is_read) return json({ skipped: true });

    // deno-lint-ignore no-explicit-any
    const msg = row.message as any;
    const [{ data: sender }, { data: subs }, { count: unread }] = await Promise.all([
      admin.from("profiles").select("display_name,email").eq("id", msg.sender_id).maybeSingle(),
      admin.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", row.user_id),
      admin.from("mailbox").select("id", { count: "exact", head: true })
        .eq("user_id", row.user_id).eq("folder", "inbox").eq("is_read", false).is("snoozed_until", null),
    ]);
    if (!subs?.length) return json({ sent: 0 });

    const payload = JSON.stringify({
      title: sender?.display_name || sender?.email || "New message",
      body: clip(`${msg.subject || "(no subject)"} — ${(msg.body_text || "").replace(/\s+/g, " ").trim()}`, 160),
      threadId: msg.thread_id,
      tag: `thread-${msg.thread_id}`,
      unread: unread || 0,
    });

    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: "high" },
        );
        sent++;
        await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", s.id);
      } catch (e) {
        // deno-lint-ignore no-explicit-any
        const code = (e as any)?.statusCode;
        if (code === 404 || code === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id); // device unsubscribed
        } else {
          console.error("push failed:", code || (e instanceof Error ? e.message : e));
        }
      }
    }));
    return json({ sent });
  } catch (e) {
    console.error("send-push error:", e instanceof Error ? e.message : e);
    return json({ error: "failed" }, 500);
  }
});
