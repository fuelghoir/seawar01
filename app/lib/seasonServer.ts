import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_SHOP_PURCHASE_QUANTITY,
  QUEST_REROLL_USDC_PRICE,
  SEASON_LEVELS,
  SHOP_ITEMS,
  itemBySlug,
  normalizeShopPurchaseQuantity,
  type SeasonReward,
  type ShopItemSlug,
} from "./season";
import { SHOP_TREASURY_ADDRESS, USDC_ADDRESS } from "../contracts/seaBattleAbi";
import { base } from "viem/chains";
import {
  createPublicClient,
  decodeEventLog,
  fallback,
  http,
  parseAbiItem,
  type Hex,
} from "viem";

const WALLET_RE = /^0x[a-f0-9]{40}$/;
const TX_HASH_RE = /^0x[a-f0-9]{64}$/;
const BASE_RPCS = [
  process.env.NEXT_PUBLIC_BASE_RPC_URL,
  "https://base-rpc.publicnode.com",
  "https://base.meowrpc.com",
  "https://base.drpc.org",
  "https://mainnet.base.org",
].filter(Boolean) as string[];

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const baseClient = createPublicClient({
  chain: base,
  transport: fallback(
    BASE_RPCS.map((url) => http(url, { retryCount: 0, timeout: 4_000 })),
    { retryCount: 0 },
  ),
});

type SeasonProgressRow = {
  xp: number | null;
  claimed_levels: number[] | null;
};

export function normalizeSeasonWallet(value: unknown): string | null {
  const wallet = String(value ?? "").trim().toLowerCase();
  return WALLET_RE.test(wallet) ? wallet : null;
}

export function normalizeSeasonTxHash(value: unknown): string | null {
  const hash = String(value ?? "").trim().toLowerCase();
  return TX_HASH_RE.test(hash) ? hash : null;
}

export function normalizeSeasonItemSlug(value: unknown): ShopItemSlug | null {
  const slug = String(value ?? "");
  return SHOP_ITEMS.some((item) => item.slug === slug) ? (slug as ShopItemSlug) : null;
}

export function normalizeSeasonClaimLevels(levels: unknown): number[] {
  if (!Array.isArray(levels)) return [];
  return Array.from(
    new Set(
      levels
        .map((level) => Number(level))
        .filter((level) => Number.isInteger(level) && level >= 1),
    ),
  ).sort((a, b) => a - b);
}

