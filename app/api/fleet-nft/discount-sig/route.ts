import { NextRequest, NextResponse } from "next/server";
import { isBaseAppUserAgent } from "../../../lib/baseApp";
import { keccak256, encodePacked, hashMessage } from "viem";
import { secp256k1 } from "@noble/curves/secp256k1";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ error: "Wallet required" }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent") || "";
  if (!isBaseAppUserAgent(userAgent)) {
    return NextResponse.json({ error: "Not eligible for discount. Please use Base App." }, { status: 403 });
  }

  const action = req.nextUrl.searchParams.get("action");
  let signAction = "discount_buy";
  if (action === "upgradeWithDiscount") signAction = "discount_upgrade";
  if (action === "maxWithDiscount") signAction = "discount_max_upgrade";

  const pk = process.env.DISCOUNT_SIGNER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) {
    return NextResponse.json({ error: "Signer not configured" }, { status: 500 });
  }

  try {
    const rawPk = (pk.startsWith("0x") ? pk.slice(2) : pk).trim();
    const privKeyBytes = Buffer.from(rawPk, "hex");

    const messageHash = keccak256(
      encodePacked(["address", "string"], [wallet as `0x${string}`, signAction])
    );
    const ethHash = hashMessage({ raw: messageHash });

    const extraEntropy = crypto.randomBytes(32);
    const sigObj = secp256k1.sign(ethHash.slice(2), privKeyBytes, { extraEntropy });
    
    const r = sigObj.r.toString(16).padStart(64, "0");
    const s = sigObj.s.toString(16).padStart(64, "0");
    const v = sigObj.recovery === 0 ? "1b" : "1c";
    const signature = `0x${r}${s}${v}` as `0x${string}`;

    return NextResponse.json({ signature });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to generate signature" }, { status: 500 });
  }
}
