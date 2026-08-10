import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, type AdminClient } from "../../lib/adminSupabase";
import {
  STARTER_PACK_LEDGER_SLUG,
  STARTER_PACK_WEEK_KEY,
} from "../../lib/onboardingStarterPack";
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
const ONBOARDING_COLUMNS =
  "wallet,tour_version,status,stage,language,started_at,skipped_at,completed_at";

type OnboardingRow = {
  wallet: string;
  tour_version: number;
  status: "pending" | "in_progress" | "completed" | "grandfathered";
  stage: OnboardingStep;
  language: "en" | "ru" | null;
  started_at: string | null;
  skipped_at: string | null;
  completed_at: string | null;
};

type StoredOnboardingRow = Omit<OnboardingRow, "stage"> & { stage: string };

export async function GET(req: NextRequest) {
  const wallet = normalizeWallet(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) return badRequest("Invalid wallet");

  const admin = adminSupabase();
  try {
    const row = await ensureOnboardingRow(admin, wallet);
    const reconciled = await recoverFromExistingCheckin(admin, row);
    return json(toPayload(reconciled));
  } catch (error) {
    if (isOnboardingSchemaUnavailable(error)) {
      try {
        return json(await localStatusFallback(admin, wallet));
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
  const language = normalizeLanguage(body?.language);
  const admin = adminSupabase();

  try {
    const current = await ensureOnboardingRow(admin, wallet);
    if (current.status === "completed" || current.status === "grandfathered") {
      return json(toPayload(current));
    }

    if (action === "dismiss" || action === "skip") {
      return json(toPayload(await updateRow(admin, wallet, {
        status: "completed",
        stage: "complete",
        skipped_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })));
    }

    if (action === "complete") {
      if (current.stage !== "debrief") {
        return conflict("Win the training battle first");
      }
      return json(toPayload(await updateRow(admin, wallet, {
        status: "completed",
        stage: "complete",
        completed_at: new Date().toISOString(),
      })));
    }

    if (action !== "progress") return badRequest("Unknown onboarding action");
    const step = normalizeStep(body?.step);
    if (!step || step === "complete") return badRequest("Invalid onboarding step");

    const currentIndex = STEP_INDEX.get(current.stage) ?? 0;
    const nextIndex = STEP_INDEX.get(step) ?? 0;
    if (nextIndex < currentIndex) return json(toPayload(current));
    if (nextIndex > currentIndex + 1) {
      return conflict("Complete the current training objective first");
    }

    const savedLanguage = language ?? current.language;
    if (step !== "language" && !savedLanguage) {
      return conflict("Choose a language first");
    }
    if (step === "loadout" && !(await hasCompletedCheckin(admin, wallet))) {
      return conflict("Complete the daily check-in first");
    }
    if (step === "battle" && !(await hasClaimedStarterLoadout(admin, wallet))) {
      return conflict("Claim the free recruit kit first");
    }

    const updated = await updateRow(admin, wallet, {
      status: step === "language" ? "pending" : "in_progress",
      stage: step,
      language: savedLanguage,
      started_at: current.stage === "language" && step === "checkin"
        ? new Date().toISOString()
        : undefined,
    });
    return json(toPayload(updated));
  } catch (error) {
    if (isOnboardingSchemaUnavailable(error)) {
      return localProgressFallback(admin, wallet, action, body?.step, language);
    }
    return serverError(error);
  }
}

async function localStatusFallback(admin: AdminClient, wallet: string) {
  const legacy = await hasExistingActivity(admin, wallet);
  return {
    required: !legacy,
    version: ONBOARDING_TOUR_VERSION,
    status: legacy ? "grandfathered" as const : "pending" as const,
    step: legacy ? "complete" as const : "language" as const,
    language: null,
    skippedGameplay: false,
    persistence: "local" as const,
  };
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

  if (action === "dismiss" || action === "skip") {
    return json({
      ...base,
      required: false,
      status: "completed" as const,
      step: "complete" as const,
      skippedGameplay: true,
    });
  }

  if (action === "complete") {
    return json({
      ...base,
      required: false,
      status: "completed" as const,
      step: "complete" as const,
    });
  }

  if (action !== "progress") return badRequest("Unknown onboarding action");
  const step = normalizeStep(rawStep);
  if (!step || step === "complete") return badRequest("Invalid onboarding step");
  if (step !== "language" && !language) return conflict("Choose a language first");
  if (step === "loadout" && !(await hasCompletedCheckin(admin, wallet))) {
    return conflict("Complete the daily check-in first");
  }
  if (step === "battle" && !(await hasClaimedStarterLoadout(admin, wallet))) {
    return conflict("Claim the free recruit kit first");
  }

  return json({
    ...base,
    required: true,
    status: step === "language" ? "pending" as const : "in_progress" as const,
    step,
  });
}

async function ensureOnboardingRow(admin: AdminClient, wallet: string): Promise<OnboardingRow> {
  const { data, error } = await admin
    .from("player_onboarding")
    .select(ONBOARDING_COLUMNS)
    .eq("wallet", wallet)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return upgradeExistingRow(admin, data as StoredOnboardingRow);

  const isLegacyPlayer = await hasExistingActivity(admin, wallet);
  const now = new Date().toISOString();
  const row = {
    wallet,
    tour_version: ONBOARDING_TOUR_VERSION,
    status: isLegacyPlayer ? "grandfathered" : "pending",
    stage: isLegacyPlayer ? "complete" : "language",
    language: null,
    started_at: null,
    skipped_at: null,
    completed_at: isLegacyPlayer ? now : null,
    updated_at: now,
  };
  const { data: inserted, error: insertError } = await admin
    .from("player_onboarding")
    .upsert(row, { onConflict: "wallet", ignoreDuplicates: true })
    .select(ONBOARDING_COLUMNS)
    .maybeSingle();
  if (insertError) throw new Error(insertError.message);
  if (inserted) return inserted as OnboardingRow;

  const { data: racedRow, error: racedError } = await admin
    .from("player_onboarding")
    .select(ONBOARDING_COLUMNS)
    .eq("wallet", wallet)
    .single();
  if (racedError) throw new Error(racedError.message);
  return upgradeExistingRow(admin, racedRow as StoredOnboardingRow);
}

async function upgradeExistingRow(
  admin: AdminClient,
  row: StoredOnboardingRow,
): Promise<OnboardingRow> {
  if (
    row.tour_version === ONBOARDING_TOUR_VERSION &&
    ONBOARDING_STEPS.includes(row.stage as OnboardingStep)
  ) {
    return row as OnboardingRow;
  }

  const isComplete = row.status === "completed" || row.status === "grandfathered";
  const stage = isComplete ? "complete" : mapLegacyStage(row.stage);
  return updateRow(admin, row.wallet, {
    tour_version: ONBOARDING_TOUR_VERSION,
    stage,
    status: stage === "language" ? "pending" : row.status,
  });
}

function mapLegacyStage(stage: string): OnboardingStep {
  if (stage === "language") return "language";
  if (stage === "briefing") return "checkin";
  // Anyone beyond the old check-in has earned the right to start at the new
  // free loadout objective, but still needs to play the new training battle.
  if (["deployment", "targeting", "result", "checkin"].includes(stage)) return "loadout";
  return "language";
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

async function hasCompletedCheckin(admin: AdminClient, wallet: string) {
  const { data, error } = await admin
    .from("player_stats")
    .select("last_checkin")
    .eq("wallet", wallet)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.last_checkin);
}

async function hasClaimedStarterLoadout(admin: AdminClient, wallet: string) {
  const claim = await admin
    .from("shop_weekly_point_purchases")
    .select("wallet")
    .eq("wallet", wallet)
    .eq("week_key", STARTER_PACK_WEEK_KEY)
    .eq("item_slug", STARTER_PACK_LEDGER_SLUG)
    .maybeSingle();
  if (claim.error) throw new Error(claim.error.message);
  // The immutable claim marker is the objective proof. Requiring current item
  // balances here could trap a player who used the kit before resuming training.
  return Boolean(claim.data);
}

async function recoverFromExistingCheckin(admin: AdminClient, row: OnboardingRow) {
  if (row.stage !== "checkin" || row.status !== "in_progress") return row;
  if (!(await hasCompletedCheckin(admin, row.wallet))) return row;
  return updateRow(admin, row.wallet, { stage: "loadout" });
}

async function updateRow(
  admin: AdminClient,
  wallet: string,
  values: Record<string, unknown>,
): Promise<OnboardingRow> {
  const cleanValues = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
  const { data, error } = await admin
    .from("player_onboarding")
    .update({ ...cleanValues, updated_at: new Date().toISOString() })
    .eq("wallet", wallet)
    .select(ONBOARDING_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as OnboardingRow;
}

function toPayload(row: OnboardingRow) {
  const complete = row.status === "completed" || row.status === "grandfathered";
  return {
    required: !complete,
    version: ONBOARDING_TOUR_VERSION,
    status: row.status,
    step: complete ? "complete" as const : row.stage,
    language: row.language,
    skippedGameplay: Boolean(row.skipped_at),
    persistence: "server" as const,
  };
}

function isOnboardingSchemaUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("player_onboarding") && (
      message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("PGRST205")
    )
  ) || message.includes("player_onboarding_stage_check");
}

function normalizeWallet(value: unknown) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null;
}

function normalizeLanguage(value: unknown) {
  return value === "en" || value === "ru" ? value : undefined;
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

function conflict(error: string) {
  return NextResponse.json({ error }, { status: 409, headers: NO_STORE_HEADERS });
}

function serverError(error: unknown) {
  console.error("Onboarding API failed:", error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Onboarding is unavailable" },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}
