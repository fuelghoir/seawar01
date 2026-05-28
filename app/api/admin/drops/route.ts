import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, requireAdminSession } from "../../../lib/adminAuth";

export const runtime = "nodejs";

const ADDR_RE = /^0x[a-f0-9]{40}$/;
const DROP_ID_RE = /^[a-zA-Z0-9_.:-]{1,80}$/;

export async function GET() {
  try {
    await requireAdminSession();
    const admin = adminSupabase();

    const [campaigns, allocations] = await Promise.all([
      admin
        .from("drop_campaigns")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("drop_allocations")
        .select("drop_id,claimed_at,amount_raw")
        .limit(100000),
    ]);

    if (campaigns.error) {
      return NextResponse.json({ error: campaigns.error.message }, { status: 500 });
    }
    if (allocations.error) {
      return NextResponse.json({ error: allocations.error.message }, { status: 500 });
    }

    const counts = new Map<string, { allocations: number; claimed: number; allocatedRaw: bigint }>();
    for (const row of allocations.data ?? []) {
      const dropId = String(row.drop_id);
      const current = counts.get(dropId) ?? { allocations: 0, claimed: 0, allocatedRaw: BigInt(0) };
      current.allocations += 1;
      if (row.claimed_at) current.claimed += 1;
      current.allocatedRaw += parseBigInt(row.amount_raw);
      counts.set(dropId, current);
    }

    return NextResponse.json({
      campaigns: (campaigns.data ?? []).map((campaign) => ({
        ...campaign,
        ...(counts.get(campaign.id) ?? { allocations: 0, claimed: 0, allocatedRaw: BigInt(0) }),
        allocatedRaw: String(counts.get(campaign.id)?.allocatedRaw ?? BigInt(0)),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Admin request failed" },
      { status: 401 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdminSession();
    const body = await req.json().catch(() => null);
    const id = String(body?.id ?? "").trim();
    const title = String(body?.title ?? id).trim().slice(0, 120);
    const tokenAddress = String(body?.tokenAddress ?? body?.token_address ?? "").trim().toLowerCase();
    const tokenSymbol = String(body?.tokenSymbol ?? body?.token_symbol ?? "TOKEN").trim().slice(0, 24);
    const decimals = Math.max(0, Math.min(36, Math.floor(Number(body?.decimals ?? 18))));
    const totalAmountRaw = String(body?.totalAmountRaw ?? body?.total_amount_raw ?? "").trim();
    const contractAddress = String(body?.contractAddress ?? body?.contract_address ?? "").trim().toLowerCase();
    const signerAddress = String(body?.signerAddress ?? body?.signer_address ?? "").trim().toLowerCase();

    if (!DROP_ID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid drop id" }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!ADDR_RE.test(tokenAddress)) {
      return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
    }
    const total = parseBigInt(totalAmountRaw);
    if (total <= BigInt(0)) {
      return NextResponse.json({ error: "Total amount must be greater than zero" }, { status: 400 });
    }
    if (contractAddress && !ADDR_RE.test(contractAddress)) {
      return NextResponse.json({ error: "Invalid contract address" }, { status: 400 });
    }
    if (signerAddress && !ADDR_RE.test(signerAddress)) {
      return NextResponse.json({ error: "Invalid signer address" }, { status: 400 });
    }

    const admin = adminSupabase();
    const stats = await admin
      .from("player_stats")
      .select("wallet,points")
      .gt("points", 0)
      .limit(100000);

    if (stats.error) {
      return NextResponse.json({ error: stats.error.message }, { status: 500 });
    }

    const rows = (stats.data ?? []).map((row) => ({
      wallet: String(row.wallet).toLowerCase(),
      points: BigInt(Math.max(0, Math.floor(Number(row.points ?? 0)))),
    }));
    const totalPoints = rows.reduce((sum, row) => sum + row.points, BigInt(0));
    if (totalPoints <= BigInt(0)) {
      return NextResponse.json({ error: "No leaderboard points to snapshot" }, { status: 400 });
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

    const allocations = rows
      .map((row) => ({
        drop_id: id,
        wallet: row.wallet,
        points: Number(row.points),
        amount_raw: ((total * row.points) / totalPoints).toString(),
      }))
      .filter((row) => BigInt(row.amount_raw) > BigInt(0));

    for (let i = 0; i < allocations.length; i += 500) {
      const insert = await admin.from("drop_allocations").insert(allocations.slice(i, i + 500));
      if (insert.error) {
        return NextResponse.json({ error: insert.error.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      drop: {
        id,
        allocations: allocations.length,
        totalPoints: totalPoints.toString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Admin request failed" },
      { status: 401 },
    );
  }
}

function parseBigInt(value: unknown) {
  const raw = String(value ?? "0").trim();
  if (!/^\d+$/.test(raw)) return BigInt(0);
  return BigInt(raw);
}
