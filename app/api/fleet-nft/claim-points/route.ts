import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../../lib/adminSupabase";
import { createPublicClient, decodeEventLog, fallback, http, isAddress, isHash } from "viem";
import { base } from "viem/chains";
import {
  FLEET_NFT_CONTRACT_ADDRESS,
  fleetPassAbi,
} from "../../../contracts/fleetPassAbi";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const BASE_RPCS = [
  process.env.NEXT_PUBLIC_BASE_RPC_URL,
  "https://base-rpc.publicnode.com",
  "https://base.meowrpc.com",
  "https://base.drpc.org",
  "https://mainnet.base.org",
].filter(Boolean) as string[];

const publicClient = createPublicClient({
  chain: base,
  transport: fallback(
    BASE_RPCS.map((url) => http(url, { retryCount: 0, timeout: 3_000 })),
    { retryCount: 0 },
  ),
});

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getConfirmedReceipt(hash: `0x${string}`) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
    if (receipt) return receipt;
    await wait(500);
  }
  return null;
}



export async function POST(req: NextRequest) {
  if (FLEET_NFT_CONTRACT_ADDRESS === ZERO_ADDR) {
    return NextResponse.json({ error: "Fleet NFT contract is not deployed" }, { status: 500 });
  }

  const admin = adminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for NFT point claims" },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => null);
  const wallet = String(body?.wallet ?? "").trim().toLowerCase();
  const txHash = String(body?.txHash ?? body?.tx_hash ?? "").trim().toLowerCase();
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }
  if (!isHash(txHash)) {
    return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
  }

  const receipt = await getConfirmedReceipt(txHash as `0x${string}`);
  if (!receipt || receipt.status !== "success") {
    return NextResponse.json({ error: "Claim transaction is not confirmed" }, { status: 409 });
  }

  let claim: { tokenId: bigint; points: bigint } | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== FLEET_NFT_CONTRACT_ADDRESS.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: fleetPassAbi,
        data: log.data,
        topics: log.topics,
      });
      if (
        decoded.eventName === "PassivePointsClaimed" &&
        decoded.args.player.toLowerCase() === wallet
      ) {
        claim = {
          tokenId: decoded.args.tokenId,
          points: decoded.args.points,
        };
        break;
      }
    } catch {
      // Ignore unrelated contract logs.
    }
  }

  if (!claim || claim.points <= BigInt(0)) {
    return NextResponse.json({ error: "PassivePointsClaimed event not found" }, { status: 400 });
  }

  const { data, error } = await admin.rpc("grant_fleet_nft_points", {
    p_wallet: wallet,
    p_tx_hash: txHash,
    p_token_id: claim.tokenId.toString(),
    p_points: claim.points.toString(),
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    points: Number(data ?? 0),
    tokenId: claim.tokenId.toString(),
  });
}
