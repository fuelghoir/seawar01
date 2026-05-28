import { NextRequest, NextResponse } from "next/server";
import {
  adminSupabase,
  normalizeAdminWallet,
  requireAdminSession,
} from "../../../../lib/adminAuth";

export const runtime = "nodejs";

const REWARD_KINDS = new Set(["points", "item", "usdc", "base", "token", "note"]);
const REWARD_STATUSES = new Set(["planned", "granted", "claimable", "paid", "cancelled"]);
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const USDC_ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdminSession();
    const body = await req.json().catch(() => null);
    const wallet = normalizeAdminWallet(body?.wallet);
    const rewardKind = String(body?.rewardKind ?? body?.reward_kind ?? "");
    const points = Math.max(0, Math.floor(Number(body?.points ?? 0)));
    const quantity = Math.max(0, Math.floor(Number(body?.quantity ?? 0)));
    const itemSlug = String(body?.itemSlug ?? body?.item_slug ?? "").trim();
    const statusRaw = String(body?.status ?? "").trim();
    const status = REWARD_STATUSES.has(statusRaw) ? statusRaw : "planned";
    const sourceSubmissionId = Number(body?.sourceSubmissionId ?? body?.source_submission_id ?? 0);
    const adminNote = String(body?.adminNote ?? body?.admin_note ?? "").slice(0, 1200);
    const rewardLabel = String(body?.rewardLabel ?? body?.reward_label ?? "").slice(0, 120);
    const tokenAddress = String(body?.tokenAddress ?? body?.token_address ?? "").trim() || null;
    const amountRaw = String(body?.amountRaw ?? body?.amount_raw ?? "").trim() || null;
    const txHash = String(body?.txHash ?? body?.tx_hash ?? "").trim() || null;

    if (!wallet) {
      return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
    }
    if (!REWARD_KINDS.has(rewardKind)) {
      return NextResponse.json({ error: "Invalid reward kind" }, { status: 400 });
    }
    if (rewardKind === "points" && points <= 0) {
      return NextResponse.json({ error: "Points must be greater than zero" }, { status: 400 });
    }
    if (rewardKind === "item" && (!itemSlug || quantity <= 0)) {
      return NextResponse.json({ error: "Item slug and quantity are required" }, { status: 400 });
    }
    if (["usdc", "base", "token"].includes(rewardKind) && finalClaimStatus(status) === "claimable") {
      if (!amountRaw || !/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= BigInt(0)) {
        return NextResponse.json({ error: "Claimable token rewards require amount raw" }, { status: 400 });
      }
      if (rewardKind === "token" && !tokenAddress) {
        return NextResponse.json({ error: "Token rewards require token address" }, { status: 400 });
      }
    }

    const admin = adminSupabase();
    let finalStatus = status;

    if (rewardKind === "points") {
      const current = await admin.from("player_stats").select("points").eq("wallet", wallet).single();
      if (!current.error) {
        const updated = await admin
          .from("player_stats")
          .update({
            points: Number(current.data.points ?? 0) + points,
            updated_at: new Date().toISOString(),
          })
          .eq("wallet", wallet);
        if (updated.error) {
          return NextResponse.json({ error: updated.error.message }, { status: 500 });
        }
      } else {
        const created = await admin
          .from("player_stats")
          .insert({ wallet, points, updated_at: new Date().toISOString() });
        if (created.error) {
          return NextResponse.json({ error: created.error.message }, { status: 500 });
        }
      }
      finalStatus = "granted";
    }

    if (rewardKind === "item") {
      const current = await admin
        .from("player_items")
        .select("quantity")
        .eq("wallet", wallet)
        .eq("item_slug", itemSlug)
        .maybeSingle();
      if (current.error) return NextResponse.json({ error: current.error.message }, { status: 500 });

      const { error } = await admin
        .from("player_items")
        .upsert(
          {
            wallet,
            item_slug: itemSlug,
            quantity: Number(current.data?.quantity ?? 0) + quantity,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "wallet,item_slug" },
        );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      finalStatus = "granted";
    }

    const { data, error } = await admin
      .from("creator_rewards")
      .insert({
        wallet,
        source_submission_id:
          Number.isInteger(sourceSubmissionId) && sourceSubmissionId > 0 ? sourceSubmissionId : null,
        reward_kind: rewardKind,
        points,
        item_slug: itemSlug || null,
        quantity,
        token_address: tokenForReward(rewardKind, tokenAddress),
        amount_raw: amountRaw,
        reward_label: rewardLabel || null,
        tx_hash: txHash,
        status: finalStatus,
        admin_note: adminNote || null,
        created_by: session.address,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (data?.source_submission_id && ["granted", "claimable", "paid"].includes(finalStatus)) {
      await admin
        .from("creator_submissions")
        .update({
          status: "rewarded",
          reviewed_by: session.address,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", data.source_submission_id);
    }

    return NextResponse.json({ reward: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Admin request failed" },
      { status: 401 },
    );
  }
}

function tokenForReward(kind: string, tokenAddress: string | null) {
  if (tokenAddress) return tokenAddress;
  if (kind === "usdc") return USDC_ADDR;
  if (kind === "base") return ZERO_ADDR;
  return null;
}

function finalClaimStatus(status: string) {
  return REWARD_STATUSES.has(status) ? status : "planned";
}
