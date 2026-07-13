import { supabase } from "./supabase";

export type ShopItemSlug =
  | "double_points_1h"
  | "quest_reroll"
  | "streak_freeze"
  | "radar_scan"
  | "torpedo";

export type SeasonLang = "en" | "ru";

export interface ShopItemDefinition {
  slug: ShopItemSlug;
  name: string;
  desc: string;
  pricePoints: number | null;
  featured: boolean;
  enabled: boolean;
  status: string;
}

export type InventoryMap = Record<ShopItemSlug, number>;

export type SeasonReward =
  | { kind: "points"; amount: number }
  | { kind: "item"; slug: ShopItemSlug; quantity: number };

export interface SeasonLevel {
  level: number;
  xpRequired: number;
  reward: SeasonReward;
}

export interface SeasonLevelState extends SeasonLevel {
  claimed: boolean;
  claimable: boolean;
}

export interface SeasonState {
  seasonKey: string;
  xp: number;
  level: number;
  nextLevelXp: number | null;
  claimedLevels: number[];
  levels: SeasonLevelState[];
  points: number;
  endDate: string;
  isEnded: boolean;
}

export const SEASON_KEY = "S2";
export const SEASON_MAX_LEVEL = 100;
export const QUEST_REROLL_USDC_PRICE = 300_000; // 0.3 USDC (6 decimals)
export const MAX_SHOP_PURCHASE_QUANTITY = 99;
// Point shop prices are balanced against perfect game rewards:
// 70 pts without Double Points, 140 pts with Double Points.
const SHOP_POINT_PRICES: Record<ShopItemSlug, number> = {
  double_points_1h: 320, // Premium booster; can pay back across several games in 1 hour
  quest_reroll: 210,     // Weekly quest value stays higher than one regular match
  streak_freeze: 100,    // Useful passive protection, kept below two perfect games
  radar_scan: 70,        // 1 perfect game; light tactical info
  torpedo: 90,           // Strong one-match tactical shot, but not a long grind
};
const SHOP_SCHEMA_MISSING =
  "Shop database tables are missing. Run scripts/supabase-season-items.sql in Supabase, then reload the app.";

export const SHOP_ITEMS: ShopItemDefinition[] = [
  {
    slug: "double_points_1h",
    name: "Double Points",
    desc: "2x game points for 1 hour. Does not boost quests or check-ins.",
    pricePoints: SHOP_POINT_PRICES.double_points_1h,
    featured: true,
    enabled: true,
    status: "Active item",
  },
  {
    slug: "quest_reroll",
    name: "Quest Reroll",
    desc: "Replace one active weekly quest with a fresh one.",
    pricePoints: SHOP_POINT_PRICES.quest_reroll,
    featured: true,
    enabled: true,
    status: "Used in Weekly Quests",
  },
  {
    slug: "streak_freeze",
    name: "Streak Freeze",
    desc: "Protects your daily streak after a missed day.",
    pricePoints: SHOP_POINT_PRICES.streak_freeze,
    featured: true,
    enabled: true,
    status: "Passive",
  },
  {
    slug: "radar_scan",
    name: "Radar Scan",
    desc: "Use in Bot or Friend mode to reveal a row or column hint.",
    pricePoints: SHOP_POINT_PRICES.radar_scan,
    featured: true,
    enabled: true,
    status: "Bot/Friend item",
  },
  {
    slug: "torpedo",
    name: "Torpedo",
    desc: "Use in Bot or Friend mode to fire a short line after choosing direction.",
    pricePoints: SHOP_POINT_PRICES.torpedo,
    featured: true,
    enabled: true,
    status: "Bot/Friend item",
  },
];

