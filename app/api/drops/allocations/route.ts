import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http, keccak256, toBytes } from "viem";
import { base } from "viem/chains";
import { supabase } from "../../../lib/supabase";
import { DROP_CLAIM_CONTRACT_ADDRESS } from "../../../contracts/dropClaimAbi";

const WALLET_RE = /^0x[a-f0-9]{40}$/;

export async function GET(req: NextRequest) {
  const wallet = String(req.nextUrl.searchParams.get("wallet") ?? "").trim().toLowerCase();
  if (!WALLET_RE.test(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const [allocations, creatorRewards] = await Promise.all([
    supabase
      .from("drop_allocations")
      .select("drop_id,wallet,points,amount_raw,claimed_at,claim_tx_hash,drop_campaigns(id,title,token_address,token_symbol,decimals,status,contract_address)")
      .eq("wallet", wallet)
      .order("created_at", { ascending: false }),
    supabase
      .from("creator_rewards")
      .select("id,wallet,reward_kind,amount_raw,token_address,reward_label,status,tx_hash,created_at")
      .eq("wallet", wallet)
      .eq("status", "claimable")
      .order("created_at", { ascending: false }),
  ]);

  if (allocations.error) {
    return NextResponse.json({ error: allocations.error.message }, { status: 500 });
  }
  if (creatorRewards.error) {
    return NextResponse.json({ error: creatorRewards.error.message }, { status: 500 });
  }

  const activeAllocations = (allocations.data ?? []).filter((row) => {
    const campaign = Array.isArray(row.drop_campaigns)
      ? row.drop_campaigns[0]
      : row.drop_campaigns;
    return campaign?.status === "active";
  });
  const activeCreatorRewards = await filterUnclaimedCreatorRewards(wallet, creatorRewards.data ?? []);

  return NextResponse.json({
    allocations: [
      ...activeAllocations,
      ...activeCreatorRewards.map((reward) => ({
        source: "creator_reward",
        reward_id: reward.id,
        drop_id: `creator-reward-${reward.id}`,
        wallet,
        points: 0,
        amount_raw: reward.amount_raw ?? "0",
        claimed_at: null,
        claim_tx_hash: reward.tx_hash,
        drop_campaigns: {
          id: `creator-reward-${reward.id}`,
          title: reward.reward_label || "Creator reward",
          token_address: reward.token_address || defaultTokenForKind(reward.reward_kind),
          token_symbol: symbolForKind(reward.reward_kind),
          decimals: decimalsForKind(reward.reward_kind),
          status: "active",
          contract_address: resolveDropClaimContract(),
        },
      })),
    ],
  });
}

async function filterUnclaimedCreatorRewards(
  wallet: string,
  rewards: Array<{
    id: number;
    reward_kind: string;
    amount_raw?: string | null;
    token_address?: string | null;
    reward_label?: string | null;
    status: string;
    tx_hash?: string | null;
  }>,
) {
  const contractAddress = resolveDropClaimContract();
  if (!contractAddress || rewards.length === 0) return rewards;

  const client = createPublicClient({
    chain: base,
    transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
  });
  const visible = [];
  for (const reward of rewards) {
    const dropId = `creator-reward-${reward.id}`;
    const claimed = await client
      .readContract({
        address: contractAddress as `0x${string}`,
        abi: [
          {
            type: "function",
            name: "claimed",
            inputs: [
              { type: "bytes32", name: "" },
              { type: "address", name: "" },
            ],
            outputs: [{ type: "bool", name: "" }],
            stateMutability: "view",
          },
        ],
        functionName: "claimed",
        args: [dropIdToBytes32(dropId), wallet as `0x${string}`],
      })
      .catch(() => false);

    if (claimed) {
      await adminSupabaseOrAnon()
        .from("creator_rewards")
        .update({ status: "paid" })
        .eq("id", reward.id)
        .eq("wallet", wallet);
      continue;
    }
    visible.push(reward);
  }
  return visible;
}

function defaultTokenForKind(kind: string) {
  if (kind === "usdc") return "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  if (kind === "base") return "0x0000000000000000000000000000000000000000";
  return "0x0000000000000000000000000000000000000000";
}

function symbolForKind(kind: string) {
  if (kind === "usdc") return "USDC";
  if (kind === "base") return "BASE";
  return "TOKEN";
}

function decimalsForKind(kind: string) {
  return kind === "usdc" ? 6 : 18;
}

function resolveDropClaimContract() {
  const address = String(
    process.env.NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS ||
      DROP_CLAIM_CONTRACT_ADDRESS ||
      "",
  ).trim();
  return address || null;
}

function dropIdToBytes32(dropId: string): `0x${string}` {
  if (/^0x[0-9a-fA-F]{64}$/.test(dropId)) return dropId as `0x${string}`;
  return keccak256(toBytes(dropId));
}

function adminSupabaseOrAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) return createClient(url, serviceKey);
  return supabase;
}
