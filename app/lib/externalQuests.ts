import { supabase } from "./supabase";
import type { Lang } from "./settings";

const WALLET_RE = /^0x[a-f0-9]{40}$/;
const DAY_MS = 86_400_000;

export type ExternalQuestKind = "baseApp" | "twitter" | "telegram";

export interface ExternalQuestCopy {
  title: string;
  subtitle: string;
  cardSubtitle: string;
  action: string;
}

export interface ExternalQuestDefinition {
  key: string;
  kind: ExternalQuestKind;
  url: string;
  baseAppUrl?: string;
  appUrl?: string;
  miniAppUrl?: string;
  reward: number;
  startsAt?: string | null;
  endsAt?: string | null;
  copy: Record<Lang, ExternalQuestCopy>;
}

export interface ExternalQuestStatus {
  definition: ExternalQuestDefinition;
  active: boolean;
  claimed: boolean;
  claimedAt: string | null;
  reward: number;
  startsAt: string | null;
  endsAt: string | null;
  daysLeft: number | null;
  loadError?: string;
}

export interface ExternalQuestClaimResult {
  reward: number;
  alreadyClaimed: boolean;
}

export const TURBO_GUM_QUEST = {
  key: "turbo-gum-2026-05",
  kind: "baseApp",
  url: "https://turbo-gum.xyz?ref=TDU0CGYP",
  baseAppUrl: "https://base.app/app/turbo-gum.xyz?ref=TDU0CGYP",
  miniAppUrl: "https://turbo-gum.xyz?ref=TDU0CGYP",
  reward: 1000,
  startsAt: "2026-05-24T00:00:00.000Z",
  endsAt: "2026-06-03T00:00:00.000Z",
  copy: {
    en: {
      title: "Turbo Gum Quest",
      subtitle:
        "Open Turbo Gum in Base App and make a transaction there. Points are granted when you open it.",
      cardSubtitle: "Open Turbo Gum in Base App",
      action: "Open Turbo Gum",
    },
    ru: {
      title: "Квест Turbo Gum",
      subtitle:
        "Открой Turbo Gum в Base App и сделай там транзакцию. Очки начисляются при переходе.",
      cardSubtitle: "Открыть Turbo Gum в Base App",
      action: "Открыть Turbo Gum",
    },
  },
} as const satisfies ExternalQuestDefinition;

export const GLOBAL_EXTERNAL_QUESTS = [
  TURBO_GUM_QUEST,
  {
    key: "gld-pirate-checkin-2026-05",
    kind: "baseApp",
    url: "https://gldpiratebase.vercel.app/ref/0x7b92e59b2de9368e71843f9894ed63bfeebaaee7",
    baseAppUrl:
      "https://base.app/app/gldpiratebase.vercel.app/ref/0x7b92e59b2de9368e71843f9894ed63bfeebaaee7",
    miniAppUrl:
      "https://gldpiratebase.vercel.app/ref/0x7b92e59b2de9368e71843f9894ed63bfeebaaee7",
    reward: 1000,
    startsAt: "2026-05-28T00:00:00.000Z",
    endsAt: null,
    copy: {
      en: {
        title: "GLD Pirate Check-in",
        subtitle:
          "Open GLD Pirate in Base App and check in. Points are granted when you open it.",
        cardSubtitle: "Check in through Base App",
        action: "Open GLD Pirate",
      },
      ru: {
        title: "Чекин в GLD Pirate",
        subtitle:
          "Открой GLD Pirate в Base App и сделай чекин. Очки начисляются при переходе.",
        cardSubtitle: "Чекин через Base App",
        action: "Открыть GLD Pirate",
      },
    },
  },
  {
    key: "x-follow-0xherm-2026-05",
    kind: "twitter",
    url: "https://x.com/0xHerm",
    appUrl: "twitter://user?screen_name=0xHerm",
    reward: 2000,
    startsAt: "2026-05-28T00:00:00.000Z",
    endsAt: null,
    copy: {
      en: {
        title: "Follow 0xHerm on X",
        subtitle:
          "Open the X app and follow @0xHerm. This quest uses the X app deep link.",
        cardSubtitle: "Follow @0xHerm",
        action: "Open X app",
      },
      ru: {
        title: "Подписка на X",
        subtitle:
          "Открой приложение X и подпишись на @0xHerm. Квест открывает именно приложение X.",
        cardSubtitle: "Подписаться на @0xHerm",
        action: "Открыть X",
      },
    },
  },
  {
    key: "x-like-repost-2058535046332510539",
    kind: "twitter",
    url: "https://x.com/0xHerm/status/2058535046332510539",
    appUrl: "twitter://status?id=2058535046332510539",
    reward: 1000,
    startsAt: "2026-05-28T00:00:00.000Z",
    endsAt: null,
    copy: {
      en: {
        title: "Like + Repost",
        subtitle:
          "Open the post in the X app, then like and repost it. Points are granted when you open it.",
        cardSubtitle: "Like and repost the X post",
        action: "Open post",
      },
      ru: {
        title: "Лайк + репост",
        subtitle:
          "Открой пост в приложении X, поставь лайк и сделай репост. Очки начисляются при переходе.",
        cardSubtitle: "Лайк и репост поста",
        action: "Открыть пост",
      },
    },
  },
  {
    key: "telegram-subscribe-0xherm-2026-05",
    kind: "telegram",
    url: "https://t.me/+xWV1zyGwNOM1ZTFi",
    appUrl: "tg://join?invite=xWV1zyGwNOM1ZTFi",
    reward: 2000,
    startsAt: "2026-05-28T00:00:00.000Z",
    endsAt: null,
    copy: {
      en: {
        title: "Join Telegram",
        subtitle:
          "Open Telegram and join the channel. This quest uses the Telegram app deep link.",
        cardSubtitle: "Join the Telegram channel",
        action: "Open Telegram",
      },
      ru: {
        title: "Подписка на Telegram",
        subtitle:
          "Открой Telegram и подпишись на канал. Квест открывает именно приложение Telegram.",
        cardSubtitle: "Подписаться на канал",
        action: "Открыть Telegram",
      },
    },
  },
] as const satisfies readonly ExternalQuestDefinition[];