const BASE_SEASON_LEVELS: SeasonLevel[] = [
  { level: 1, xpRequired: 50, reward: { kind: "points", amount: 100 } },
  { level: 2, xpRequired: 120, reward: { kind: "item", slug: "quest_reroll", quantity: 1 } },
  { level: 3, xpRequired: 220, reward: { kind: "item", slug: "radar_scan", quantity: 1 } },
  { level: 4, xpRequired: 350, reward: { kind: "item", slug: "double_points_1h", quantity: 1 } },
  { level: 5, xpRequired: 500, reward: { kind: "item", slug: "streak_freeze", quantity: 1 } },
  { level: 6, xpRequired: 700, reward: { kind: "item", slug: "torpedo", quantity: 1 } },
  { level: 7, xpRequired: 950, reward: { kind: "item", slug: "quest_reroll", quantity: 1 } },
  { level: 8, xpRequired: 1250, reward: { kind: "item", slug: "double_points_1h", quantity: 1 } },
  { level: 9, xpRequired: 1600, reward: { kind: "item", slug: "radar_scan", quantity: 2 } },
  { level: 10, xpRequired: 2000, reward: { kind: "item", slug: "streak_freeze", quantity: 1 } },
  { level: 11, xpRequired: 2450, reward: { kind: "points", amount: 500 } },
  { level: 12, xpRequired: 2950, reward: { kind: "item", slug: "quest_reroll", quantity: 2 } },
  { level: 13, xpRequired: 3500, reward: { kind: "item", slug: "torpedo", quantity: 2 } },
  { level: 14, xpRequired: 4100, reward: { kind: "item", slug: "double_points_1h", quantity: 1 } },
  { level: 15, xpRequired: 4750, reward: { kind: "points", amount: 800 } },
  { level: 16, xpRequired: 5450, reward: { kind: "item", slug: "streak_freeze", quantity: 2 } },
  { level: 17, xpRequired: 6200, reward: { kind: "points", amount: 1000 } },
  { level: 18, xpRequired: 7000, reward: { kind: "item", slug: "double_points_1h", quantity: 2 } },
  { level: 19, xpRequired: 7850, reward: { kind: "item", slug: "quest_reroll", quantity: 2 } },
  { level: 20, xpRequired: 8750, reward: { kind: "points", amount: 2000 } },
];

function generatedSeasonXp(level: number): number {
  let xp = BASE_SEASON_LEVELS[BASE_SEASON_LEVELS.length - 1].xpRequired;
  for (let entry = BASE_SEASON_LEVELS.length + 1; entry <= level; entry++) {
    xp += 700 + (entry - BASE_SEASON_LEVELS.length) * 15;
  }
  return xp;
}

function generatedSeasonReward(level: number): SeasonReward {
  if (level === SEASON_MAX_LEVEL) {
    return { kind: "item", slug: "double_points_1h", quantity: 5 };
  }
  if (level % 20 === 0) {
    return {
      kind: "item",
      slug: "torpedo",
      quantity: Math.max(1, Math.floor(level / 40) + 1),
    };
  }
  if (level % 15 === 0) {
    return {
      kind: "item",
      slug: "radar_scan",
      quantity: Math.max(1, Math.floor(level / 45) + 1),
    };
  }
  if (level % 25 === 0) {
    return {
      kind: "item",
      slug: "streak_freeze",
      quantity: Math.max(1, Math.floor(level / 50) + 1),
    };
  }
  if (level % 10 === 0) {
    return {
      kind: "item",
      slug: "double_points_1h",
      quantity: Math.max(1, Math.floor(level / 40) + 1),
    };
  }
  if (level % 7 === 0) {
    return {
      kind: "item",
      slug: "quest_reroll",
      quantity: Math.max(1, Math.floor(level / 35) + 1),
    };
  }
  return {
    kind: "points",
    amount: Math.round((650 + level * 75) / 50) * 50,
  };
}

export const SEASON_LEVELS: SeasonLevel[] = [
  ...BASE_SEASON_LEVELS,
  ...Array.from(
    { length: SEASON_MAX_LEVEL - BASE_SEASON_LEVELS.length },
    (_, index) => {
      const level = BASE_SEASON_LEVELS.length + index + 1;
      return {
        level,
        xpRequired: generatedSeasonXp(level),
        reward: generatedSeasonReward(level),
      };
    }
  ),
];

const SHOP_ITEM_TEXT: Record<
  SeasonLang,
  Record<ShopItemSlug, { name: string; desc: string; status: string }>
