import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../lib/adminSupabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WALLET_RE = /^0x[a-f0-9]{40}$/;

function normalizeWallet(value: unknown) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return WALLET_RE.test(wallet) ? wallet : null;
}

function normalizeUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (raw.length < 8 || raw.length > 800) return null;

  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const wallet = normalizeWallet(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const admin = getCreatorProgramClient();
  if (admin instanceof NextResponse) return admin;

  const [submissions, rewards] = await Promise.all([
    admin
      .from("creator_submissions")
      .select("id,url,status,admin_note,reviewed_at,created_at")
      .eq("wallet", wallet)
      .order("created_at", { ascending: false })
      .limit(30),
    admin
      .from("creator_rewards")
      .select("id,reward_kind,points,item_slug,quantity,token_address,amount_raw,reward_label,tx_hash,status,admin_note,created_at")
      .eq("wallet", wallet)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (submissions.error) {
    return NextResponse.json({ error: submissions.error.message }, { status: 500 });
  }
  if (rewards.error) {
    return NextResponse.json({ error: rewards.error.message }, { status: 500 });
  }

  return noStoreJson({
    submissions: submissions.data ?? [],
    rewards: rewards.data ?? [],
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = normalizeWallet(body?.wallet);
  const url = normalizeUrl(body?.url);

  if (!wallet) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }
  if (!url) {
    return NextResponse.json({ error: "Paste a valid http/https link" }, { status: 400 });
  }

  const admin = getCreatorProgramClient();
  if (admin instanceof NextResponse) return admin;

  const { data, error } = await admin
    .from("creator_submissions")
    .insert({ wallet, url })
    .select("id,url,status,created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return noStoreJson({ submission: data });
}

function getCreatorProgramClient() {
  try {
    return adminSupabase();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Creator program is not configured" },
      { status: 500 },
    );
  }
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
