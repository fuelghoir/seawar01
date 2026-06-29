import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../../lib/adminSupabase";
import {
  activateDoublePointsServer,
  buyPointItemServer,
  claimSeasonLevelsServer,
  consumeItemServer,
  grantPaidQuestRerollServer,
  normalizeSeasonItemSlug,
  normalizeSeasonTxHash,
  normalizeSeasonWallet,
} from "../../../lib/seasonServer";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = normalizeSeasonWallet(body?.wallet);
  if (!wallet) return badRequest("Invalid wallet");

  const admin = adminSupabase();

  try {
    switch (body?.action) {
      case "buyPointItem": {
        const slug = normalizeSeasonItemSlug(body?.slug);
        if (!slug) throw new Error("Invalid item");
        await buyPointItemServer(admin, wallet, slug, Number(body?.quantity ?? 1));
        return NextResponse.json({ ok: true });
      }
      case "grantPaidQuestReroll": {
        const txHash = normalizeSeasonTxHash(body?.txHash);
        if (!txHash) throw new Error("Invalid transaction hash");
        await grantPaidQuestRerollServer(admin, wallet, txHash, Number(body?.quantity ?? 1));
        return NextResponse.json({ ok: true });
      }
      case "activateDoublePoints": {
        const activeUntil = await activateDoublePointsServer(admin, wallet);
        return NextResponse.json({ activeUntil });
      }
      case "consumeItem": {
        const slug = normalizeSeasonItemSlug(body?.slug);
        if (!slug) throw new Error("Invalid item");
        await consumeItemServer(admin, wallet, slug, Number(body?.quantity ?? 1));
        return NextResponse.json({ ok: true });
      }
      case "claimSeasonLevels": {
        const rewards = await claimSeasonLevelsServer(admin, wallet, body?.levels);
        return NextResponse.json({ rewards });
      }
      default:
        throw new Error("Unknown season action");
    }
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Season action failed");
  }
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}
