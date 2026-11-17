// DAPP Mail — account security function
// Actions:
//   send           (logged in)  send a 6-digit code to a recovery email
//   verify         (logged in)  confirm the code
//   activate       (logged in)  set personal password + finish first-login setup
//   request-reset  (logged out) email a password-reset link to the VERIFIED recovery email
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@^6.9.16";

const DOMAIN = "dapp.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const transporter = nodemailer.createTransport({
  host: Deno.env.get("SMTP_HOSTNAME"),
  port: Number(Deno.env.get("SMTP_PORT") || 465),
  secure: Deno.env.get("SMTP_SECURE") === "true",
  auth: { user: Deno.env.get("SMTP_USERNAME"), pass: Deno.env.get("SMTP_PASSWORD") },
});

async function sha256(text: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function emailShell(title: string, inner: string) {
  return `<div style="font-family:Inter,Arial,sans-serif;background:#f4f6fb;padding:32px">
    <div style="max-width:480px;margin:auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #e6e8f0">
      <div style="font-weight:700;font-size:18px;color:#3b5bdb">✉ DAPP Mail</div>
      <h2 style="margin:20px 0 8px;color:#111827">${title}</h2>
      ${inner}
      <p style="color:#6b7280;font-size:12px;margin-top:28px">If you didn't request this, you can ignore this email.</p>
    </div></div>`;
}

function validPassword(p: unknown): p is string {
  return typeof p === "string" && p.length >= 8 && p.length <= 72;
}

const GENERIC_RESET =
  "If this account has a verified recovery email, a reset link has been sent to it.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const action = body.action;

  try {
    // ---------------- LOGGED-OUT: password reset ----------------
    if (action === "request-reset") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email.endsWith("@" + DOMAIN) || email.length > 120) {
        return json({ success: true, message: GENERIC_RESET });
      }
      const { data: profile } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
      if (!profile) return json({ success: true, message: GENERIC_RESET });

      const { data: sec } = await admin
        .from("user_security")
        .select("recovery_email, recovery_email_verified, last_reset_requested_at")
        .eq("user_id", profile.id)
        .maybeSingle();
      if (!sec?.recovery_email_verified || !sec.recovery_email) {
        return json({ success: true, message: GENERIC_RESET });
      }
      if (sec.last_reset_requested_at && Date.now() - new Date(sec.last_reset_requested_at).getTime() < 120000) {
        return json({ success: true, message: GENERIC_RESET });
      }
      await admin.from("user_security").update({ last_reset_requested_at: new Date().toISOString() }).eq("user_id", profile.id);

      const origin = req.headers.get("origin") || undefined; // Supabase only honours allow-listed URLs
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: origin ? { redirectTo: origin } : undefined,
      });
      if (linkError || !link?.properties?.action_link) throw linkError || new Error("link failed");

      const url = link.properties.action_link;
      await transporter.sendMail({
        from: Deno.env.get("SMTP_FROM"),
        to: sec.recovery_email,
        subject: "DAPP Mail - Reset your password",
        text: `Someone requested a password reset for ${email}.\n\nOpen this link to choose a new password (valid for 1 hour):\n${url}\n`,
        html: emailShell(
          "Reset your password",
          `<p style="color:#374151">A password reset was requested for <b>${escapeHtml(email)}</b>.</p>
           <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#3b5bdb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Choose a new password</a></p>
           <p style="color:#6b7280;font-size:13px">This link works once and expires in 1 hour.</p>`,
        ),
      });
      return json({ success: true, message: GENERIC_RESET });
    }

    // ---------------- LOGGED-IN actions ----------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Please sign in again" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Please sign in again" }, 401);
    const userId = authData.user.id;

    if (action === "activate") {
      // TEMPORARY: the old app sets the password itself and sends no new_password.
      // Remove this fallback once everyone is on the new app.
      const legacy = body.new_password === undefined;
      if (!legacy && !validPassword(body.new_password)) {
        return json({ error: "Password must be 8–72 characters" }, 400);
      }
      const { data: security, error: checkError } = await admin
        .from("user_security").select("recovery_email_verified").eq("user_id", userId).maybeSingle();
      if (checkError) throw checkError;
      if (!security?.recovery_email_verified) {
        return json({ error: "Verify your recovery email first" }, 403);
      }
      if (!legacy) {
        const { error: pwError } = await admin.auth.admin.updateUserById(userId, {
          password: body.new_password as string,
        });
        if (pwError) return json({ error: pwError.message }, 400);
      }

      const { error: activateError } = await admin
        .from("user_security")
        .update({ first_login_completed: true, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (activateError) throw activateError;
      return json({ success: true });
    }

    if (action === "send") {
      const email = String(body.recovery_email || "").trim().toLowerCase();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: "Enter a valid recovery email" }, 400);
      }
      if (email.endsWith("@" + DOMAIN)) {
        return json({ error: `Use a personal email (like Gmail), not a @${DOMAIN} address` }, 400);
      }
      const { data: existing, error: lookupError } = await admin
        .from("recovery_email_otps").select("created_at").eq("user_id", userId).maybeSingle();
      if (lookupError) throw lookupError;
      if (existing && Date.now() - new Date(existing.created_at).getTime() < 60000) {
        return json({ error: "Please wait 60 seconds before requesting another code" }, 429);
      }

      const random = new Uint32Array(1);
      crypto.getRandomValues(random);
      const code = String(random[0] % 1000000).padStart(6, "0");

      const { error: saveError } = await admin.from("recovery_email_otps").upsert({
        user_id: userId,
        otp_hash: await sha256(`${userId}:${code}`),
        recovery_email: email,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        attempts: 0,
        created_at: new Date().toISOString(),
      });
      if (saveError) throw saveError;

      try {
        await transporter.sendMail({
          from: Deno.env.get("SMTP_FROM"),
          to: email,
          subject: "DAPP Mail - Your verification code",
          text: `Your DAPP Mail verification code is ${code}. It expires in 10 minutes. Do not share it with anyone.`,
          html: emailShell(
            "Your verification code",
            `<p style="color:#374151">Use this code to verify your recovery email:</p>
             <div style="font-size:32px;font-weight:700;letter-spacing:10px;color:#111827;margin:16px 0">${code}</div>
             <p style="color:#6b7280;font-size:13px">It expires in 10 minutes. Never share it with anyone.</p>`,
          ),
        });
      } catch (mailError) {
        await admin.from("recovery_email_otps").delete().eq("user_id", userId);
        throw mailError;
      }
      return json({ success: true });
    }

    if (action === "verify") {
      const code = String(body.code || "").trim();
      if (!/^\d{6}$/.test(code)) return json({ error: "Enter the 6-digit code" }, 400);

      const { data: record, error: lookupError } = await admin
        .from("recovery_email_otps").select("*").eq("user_id", userId).maybeSingle();
      if (lookupError) throw lookupError;
      if (!record) return json({ error: "Request a code first" }, 400);

      if (new Date(record.expires_at).getTime() < Date.now()) {
        await admin.from("recovery_email_otps").delete().eq("user_id", userId);
        return json({ error: "Code expired. Request a new one." }, 400);
      }
      if (record.attempts >= 5) {
        await admin.from("recovery_email_otps").delete().eq("user_id", userId);
        return json({ error: "Too many attempts. Request a new code." }, 429);
      }
      if ((await sha256(`${userId}:${code}`)) !== record.otp_hash) {
        await admin.from("recovery_email_otps").update({ attempts: record.attempts + 1 }).eq("user_id", userId);
        return json({ error: "Incorrect code" }, 400);
      }

      const { error: updateError } = await admin.from("user_security").upsert({
        user_id: userId,
        recovery_email: record.recovery_email,
        recovery_email_verified: true,
        updated_at: new Date().toISOString(),
      });
      if (updateError) throw updateError;
      await admin.from("recovery_email_otps").delete().eq("user_id", userId);
      return json({ success: true, recovery_email: record.recovery_email });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    // Details go to the Supabase logs only — never to the browser.
    console.error("recovery-email error:", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong. Please try again in a minute." }, 500);
  }
});