> = {
  en: {
    double_points_1h: {
      name: "Double Points",
      desc: "2x game points for 1 hour. Does not boost quests or check-ins.",
      status: "Active item",
    },
    quest_reroll: {
      name: "Quest Reroll",
      desc: "Replace one active weekly quest with a fresh one.",
      status: "Used in Weekly Quests",
    },
    streak_freeze: {
      name: "Streak Freeze",
      desc: "Protects your daily streak after a missed day.",
      status: "Passive",
    },
    radar_scan: {
      name: "Radar Scan",
      desc: "Use in Bot or Friend mode to reveal a row or column hint.",
      status: "Bot/Friend item",
    },
    torpedo: {
      name: "Torpedo",
      desc: "Use in Bot or Friend mode to fire a short line after choosing direction.",
      status: "Bot/Friend item",
    },
  },
  ru: {
    double_points_1h: {
      name: "Двойные очки",
      desc: "2x очки за игры на 1 час. Не усиливает квесты и чекины.",
      status: "Активный предмет",
    },
    quest_reroll: {
      name: "Реролл квеста",
      desc: "Замени один активный недельный квест на новый.",
      status: "Используется в недельных квестах",
    },
    streak_freeze: {
      name: "Защита серии",
      desc: "Защищает серию ежедневных чекинов после пропущенного дня.",
      status: "Пассивно",
    },
    radar_scan: {
      name: "Скан радаром",
      desc: "Для режима с ботом или другом: показывает подсказку по ряду или колонке.",
      status: "Для бота/друга",
    },
    torpedo: {
      name: "Торпеда",
      desc: "Для режима с ботом или другом: бьет короткой линией после выбора направления.",
      status: "Для бота/друга",
    },
  },
};

export function shopItemText(
  item: ShopItemDefinition,
  lang: SeasonLang = "en"
): ShopItemDefinition {
  const text = SHOP_ITEM_TEXT[lang]?.[item.slug] ?? SHOP_ITEM_TEXT.en[item.slug];
  return { ...item, ...text };
}

function emptyInventory(): InventoryMap {
  return SHOP_ITEMS.reduce((acc, item) => {
    acc[item.slug] = 0;
    return acc;
  }, {} as InventoryMap);
}

function normalizeWallet(wallet: string) {
  return wallet.toLowerCase();
}

async function postSeasonAction<T>(
  action: string,
  payload: Record<string, unknown>
): Promise<T> {
  const res = await fetch("/api/season/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || "Season action failed");
  }
  return data as T;
}

function isMissingShopTableError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /schema cache|shop_weekly_point_purchases|shop_usdc_purchases/i.test(error.message ?? "")
  );
}

function shopTableError(error: { code?: string; message?: string }): Error {
  return new Error(isMissingShopTableError(error) ? SHOP_SCHEMA_MISSING : error.message);
}

function getSeasonWeekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week.toString().padStart(2, "0")}`;
}

export function seasonClaimSentinelAddress(level: number): `0x${string}` {
  return `0x${(5000 + level).toString(16).padStart(40, "0")}` as `0x${string}`;
}

const POINT_PURCHASE_SENTINELS: Record<ShopItemSlug, number> = {
  double_points_1h: 7001,
  quest_reroll: 7002,
  streak_freeze: 7003,
  radar_scan: 7004,
  torpedo: 7005,
};

export function pointPurchaseSentinelAddress(slug: ShopItemSlug): `0x${string}` {
  return `0x${POINT_PURCHASE_SENTINELS[slug].toString(16).padStart(40, "0")}` as `0x${string}`;
}

export function rewardLabel(reward: SeasonReward, lang: SeasonLang = "en"): string {
  if (reward.kind === "points") return `+${reward.amount.toLocaleString()} pts`;
  return `${reward.quantity}x ${SHOP_ITEM_TEXT[lang]?.[reward.slug]?.name ?? SHOP_ITEM_TEXT.en[reward.slug].name}`;
}

export function itemBySlug(slug: ShopItemSlug): ShopItemDefinition {
  const item = SHOP_ITEMS.find((entry) => entry.slug === slug);
  if (!item) throw new Error("Unknown item");
  return item;
}

export function normalizeShopPurchaseQuantity(quantity = 1): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(
    MAX_SHOP_PURCHASE_QUANTITY,
    Math.max(1, Math.floor(quantity))
  );
}

export async function getInventory(wallet: string): Promise<InventoryMap> {
  const addr = normalizeWallet(wallet);
  const inventory = emptyInventory();
  const { data, error } = await supabase
    .from("player_items")
    .select("item_slug, quantity")
    .eq("wallet", addr);

  if (error) throw new Error(error.message);

  for (const row of data || []) {
    const slug = row.item_slug as ShopItemSlug;
    if (slug in inventory) inventory[slug] = Number(row.quantity ?? 0);
  }
  return inventory;
}

export async function getItemQuantity(
  wallet: string,
  slug: ShopItemSlug
): Promise<number> {
  const addr = normalizeWallet(wallet);
  const { data, error } = await supabase
    .from("player_items")
    .select("quantity")
    .eq("wallet", addr)
    .eq("item_slug", slug)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Number(data?.quantity ?? 0);
}

export async function grantItem(
  wallet: string,
  slug: ShopItemSlug,
  quantity = 1
): Promise<void> {
  void wallet;
  void slug;
  void quantity;
  throw new Error("grantItem is server-only. Use a validated season API action.");
}

export async function consumeItem(
  wallet: string,
  slug: ShopItemSlug,
  quantity = 1
): Promise<void> {
  if (quantity <= 0) return;
  const addr = normalizeWallet(wallet);
  await postSeasonAction("consumeItem", { wallet: addr, slug, quantity });
}

export async function grantRawPoints(wallet: string, points: number): Promise<void> {
  void wallet;
  void points;
  throw new Error("grantRawPoints is server-only. Use a validated server reward path.");
}

export async function buyPointItem(
  wallet: string,
  slug: ShopItemSlug,
  quantity = 1
): Promise<void> {
  const qty = normalizeShopPurchaseQuantity(quantity);
  const addr = normalizeWallet(wallet);
  await postSeasonAction("buyPointItem", { wallet: addr, slug, quantity: qty });
}

export async function validatePointItemPurchase(
  wallet: string,
  slug: ShopItemSlug,
  quantity = 1
): Promise<void> {
  const qty = normalizeShopPurchaseQuantity(quantity);
  const item = itemBySlug(slug);
  if (!item.enabled || item.pricePoints == null) {
    throw new Error("Item is not available yet");
  }
  if (slug === "quest_reroll" && qty > 1) {
    throw new Error("Quest Reroll points purchase is limited to 1 per week");
  }

  const addr = normalizeWallet(wallet);
  if (slug === "quest_reroll" && await hasQuestRerollPointPurchaseThisWeek(addr)) {
    throw new Error("Quest Reroll points purchase already used this week");
  }

  const { data, error } = await supabase
    .from("season_progress")
    .select("points")
    .eq("wallet", addr)
    .eq("season_key", SEASON_KEY)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const points = Number(data?.points ?? 0);
  if (points < item.pricePoints * qty) throw new Error("Not enough points");
}

export async function hasQuestRerollPointPurchaseThisWeek(wallet: string): Promise<boolean> {
  const addr = normalizeWallet(wallet);
  const { data, error } = await supabase
    .from("shop_weekly_point_purchases")
    .select("wallet")
    .eq("wallet", addr)
    .eq("week_key", getSeasonWeekKey())
    .eq("item_slug", "quest_reroll")
    .maybeSingle();

  if (error) throw shopTableError(error);
  return !!data;
}

export async function grantPaidQuestReroll(
  wallet: string,
  txHash: string,
  quantity = 1
): Promise<void> {
  const qty = normalizeShopPurchaseQuantity(quantity);
  const addr = normalizeWallet(wallet);
  const normalizedTxHash = txHash.toLowerCase();
  await postSeasonAction("grantPaidQuestReroll", {
    wallet: addr,
    txHash: normalizedTxHash,
    quantity: qty,
  });
}

export async function activateDoublePoints(wallet: string): Promise<string> {
  const addr = normalizeWallet(wallet);
  const data = await postSeasonAction<{ activeUntil: string }>(
    "activateDoublePoints",
    { wallet: addr }
  );
  return data.activeUntil;
}

export async function getActiveDoublePoints(wallet: string): Promise<string | null> {
  const addr = normalizeWallet(wallet);
  const { data, error } = await supabase
    .from("player_boosters")
    .select("active_until")
    .eq("wallet", addr)
    .eq("booster_slug", "double_points")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.active_until) return null;

  const activeUntil = data.active_until as string;
  return new Date(activeUntil).getTime() > Date.now() ? activeUntil : null;
}

export async function getGamePointMultiplier(wallet: string): Promise<number> {
  const activeUntil = await getActiveDoublePoints(wallet);
  return activeUntil ? 2 : 1;
}

export async function addSeasonXp(wallet: string, xp: number): Promise<void> {
  void wallet;
  void xp;
  throw new Error("addSeasonXp is server-only. Use the check-in/game reward server path.");
}

export async function getSeasonState(wallet: string): Promise<SeasonState> {
  const addr = normalizeWallet(wallet);
  
  const [{ data: progressData, error: progressError }, { data: configData, error: configError }] = await Promise.all([
    supabase
      .from("season_progress")
      .select("xp, claimed_levels, points")
      .eq("wallet", addr)
      .eq("season_key", SEASON_KEY)
      .maybeSingle(),
    supabase
      .from("season_config")
      .select("end_date, is_ended")
      .eq("id", "default")
      .maybeSingle()
  ]);

  if (progressError) throw new Error(progressError.message);
  if (configError) throw new Error(configError.message);

  const xp = Number(progressData?.xp ?? 0);
  const points = Number(progressData?.points ?? 0);
  const claimedLevels = Array.isArray(progressData?.claimed_levels)
    ? (progressData.claimed_levels as number[])
    : [];
  const level = SEASON_LEVELS.filter((entry) => xp >= entry.xpRequired).length;
  const nextLevel = SEASON_LEVELS.find((entry) => xp < entry.xpRequired);

  const endDate = configData?.end_date ?? "2026-07-18T00:00:00.000Z";
  const isEnded = configData?.is_ended ?? false;

  return {
    seasonKey: SEASON_KEY,
    xp,
    level,
    nextLevelXp: nextLevel?.xpRequired ?? null,
    claimedLevels,
    points,
    endDate,
    isEnded,
    levels: SEASON_LEVELS.map((entry) => ({
      ...entry,
      claimed: claimedLevels.includes(entry.level),
      claimable: xp >= entry.xpRequired && !claimedLevels.includes(entry.level),
    })),
  };
}

export async function claimSeasonLevel(
  wallet: string,
  level: number
): Promise<SeasonReward> {
  const rewards = await claimSeasonLevels(wallet, [level]);
  return rewards[0];
}

function normalizeSeasonClaimLevels(levels: number[]): number[] {
  return Array.from(new Set(levels.filter(Number.isInteger))).sort((a, b) => a - b);
}

function getSeasonClaimTargets(state: SeasonState, levels: number[]): SeasonLevel[] {
  const requestedLevels = normalizeSeasonClaimLevels(levels);
  if (requestedLevels.length === 0) throw new Error("No rewards ready");

  return requestedLevels.map((level) => {
    const target = SEASON_LEVELS.find((entry) => entry.level === level);
    if (!target) throw new Error("Unknown season level");
    if (state.xp < target.xpRequired) throw new Error("Level is not ready");
    if (state.claimedLevels.includes(level)) throw new Error("Already claimed");
    return target;
  });
}

export async function claimSeasonLevels(
  wallet: string,
  levels: number[]
): Promise<SeasonReward[]> {
  const addr = normalizeWallet(wallet);
  const data = await postSeasonAction<{ rewards: SeasonReward[] }>(
    "claimSeasonLevels",
    { wallet: addr, levels }
  );
  return data.rewards;
}

export async function validateSeasonLevelClaim(
  wallet: string,
  level: number
): Promise<SeasonReward> {
  const state = await getSeasonState(wallet);
  const target = SEASON_LEVELS.find((entry) => entry.level === level);
  if (!target) throw new Error("Unknown season level");
  if (state.xp < target.xpRequired) throw new Error("Level is not ready");
  if (state.claimedLevels.includes(level)) throw new Error("Already claimed");
  return target.reward;
}

export async function validateSeasonLevelClaims(
  wallet: string,
  levels: number[]
): Promise<SeasonReward[]> {
  const state = await getSeasonState(wallet);
  return getSeasonClaimTargets(state, levels).map((target) => target.reward);
}
