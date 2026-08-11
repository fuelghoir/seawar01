import { NextResponse } from "next/server";
import type { AdminClient } from "../../../lib/adminSupabase";
import { adminSupabase, requireAdminSession } from "../../../lib/adminAuth";
import { normalizeReferralWallet } from "../../../lib/referralIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 1_000;
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

type DatabaseRow = Record<string, unknown>;

type ReferralRecord = {
  referrer: string;
  referee: string;
  refToken: string | null;
  source: string;
  campaign: string | null;
  createdAt: string;
  gamesPlayed: number;
  bonusPaidAt: string | null;
  bonusPoints: number;
};

type ReferralCodeRecord = {
  code: string;
  wallet: string;
  is_primary: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type AcquisitionRecord = {
  id: string;
  wallet: string | null;
  refToken: string | null;
  source: string;
  campaign: string | null;
  walletAttachedAt: string | null;
  referralRecordedAt: string | null;
  firstSeenAt: string | null;
  visitCount: number;
};

type SourceAccumulator = {
  visitors: Set<string>;
  connected: Set<string>;
  referrals: Set<string>;
  active: Set<string>;
};

type LoadRowsResult = {
  rows: DatabaseRow[];
  available: boolean;
};

export async function GET() {
  try {
    await requireAdminSession();
    const admin = adminSupabase();

    const [
      acquisitionResult,
      walletLinksResult,
      referralResult,
      statsResult,
      codeResult,
      rewardLedgerAvailable,
    ] = await Promise.all([
      loadAllRows(admin, "acquisition_sessions", "id", true),
      loadAllRows(admin, "acquisition_wallet_links", ["session_id", "wallet"], true),
      loadAllRows(admin, "referrals", "id"),
      loadAllRows(admin, "player_stats", "wallet"),
      loadAllRows(admin, "referral_codes", "code", true),
      relationAvailable(admin, "referral_reward_events"),
    ]);
    const acquisitionRows = acquisitionResult.rows;
    const referralRows = referralResult.rows;
    const statsRows = statsResult.rows;
    const codeRows = codeResult.rows;

    const codes = buildCodes(codeRows);
    const codeOwners = new Map(codes.map((entry) => [entry.code, entry.wallet]));
    const acquisitions = buildAcquisitions(acquisitionRows, walletLinksResult.rows);
    const acquisitionsByWallet = groupAcquisitionsByWallet(acquisitions);
    const gamesByWallet = buildGamesByWallet(statsRows);
    const referrals = buildReferrals(
      referralRows,
      acquisitionsByWallet,
      gamesByWallet,
      codeOwners,
    );

    const activeReferrals = referrals.filter((entry) => entry.gamesPlayed > 0);
    const paidReferrals = referrals.filter((entry) => entry.bonusPaidAt !== null);
    const unpaidActive = activeReferrals.filter((entry) => entry.bonusPaidAt === null);

    const response = {
      trackingAvailable: acquisitionResult.available && walletLinksResult.available,
      rewardLedgerAvailable,
      summary: {
        visitors: new Set(
          acquisitions.flatMap((entry) => entry.visitCount > 0 ? [entry.id] : []),
        ).size,
        connectedWallets: new Set(
          acquisitions.flatMap((entry) => entry.wallet ? [entry.wallet] : []),
        ).size,
        recordedReferrals: referrals.length,
        activeReferrals: activeReferrals.length,
        paidReferrals: paidReferrals.length,
        pendingReferrals: referrals.length - activeReferrals.length,
        unpaidActive: unpaidActive.length,
        firstGameBonusPoints: paidReferrals.reduce(
          (total, entry) => total + entry.bonusPoints,
          0,
        ),
      },
      sources: buildSources(acquisitions, referrals),
      referrals,
      codes,
    };

    return NextResponse.json(response, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Referral analytics failed";
    const status = /admin login required/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
  }
}

async function loadAllRows(
  admin: AdminClient,
  table: string,
  orderColumns: string | readonly string[],
  optional = false,
): Promise<LoadRowsResult> {
  const rows: DatabaseRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = admin
      .from(table)
      .select("*");
    for (const orderColumn of typeof orderColumns === "string"
      ? [orderColumns]
      : orderColumns) {
      query = query.order(orderColumn, { ascending: true });
    }
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);

    if (error) {
      if (optional && isMissingRelation(error, table)) {
        return { rows: [], available: false };
      }
      throw new Error(`${table}: ${error.message}`);
    }

    const page = toDatabaseRows(data);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { rows, available: true };
  }
}

async function relationAvailable(admin: AdminClient, table: string) {
  const { error } = await admin
    .from(table)
    // PostgREST may answer HEAD for a missing relation with 204 and no error,
    // so use a bounded GET for an authoritative schema-cache check.
    .select("*")
    .limit(1);
  if (!error) return true;
  if (isMissingRelation(error, table)) return false;
  throw new Error(`${table}: ${error.message}`);
}

