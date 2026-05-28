import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, requireAdminSession } from "../../../../../lib/adminAuth";

export const runtime = "nodejs";

const STATUSES = new Set(["pending", "approved", "rejected", "rewarded"]);

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const session = await requireAdminSession();
    const { id } = await params;
    const submissionId = Number(id);
    const body = await req.json().catch(() => null);
    const status = String(body?.status ?? "");
    const adminNote = String(body?.adminNote ?? body?.admin_note ?? "").slice(0, 1200);

    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return NextResponse.json({ error: "Invalid submission id" }, { status: 400 });
    }
    if (!STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const admin = adminSupabase();
    const { data, error } = await admin
      .from("creator_submissions")
      .update({
        status,
        admin_note: adminNote || null,
        reviewed_by: session.address,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", submissionId)
      .select("id,wallet,url,status,admin_note,reviewed_by,reviewed_at,created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ submission: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Admin request failed" },
      { status: 401 },
    );
  }
}
