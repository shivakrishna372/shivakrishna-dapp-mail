// DAPP Mail — admin-only user management
// Actions: list, create, reset_password, set_disabled, set_admin, rename
import { createClient } from "npm:@supabase/supabase-js@2";

const DOMAIN = "dapp.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const validPassword = (p: unknown): p is string => typeof p === "string" && p.length >= 8 && p.length <= 72;
const validId = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

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

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }

    switch (body.action) {
      case "list": {
        const [{ data: profiles }, { data: security }, { data: authList }] = await Promise.all([
          admin.from("profiles").select("id,email,username,display_name,is_admin,created_at").order("email"),
          admin.from("user_security").select("user_id,recovery_email,recovery_email_verified,first_login_completed"),
          admin.auth.admin.listUsers({ perPage: 1000 }),
        ]);
        const sec = new Map((security || []).map((s) => [s.user_id, s]));
        const au = new Map((authList?.users || []).map((u) => [u.id, u]));
        const users = (profiles || []).map((p) => {
          const s = sec.get(p.id);
          const u = au.get(p.id);
          return {
            ...p,
            setup_complete: !!s?.first_login_completed,
            recovery_email: s?.recovery_email_verified ? s.recovery_email : null,
            last_sign_in_at: u?.last_sign_in_at ?? null,
            disabled: !!(u?.banned_until && new Date(u.banned_until) > new Date()),
          };
        });
        return json({ users });
      }

      case "create": {
        const username = String(body.username || "").trim().toLowerCase();
        const displayName = String(body.display_name || "").trim().slice(0, 80);
        if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(username)) {
          return json({ error: "Username: 2–40 characters, letters, numbers, dot, dash or underscore" }, 400);
        }
        if (!validPassword(body.temp_password)) return json({ error: "Temporary password must be 8–72 characters" }, 400);
        const { data, error } = await admin.auth.admin.createUser({
          email: `${username}@${DOMAIN}`,
          password: body.temp_password,
          email_confirm: true,
          user_metadata: { display_name: displayName || username },
        });
        if (error) {
          const msg = /already|registered|exists/i.test(error.message) ? "That address is already taken" : error.message;
          return json({ error: msg }, 400);
        }
        return json({ success: true, id: data.user?.id });
      }

      case "reset_password": {
        if (!validId(body.user_id)) return json({ error: "Invalid user" }, 400);
        if (!validPassword(body.temp_password)) return json({ error: "Temporary password must be 8–72 characters" }, 400);
        const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.temp_password });
        if (error) return json({ error: error.message }, 400);
        // Force them to choose a new personal password on next login.
        await admin.from("user_security").update({ first_login_completed: false }).eq("user_id", body.user_id);
        return json({ success: true });
      }

      case "set_disabled": {
        if (!validId(body.user_id)) return json({ error: "Invalid user" }, 400);
        if (body.user_id === me.id) return json({ error: "You can't disable your own account" }, 400);
        const { error } = await admin.auth.admin.updateUserById(body.user_id, {
          ban_duration: body.disabled ? "876000h" : "none",
        });
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }

      case "set_admin": {
        if (!validId(body.user_id)) return json({ error: "Invalid user" }, 400);
        if (body.user_id === me.id) return json({ error: "You can't change your own admin role" }, 400);
        const { error } = await admin.from("profiles").update({ is_admin: !!body.is_admin }).eq("id", body.user_id);
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }

      case "rename": {
        if (!validId(body.user_id)) return json({ error: "Invalid user" }, 400);
        const name = String(body.display_name || "").trim().slice(0, 80);
        if (!name) return json({ error: "Name can't be empty" }, 400);
        const { error } = await admin.from("profiles").update({ display_name: name }).eq("id", body.user_id);
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }
    }
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("admin-users error:", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
