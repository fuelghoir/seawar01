import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../../lib/adminSupabase";
import { claimUserQuestServer, rerollUserQuestServer } from "../../../lib/questServer";
import { normalizeSeasonWallet } from "../../../lib/seasonServer";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = normalizeSeasonWallet(body?.wallet);
  if (!wallet) return badRequest("Invalid wallet");

  const admin = adminSupabase();

  try {
    switch (body?.action) {
      case "claimUserQuest":
        return NextResponse.json(await claimUserQuestServer(admin, wallet, body?.questId));
      case "rerollUserQuest":
        return NextResponse.json(await rerollUserQuestServer(admin, wallet, body?.questId));
      default:
        throw new Error("Unknown quest action");
    }
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Quest action failed");
  }
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}
