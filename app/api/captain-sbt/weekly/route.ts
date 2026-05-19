import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http, isAddress } from "viem";
import { base } from "viem/chains";
import { captainSbtAbi, CAPTAIN_SBT_CONTRACT_ADDRESS } from "../../../contracts/seaBattleAbi";
import { getLimitedSbtWeekKey, LIMITED_SBT_WEEKLY_POINTS } from "../../../lib/limitedSbt";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

function adminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey);
}

export async function POST(req: NextRequest) {
  if (CAPTAIN_SBT_CONTRACT_ADDRESS === ZERO_ADDR) {
    return NextResponse.json({ error: "Captain SBT contract is not deployed" }, { status: 500 });
  }

  const admin = adminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for on-chain SBT weekly rewards" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  const wallet = String(body?.wallet ?? "").toLowerCase();
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const client = createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL) });
  const balance = await client.readContract({
    address: CAPTAIN_SBT_CONTRACT_ADDRESS,
    abi: captainSbtAbi,
    functionName: "balanceOf",
    args: [wallet],
  });

  if (BigInt(balance) === BigInt(0)) {
    return NextResponse.json({ error: "Claim Captain SBT first" }, { status: 403 });
  }

  const weekKey = getLimitedSbtWeekKey();
  const insert = await admin
    .from("limited_sbt_weekly_rewards")
    .insert({
      wallet,
      week_key: weekKey,
      points: LIMITED_SBT_WEEKLY_POINTS,
    });

  if (insert.error) {
    if (insert.error.code === "23505") {
      return NextResponse.json({ points: 0, weekKey });
    }
    return NextResponse.json({ error: insert.error.message }, { status: 500 });
  }

  const { data: stats, error: statsError } = await admin
    .from("player_stats")
    .select("points")
    .eq("wallet", wallet)
    .maybeSingle();

  if (statsError) {
    return NextResponse.json({ error: statsError.message }, { status: 500 });
  }

  if (stats) {
    const update = await admin
      .from("player_stats")
      .update({
        points: Number(stats.points ?? 0) + LIMITED_SBT_WEEKLY_POINTS,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet", wallet);
    if (update.error) {
      return NextResponse.json({ error: update.error.message }, { status: 500 });
    }
  } else {
    const create = await admin.from("player_stats").insert({
      wallet,
      points: LIMITED_SBT_WEEKLY_POINTS,
    });
    if (create.error) {
      return NextResponse.json({ error: create.error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ points: LIMITED_SBT_WEEKLY_POINTS, weekKey });
}
