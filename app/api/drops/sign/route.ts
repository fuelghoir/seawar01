import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { adminSupabase } from "../../../lib/adminSupabase";
import { supabase } from "../../../lib/supabase";
import { DROP_CLAIM_CONTRACT_ADDRESS } from "../../../contracts/dropClaimAbi";

const WALLET_RE = /^0x[a-f0-9]{40}$/;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const USDC_ADDR = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SIGNATURE_TTL_SECONDS = 10 * 60;

type Campaign = {
  id: string;
  token_address: string;
  status: string;
  contract_address?: string | null;
};

type ClaimCandidate = {
  token: `0x${string}`;
  amount: bigint;
  contractAddress: `0x${string}`;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = String(body?.wallet ?? "").trim().toLowerCase();
  const dropId = String(body?.dropId ?? body?.drop_id ?? "").trim();

  if (!WALLET_RE.test(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }
  if (!dropId) {
    return NextResponse.json({ error: "Invalid drop id" }, { status: 400 });
  }

  const key = signerPrivateKey();
  if (!key) {
    return NextResponse.json({ error: "DROP_CLAIM_SIGNER_PRIVATE_KEY is not configured" }, { status: 500 });
  }

  let account: ReturnType<typeof privateKeyToAccount>;
  try {
    account = parseSignerAccount(key);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid drop signer key" },
      { status: 500 },
    );
  }

  const candidate = await getClaimCandidate(dropId, wallet);
  if ("error" in candidate) {
    return NextResponse.json({ error: candidate.error }, { status: candidate.status });
  }

  const { token, amount, contractAddress } = candidate;
  if (amount <= BigInt(0)) {
    return NextResponse.json({ error: "Allocation is zero" }, { status: 400 });
  }

  const client = createPublicClient({
    chain: base,
    transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
  });
  const onchainSigner = await client.readContract({
    address: contractAddress,
    abi: [
      {
        type: "function",
        name: "signer",
        inputs: [],
        outputs: [{ type: "address", name: "" }],
        stateMutability: "view",
      },
    ],
    functionName: "signer",
  });

  if (String(onchainSigner).toLowerCase() !== account.address.toLowerCase()) {
    return NextResponse.json({ error: "Drop signer key does not match contract signer" }, { status: 500 });
  }

  const dropIdBytes32 = dropIdToBytes32(dropId);
  const alreadyClaimed = await client.readContract({
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
    args: [dropIdBytes32, wallet as `0x${string}`],
  });

  if (alreadyClaimed) {
    await markClaimedInDb(dropId, wallet);
    return NextResponse.json({ error: "Already claimed" }, { status: 409 });
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_TTL_SECONDS);
  const signature = await account.signTypedData({
    domain: {
      name: "Sea Battle Drop Claim",
      version: "1",
      chainId: base.id,
      verifyingContract: contractAddress,
    },
    types: {
      Claim: [
        { name: "dropId", type: "bytes32" },
        { name: "token", type: "address" },
        { name: "account", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Claim",
    message: {
      dropId: dropIdBytes32,
      token,
      account: wallet as `0x${string}`,
      amount,
      deadline,
    },
  });

  return NextResponse.json({
    dropId,
    dropIdBytes32,
    token,
    amount: amount.toString(),
    deadline: deadline.toString(),
    signature,
    contractAddress,
  });
}

async function getClaimCandidate(
  dropId: string,
  wallet: string,
): Promise<ClaimCandidate | { error: string; status: number }> {
  const allocation = await supabase
    .from("drop_allocations")
    .select("drop_id,wallet,amount_raw,claimed_at,drop_campaigns(id,token_address,status,contract_address)")
    .eq("drop_id", dropId)
    .eq("wallet", wallet)
    .maybeSingle();

  if (allocation.error) {
    return { error: allocation.error.message, status: 500 };
  }
  if (allocation.data) {
    if (allocation.data.claimed_at) {
      return { error: "Already claimed", status: 409 };
    }

    const campaign = (Array.isArray(allocation.data.drop_campaigns)
      ? allocation.data.drop_campaigns[0]
      : allocation.data.drop_campaigns) as Campaign | null;
    if (!campaign || campaign.status !== "active") {
      return { error: "Drop is not active", status: 403 };
    }

    const contractAddress = normalizeContractAddress(campaign.contract_address);
    if (!contractAddress) {
      return { error: "Drop claim contract is not configured", status: 500 };
    }

    return {
      token: campaign.token_address as `0x${string}`,
      amount: BigInt(String(allocation.data.amount_raw ?? "0")),
      contractAddress,
    };
  }

  const creatorRewardId = parseCreatorRewardDropId(dropId);
  if (creatorRewardId === null) {
    return { error: "No allocation for this wallet", status: 404 };
  }

  const reward = await supabase
    .from("creator_rewards")
    .select("id,wallet,reward_kind,status,amount_raw,token_address")
    .eq("id", creatorRewardId)
    .eq("wallet", wallet)
    .maybeSingle();
  if (reward.error) {
    return { error: reward.error.message, status: 500 };
  }
  if (!reward.data) {
    return { error: "No creator reward for this wallet", status: 404 };
  }
  if (reward.data.status !== "claimable") {
    return { error: "Creator reward is not claimable", status: 403 };
  }

  const contractAddress = normalizeContractAddress(null);
  if (!contractAddress) {
    return { error: "Drop claim contract is not configured", status: 500 };
  }

  return {
    token: tokenForCreatorReward(reward.data.reward_kind, reward.data.token_address),
    amount: BigInt(String(reward.data.amount_raw ?? "0")),
    contractAddress,
  };
}

function signerPrivateKey() {
  return process.env.DROP_CLAIM_SIGNER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || "";
}

function parseSignerAccount(key: string) {
  const trimmed = key.trim();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("DROP_CLAIM_SIGNER_PRIVATE_KEY is invalid");
  }
  return privateKeyToAccount(`0x${hex}` as `0x${string}`);
}

function dropIdToBytes32(dropId: string): `0x${string}` {
  if (/^0x[0-9a-fA-F]{64}$/.test(dropId)) return dropId as `0x${string}`;
  return keccak256(toBytes(dropId));
}

function normalizeContractAddress(value: string | null | undefined): `0x${string}` | null {
  const configured = String(value || "").trim().toLowerCase();
  if (configured && configured !== ZERO_ADDR) return configured as `0x${string}`;

  const fallback = String(
    process.env.NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS ||
      DROP_CLAIM_CONTRACT_ADDRESS ||
      ZERO_ADDR,
  ).toLowerCase();
  return fallback === ZERO_ADDR ? null : (fallback as `0x${string}`);
}

function parseCreatorRewardDropId(dropId: string) {
  const match = /^creator-reward-(\d+)$/.exec(dropId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function tokenForCreatorReward(kind: string, tokenAddress: string | null | undefined): `0x${string}` {
  const normalized = tokenAddress?.toLowerCase();
  if (normalized && /^0x[a-f0-9]{40}$/.test(normalized)) {
    return normalized as `0x${string}`;
  }
  if (kind === "usdc") return USDC_ADDR as `0x${string}`;
  return ZERO_ADDR as `0x${string}`;
}

async function markClaimedInDb(dropId: string, wallet: string) {
  const db = adminSupabaseOrAnon();
  const creatorRewardId = parseCreatorRewardDropId(dropId);
  if (creatorRewardId !== null) {
    await db
      .from("creator_rewards")
      .update({ status: "paid" })
      .eq("id", creatorRewardId)
      .eq("wallet", wallet);
    return;
  }

  await db
    .from("drop_allocations")
    .update({ claimed_at: new Date().toISOString() })
    .eq("drop_id", dropId)
    .eq("wallet", wallet);
}

function adminSupabaseOrAnon() {
  const admin = adminSupabase();
  return admin ? admin : supabase;
}
