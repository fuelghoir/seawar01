import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, requireAdminSession } from "../../../lib/adminAuth";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { DROP_CLAIM_CONTRACT_ADDRESS } from "../../../contracts/dropClaimAbi";

export const runtime = "nodejs";

const ADDR_RE = /^0x[a-f0-9]{40}$/;
const DROP_ID_RE = /^[a-zA-Z0-9_.:-]{1,80}$/;
const _MIN_ELIGIBLE_POINTS = 3_000;
const _MIN_ELIGIBLE_TRANSACTIONS = 10;

type PlayerStatsRow = {
  wallet?: string | null;
  points?: number | string | null;
  games_played?: number | string | null;
  total_checkins?: number | string | null;
};

const erc20Abi = [
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ type: "address", name: "account" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

function formatRaw(raw: string, decimals: number) {
  const value = BigInt(raw || "0");
  const scale = BigInt(10) ** BigInt(Math.max(0, decimals));
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === BigInt(0)) return whole.toLocaleString();
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return `${whole.toLocaleString()}${fractionText ? `.${fractionText}` : ""}`;
}

function _seasonTransactionCount(row: PlayerStatsRow) {
  return (
    Math.max(0, Math.floor(Number(row.games_played ?? 0))) +
    Math.max(0, Math.floor(Number(row.total_checkins ?? 0)))
  );
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession();
    const admin = adminSupabase();

    const action = req.nextUrl.searchParams.get("action");
    if (action === "tokens") {
      const client = createPublicClient({
        chain: base,
        transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
      });

      const dropContract = (process.env.NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS ||
        DROP_CLAIM_CONTRACT_ADDRESS ||
        "0x39016cE335546b6ab9776a1cC78cf210f84f5a5b") as `0x${string}`;

      const singleAddress = req.nextUrl.searchParams.get("address");
      if (singleAddress && ADDR_RE.test(singleAddress)) {
        try {
          const [symbol, decimals, balance] = await Promise.all([
            client.readContract({
              address: singleAddress as `0x${string}`,
              abi: erc20Abi,
              functionName: "symbol",
            }),
            client.readContract({
              address: singleAddress as `0x${string}`,
              abi: erc20Abi,
              functionName: "decimals",
            }),
            client.readContract({
              address: singleAddress as `0x${string}`,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [dropContract],
            }),
          ]);

          return NextResponse.json({
            address: singleAddress,
            symbol: String(symbol),
            decimals: Number(decimals),
            balance: balance.toString(),
            formattedBalance: formatRaw(balance.toString(), Number(decimals)),
          });
        } catch {
          return NextResponse.json({ error: "Invalid token or not ERC20" }, { status: 400 });
        }
      }

      // Query standard and historical tokens
      const { data: campaignTokens } = await admin
        .from("drop_campaigns")
        .select("token_address, token_symbol, decimals")
        .limit(200);

      const tokensToQuery = new Set<string>();
      tokensToQuery.add("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"); // USDC

      if (campaignTokens) {
        for (const t of campaignTokens) {
          if (t.token_address && ADDR_RE.test(t.token_address)) {
            tokensToQuery.add(t.token_address.toLowerCase());
          }
        }
      }

      const tokenBalances = [];
      for (const address of tokensToQuery) {
        try {
          const [symbol, decimals, balance] = await Promise.all([
            client.readContract({
              address: address as `0x${string}`,
              abi: erc20Abi,
              functionName: "symbol",
            }).catch(() => null),
            client.readContract({
              address: address as `0x${string}`,
              abi: erc20Abi,
              functionName: "decimals",
            }).catch(() => null),
            client.readContract({
              address: address as `0x${string}`,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [dropContract],
            }).catch(() => BigInt(0)),
          ]);

          if (symbol !== null && decimals !== null) {
            tokenBalances.push({
              address,
              symbol: String(symbol),
              decimals: Number(decimals),
              balance: balance.toString(),
              formattedBalance: formatRaw(balance.toString(), Number(decimals)),
            });
          }
        } catch (err) {
          console.error(`Failed to query token ${address}:`, err);
        }
      }

      return NextResponse.json({ tokens: tokenBalances });
    }

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

    const minPoints = Math.max(0, Math.floor(Number(body?.minPoints ?? body?.min_points ?? 3000)));
    const minTransactions = Math.max(0, Math.floor(Number(body?.minTransactions ?? body?.min_transactions ?? 10)));
    const minCheckins = Math.max(0, Math.floor(Number(body?.minCheckins ?? body?.min_checkins ?? 0)));
    const preview = !!body?.preview;

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
      .select("wallet,points,games_played,total_checkins")
      .gte("points", minPoints)
      .limit(100000);

    if (stats.error) {
      return NextResponse.json({ error: stats.error.message }, { status: 500 });
    }

    const rows = (stats.data ?? [])
      .map((row) => {
        const points = BigInt(Math.max(0, Math.floor(Number(row.points ?? 0))));
        const gamesPlayed = Math.max(0, Math.floor(Number(row.games_played ?? 0)));
        const totalCheckins = Math.max(0, Math.floor(Number(row.total_checkins ?? 0)));
        const transactions = gamesPlayed + totalCheckins;
        return {
          wallet: String(row.wallet).toLowerCase(),
          points,
          gamesPlayed,
          totalCheckins,
          transactions,
        };
      })
      .filter(
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

function parseBigInt(value: unknown) {
  const raw = String(value ?? "0").trim();
  if (!/^\d+$/.test(raw)) return BigInt(0);
  return BigInt(raw);
}
