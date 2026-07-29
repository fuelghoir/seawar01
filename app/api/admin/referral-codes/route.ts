import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, requireAdminSession } from "../../../lib/adminAuth";
import {
  normalizeReferralCode,
  normalizeReferralWallet,
} from "../../../lib/referralIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession();
    const walletParam = req.nextUrl.searchParams.get("wallet");
    const wallet = walletParam ? normalizeReferralWallet(walletParam) : null;
    if (walletParam && !wallet) return jsonError("Invalid referral wallet", 400);

    let query = adminSupabase()
      .from("referral_codes")
      .select("code,wallet,is_primary,created_by,created_at,updated_at")
      .order("is_primary", { ascending: false })
      .order("updated_at", { ascending: false });
    if (wallet) query = query.eq("wallet", wallet);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ codes: data ?? [] }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdminSession();
    const body = await req.json().catch(() => null);
    const wallet = normalizeReferralWallet(body?.wallet);
    const code = normalizeReferralCode(body?.code);
    if (!wallet) return jsonError("Invalid referral wallet", 400);
    if (!code) return jsonError("Use 3-32 lowercase letters, numbers, _ or -", 400);

    const { data, error } = await adminSupabase().rpc("set_primary_referral_code", {
      p_wallet: wallet,
      p_code: code,
      p_created_by: session.address,
    });
    if (error) {
      if (error.code === "23505") return jsonError("Referral code is already assigned", 409);
      throw error;
    }

    const entry = Array.isArray(data) ? data[0] : data;
    if (!entry) throw new Error("Referral code was not returned by the database");
    return NextResponse.json({ entry }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleAdminError(error);
  }
}

function handleAdminError(error: unknown) {
  const { code, message } = readError(error);
  if (
    code === "42P01" ||
    code === "PGRST205" ||
    (code === "PGRST202" && /set_primary_referral_code/i.test(message)) ||
    /referral_codes.*schema cache|set_primary_referral_code.*schema cache/i.test(message)
  ) {
    return jsonError(
      "Short referral schema is not installed. Run scripts/supabase-short-referral-codes.sql in Supabase SQL Editor.",
      503,
    );
  }

  const status = /admin login required/i.test(message) ? 401 : 500;
  return jsonError(message, status);
}

function readError(error: unknown) {
  if (error instanceof Error) return { code: "", message: error.message };
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; message?: unknown };
    return {
      code: typeof value.code === "string" ? value.code : "",
      message: typeof value.message === "string" ? value.message : "Referral code request failed",
    };
  }
  return { code: "", message: "Referral code request failed" };
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS });
}
