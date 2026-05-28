import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import {
  buildAdminLoginMessage,
  isAdminWallet,
  normalizeAdminWallet,
  setAdminSession,
} from "../../../lib/adminAuth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const wallet = normalizeAdminWallet(req.nextUrl.searchParams.get("wallet"));
  if (!wallet || !isAdminWallet(wallet)) {
    return NextResponse.json({ error: "Wallet is not allowed" }, { status: 403 });
  }

  return NextResponse.json({ message: buildAdminLoginMessage(wallet) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = normalizeAdminWallet(body?.wallet);
  const signature = String(body?.signature ?? "");
  const message = String(body?.message ?? "");

  if (!wallet || !isAdminWallet(wallet)) {
    return NextResponse.json({ error: "Wallet is not allowed" }, { status: 403 });
  }
  if (message !== buildAdminLoginMessage(wallet)) {
    return NextResponse.json({ error: "Login message expired" }, { status: 400 });
  }

  const valid = await verifyMessage({
    address: wallet as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  }).catch(() => false);

  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  await setAdminSession(wallet);
  return NextResponse.json({ address: wallet });
}
