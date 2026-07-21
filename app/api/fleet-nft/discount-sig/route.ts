import { NextRequest, NextResponse } from "next/server";
import { isBaseAppUserAgent } from "../../../lib/baseApp";
import { keccak256, encodePacked } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ error: "Wallet required" }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent") || "";
  if (!isBaseAppUserAgent(userAgent)) {
    return NextResponse.json({ error: "Not eligible for discount. Please use Base App." }, { status: 403 });
  }

  const pk = process.env.DISCOUNT_SIGNER_PRIVATE_KEY;
  if (!pk) {
    return NextResponse.json({ error: "Signer not configured" }, { status: 500 });
  }

  try {
    const account = privateKeyToAccount(pk as `0x${string}`);
    const messageHash = keccak256(
      encodePacked(["address", "string"], [wallet as `0x${string}`, "DISCOUNT"])
    );
    const signature = await account.signMessage({ message: { raw: messageHash } });

    return NextResponse.json({ signature });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to generate signature" }, { status: 500 });
  }
}
