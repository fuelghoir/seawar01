import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../lib/adminAuth";
import {
  chunk,
  fetchBaseNotificationUsers,
  getBaseNotificationsConfig,
  sendBaseNotification,
  type BaseNotificationAddressResult,
  type BaseNotificationSendResult,
} from "../../lib/baseNotifications";
import { getAssignedQuestIds, getWeekKey } from "../../lib/quests";

export const runtime = "nodejs";

type CampaignName = "checkin" | "weekly-quests";
type CampaignRequest = CampaignName | "all";
type AdminClient = ReturnType<typeof adminSupabase>;

type PlayerStatsRow = {
  wallet: string | null;
  last_checkin: string | null;
};

type UserQuestRow = {
  wallet: string | null;
  quest_id: number | null;
  claimed: boolean | null;
};

type UserQuestRerollRow = {
  wallet: string | null;
  old_quest_id: number | null;
  new_quest_id: number | null;
};

interface CampaignSelection {
  wallets: string[];
  meta: Record<string, unknown>;
}

const SUPABASE_IN_CHUNK_SIZE = 500;

const CAMPAIGN_COPY: Record<CampaignName, { title: string; message: string; targetPath: string }> = {
  checkin: {
    title: "Забери чек-ин",
    message: "Ежедневная награда уже ждет. Открой Sea Battle и сохрани серию.",
    targetPath: "/shop",
  },
  "weekly-quests": {
    title: "Квесты недели",
    message: "Выполни еженедельные квесты и забери очки до сброса недели.",
    targetPath: "/",
  },
};

export async function POST(req: NextRequest) {
  const authError = authorize(req);
  if (authError) return authError;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const campaign = parseCampaign(body.campaign ?? body.type);
    const dryRun = body.dryRun === true || body.dry_run === true;
    const includeWallets = body.includeWallets === true || body.include_wallets === true;
    const maxUsers = parsePositiveInt(body.maxUsers ?? body.max_users);
    const maxPages = parsePositiveInt(body.maxPages ?? body.max_pages);

    const config = getBaseNotificationsConfig();
    const admin = adminSupabase();
    const audience = await fetchBaseNotificationUsers(config, { maxUsers, maxPages });
    const requestedCampaigns = campaign === "all"
      ? (["checkin", "weekly-quests"] as CampaignName[])
      : [campaign];

    const campaigns: Record<string, unknown> = {};

    for (const name of requestedCampaigns) {
      const selection = await selectCampaignWallets(admin, name, audience.wallets);
      const copy = CAMPAIGN_COPY[name];
      const sendResult = dryRun || selection.wallets.length === 0
        ? null
        : await sendBaseNotification(config, {
            walletAddresses: selection.wallets,
            title: copy.title,
            message: copy.message,
            targetPath: copy.targetPath,
          });

      campaigns[name] = buildCampaignResponse(selection, sendResult, dryRun, includeWallets);
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      appUrl: config.appUrl,
      audience: {
        optedInWallets: audience.wallets.length,
        pages: audience.pages,
        hasMore: audience.hasMore,
      },
      campaigns,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Base notification send failed" },
      { status: 500 },
    );
  }
}

