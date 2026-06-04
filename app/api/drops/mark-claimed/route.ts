import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, keccak256, toBytes } from "viem";
import { base } from "viem/chains";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { DROP_CLAIM_CONTRACT_ADDRESS } from "../../../contracts/dropClaimAbi";

const WALLET_RE = /^0x[a-f0-9]{40}$/;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = String(body?.wallet ?? "").trim().toLowerCase();
  const dropId = String(body?.dropId ?? body?.drop_id ?? "").trim();
  const txHash = String(body?.txHash ?? body?.tx_hash ?? "").trim().toLowerCase();

  if (!WALLET_RE.test(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }
  if (!dropId) {
    return NextResponse.json({ error: "Invalid drop id" }, { status: 400 });
  }

  const creatorRewardId = parseCreatorRewardDropId(dropId);
  const campaignResult = creatorRewardId === null
    ? await supabase
        .from("drop_campaigns")
        .select("contract_address")
        .eq("id", dropId)
        .maybeSingle()
    : null;

  if (campaignResult?.error) {
    return NextResponse.json({ error: campaignResult.error.message }, { status: 500 });
  }

  const contractAddress = resolveDropClaimContract(campaignResult?.data?.contract_address);
  if (!contractAddress) {
    return NextResponse.json({ error: "Drop claim contract is not configured" }, { status: 500 });
  }

  const client = createPublicClient({
    chain: base,
    transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
  });

  const didClaim = await client.readContract({
    address: contractAddress,
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
  });

  if (!didClaim) {
    return NextResponse.json({ error: "Claim not found on-chain yet" }, { status: 409 });
  }

  const db = adminSupabaseOrAnon();
  const update = creatorRewardId === null
    ? await db
        .from("drop_allocations")
        .update({
          claimed_at: new Date().toISOString(),
          claim_tx_hash: txHash || null,
        })
        .eq("drop_id", dropId)
        .eq("wallet", wallet)
    : await db
        .from("creator_rewards")
        .update({
          status: "paid",
          tx_hash: txHash || null,
        })
        .eq("id", creatorRewardId)
        .eq("wallet", wallet);

  if (update.error) {
    return NextResponse.json({ error: update.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function dropIdToBytes32(dropId: string): `0x${string}` {
  if (/^0x[0-9a-fA-F]{64}$/.test(dropId)) return dropId as `0x${string}`;
  return keccak256(toBytes(dropId));
}

function parseCreatorRewardDropId(dropId: string) {
  const match = /^creator-reward-(\d+)$/.exec(dropId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function resolveDropClaimContract(value: string | null | undefined): `0x${string}` | null {
  const configured = String(value || "").trim().toLowerCase();
  if (configured && configured !== ZERO_ADDR) return configured as `0x${string}`;

  const fallback = String(
    process.env.NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS ||
      DROP_CLAIM_CONTRACT_ADDRESS ||
      ZERO_ADDR,
  ).toLowerCase();
  return fallback === ZERO_ADDR ? null : (fallback as `0x${string}`);
}

function adminSupabaseOrAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) return createClient(url, serviceKey);
  return supabase;
}
