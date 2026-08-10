import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, type AdminClient } from "../../lib/adminSupabase";
import {
  ONBOARDING_STEPS,
  ONBOARDING_TOUR_VERSION,
  type OnboardingStep,
} from "../../lib/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const STEP_INDEX = new Map(ONBOARDING_STEPS.map((step, index) => [step, index]));
const ONBOARDING_ROLLOUT_AT = "2026-08-10T21:12:36.000Z";

type OnboardingRow = {
  wallet: string;
  tour_version: number;
  status: "pending" | "in_progress" | "completed" | "grandfathered";
  stage: OnboardingStep;
  language: "en" | "ru" | null;
  skipped_at: string | null;
  completed_at: string | null;
};

export async function GET(req: NextRequest) {
  const wallet = normalizeWallet(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) return badRequest("Invalid wallet");

  const admin = adminSupabase();
  try {
    const row = await ensureOnboardingRow(admin, wallet);
    const reconciled = await recoverFromExistingCheckin(admin, row);
    return json(toPayload(reconciled));
  } catch (error) {
    if (isMissingOnboardingTable(error)) {
      try {
        const legacy = await hasExistingActivity(admin, wallet);
        return json({
          required: !legacy,
          version: ONBOARDING_TOUR_VERSION,
          status: legacy ? "grandfathered" : "pending",
          step: legacy ? "complete" : "language",
          language: null,
          skippedGameplay: false,
          persistence: "local",
        });
      } catch (fallbackError) {
        return serverError(fallbackError);
      }
    }
    return serverError(error);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = normalizeWallet(body?.wallet);
  if (!wallet) return badRequest("Invalid wallet");

  const action = String(body?.action ?? "");
  const language = body?.language === "en" || body?.language === "ru"
    ? body.language
    : undefined;

  const admin = adminSupabase();
  try {
    const current = await ensureOnboardingRow(admin, wallet);
    if (current.status === "completed" || current.status === "grandfathered") {
      return json(toPayload(current));
    }

    if (action === "complete") {
      const { data: stats, error } = await admin
        .from("player_stats")
        .select("last_checkin")
        .eq("wallet", wallet)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!stats?.last_checkin) {
        return NextResponse.json(
          { error: "Complete the daily check-in first" },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }

      const updated = await updateRow(admin, wallet, {
        status: "completed",
        stage: "complete",
        completed_at: new Date().toISOString(),
      });
      return json(toPayload(updated));
    }

    if (action === "dismiss") {
      const updated = await updateRow(admin, wallet, {
        status: "completed",
        stage: "complete",
        skipped_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      return json(toPayload(updated));
    }

    if (action === "skip") {
      const updated = await updateRow(admin, wallet, {
        status: "in_progress",
        stage: "checkin",
        language: language ?? current.language,
        skipped_at: new Date().toISOString(),
      });
      return json(toPayload(updated));
    }

    if (action !== "progress") return badRequest("Unknown onboarding action");
    const step = normalizeStep(body?.step);
    if (!step || step === "complete") return badRequest("Invalid onboarding step");

    const currentIndex = STEP_INDEX.get(current.stage) ?? 0;
    const nextIndex = STEP_INDEX.get(step) ?? 0;
    if (nextIndex < currentIndex || nextIndex > currentIndex + 1) {
      return badRequest("Onboarding steps must be completed in order");
    }

    const savedLanguage = language ?? current.language;
    if (step !== "language" && !savedLanguage) {
      return badRequest("Choose a language first");
    }

    const updated = await updateRow(admin, wallet, {
      status: step === "language" ? "pending" : "in_progress",
      stage: step,
      language: savedLanguage,
      started_at: current.stage === "language" && step !== "language"
        ? new Date().toISOString()
        : undefined,
    });
    return json(toPayload(updated));
  } catch (error) {
    if (isMissingOnboardingTable(error)) {
      return localProgressFallback(admin, wallet, action, body?.step, language);
    }
    return serverError(error);
  }
}

async function localProgressFallback(
  admin: AdminClient,
  wallet: string,
  action: string,
  rawStep: unknown,
  language: "en" | "ru" | undefined,
) {
  const base = {
    version: ONBOARDING_TOUR_VERSION,
    language: language ?? null,
    skippedGameplay: false,
    persistence: "local" as const,
  };

  if (action === "complete") {
    const { data: stats, error } = await admin
      .from("player_stats")
      .select("last_checkin")
      .eq("wallet", wallet)
      .maybeSingle();
    if (error) return serverError(error);
    if (!stats?.last_checkin) {
      return NextResponse.json(
        { error: "Complete the daily check-in first" },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    return json({ ...base, required: false, status: "completed", step: "complete" });
  }

  if (action === "dismiss") {
    return json({ ...base, required: false, status: "completed", step: "complete", skippedGameplay: true });
  }

  if (action === "skip") {
    return json({ ...base, required: true, status: "in_progress", step: "checkin", skippedGameplay: true });
  }

  if (action !== "progress") return badRequest("Unknown onboarding action");
  const step = normalizeStep(rawStep);
  if (!step || step === "complete") return badRequest("Invalid onboarding step");
  if (step !== "language" && !language) return badRequest("Choose a language first");
  return json({
    ...base,
    required: true,
    status: step === "language" ? "pending" : "in_progress",
    step,
  });
}

async function ensureOnboardingRow(admin: AdminClient, wallet: string) {
  const { data, error } = await admin
    .from("player_onboarding")
    .select("wallet,tour_version,status,stage,language,skipped_at,completed_at")
    .eq("wallet", wallet)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as OnboardingRow;

  const isLegacyPlayer = await hasExistingActivity(admin, wallet);
  const now = new Date().toISOString();
  const row = {
    wallet,
    tour_version: ONBOARDING_TOUR_VERSION,
    status: isLegacyPlayer ? "grandfathered" : "pending",
    stage: isLegacyPlayer ? "complete" : "language",
    language: null,
    completed_at: isLegacyPlayer ? now : null,
    updated_at: now,
  };
  const { data: inserted, error: insertError } = await admin
    .from("player_onboarding")
    .upsert(row, { onConflict: "wallet", ignoreDuplicates: true })
    .select("wallet,tour_version,status,stage,language,skipped_at,completed_at")
    .maybeSingle();
  if (insertError) throw new Error(insertError.message);
  if (inserted) return inserted as OnboardingRow;

  const { data: racedRow, error: racedError } = await admin
    .from("player_onboarding")
    .select("wallet,tour_version,status,stage,language,skipped_at,completed_at")
    .eq("wallet", wallet)
    .single();
  if (racedError) throw new Error(racedError.message);
  return racedRow as OnboardingRow;
}

async function hasExistingActivity(admin: AdminClient, wallet: string) {
  const [stats, playerOneGames, playerTwoGames, seasonProgress] = await Promise.all([
    admin
      .from("player_stats")
      .select("updated_at")
      .eq("wallet", wallet)
      .maybeSingle(),
    admin
      .from("games")
      .select("id")
      .eq("player1", wallet)
      .lt("created_at", ONBOARDING_ROLLOUT_AT)
      .limit(1),
    admin
      .from("games")
      .select("id")
      .eq("player2", wallet)
      .lt("created_at", ONBOARDING_ROLLOUT_AT)
      .limit(1),
    admin
      .from("season_progress")
      .select("wallet")
      .eq("wallet", wallet)
      .lt("updated_at", ONBOARDING_ROLLOUT_AT)
      .limit(1),
  ]);

  for (const result of [stats, playerOneGames, playerTwoGames, seasonProgress]) {
    if (result.error) throw new Error(result.error.message);
  }

  const statsRow = stats.data as { updated_at?: string | null } | null;
  const statsPredatesRollout = Boolean(
    statsRow?.updated_at && new Date(statsRow.updated_at).getTime() < Date.parse(ONBOARDING_ROLLOUT_AT),
  );

  return statsPredatesRollout ||
    Boolean(playerOneGames.data?.length || playerTwoGames.data?.length || seasonProgress.data?.length);
}

async function recoverFromExistingCheckin(admin: AdminClient, row: OnboardingRow) {
  if (row.stage !== "briefing" || row.status !== "in_progress") return row;
  const { data, error } = await admin
    .from("player_stats")
    .select("last_checkin")
    .eq("wallet", row.wallet)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.last_checkin) return row;
  return updateRow(admin, row.wallet, {
    stage: "deployment",
  });
}

async function updateRow(
  admin: AdminClient,
  wallet: string,
  values: Record<string, unknown>,
) {
  const { data, error } = await admin
    .from("player_onboarding")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("wallet", wallet)
    .select("wallet,tour_version,status,stage,language,skipped_at,completed_at")
    .single();
  if (error) throw new Error(error.message);
  return data as OnboardingRow;
}

function toPayload(row: OnboardingRow) {
  const complete = row.status === "completed" || row.status === "grandfathered";
  return {
    required: !complete,
    version: row.tour_version,
    status: row.status,
    step: complete ? "complete" : row.stage,
    language: row.language,
    skippedGameplay: Boolean(row.skipped_at),
    persistence: "server" as const,
  };
}

function isMissingOnboardingTable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("player_onboarding") && (
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("PGRST205")
  );
}

function normalizeWallet(value: unknown) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null;
}

function normalizeStep(value: unknown): OnboardingStep | null {
  const step = String(value ?? "") as OnboardingStep;
  return ONBOARDING_STEPS.includes(step) ? step : null;
}

function json(payload: unknown) {
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400, headers: NO_STORE_HEADERS });
}

function serverError(error: unknown) {
  console.error("Onboarding API failed:", error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Onboarding is unavailable" },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}