function buildAcquisitions(
  rows: DatabaseRow[],
  walletLinkRows: DatabaseRow[],
): AcquisitionRecord[] {
  type SessionRecord = Omit<
    AcquisitionRecord,
    "wallet" | "walletAttachedAt" | "referralRecordedAt"
  >;
  const sessions = new Map<string, SessionRecord>();

  rows.forEach((row, index) => {
    const id = readString(row, "id", "visitor_id", "session_id") ?? `legacy-${index}`;
    if (sessions.has(id)) return;

    sessions.set(id, {
      id,
      refToken: readString(row, "ref_token", "referral_token", "ref"),
      source: acquisitionSource(row),
      campaign: readString(row, "utm_campaign", "campaign"),
      firstSeenAt: readString(row, "first_seen_at", "created_at"),
      visitCount: readNonNegativeInteger(row, "visit_count"),
    });
  });

  const linksBySession = new Map<string, DatabaseRow[]>();
  for (const row of walletLinkRows) {
    const sessionId = readString(row, "session_id");
    if (!sessionId || !sessions.has(sessionId)) continue;
    const links = linksBySession.get(sessionId) ?? [];
    links.push(row);
    linksBySession.set(sessionId, links);
  }

  const records: AcquisitionRecord[] = [];
  for (const session of sessions.values()) {
    const links = linksBySession.get(session.id) ?? [];
    let validLinkCount = 0;
    for (const link of links) {
      const wallet = normalizeReferralWallet(readValue(link, "wallet"));
      if (!wallet) continue;
      validLinkCount += 1;
      records.push({
        ...session,
        wallet,
        walletAttachedAt: readString(link, "attached_at"),
        referralRecordedAt: readString(link, "referral_recorded_at"),
      });
    }

    if (validLinkCount === 0) {
      records.push({
        ...session,
        wallet: null,
        walletAttachedAt: null,
        referralRecordedAt: null,
      });
    }
  }

  return records;
}

function groupAcquisitionsByWallet(records: AcquisitionRecord[]) {
  const result = new Map<string, AcquisitionRecord[]>();
  for (const record of records) {
    if (!record.wallet) continue;
    const entries = result.get(record.wallet) ?? [];
    entries.push(record);
    result.set(record.wallet, entries);
  }
  return result;
}

function buildGamesByWallet(rows: DatabaseRow[]) {
  const result = new Map<string, number>();
  for (const row of rows) {
    const wallet = normalizeReferralWallet(readValue(row, "wallet"));
    if (!wallet) continue;
    result.set(wallet, Math.max(result.get(wallet) ?? 0, readNonNegativeInteger(row, "games_played")));
  }
  return result;
}

function buildReferrals(
  rows: DatabaseRow[],
  acquisitionsByWallet: Map<string, AcquisitionRecord[]>,
  gamesByWallet: Map<string, number>,
  codeOwners: Map<string, string>,
): ReferralRecord[] {
  const records = new Map<string, ReferralRecord>();

  for (const row of rows) {
    const referrer = normalizeReferralWallet(readValue(row, "referrer"));
    const referee = normalizeReferralWallet(readValue(row, "referee"));
    if (!referrer || !referee || records.has(referee)) continue;

    const attribution = selectReferralAttribution(
      acquisitionsByWallet.get(referee) ?? [],
      referrer,
      codeOwners,
    );
    const directSource = readString(row, "source", "utm_source");

    records.set(referee, {
      referrer,
      referee,
      refToken:
        readString(row, "ref_token", "referral_token", "ref") ??
        attribution?.refToken ??
        null,
      source: directSource ? normalizeSource(directSource) : attribution?.source ?? "unknown",
      campaign:
        readString(row, "campaign", "utm_campaign") ?? attribution?.campaign ?? null,
      createdAt: readString(row, "created_at") ?? "",
      gamesPlayed: gamesByWallet.get(referee) ?? 0,
      bonusPaidAt: readString(row, "first_game_bonus_paid_at", "bonus_paid_at"),
      bonusPoints: readNonNegativeInteger(
        row,
        "first_game_bonus_points",
        "bonus_points",
      ),
    });
  }

  return Array.from(records.values()).sort(
    (left, right) => sortableTimestamp(right.createdAt) - sortableTimestamp(left.createdAt),
  );
}

function selectReferralAttribution(
  records: AcquisitionRecord[],
  referrer: string,
  codeOwners: Map<string, string>,
): AcquisitionRecord | null {
  if (records.length === 0) return null;

  return [...records].sort((left, right) => {
    const scoreDifference =
      attributionScore(right, referrer, codeOwners) -
      attributionScore(left, referrer, codeOwners);
    if (scoreDifference !== 0) return scoreDifference;
    return attributionTime(left) - attributionTime(right);
  })[0] ?? null;
}

function attributionScore(
  record: AcquisitionRecord,
  referrer: string,
  codeOwners: Map<string, string>,
) {
  let score = 0;
  if (record.referralRecordedAt) score += 8;
  if (referralTokenMatches(record.refToken, referrer, codeOwners)) score += 4;
  if (record.refToken) score += 2;
  if (record.walletAttachedAt) score += 1;
  return score;
}

