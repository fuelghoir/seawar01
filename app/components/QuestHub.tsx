"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import {
  claimExternalQuest,
  getExternalQuestStatuses,
  type ExternalQuestDefinition,
  type ExternalQuestStatus,
} from "../lib/externalQuests";
import { TR, useSettings, type Lang } from "../lib/settings";
import {
  CheckIcon,
  ExternalLinkIcon,
  ShieldIcon,
  TelegramIcon,
  XIcon,
} from "./Icons";
import CreatorProgram from "./CreatorProgram";
import QuestPanel from "./QuestPanel";
import {
  SOCIAL_CONNECT_EVENT,
  SOCIAL_CONNECTIONS_CHANGED_EVENT,
  SocialConnectPanel,
} from "./SocialConnectPanel";
import styles from "./QuestHub.module.css";

type QuestTab = "weekly" | "global" | "creator";
type SocialProvider = "x" | "telegram";

type SocialStatusResponse = {
  connections?: Array<{
    provider: SocialProvider;
    providerUserId: string | null;
    providerUsername: string | null;
    needsReconnect?: boolean;
  }>;
};

interface QuestHubProps {
  address: string;
  isInMiniApp: boolean;
  onPointsChanged?: () => void;
}

const COPY: Record<
  Lang,
  {
    weeklyTab: string;
    globalTab: string;
    creatorTab: string;
    globalLoading: string;
    globalEmpty: string;
    oneTime: string;
    opening: string;
    verifying: string;
    verify: string;
    openedReady: string;
    claimed: string;
    alreadyClaimed: string;
    unavailable: string;
    connectX: string;
    connectTelegram: string;
    connectFirst: (provider: "X" | "Telegram") => string;
    daysLeft: (days: number) => string;
  }
> = {
  en: {
    weeklyTab: "Weekly",
    globalTab: "Global",
    creatorTab: "Creator",
    globalLoading: "Loading global quests...",
    globalEmpty: "No global quests right now.",
    oneTime: "one-time",
    opening: "Opening...",
    verifying: "Verifying...",
    verify: "Verify",
    openedReady: "Opened. Complete the action, then tap Verify.",
    claimed: "Claimed",
    alreadyClaimed: "Already claimed",
    unavailable: "Quest is not available",
    connectX: "Connect X",
    connectTelegram: "Connect Telegram",
    connectFirst: (provider) => `Connect ${provider} first, then open the quest.`,
    daysLeft: (days) => `${days}d left`,
  },
  ru: {
    weeklyTab: "Еженедельные",
    globalTab: "Глобальные",
    creatorTab: "Creator",
    globalLoading: "Загрузка глобальных квестов...",
    globalEmpty: "Глобальных квестов пока нет.",
    oneTime: "разово",
    opening: "Открываем...",
    verifying: "Проверяем...",
    verify: "Проверить",
    openedReady: "Открылось. Сделай действие, потом нажми Проверить.",
    claimed: "Получено",
    alreadyClaimed: "Уже получено",
    unavailable: "Квест недоступен",
    connectX: "Подключить X",
    connectTelegram: "Подключить Telegram",
    connectFirst: (provider) => `Сначала подключи ${provider}, потом открой квест.`,
    daysLeft: (days) => `${days}д осталось`,
  },
};

