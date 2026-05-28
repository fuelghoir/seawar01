import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, requireAdminSession } from "../../../../lib/adminAuth";

export const runtime = "nodejs";

const ADDR_RE = /^0x[a-f0-9]{40}$/;
const STATUSES = new Set(["draft", "active", "closed", "cancelled"]);

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    await requireAdminSession();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const status = String(body?.status ?? "").trim();
    const contractAddress = String(body?.contractAddress ?? body?.contract_address ?? "").trim().toLowerCase();
    const signerAddress = String(body?.signerAddress ?? body?.signer_address ?? "").trim().toLowerCase();

    const patch: Record<string, string | null> = {};
    if (status) {
      if (!STATUSES.has(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      patch.status = status;
    }
    if (contractAddress) {
      if (!ADDR_RE.test(contractAddress)) {
        return NextResponse.json({ error: "Invalid contract address" }, { status: 400 });
      }
      patch.contract_address = contractAddress;
    }
    if (signerAddress) {
      if (!ADDR_RE.test(signerAddress)) {
        return NextResponse.json({ error: "Invalid signer address" }, { status: 400 });
      }
      patch.signer_address = signerAddress;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const admin = adminSupabase();
    const { data, error } = await admin
      .from("drop_campaigns")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ campaign: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Admin request failed" },
      { status: 401 },
    );
  }
}