function referralTokenMatches(
  token: string | null,
  referrer: string,
  codeOwners: Map<string, string>,
) {
  if (!token) return false;
  const normalized = token.trim().toLowerCase();
  return normalizeReferralWallet(normalized) === referrer || codeOwners.get(normalized) === referrer;
}

function buildSources(acquisitions: AcquisitionRecord[], referrals: ReferralRecord[]) {
  const accumulators = new Map<string, SourceAccumulator>();
  const acquisitionById = new Map<string, AcquisitionRecord>();
  for (const entry of acquisitions) {
    if (entry.visitCount > 0 && !acquisitionById.has(entry.id)) {
      acquisitionById.set(entry.id, entry);
    }
  }

  for (const record of acquisitionById.values()) {
    sourceAccumulator(accumulators, record.source).visitors.add(record.id);
  }

  for (const record of acquisitions) {
    if (!record.wallet) continue;
    // Count a wallet once within every source where it was actually observed.
    // This keeps the source denominator aligned when a later signed referral
    // is attributed to a different campaign than the wallet's first session.
    sourceAccumulator(accumulators, record.source).connected.add(record.wallet);
  }

  for (const referral of referrals) {
    const accumulator = sourceAccumulator(accumulators, referral.source);
    accumulator.referrals.add(referral.referee);
    if (referral.gamesPlayed > 0) accumulator.active.add(referral.referee);
  }

  return Array.from(accumulators, ([source, counts]) => {
    const visitors = counts.visitors.size;
    const connected = counts.connected.size;
    const referralCount = counts.referrals.size;
    return {
      source,
      visitors,
      connected,
      referrals: referralCount,
      active: counts.active.size,
      conversion: connected > 0
        ? Math.round((referralCount / connected) * 1_000) / 10
        : 0,
    };
  }).sort(
    (left, right) =>
      right.visitors - left.visitors ||
      right.referrals - left.referrals ||
      left.source.localeCompare(right.source),
  );
}

function sourceAccumulator(
  accumulators: Map<string, SourceAccumulator>,
  source: string,
) {
  const existing = accumulators.get(source);
  if (existing) return existing;

  const created: SourceAccumulator = {
    visitors: new Set<string>(),
    connected: new Set<string>(),
    referrals: new Set<string>(),
    active: new Set<string>(),
  };
  accumulators.set(source, created);
  return created;
}

function buildCodes(rows: DatabaseRow[]): ReferralCodeRecord[] {
  return rows.flatMap((row) => {
    const code = readString(row, "code")?.toLowerCase();
    const wallet = normalizeReferralWallet(readValue(row, "wallet"));
    if (!code || !wallet) return [];

    return [{
      code,
      wallet,
      is_primary: readBoolean(row, "is_primary"),
      created_by: normalizeReferralWallet(readValue(row, "created_by")),
      created_at: readString(row, "created_at") ?? "",
      updated_at: readString(row, "updated_at") ?? "",
    }];
  }).sort(
    (left, right) =>
      Number(right.is_primary) - Number(left.is_primary) ||
      sortableTimestamp(right.updated_at) - sortableTimestamp(left.updated_at) ||
      left.code.localeCompare(right.code),
  );
}

function acquisitionSource(row: DatabaseRow) {
  const utmSource = readString(row, "utm_source", "source");
  if (utmSource) return normalizeSource(utmSource);

  const platform = readString(row, "platform");
  if (platform && /^(base[-_ ]?app|farcaster)$/i.test(platform)) {
    return normalizeSource(platform);
  }

  const referrerHost = readString(row, "referrer_host");
  if (referrerHost) return normalizeSource(referrerHost);

  if (platform && platform.toLowerCase() !== "web") return normalizeSource(platform);

  return "direct";
}

function normalizeSource(value: string) {
  const source = value.trim().toLowerCase().replace(/^www\./, "");
  if (/^(x|twitter)(\.com)?$/.test(source)) return "x";
  if (/^(t\.me|telegram)(\.org)?$/.test(source)) return "telegram";
  if (/^(base|base\.app|base-app|base_app|base app)$/.test(source)) return "base app";
  return source.slice(0, 120) || "unknown";
}

function attributionTime(record: AcquisitionRecord) {
  const parsed = Date.parse(record.walletAttachedAt ?? record.firstSeenAt ?? "");
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function sortableTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDatabaseRows(value: unknown): DatabaseRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isDatabaseRow);
}

function isDatabaseRow(value: unknown): value is DatabaseRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readValue(row: DatabaseRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function readString(row: DatabaseRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function readBoolean(row: DatabaseRow, ...keys: string[]) {
  const value = readValue(row, ...keys);
  return value === true || value === "true" || value === 1;
}

function readNonNegativeInteger(row: DatabaseRow, ...keys: string[]) {
  const value = Number(readValue(row, ...keys) ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isMissingRelation(error: { code?: string; message?: string }, table: string) {
  const message = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    new RegExp(`${escapeRegExp(table)}.*(?:schema cache|does not exist)`, "i").test(message)
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
