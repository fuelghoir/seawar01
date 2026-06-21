import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import {
  adminSupabase,
  normalizeWallet,
  socialDbMissingMessage,
} from "../../../../../lib/socialConnectionsServer";

function base64Url(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function appUrl(req: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || "seabattle.top";
  return `${proto}://${host}`;
}

function redirectUri(req: NextRequest) {
  return process.env.X_OAUTH_CALLBACK_URL || `${appUrl(req)}/api/social-connections/x/oauth/callback`;
}

function authorizeUrl() {
  return (process.env.X_OAUTH_AUTHORIZE_URL || "https://x.com/i/oauth2/authorize").replace(/\?$/, "");
}

export async function GET(req: NextRequest) {
  const admin = adminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for social connections" },
      { status: 500 },
    );
  }

  const clientId = process.env.X_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "X OAuth is not configured. Add X_CLIENT_ID and callback URL in X Developer Portal." },
      { status: 500 },
    );
  }

  const wallet = normalizeWallet(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });

  const state = base64Url(randomBytes(24));
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const callback = redirectUri(req);

  try {
    const { error } = await admin.from("social_oauth_states").insert({
      state,
      wallet,
      provider: "x",
      code_verifier: codeVerifier,
      redirect_uri: callback,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) throw new Error(error.message);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: callback,
      scope: "tweet.read users.read follows.read like.read offline.access",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return NextResponse.redirect(`${authorizeUrl()}?${params.toString()}`);
  } catch (err) {
    const message = socialDbMissingMessage(err instanceof Error ? err.message : "Could not start X OAuth");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
