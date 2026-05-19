import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { captainSbtAbi, CAPTAIN_SBT_CONTRACT_ADDRESS } from "../../../contracts/seaBattleAbi";
import { supabase } from "../../../lib/supabase";
import { LIMITED_SBT_REQUIRED_WINS } from "../../../lib/limitedSbt";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const SIGNATURE_TTL_SECONDS = 10 * 60;

function signerPrivateKey() {
  return process.env.CAPTAIN_SBT_SIGNER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || "";
}

export async function POST(req: NextRequest) {
  if (CAPTAIN_SBT_CONTRACT_ADDRESS === ZERO_ADDR) {
    return NextResponse.json({ error: "Captain SBT contract is not deployed" }, { status: 500 });
  }

  const key = signerPrivateKey();
  if (!key) {
    return NextResponse.json({ error: "Captain SBT signer key is not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const wallet = String(body?.wallet ?? "").toLowerCase();
  const nonceRaw = body?.nonce;

  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  let nonce: bigint;
  try {
    nonce = BigInt(nonceRaw);
  } catch {
    return NextResponse.json({ error: "Invalid nonce" }, { status: 400 });
  }

  const { data: stats, error: statsError } = await supabase
    .from("player_stats")
    .select("wins")
    .eq("wallet", wallet)
    .maybeSingle();

  if (statsError) {
    return NextResponse.json({ error: statsError.message }, { status: 500 });
  }

  const wins = Number(stats?.wins ?? 0);
  if (wins < LIMITED_SBT_REQUIRED_WINS) {
    return NextResponse.json(
      { error: `Need ${LIMITED_SBT_REQUIRED_WINS} wins`, wins },
      { status: 403 }
    );
  }

  const client = createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL) });

  const [chainNonce, balance, totalSupply] = await Promise.all([
    client.readContract({
      address: CAPTAIN_SBT_CONTRACT_ADDRESS,
      abi: captainSbtAbi,
      functionName: "nonces",
      args: [wallet],
    }),
    client.readContract({
      address: CAPTAIN_SBT_CONTRACT_ADDRESS,
      abi: captainSbtAbi,
      functionName: "balanceOf",
      args: [wallet],
    }),
    client.readContract({
      address: CAPTAIN_SBT_CONTRACT_ADDRESS,
      abi: captainSbtAbi,
      functionName: "totalSupply",
    }),
  ]);

  if (BigInt(chainNonce) !== nonce) {
    return NextResponse.json({ error: "Nonce changed", nonce: chainNonce.toString() }, { status: 409 });
  }

  if (BigInt(balance) > BigInt(0)) {
    return NextResponse.json({ error: "Already minted" }, { status: 409 });
  }

  if (BigInt(totalSupply) >= BigInt(20)) {
    return NextResponse.json({ error: "All 20 SBTs have been claimed" }, { status: 409 });
  }

  const account = privateKeyToAccount(key.startsWith("0x") ? key as `0x${string}` : `0x${key}` as `0x${string}`);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_TTL_SECONDS);

  const signature = await account.signTypedData({
    domain: {
      name: "Sea Battle Captain SBT",
      version: "1",
      chainId: base.id,
      verifyingContract: CAPTAIN_SBT_CONTRACT_ADDRESS,
    },
    types: {
      Mint: [
        { name: "to", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Mint",
    message: {
      to: wallet,
      nonce,
      deadline,
    },
  });

  return NextResponse.json({
    signature,
    deadline: deadline.toString(),
    wins,
  });
}