function authorize(req: NextRequest) {
  const expected =
    process.env.BASE_NOTIFICATIONS_SECRET ||
    process.env.PUSH_SECRET ||
    process.env.CRON_SECRET ||
    "";

  if (!expected) {
    return NextResponse.json(
      { error: "BASE_NOTIFICATIONS_SECRET, PUSH_SECRET, or CRON_SECRET is required" },
      { status: 500 },
    );
  }

  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const received =
    req.headers.get("x-base-notifications-secret") ||
    req.headers.get("x-push-secret") ||
    bearer;

  if (received !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

function parseCampaign(value: unknown): CampaignRequest {
  const raw = String(value ?? "all").trim().toLowerCase();
  if (raw === "checkin" || raw === "check-in" || raw === "daily") return "checkin";
  if (raw === "weekly" || raw === "quests" || raw === "weekly-quests") return "weekly-quests";
  return "all";
}

async function selectCampaignWallets(
  admin: AdminClient,
  campaign: CampaignName,
  audienceWallets: string[],
): Promise<CampaignSelection> {
  if (campaign === "checkin") {
    return selectCheckinWallets(admin, audienceWallets);
  }

  return selectWeeklyQuestWallets(admin, audienceWallets);
}

async function selectCheckinWallets(
  admin: AdminClient,
  audienceWallets: string[],
): Promise<CampaignSelection> {
  const today = todayUTC();
  const rows = await loadCheckinStats(admin, audienceWallets);
  const checkedInToday = new Set(
    rows
      .filter((row) => String(row.last_checkin ?? "") === today)
      .map((row) => String(row.wallet ?? "").toLowerCase()),
  );

  return {
    wallets: audienceWallets.filter((wallet) => !checkedInToday.has(wallet)),
    meta: { today },
  };
}

async function selectWeeklyQuestWallets(
  admin: AdminClient,
  audienceWallets: string[],
): Promise<CampaignSelection> {
  const weekKey = getWeekKey();
  const [questRows, rerollRows] = await Promise.all([
    loadUserQuestRows(admin, audienceWallets, weekKey),
    loadUserQuestRerollRows(admin, audienceWallets, weekKey),
  ]);

  const questRowsByWallet = new Map<string, Map<number, boolean>>();
  for (const row of questRows) {
    const wallet = String(row.wallet ?? "").toLowerCase();
    const questId = Number(row.quest_id);
    if (!wallet || !Number.isInteger(questId)) continue;

    const walletRows = questRowsByWallet.get(wallet) ?? new Map<number, boolean>();
    walletRows.set(questId, row.claimed === true);
    questRowsByWallet.set(wallet, walletRows);
  }

  const rerollsByWallet = new Map<string, Map<number, number>>();
  for (const row of rerollRows) {
    const wallet = String(row.wallet ?? "").toLowerCase();
    const oldQuestId = Number(row.old_quest_id);
    const newQuestId = Number(row.new_quest_id);
    if (!wallet || !Number.isInteger(oldQuestId) || !Number.isInteger(newQuestId)) continue;

    const walletRerolls = rerollsByWallet.get(wallet) ?? new Map<number, number>();
    walletRerolls.set(oldQuestId, newQuestId);
    rerollsByWallet.set(wallet, walletRerolls);
  }

  const wallets = audienceWallets.filter((wallet) => {
    const assignedQuestIds = applyQuestRerolls(
      getAssignedQuestIds(wallet, weekKey),
      rerollsByWallet.get(wallet),
    );
    const walletRows = questRowsByWallet.get(wallet);
    return assignedQuestIds.some((questId) => walletRows?.get(questId) !== true);
  });

  return {
    wallets,
    meta: { weekKey },
  };
}

async function loadCheckinStats(admin: AdminClient, wallets: string[]) {
  const rows: PlayerStatsRow[] = [];
  for (const batch of chunk(wallets, SUPABASE_IN_CHUNK_SIZE)) {
    const { data, error } = await admin
      .from("player_stats")
      .select("wallet,last_checkin")
      .in("wallet", batch);

    if (error) throw new Error(`Could not load check-in stats: ${error.message}`);
    rows.push(...((data ?? []) as PlayerStatsRow[]));
  }
  return rows;
}

async function loadUserQuestRows(admin: AdminClient, wallets: string[], weekKey: string) {
  const rows: UserQuestRow[] = [];
  for (const batch of chunk(wallets, SUPABASE_IN_CHUNK_SIZE)) {
    const { data, error } = await admin
      .from("user_quests")
      .select("wallet,quest_id,claimed")
      .eq("week_key", weekKey)
      .in("wallet", batch);

    if (error) throw new Error(`Could not load weekly quest rows: ${error.message}`);
    rows.push(...((data ?? []) as UserQuestRow[]));
  }
  return rows;
}

async function loadUserQuestRerollRows(admin: AdminClient, wallets: string[], weekKey: string) {
  const rows: UserQuestRerollRow[] = [];
  for (const batch of chunk(wallets, SUPABASE_IN_CHUNK_SIZE)) {
    const { data, error } = await admin
      .from("user_quest_rerolls")
      .select("wallet,old_quest_id,new_quest_id")
      .eq("week_key", weekKey)
      .in("wallet", batch);

    if (error) throw new Error(`Could not load weekly quest rerolls: ${error.message}`);
    rows.push(...((data ?? []) as UserQuestRerollRow[]));
  }
  return rows;
}

function applyQuestRerolls(baseQuestIds: number[], rerolls?: Map<number, number>) {
  if (!rerolls || rerolls.size === 0) return baseQuestIds;

  const seen = new Set<number>();
  return baseQuestIds.map((questId) => {
    const nextQuestId = rerolls.get(questId) ?? questId;
    if (seen.has(nextQuestId)) return questId;
    seen.add(nextQuestId);
    return nextQuestId;
  });
}

function buildCampaignResponse(
  selection: CampaignSelection,
  sendResult: BaseNotificationSendResult | null,
  dryRun: boolean,
  includeWallets: boolean,
) {
  const response: Record<string, unknown> = {
    ...selection.meta,
    eligibleWallets: selection.wallets.length,
    sent: dryRun ? 0 : sendResult?.sentCount ?? 0,
    failed: dryRun ? 0 : sendResult?.failedCount ?? 0,
    baseRequests: dryRun ? 0 : sendResult?.requestCount ?? 0,
  };

  const failureReasons = summarizeFailureReasons(sendResult?.results ?? []);
  if (Object.keys(failureReasons).length > 0) {
    response.failureReasons = failureReasons;
  }
  if (includeWallets) {
    response.wallets = selection.wallets;
  }

  return response;
}

function summarizeFailureReasons(results: BaseNotificationAddressResult[]) {
  const counts: Record<string, number> = {};
  for (const result of results) {
    if (result.sent) continue;
    const reason = result.failureReason || "unknown";
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

function parsePositiveInt(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.floor(num);
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}
