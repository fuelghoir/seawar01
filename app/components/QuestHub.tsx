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
import QuestPanel from "./QuestPanel";
import styles from "./QuestHub.module.css";

type QuestTab = "weekly" | "global";

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
    globalLoading: string;
    globalEmpty: string;
    oneTime: string;
    opening: string;
    claimed: string;
    alreadyClaimed: string;
    unavailable: string;
    daysLeft: (days: number) => string;
  }
> = {
  en: {
    weeklyTab: "Weekly",
    globalTab: "Global",
    globalLoading: "Loading global quests...",
    globalEmpty: "No global quests right now.",
    oneTime: "one-time",
    opening: "Opening...",
    claimed: "Claimed",
    alreadyClaimed: "Already claimed",
    unavailable: "Quest is not available",
    daysLeft: (days) => `${days}d left`,
  },
  ru: {
    weeklyTab: "Еженедельные",
    globalTab: "Глобальные",
    globalLoading: "Загрузка глобальных квестов...",
    globalEmpty: "Глобальных квестов пока нет.",
    oneTime: "разово",
    opening: "Открываем...",
    claimed: "Получено",
    alreadyClaimed: "Уже получено",
    unavailable: "Квест недоступен",
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
  const [messages, setMessages] = useState<Record<string, string>>({});

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

  useEffect(() => {
    loadGlobalQuests();
  }, [loadGlobalQuests]);

  const globalReadyCount = useMemo(
    () => globalQuests.filter((quest) => quest.active && !quest.claimed).length,
    [globalQuests],
  );

  const handleOpenGlobalQuest = async (status: ExternalQuestStatus) => {
    const quest = status.definition;
    if (openingKey || status.claimed || !status.active) return;

    setOpeningKey(quest.key);
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
      await openExternalQuestTarget(quest, isInMiniApp);
    } catch (err) {
      setMessages((current) => ({
        ...current,
        [quest.key]: err instanceof Error ? err.message : tr.shop_claim_failed,
      }));
    } finally {
      setOpeningKey(null);
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
          {globalReadyCount > 0 && (
            <span className={styles.tabBadge}>{globalReadyCount}</span>
          )}
        </button>
      </div>

      {activeTab === "weekly" ? (
        <QuestPanel
          address={address}
          onPointsChanged={onPointsChanged}
          hideHeader
          expanded
        />
      ) : (
        <div className={styles.globalPane}>
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

              return (
                <div
                  key={quest.key}
                  className={`${styles.globalQuest} ${
                    status.claimed ? styles.globalQuestClaimed : ""
                  }`}
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
                      <span>
                        {status.daysLeft == null ? copy.oneTime : copy.daysLeft(status.daysLeft)}
                      </span>
                    </span>
                  </span>

                  {status.claimed ? (
                    <span className={styles.claimedPill}>
                      <CheckIcon size={14} />
                      {copy.claimed}
                    </span>
                  ) : (
                    <button
                      className={styles.globalAction}
                      onClick={() => handleOpenGlobalQuest(status)}
                      disabled={isOpening || !status.active}
                      type="button"
                    >
                      <ExternalLinkIcon size={14} />
                      {isOpening ? copy.opening : questCopy.action}
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
        // Some hosts reject custom schemes, so fall through to direct navigation.
      }
    }

    window.location.href = quest.appUrl;
    return;
  }

  if (isInMiniApp && quest.kind === "baseApp") {
    try {
      await sdk.actions.openMiniApp({ url: quest.miniAppUrl ?? quest.url });
      return;
    } catch {
      // Fall through to the Base App URL.
    }
  }

  if (isInMiniApp) {
    try {
      await sdk.actions.openUrl({ url: quest.baseAppUrl ?? quest.url });
      return;
    } catch {
      // Fall through to browser navigation.
    }
  }

  const target = quest.baseAppUrl ?? quest.url;
  const opened = window.open(target, "_blank", "noopener,noreferrer");
  if (!opened) window.location.href = target;
}