export function QuestHub({ address, isInMiniApp, onPointsChanged }: QuestHubProps) {
  const { lang } = useSettings();
  const tr = TR[lang];
  const copy = COPY[lang];
  const [activeTab, setActiveTab] = useState<QuestTab>("weekly");
  const [globalQuests, setGlobalQuests] = useState<ExternalQuestStatus[]>([]);
  const [loadingGlobal, setLoadingGlobal] = useState(false);
  const [globalLoadError, setGlobalLoadError] = useState("");
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [verifyingKey, setVerifyingKey] = useState<string | null>(null);
  const [openedQuestKeys, setOpenedQuestKeys] = useState<Record<string, boolean>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [socialStatus, setSocialStatus] = useState<SocialStatusResponse | null>(null);

  const loadGlobalQuests = useCallback(async () => {
    setLoadingGlobal(true);
    setGlobalLoadError("");
    try {
      const statuses = await getExternalQuestStatuses(address);
      setGlobalQuests(statuses);
    } catch (err) {
      setGlobalQuests([]);
      setGlobalLoadError(err instanceof Error ? err.message : copy.unavailable);
    } finally {
      setLoadingGlobal(false);
    }
  }, [address, copy.unavailable]);

  const loadSocialStatus = useCallback(async () => {
    const res = await fetch(`/api/social-connections?wallet=${encodeURIComponent(address)}`, {
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "Could not load social connections");
    setSocialStatus(data);
  }, [address]);

  useEffect(() => {
    loadGlobalQuests();
  }, [loadGlobalQuests]);

  useEffect(() => {
    loadSocialStatus().catch(() => {});
  }, [loadSocialStatus]);

  useEffect(() => {
    const refresh = () => {
      loadSocialStatus().catch(() => {});
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "sea-battle-social-connected") refresh();
    };

    window.addEventListener(SOCIAL_CONNECTIONS_CHANGED_EVENT, refresh);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener(SOCIAL_CONNECTIONS_CHANGED_EVENT, refresh);
      window.removeEventListener("message", onMessage);
    };
  }, [loadSocialStatus]);

  const globalReadyCount = useMemo(
    () => globalQuests.filter((quest) => quest.active && !quest.claimed).length,
    [globalQuests],
  );

  const handleOpenGlobalQuest = async (status: ExternalQuestStatus) => {
    const quest = status.definition;
    if (openingKey || verifyingKey || status.claimed || !status.active) return;

    setOpeningKey(quest.key);
    setMessages((current) => ({ ...current, [quest.key]: "" }));

    try {
      await openExternalQuestTarget(quest, isInMiniApp);
      if (requiresManualVerify(quest)) {
        setOpenedQuestKeys((current) => ({ ...current, [quest.key]: true }));
        setMessages((current) => ({ ...current, [quest.key]: copy.openedReady }));
        return;
      }
      await verifyGlobalQuest(status);
    } catch (err) {
      setMessages((current) => ({
        ...current,
        [quest.key]: err instanceof Error ? err.message : tr.shop_claim_failed,
      }));
    } finally {
      setOpeningKey(null);
    }
  };

  const verifyGlobalQuest = async (status: ExternalQuestStatus) => {
    const quest = status.definition;
    if (verifyingKey || status.claimed || !status.active) return;

    setVerifyingKey(quest.key);
    setMessages((current) => ({ ...current, [quest.key]: "" }));

    try {
      const result = await claimExternalQuest(address, quest.key);
      const reward = result.reward || quest.reward;
      const claimedAt = new Date().toISOString();
      setGlobalQuests((current) =>
        current.map((entry) =>
          entry.definition.key === quest.key
            ? { ...entry, claimed: true, claimedAt, loadError: undefined }
            : entry,
        ),
      );
      setMessages((current) => ({
        ...current,
        [quest.key]: result.alreadyClaimed
          ? copy.alreadyClaimed
          : `+${reward.toLocaleString()} ${tr.shop_pts}!`,
      }));
      onPointsChanged?.();
    } catch (err) {
      setMessages((current) => ({
        ...current,
        [quest.key]: err instanceof Error ? err.message : tr.shop_claim_failed,
      }));
    } finally {
      setVerifyingKey(null);
    }
  };

  const connectFromQuest = (quest: ExternalQuestDefinition, provider: SocialProvider) => {
    const providerName = provider === "x" ? "X" : "Telegram";
    setMessages((current) => ({
      ...current,
      [quest.key]: copy.connectFirst(providerName),
    }));
    const handled = !window.dispatchEvent(
      new CustomEvent(SOCIAL_CONNECT_EVENT, {
        detail: { provider },
        cancelable: true,
      }),
    );
    if (!handled && provider === "x") {
      window.open(
        `/api/social-connections/x/oauth/start?wallet=${encodeURIComponent(address)}`,
        "_blank",
        "popup,width=520,height=760",
      );
    }
  };

  return (
    <div className={styles.hub}>
      <div className={styles.tabs} role="tablist" aria-label={tr.home_quests}>
        <button
          className={`${styles.tab} ${activeTab === "weekly" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("weekly")}
          type="button"
          role="tab"
          aria-selected={activeTab === "weekly"}
        >
          {copy.weeklyTab}
        </button>
        <button
          className={`${styles.tab} ${activeTab === "global" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("global")}
          type="button"
          role="tab"
          aria-selected={activeTab === "global"}
        >
          {copy.globalTab}
          {globalReadyCount > 0 && <span className={styles.tabBadge}>{globalReadyCount}</span>}
        </button>
        <button
          className={`${styles.tab} ${activeTab === "creator" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("creator")}
          type="button"
          role="tab"
          aria-selected={activeTab === "creator"}
        >
          {copy.creatorTab}
        </button>
      </div>

      {activeTab === "weekly" ? (
        <QuestPanel address={address} onPointsChanged={onPointsChanged} hideHeader expanded />
      ) : activeTab === "creator" ? (
        <CreatorProgram address={address} />
      ) : (
        <div className={styles.globalPane}>
          <SocialConnectPanel address={address} />
          {loadingGlobal ? (
            <p className={styles.loading}>{copy.globalLoading}</p>
          ) : globalLoadError ? (
            <p className={styles.loading}>{globalLoadError}</p>
          ) : globalQuests.length === 0 ? (
            <p className={styles.loading}>{copy.globalEmpty}</p>
          ) : (
            globalQuests.map((status) => {
              const quest = status.definition;
              const questCopy = quest.copy[lang];
              const msg = messages[quest.key] || status.loadError || "";
              const isOpening = openingKey === quest.key;
              const isVerifying = verifyingKey === quest.key;
              const needsVerifyStep = requiresManualVerify(quest);
              const openedForVerify = Boolean(openedQuestKeys[quest.key]);
              const missingProvider = getMissingSocialProvider(quest, socialStatus);

              return (
                <div
                  key={quest.key}
                  className={`${styles.globalQuest} ${status.claimed ? styles.globalQuestClaimed : ""}`}
                >
                  <span
                    className={`${styles.questIcon} ${styles[`${quest.kind}Icon`]}`}
                    aria-hidden="true"
                  >
                    {getQuestIcon(quest)}
                  </span>

                  <span className={styles.globalQuestBody}>
                    <span className={styles.globalQuestTop}>
                      <span className={styles.globalQuestTitle}>{questCopy.title}</span>
                      <span className={styles.globalReward}>
                        +{quest.reward.toLocaleString()} {tr.shop_pts}
                      </span>
                    </span>
                    <span className={styles.globalQuestDesc}>{questCopy.subtitle}</span>
                    <span className={styles.globalQuestMeta}>
                      <span>{questCopy.cardSubtitle}</span>
                      <span>{status.daysLeft == null ? copy.oneTime : copy.daysLeft(status.daysLeft)}</span>
                    </span>
                  </span>

                  {status.claimed ? (
                    <span className={styles.claimedPill}>
                      <CheckIcon size={14} />
                      {copy.claimed}
                    </span>
                  ) : (
                    <button
                      className={`${styles.globalAction} ${missingProvider ? styles.connectAction : ""}`}
                      onClick={() =>
                        missingProvider
                          ? connectFromQuest(quest, missingProvider)
                          : needsVerifyStep && openedForVerify
                            ? verifyGlobalQuest(status)
                            : handleOpenGlobalQuest(status)
                      }
                      disabled={isOpening || isVerifying || !status.active}
                      type="button"
                    >
                      {needsVerifyStep && openedForVerify && !missingProvider ? (
                        <CheckIcon size={14} />
                      ) : (
                        <ExternalLinkIcon size={14} />
                      )}
                      {isOpening
                        ? copy.opening
                        : isVerifying
                          ? copy.verifying
                          : missingProvider === "x"
                            ? copy.connectX
                            : missingProvider === "telegram"
                              ? copy.connectTelegram
                              : needsVerifyStep && openedForVerify
                                ? copy.verify
                                : questCopy.action}
                    </button>
                  )}

                  {msg && (
                    <p
                      className={`${styles.msg} ${
                        msg.startsWith("+") || msg === copy.alreadyClaimed
                          ? styles.msgSuccess
                          : styles.msgError
                      }`}
                    >
                      {msg}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function getQuestIcon(quest: ExternalQuestDefinition) {
  if (quest.kind === "telegram") return <TelegramIcon size={18} />;
  if (quest.kind === "twitter") return <XIcon size={17} />;
  return <ShieldIcon size={18} />;
}

function requiresManualVerify(quest: ExternalQuestDefinition) {
  return quest.kind === "twitter" || quest.kind === "telegram";
}

function getMissingSocialProvider(
  quest: ExternalQuestDefinition,
  socialStatus: SocialStatusResponse | null,
): SocialProvider | null {
  if (quest.kind === "twitter" && !isSocialConnected(socialStatus, "x")) return "x";
  if (quest.kind === "telegram" && !isSocialConnected(socialStatus, "telegram")) return "telegram";
  return null;
}

function isSocialConnected(socialStatus: SocialStatusResponse | null, provider: SocialProvider) {
  return Boolean(
    socialStatus?.connections?.some(
      (connection) =>
        connection.provider === provider &&
        connection.providerUserId &&
        !connection.needsReconnect,
    ),
  );
}

async function openExternalQuestTarget(
  quest: ExternalQuestDefinition,
  isInMiniApp: boolean,
): Promise<void> {
  if ((quest.kind === "twitter" || quest.kind === "telegram") && quest.appUrl) {
    if (isInMiniApp) {
      try {
        await sdk.actions.openUrl({ url: quest.appUrl });
        return;
      } catch {
        // Some hosts reject custom schemes, so fall through to the web URL.
      }
    }
  }

  if (isInMiniApp) {
    try {
      await sdk.actions.openUrl({ url: quest.url });
      return;
    } catch {
      // Fall through to browser navigation.
    }
  }

  const target = quest.url;
  const opened = window.open(target, "_blank", "popup,width=520,height=760");
  if (!opened) window.location.href = target;
}
