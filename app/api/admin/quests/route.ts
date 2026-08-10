import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, requireAdminSession } from "../../../lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUEST_FIELDS = "quest_key,kind,target_url,app_url,points,title_en,title_ru,subtitle_en,subtitle_ru,action_en,action_ru,starts_at,ends_at,enabled,created_at";

export async function GET() {
  try {
    await requireAdminSession();
    const { data, error } = await adminSupabase()
      .from("external_quest_campaigns")
      .select(QUEST_FIELDS)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ quests: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminSession();
    const body = await req.json().catch(() => null);
    const quest = normalizeQuest(body);
    const { data, error } = await adminSupabase()
      .from("external_quest_campaigns")
      .insert(quest)
      .select(QUEST_FIELDS)
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ quest: data });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdminSession();
    const body = await req.json().catch(() => null);
    const questKey = String(body?.questKey ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(questKey)) throw new Error("Invalid quest key");
    const { data, error } = await adminSupabase()
      .from("external_quest_campaigns")
      .update({ enabled: Boolean(body?.enabled), updated_at: new Date().toISOString() })
      .eq("quest_key", questKey)
      .select(QUEST_FIELDS)
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ quest: data });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 400 });
  }
}

function normalizeQuest(body: Record<string, unknown> | null) {
  const questKey = String(body?.questKey ?? "").trim().toLowerCase();
  const kind = String(body?.kind ?? "baseApp");
  const targetUrl = String(body?.targetUrl ?? "").trim();
  const points = Number(body?.points);
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(questKey)) throw new Error("Quest key: only lowercase letters, numbers and hyphens");
  if (!["baseApp", "twitter", "telegram"].includes(kind)) throw new Error("Invalid quest type");
  if (!/^https:\/\//i.test(targetUrl)) throw new Error("Target URL must start with https://");
  if (!Number.isInteger(points) || points < 1 || points > 1_000_000) throw new Error("Points must be between 1 and 1,000,000");
  const titleRu = String(body?.titleRu ?? "").trim();
  const titleEn = String(body?.titleEn ?? titleRu).trim();
  if (!titleRu || !titleEn) throw new Error("Quest title is required");
  const startsAt = dateOrNull(body?.startsAt);
  const endsAt = dateOrNull(body?.endsAt);
  if (startsAt && endsAt && new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
    throw new Error("Quest end must be after its start");
  }
  return {
    quest_key: questKey, kind, target_url: targetUrl,
    app_url: nullable(body?.appUrl), points,
    title_en: titleEn, title_ru: titleRu,
    subtitle_en: String(body?.subtitleEn ?? "").trim(), subtitle_ru: String(body?.subtitleRu ?? "").trim(),
    action_en: String(body?.actionEn ?? "Open").trim() || "Open",
    action_ru: String(body?.actionRu ?? "Открыть").trim() || "Открыть",
    starts_at: startsAt, ends_at: endsAt, enabled: true,
  };
}

function nullable(value: unknown) { const text = String(value ?? "").trim(); return text || null; }
function dateOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid quest date");
  return date.toISOString();
}
function message(err: unknown) {
  const raw = err instanceof Error ? err.message : "Quest request failed";
  return /external_quest_campaigns|schema cache|does not exist/i.test(raw)
    ? "Quest database is not installed. Run scripts/supabase-admin-external-quests.sql in Supabase."
    : raw;
}
