import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { wallet, subscription } = await req.json();
    if (!wallet || !subscription) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        wallet: (wallet as string).toLowerCase(),
        subscription,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet" }
    );

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
