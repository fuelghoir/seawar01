import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
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

    const admin = adminSupabase();
    const { data, error } = await admin.rpc("set_primary_referral_code", {
      p_wallet: wallet,
      p_code: code,
      p_created_by: session.address,
    });
    if (error) {
      if (error.code === "23505") return jsonError("Referral code is already assigned", 409);
      if (shouldUseDirectFallback(error)) {
        const entry = await setPrimaryReferralCodeFallback(
          admin,
          wallet,
          code,
          session.address,
        );
        return NextResponse.json({ entry }, { headers: NO_STORE_HEADERS });
      }
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

  const status = /admin login required/i.test(message)
    ? 401
    : /already assigned/i.test(message)
      ? 409
      : 500;
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

function shouldUseDirectFallback(error: { code?: string; message?: string }) {
  return (
    error.code === "42702" ||
    error.code === "PGRST202" ||
    /column reference.*code.*ambiguous|set_primary_referral_code.*schema cache/i.test(
      error.message ?? "",
    )
  );
}

async function setPrimaryReferralCodeFallback(
  admin: SupabaseClient,
  wallet: string,
  code: string,
  createdBy: string,
) {
  const columns = "code,wallet,is_primary,created_by,created_at,updated_at";
  const { data: existing, error: existingError } = await admin
    .from("referral_codes")
    .select(columns)
    .eq("code", code)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing && existing.wallet !== wallet) {
    throw new Error("Referral code is already assigned");
  }

  const { data: previousPrimary, error: previousError } = await admin
    .from("referral_codes")
    .select(columns)
    .eq("wallet", wallet)
    .eq("is_primary", true)
    .maybeSingle();
  if (previousError) throw previousError;

  if (previousPrimary && previousPrimary.code !== code) {
    const { error: demoteError } = await admin
      .from("referral_codes")
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq("code", previousPrimary.code)
      .eq("wallet", wallet);
    if (demoteError) throw demoteError;
  }

  const now = new Date().toISOString();
  const { data: entry, error: upsertError } = await admin
    .from("referral_codes")
    .upsert(
      {
        code,
        wallet,
        is_primary: true,
        created_by: createdBy,
        updated_at: now,
      },
      { onConflict: "code" },
    )
    .select(columns)
    .single();

  if (upsertError) {
    if (previousPrimary && previousPrimary.code !== code) {
      await admin
        .from("referral_codes")
        .update({ is_primary: true, updated_at: now })
        .eq("code", previousPrimary.code)
        .eq("wallet", wallet);
    }
    throw upsertError;
  }

  return entry;
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS });
}
