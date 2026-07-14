import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, requireAdminSession } from "../../../lib/adminAuth";

export const runtime = "nodejs";

const ADDR_RE = /^0x[a-f0-9]{40}$/;
const DROP_ID_RE = /^[a-zA-Z0-9_.:-]{1,80}$/;



function formatRaw(raw: string, decimals: number) {
  const value = BigInt(raw || "0");
  const scale = BigInt(10) ** BigInt(Math.max(0, decimals));
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === BigInt(0)) return whole.toLocaleString();
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return `${whole.toLocaleString()}${fractionText ? `.${fractionText}` : ""}`;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdminSession();
    const admin = adminSupabase();
    
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id") || "";
    const title = searchParams.get("title") || "";
    const tokenAddress = searchParams.get("tokenAddress") || "";
    const tokenSymbol = searchParams.get("tokenSymbol") || "";
    const decimals = parseInt(searchParams.get("decimals") || "18");
    const total = BigInt(searchParams.get("total") || "0");
    const minPoints = parseInt(searchParams.get("minPoints") || "0");
    const minTransactions = parseInt(searchParams.get("minTransactions") || "0");
    const minCheckins = parseInt(searchParams.get("minCheckins") || "0");
    const pointsSource = searchParams.get("pointsSource") || "standard";
    const preview = searchParams.get("preview") === "true";
    const contractAddress = searchParams.get("contractAddress");
    const signerAddress = searchParams.get("signerAddress");

    if (!DROP_ID_RE.test(id)) return NextResponse.json({ error: "Invalid drop ID" }, { status: 400 });

    const allWallets: { wallet: string; points: bigint; gamesPlayed: number; totalCheckins: number; transactions: number; }[] = [];

    if (pointsSource === "season_current") {
      const seasonConfig = await admin.from("season_config").select("season_key").eq("id", "default").single();
      const seasonKey = seasonConfig.data?.season_key || "S1";

      const [statsRes, seasonRes] = await Promise.all([
        admin.from("player_stats").select("wallet,games_played,total_checkins").limit(100000),
        admin.from("season_progress").select("wallet,xp").eq("season_key", seasonKey).gte("xp", minPoints).limit(100000)
      ]);

      if (seasonRes.error) return NextResponse.json({ error: seasonRes.error.message }, { status: 500 });
      if (statsRes.error) return NextResponse.json({ error: statsRes.error.message }, { status: 500 });

      const statsMap = new Map();
      for (const row of statsRes.data || []) {
        statsMap.set(String(row.wallet).toLowerCase(), row);
      }

      for (const row of seasonRes.data || []) {
        const w = String(row.wallet).toLowerCase();
        const stat = statsMap.get(w);
        const gamesPlayed = Math.max(0, Math.floor(Number(stat?.games_played ?? 0)));
        const totalCheckins = Math.max(0, Math.floor(Number(stat?.total_checkins ?? 0)));
        const transactions = gamesPlayed + totalCheckins;
        allWallets.push({
          wallet: w,
          points: BigInt(Math.max(0, Math.floor(Number(row.xp ?? 0)))),
          gamesPlayed,
          totalCheckins,
          transactions
        });
      }
    } else {
      const stats = await admin
        .from("player_stats")
        .select("wallet,points,games_played,total_checkins")
        .gte("points", minPoints)
        .limit(100000);

      if (stats.error) return NextResponse.json({ error: stats.error.message }, { status: 500 });

      for (const row of stats.data || []) {
        const gamesPlayed = Math.max(0, Math.floor(Number(row.games_played ?? 0)));
        const totalCheckins = Math.max(0, Math.floor(Number(row.total_checkins ?? 0)));
        const transactions = gamesPlayed + totalCheckins;
        allWallets.push({
          wallet: String(row.wallet).toLowerCase(),
          points: BigInt(Math.max(0, Math.floor(Number(row.points ?? 0)))),
          gamesPlayed,
          totalCheckins,
          transactions
        });
      }
    }

    const rows = allWallets.filter(
      (row) =>
        ADDR_RE.test(row.wallet) &&
        row.points >= BigInt(minPoints) &&
        row.transactions >= minTransactions &&
        row.totalCheckins >= minCheckins,
    );

    const totalPoints = rows.reduce((sum, row) => sum + row.points, BigInt(0));
    if (totalPoints <= BigInt(0)) {
      return NextResponse.json(
        { error: `No eligible wallets: need at least ${minPoints} points, ${minTransactions} transactions, and ${minCheckins} checkins` },
        { status: 400 },
      );
    }

    const allocations = rows
      .map((row) => ({
        drop_id: id,
        wallet: row.wallet,
        points: Number(row.points),
        gamesPlayed: row.gamesPlayed,
        totalCheckins: row.totalCheckins,
        transactions: row.transactions,
        amount_raw: ((total * row.points) / totalPoints).toString(),
      }))
      .filter((row) => BigInt(row.amount_raw) > BigInt(0));

    if (preview) {
      return NextResponse.json({
        preview: true,
        drop: {
          id,
          title,
          token_address: tokenAddress,
          token_symbol: tokenSymbol,
          decimals,
          total_amount_raw: total.toString(),
          totalPoints: totalPoints.toString(),
          allocationsCount: allocations.length,
          eligibility: {
            minPoints,
            minTransactions,
            minCheckins,
          },
        },
        allocations: allocations.map((a) => ({
          wallet: a.wallet,
          points: a.points,
          gamesPlayed: a.gamesPlayed,
          totalCheckins: a.totalCheckins,
          transactions: a.transactions,
          amount_raw: a.amount_raw,
          amount_formatted: formatRaw(a.amount_raw, decimals),
        })),
      });
    }

    const campaign = await admin
      .from("drop_campaigns")
      .upsert(
        {
          id,
          title,
          token_address: tokenAddress,
          token_symbol: tokenSymbol || "TOKEN",
          decimals,
          total_amount_raw: total.toString(),
          total_points: Number(totalPoints),
          contract_address: contractAddress || null,
          signer_address: signerAddress || null,
          status: "draft",
          snapshot_at: new Date().toISOString(),
          created_by: session.address,
        },
        { onConflict: "id" },
      );

    if (campaign.error) {
      return NextResponse.json({ error: campaign.error.message }, { status: 500 });
    }

    await admin.from("drop_allocations").delete().eq("drop_id", id);

    const dbAllocations = allocations.map((a) => ({
      drop_id: id,
      wallet: a.wallet,
      points: a.points,
      amount_raw: a.amount_raw,
    }));

    for (let i = 0; i < dbAllocations.length; i += 500) {
      const insert = await admin.from("drop_allocations").insert(dbAllocations.slice(i, i + 500));
      if (insert.error) {
        return NextResponse.json({ error: insert.error.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      drop: {
        id,
        allocations: dbAllocations.length,
        totalPoints: totalPoints.toString(),
        eligibility: {
          minPoints,
          minTransactions,
          minCheckins,
        },
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Admin request failed" },
      { status: 401 },
    );
  }
}
