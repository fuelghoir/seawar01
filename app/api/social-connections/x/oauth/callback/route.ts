import { NextRequest, NextResponse } from "next/server";
import {
  adminSupabase,
  getSocialConnection,
  socialDbMissingMessage,
  upsertSocialConnection,
} from "../../../../../lib/socialConnectionsServer";

type OAuthStateRow = {
  state: string;
  wallet: string;
  provider: string;
  code_verifier: string;
  redirect_uri: string;
  expires_at: string;
};

function html(title: string, body: string, ok = true) {
  const messagePayload = JSON.stringify(
    ok
      ? { type: "sea-battle-social-connected", provider: "x" }
      : { type: "sea-battle-social-error", provider: "x", message: body },
  );

  return new NextResponse(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07111f;color:#fff;font-family:system-ui,sans-serif}
      main{max-width:420px;padding:28px;border:1px solid ${ok ? "#00dcb4" : "#ff6b81"}55;border-radius:18px;background:#0b1728;text-align:center}
      h1{margin:0 0 10px;font-size:22px}p{opacity:.78}
    </style>
  </head>
  <body>
    <main><h1>${title}</h1><p>${body}</p></main>
    <script>
      try { window.opener && window.opener.postMessage(${messagePayload}, "*"); } catch (e) {}
      setTimeout(function(){ try { window.close(); } catch(e) {} }, 1200);
    </script>
  </body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function exchangeCodeForToken(code: string, row: OAuthStateRow) {
  const clientId = process.env.X_CLIENT_ID;
  if (!clientId) throw new Error("X OAuth is not configured. Add X_CLIENT_ID.");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: row.redirect_uri,
    code_verifier: row.code_verifier,
    client_id: clientId,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (process.env.X_CLIENT_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${process.env.X_CLIENT_SECRET}`).toString("base64")}`;
  }

  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers,
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error_description || data?.error || res.statusText);
  }
  const accessToken = data?.access_token;
  if (typeof accessToken !== "string") throw new Error("X OAuth did not return an access token");
  return {
    accessToken,
    refreshToken: typeof data?.refresh_token === "string" ? data.refresh_token : null,
    scope: typeof data?.scope === "string" ? data.scope : null,
    expiresIn: typeof data?.expires_in === "number" ? data.expires_in : null,
  };
}

async function getMe(accessToken: string) {
  const res = await fetch("https://api.twitter.com/2/users/me?user.fields=username,name", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.detail || data?.title || data?.error || res.statusText);
  }
  if (!data?.data?.id) throw new Error("X OAuth did not return a user id");
  return data.data as { id: string; username?: string; name?: string };
}

export async function GET(req: NextRequest) {
  const admin = adminSupabase();
  if (!admin) return html("Connection failed", "Supabase admin is not configured.", false);

  const state = req.nextUrl.searchParams.get("state") || "";
  const code = req.nextUrl.searchParams.get("code") || "";
  const error = req.nextUrl.searchParams.get("error");
  if (error) return html("X connection cancelled", error, false);
  if (!state || !code) return html("Connection failed", "Missing X OAuth state or code.", false);

  try {
    const { data, error: loadError } = await admin
      .from("social_oauth_states")
      .select("state,wallet,provider,code_verifier,redirect_uri,expires_at")
      .eq("state", state)
      .eq("provider", "x")
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!data) throw new Error("OAuth session expired");

    const row = data as OAuthStateRow;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error("OAuth session expired");
    }

    const token = await exchangeCodeForToken(code, row);
    const me = await getMe(token.accessToken);
    const existing = await getSocialConnection(admin, row.wallet, "x").catch(() => null);
    await upsertSocialConnection(admin, {
      wallet: row.wallet,
      provider: "x",
      provider_user_id: me.id,
      provider_username: me.username ?? null,
      base_verify_token: existing?.base_verify_token ?? null,
      metadata: {
        ...(existing?.metadata ?? {}),
        source: existing?.base_verify_token ? "base_verify+x_oauth" : "x_oauth",
        xName: me.name ?? null,
        xAccessToken: token.accessToken,
        xRefreshToken: token.refreshToken,
        xScope: token.scope,
        xTokenExpiresAt: token.expiresIn
          ? new Date(Date.now() + token.expiresIn * 1000).toISOString()
          : null,
        oauthConnectedAt: new Date().toISOString(),
      },
    });

    await admin.from("social_oauth_states").delete().eq("state", state);
    return html("X connected", `Connected @${me.username || me.id}. You can return to Sea Battle now.`);
  } catch (err) {
    const message = socialDbMissingMessage(err instanceof Error ? err.message : "Could not connect X");
    return html("X connection failed", message, false);
  }
}
