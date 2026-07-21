import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, keccak256, encodePacked } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { fleetPassAbi } from "../../../contracts/fleetPassAbi";

const V1_ADDRESS = "0xe8ea934c519917832bff6fb82e96c95463497053";

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "Wallet required" }, { status: 400 });

  const pk = process.env.DISCOUNT_SIGNER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) return NextResponse.json({ error: "Signer not configured" }, { status: 500 });

  try {
    const publicClient = createPublicClient({
      chain: base,
      transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org"),
    });

    const v1State = await publicClient.readContract({
      address: V1_ADDRESS,
      abi: fleetPassAbi,
      functionName: "fleetStateOf",
      args: [wallet as `0x${string}`],
    }) as readonly unknown[];

    const tokenId = Number(v1State[0]);
    const tier = Number(v1State[1]);
    const level = Number(v1State[2]);

    if (tokenId === 0) {
      return NextResponse.json({ error: "No V1 miner found" }, { status: 400 });
    }

    const account = privateKeyToAccount(pk as `0x${string}`);
    const messageHash = keccak256(
      encodePacked(["address", "uint8", "uint8", "string"], [wallet as `0x${string}`, tier, level, "MIGRATE"])
    );
    const signature = await account.signMessage({ message: { raw: messageHash } });

    return NextResponse.json({ signature, tier, level });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to generate signature" }, { status: 500 });
  }
}