export interface TurboGumQuestStatus {
  active: boolean;
  claimed: boolean;
  claimedAt: string | null;
  reward: number;
  startsAt: string;
  endsAt: string;
  daysLeft: number;
  loadError?: string;
}

export interface TurboGumQuestClaimResult {
  reward: number;
  alreadyClaimed: boolean;
}

export function isExternalQuestActive(
  quest: ExternalQuestDefinition,
  date = new Date(),
): boolean {
  const now = date.getTime();
  const startsAt = quest.startsAt ? new Date(quest.startsAt).getTime() : 0;
  const endsAt = quest.endsAt ? new Date(quest.endsAt).getTime() : Number.POSITIVE_INFINITY;
  return now >= startsAt && now < endsAt;
}

export function isTurboGumQuestActive(date = new Date()): boolean {
  return isExternalQuestActive(TURBO_GUM_QUEST, date);
}

export async function getExternalQuestStatuses(
  wallet: string,
): Promise<ExternalQuestStatus[]> {
  const addr = normalizeWallet(wallet);
  if (!addr) throw new Error("Invalid wallet");

  const keys = GLOBAL_EXTERNAL_QUESTS.map((quest) => quest.key);
  const { data, error } = await supabase
    .from("external_quest_claims")
    .select("quest_key, claimed_at")
    .eq("wallet", addr)
    .in("quest_key", keys);

  const claimed = new Map<string, string>();
  if (data) {
    for (const row of data as Array<{ quest_key: string; claimed_at: string }>) {
      claimed.set(row.quest_key, row.claimed_at);
    }
  }

  return GLOBAL_EXTERNAL_QUESTS.map((quest) =>
    buildExternalQuestStatus(quest, claimed.get(quest.key) ?? null, error?.message),
  );
}

export async function getExternalQuestStatus(
  wallet: string,
  questKey: string,
): Promise<ExternalQuestStatus> {
  const statuses = await getExternalQuestStatuses(wallet);
  const status = statuses.find((entry) => entry.definition.key === questKey);
  if (!status) throw new Error("Unknown quest");
  return status;
}

export async function getTurboGumQuestStatus(
  wallet: string,
): Promise<TurboGumQuestStatus> {
  const status = await getExternalQuestStatus(wallet, TURBO_GUM_QUEST.key);
  return {
    active: status.active,
    claimed: status.claimed,
    claimedAt: status.claimedAt,
    reward: status.reward,
    startsAt: TURBO_GUM_QUEST.startsAt,
    endsAt: TURBO_GUM_QUEST.endsAt,
    daysLeft: status.daysLeft ?? 0,
    loadError: status.loadError,
  };
}

export async function claimExternalQuest(
  wallet: string,
  questKey: string,
): Promise<ExternalQuestClaimResult> {
  const addr = normalizeWallet(wallet);
  if (!addr) throw new Error("Invalid wallet");

  const quest = GLOBAL_EXTERNAL_QUESTS.find((entry) => entry.key === questKey);
  if (!quest) throw new Error("Unknown quest");
  if (!isExternalQuestActive(quest)) throw new Error("Quest expired");

  const { data, error } = await supabase.rpc("claim_external_quest", {
    p_wallet: addr,
    p_quest_key: quest.key,
  });

  if (error && quest.key === TURBO_GUM_QUEST.key) {
    const fallback = await supabase.rpc("claim_turbo_gum_quest", {
      p_wallet: addr,
    });
    if (fallback.error) throw new Error(fallback.error.message);
    const awarded = Boolean(fallback.data);
    return {
      reward: awarded ? quest.reward : 0,
      alreadyClaimed: !awarded,
    };
  }

  if (error) throw new Error(error.message);

  const awarded = Boolean(data);
  return {
    reward: awarded ? quest.reward : 0,
    alreadyClaimed: !awarded,
  };
}

export async function claimTurboGumQuest(
  wallet: string,
): Promise<TurboGumQuestClaimResult> {
  return claimExternalQuest(wallet, TURBO_GUM_QUEST.key);
}

function buildExternalQuestStatus(
  definition: ExternalQuestDefinition,
  claimedAt: string | null,
  loadError?: string,
): ExternalQuestStatus {
  return {
    definition,
    active: isExternalQuestActive(definition),
    claimed: Boolean(claimedAt),
    claimedAt,
    reward: definition.reward,
    startsAt: definition.startsAt ?? null,
    endsAt: definition.endsAt ?? null,
    daysLeft: getDaysLeft(definition),
    ...(loadError ? { loadError } : {}),
  };
}

function normalizeWallet(wallet: string | null | undefined): string | null {
  const addr = wallet?.trim().toLowerCase();
  if (!addr || !WALLET_RE.test(addr)) return null;
  return addr;
}

function getDaysLeft(quest: ExternalQuestDefinition): number | null {
  if (!quest.endsAt) return null;
  const ms = new Date(quest.endsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}