export async function getItemQuantityServer(
  admin: SupabaseClient,
  wallet: string,
  slug: ShopItemSlug,
): Promise<number> {
  const { data, error } = await admin
    .from("player_items")
    .select("quantity")
    .eq("wallet", wallet)
    .eq("item_slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Number(data?.quantity ?? 0);
}

export async function grantItemServer(
  admin: SupabaseClient,
  wallet: string,
  slug: ShopItemSlug,
  quantity = 1,
) {
  const qty = normalizeQuantity(quantity);
  if (qty <= 0) return;

  const current = await getItemQuantityServer(admin, wallet, slug);
  const { error } = await admin.from("player_items").upsert(
    {
      wallet,
      item_slug: slug,
      quantity: current + qty,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wallet,item_slug" },
  );
  if (error) throw new Error(error.message);
}

export async function consumeItemServer(
  admin: SupabaseClient,
  wallet: string,
  slug: ShopItemSlug,
  quantity = 1,
) {
  const qty = normalizeQuantity(quantity);
  if (qty <= 0) return;

  const current = await getItemQuantityServer(admin, wallet, slug);
  if (current < qty) throw new Error("Not enough items");

  const { error } = await admin
    .from("player_items")
    .update({
      quantity: current - qty,
      updated_at: new Date().toISOString(),
    })
    .eq("wallet", wallet)
    .eq("item_slug", slug);
  if (error) throw new Error(error.message);
}

export async function grantRawPointsServer(
  admin: SupabaseClient,
  wallet: string,
  pointsValue: number,
) {
  const points = Math.floor(Number(pointsValue));
  if (points <= 0) return;

  const { data, error } = await admin
    .from("player_stats")
    .select("points")
    .eq("wallet", wallet)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    const { error: updateError } = await admin
      .from("player_stats")
      .update({
        points: Number(data.points ?? 0) + points,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet", wallet);
    if (updateError) throw new Error(updateError.message);
    return;
  }

  const { error: insertError } = await admin.from("player_stats").insert({
    wallet,
    points,
  });
  if (insertError) throw new Error(insertError.message);
}

export async function buyPointItemServer(
  admin: SupabaseClient,
  wallet: string,
  slug: ShopItemSlug,
  quantity = 1,
) {
  const qty = normalizeShopPurchaseQuantity(quantity);
  const item = itemBySlug(slug);
  if (!item.enabled || item.pricePoints == null) throw new Error("Item is not available yet");
  if (slug === "quest_reroll" && qty > 1) {
    throw new Error("Quest Reroll points purchase is limited to 1 per week");
  }

  const totalPricePoints = item.pricePoints * qty;
  const weekKey = getSeasonWeekKey();

  // Query spendable active season points balance
  const { data: seasonData, error: seasonError } = await admin
    .from("season_progress")
    .select("points")
    .eq("wallet", wallet)
    .eq("season_key", SEASON_KEY)
    .maybeSingle();
  if (seasonError) throw new Error(seasonError.message);

  const seasonPoints = Number(seasonData?.points ?? 0);
  if (seasonPoints < totalPricePoints) throw new Error("Not enough points");

  // Query permanent leaderboard stats points
  const { data: playerStatsData, error: statsError } = await admin
    .from("player_stats")
    .select("points")
    .eq("wallet", wallet)
    .maybeSingle();
  if (statsError) throw new Error(statsError.message);

  const playerStatsPoints = Number(playerStatsData?.points ?? 0);

  let weeklyPurchaseRecorded = false;
  if (slug === "quest_reroll") {
    const { error: recordError } = await admin
      .from("shop_weekly_point_purchases")
      .insert({
        wallet,
        week_key: weekKey,
        item_slug: slug,
      });
    if (recordError) {
      if (recordError.code === "23505") {
        throw new Error("Quest Reroll points purchase already used this week");
      }
      throw new Error(recordError.message);
    }
    weeklyPurchaseRecorded = true;
  }

  const rollbackWeeklyPurchase = async () => {
    if (!weeklyPurchaseRecorded) return;
    await admin
      .from("shop_weekly_point_purchases")
      .delete()
      .eq("wallet", wallet)
      .eq("week_key", weekKey)
      .eq("item_slug", slug);
  };

  // Decrement season points balance
  const { error: updateSeasonError } = await admin
    .from("season_progress")
    .update({
      points: seasonPoints - totalPricePoints,
      updated_at: new Date().toISOString(),
    })
    .eq("wallet", wallet)
    .eq("season_key", SEASON_KEY);
  if (updateSeasonError) {
    await rollbackWeeklyPurchase();
    throw new Error(updateSeasonError.message);
  }

  // Decrement permanent leaderboard points
  const { error: updateStatsError } = await admin
    .from("player_stats")
    .update({
      points: Math.max(0, playerStatsPoints - totalPricePoints),
      updated_at: new Date().toISOString(),
    })
    .eq("wallet", wallet);
  if (updateStatsError) {
    // Rollback season points
    try {
      await admin
        .from("season_progress")
        .update({
          points: seasonPoints,
          updated_at: new Date().toISOString(),
        })
        .eq("wallet", wallet)
        .eq("season_key", SEASON_KEY);
    } catch {
      // ignore
    }
    await rollbackWeeklyPurchase();
    throw new Error(updateStatsError.message);
  }

  try {
    await grantItemServer(admin, wallet, slug, qty);
  } catch (err) {
    // Refund permanent points (the DB trigger will automatically refund season points too)
    await grantRawPointsServer(admin, wallet, totalPricePoints).catch(() => {});
    await rollbackWeeklyPurchase();
    throw err;
  }
}

export async function grantPaidQuestRerollServer(
  admin: SupabaseClient,
  wallet: string,
  txHash: string,
  quantity = 1,
) {
  const qty = normalizeShopPurchaseQuantity(quantity);
  const amountUsdcMicro = QUEST_REROLL_USDC_PRICE * qty;
  await assertPaidQuestRerollTransfer(wallet, txHash, amountUsdcMicro);

  const { error: rpcError } = await admin.rpc("record_paid_quest_reroll", {
    p_wallet: wallet,
    p_tx_hash: txHash,
    p_amount_usdc_micro: amountUsdcMicro,
    p_quantity: qty,
  });
  if (!rpcError) return;

  const canFallback =
    rpcError.code === "PGRST202" ||
    /record_paid_quest_reroll|schema cache|function/i.test(rpcError.message ?? "");
  if (!canFallback) throw new Error(rpcError.message);

  const grantedAt = new Date().toISOString();
  const insertWithGrantMarker = await admin
    .from("shop_usdc_purchases")
    .insert({
      wallet,
      tx_hash: txHash,
      item_slug: "quest_reroll",
      amount_usdc_micro: amountUsdcMicro,
      granted_at: grantedAt,
    })
    .select("tx_hash")
    .maybeSingle();

  if (!insertWithGrantMarker.error) {
    await grantItemServer(admin, wallet, "quest_reroll", qty);
    return;
  }

  if (insertWithGrantMarker.error.code === "23505") {
    const markExisting = await admin
      .from("shop_usdc_purchases")
      .update({ granted_at: grantedAt })
      .eq("tx_hash", txHash)
      .eq("wallet", wallet)
      .eq("item_slug", "quest_reroll")
      .eq("amount_usdc_micro", amountUsdcMicro)
      .is("granted_at", null)
      .select("tx_hash")
      .maybeSingle();

    if (!markExisting.error && markExisting.data) {
      await grantItemServer(admin, wallet, "quest_reroll", qty);
      return;
    }
    if (!markExisting.error) return;
    if (!/granted_at/i.test(markExisting.error.message ?? "")) {
      throw new Error(markExisting.error.message);
    }
  } else if (!/granted_at/i.test(insertWithGrantMarker.error.message ?? "")) {
    throw new Error(insertWithGrantMarker.error.message);
  }

  const { error: legacyInsertError } = await admin
    .from("shop_usdc_purchases")
    .insert({
      wallet,
      tx_hash: txHash,
      item_slug: "quest_reroll",
      amount_usdc_micro: amountUsdcMicro,
    });
  if (legacyInsertError) {
    if (legacyInsertError.code === "23505") return;
    throw new Error(legacyInsertError.message);
  }

  await grantItemServer(admin, wallet, "quest_reroll", qty);
}

export async function activateDoublePointsServer(
  admin: SupabaseClient,
  wallet: string,
): Promise<string> {
  await consumeItemServer(admin, wallet, "double_points_1h", 1);

  const { data } = await admin
    .from("player_boosters")
    .select("active_until")
    .eq("wallet", wallet)
    .eq("booster_slug", "double_points")
    .maybeSingle();

  const now = Date.now();
  const currentUntil = data?.active_until
    ? new Date(String(data.active_until)).getTime()
    : 0;
  const startsAt = Math.max(now, currentUntil);
  const activeUntil = new Date(startsAt + 60 * 60 * 1000).toISOString();

  const { error } = await admin.from("player_boosters").upsert(
    {
      wallet,
      booster_slug: "double_points",
      active_until: activeUntil,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wallet,booster_slug" },
  );
  if (error) {
    await grantItemServer(admin, wallet, "double_points_1h", 1).catch(() => {});
    throw new Error(error.message);
  }

  return activeUntil;
}

async function getActiveSeasonKey(admin: SupabaseClient): Promise<string> {
  const { data } = await admin
    .from("season_config")
    .select("season_key")
    .eq("id", "default")
    .maybeSingle();
  return data?.season_key ?? "S1";
}

export async function addSeasonXpServer(
  admin: SupabaseClient,
  wallet: string,
  xpValue: number,
) {
  const xp = Math.floor(Number(xpValue));
  if (xp <= 0) return;

  const seasonKey = await getActiveSeasonKey(admin);
  const state = await getSeasonProgress(admin, wallet, seasonKey);
  const { error } = await admin.from("season_progress").upsert(
    {
      wallet,
      season_key: seasonKey,
      xp: state.xp + xp,
      claimed_levels: state.claimedLevels,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wallet,season_key" },
  );
  if (error) throw new Error(error.message);
}

export async function claimSeasonLevelsServer(
  admin: SupabaseClient,
  wallet: string,
  levelsValue: unknown,
): Promise<SeasonReward[]> {
  const requestedLevels = normalizeSeasonClaimLevels(levelsValue);
  if (requestedLevels.length === 0) throw new Error("No rewards ready");

  const seasonKey = await getActiveSeasonKey(admin);
  const state = await getSeasonProgress(admin, wallet, seasonKey);
  const targets = requestedLevels.map((level) => {
    const target = SEASON_LEVELS.find((entry) => entry.level === level);
    if (!target) throw new Error("Unknown season level");
    if (state.xp < target.xpRequired) throw new Error("Level is not ready");
    if (state.claimedLevels.includes(level)) throw new Error("Already claimed");
    return target;
  });

  const nextClaimed = Array.from(
    new Set([...state.claimedLevels, ...targets.map((target) => target.level)]),
  ).sort((a, b) => a - b);

  const { error } = await admin.from("season_progress").upsert(
    {
      wallet,
      season_key: seasonKey,
      xp: state.xp,
      claimed_levels: nextClaimed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wallet,season_key" },
  );
  if (error) throw new Error(error.message);

  try {
    const points = targets.reduce(
      (sum, target) => sum + (target.reward.kind === "points" ? target.reward.amount : 0),
      0,
    );
    if (points > 0) await grantRawPointsServer(admin, wallet, points);

    const items = targets.reduce((acc, target) => {
      if (target.reward.kind === "item") {
        acc[target.reward.slug] = (acc[target.reward.slug] ?? 0) + target.reward.quantity;
      }
      return acc;
    }, {} as Partial<Record<ShopItemSlug, number>>);

    for (const [slug, quantity] of Object.entries(items) as Array<[ShopItemSlug, number]>) {
      await grantItemServer(admin, wallet, slug, quantity);
    }
  } catch (err) {
    await admin.from("season_progress").upsert(
      {
        wallet,
        season_key: seasonKey,
        xp: state.xp,
        claimed_levels: state.claimedLevels,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet,season_key" },
    );
    throw err;
  }

  return targets.map((target) => target.reward);
}

async function getSeasonProgress(admin: SupabaseClient, wallet: string, seasonKey: string) {
  const { data, error } = await admin
    .from("season_progress")
    .select("xp,claimed_levels")
    .eq("wallet", wallet)
    .eq("season_key", seasonKey)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const row = data as SeasonProgressRow | null;
  return {
    xp: Number(row?.xp ?? 0),
    claimedLevels: Array.isArray(row?.claimed_levels) ? row.claimed_levels : [],
  };
}

function normalizeQuantity(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_SHOP_PURCHASE_QUANTITY, Math.max(1, Math.floor(value)));
}

function getSeasonWeekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week.toString().padStart(2, "0")}`;
}

async function assertPaidQuestRerollTransfer(
  wallet: string,
  txHash: string,
  amountUsdcMicro: number,
) {
  let receipt;
  try {
    receipt = await baseClient.getTransactionReceipt({ hash: txHash as Hex });
  } catch {
    throw new Error("Could not verify USDC payment");
  }

  if (receipt.status !== "success") throw new Error("USDC payment was not successful");

  const from = wallet.toLowerCase();
  const to = SHOP_TREASURY_ADDRESS.toLowerCase();
  const usdc = USDC_ADDRESS.toLowerCase();
  const expectedAmount = BigInt(amountUsdcMicro);

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdc) continue;
    try {
      const decoded = decodeEventLog({
        abi: [transferEvent],
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "Transfer") continue;
      const args = decoded.args as { from?: string; to?: string; value?: bigint };
      if (
        args.from?.toLowerCase() === from &&
        args.to?.toLowerCase() === to &&
        (args.value ?? BigInt(0)) >= expectedAmount
      ) {
        return;
      }
    } catch {
      continue;
    }
  }

  throw new Error("USDC payment does not match this purchase");
}
