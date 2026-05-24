"use client";

import { useEffect, useMemo, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import {
  claimTurboGumQuest,
  getTurboGumQuestStatus,
  TURBO_GUM_QUEST,
  type TurboGumQuestStatus,
} from "../lib/externalQuests";
import { TR, useSettings, type Lang } from "../lib/settings";
import { ExternalLinkIcon } from "./Icons";
import styles from "./TurboGumQuestPrompt.module.css";

export const TURBO_GUM_QUEST_COPY: Record<
  Lang,
  {
    title: string;
    subtitle: string;
    cardSubtitle: string;
    rewardLabel: string;
    timeLabel: string;
    daysLeft: (days: number) => string;
    action: string;
    opening: string;
    alreadyClaimed: string;
    unavailable: string;
  }
> = {
  en: {
    title: "Turbo Gum Quest",
    subtitle:
      "Open Turbo Gum in Base App and make a transaction there. The transaction cannot be tracked here, so points are granted when you open it.",
    cardSubtitle: "Open Turbo Gum in Base App",
    rewardLabel: "Bonus",
    timeLabel: "Time left",
    daysLeft: (days) => `${days}d`,
    action: "Open Turbo Gum",
    opening: "Opening...",
    alreadyClaimed: "Already claimed",
    unavailable: "Quest is not available",
  },
  ru: {
    title: "Квест Turbo Gum",
    subtitle:
      "Перейди в Turbo Gum в Base App и сделай там транзакцию. Отследить ее здесь нельзя, поэтому очки начисляются сразу при переходе.",
    cardSubtitle: "Открыть Turbo Gum в Base App",
    rewardLabel: "Бонус",
    timeLabel: "Осталось",
    daysLeft: (days) => `${days}д`,
    action: "Открыть Turbo Gum",
    opening: "Открываем...",
    alreadyClaimed: "Уже получено",
    unavailable: "Квест недоступен",
  },
};

interface TurboGumQuestPromptProps {
  address: string;
  isInMiniApp: boolean;
  initialStatus?: TurboGumQuestStatus | null;
  onClose: () => void;
  onClaimed?: () => void;
}

export function TurboGumQuestPrompt({
  address,
  isInMiniApp,
  initialStatus,
  onClose,
  onClaimed,
}: TurboGumQuestPromptProps) {
  const { lang } = useSettings();
  const tr = TR[lang];
  const copy = TURBO_GUM_QUEST_COPY[lang];
  const [status, setStatus] = useState<TurboGumQuestStatus | null>(
    initialStatus ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    let cancelled = false;
    getTurboGumQuestStatus(address)
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setMsg(err instanceof Error ? err.message : copy.unavailable);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [address, copy.unavailable]);

  const pointsLabel = useMemo(
    () => `+${TURBO_GUM_QUEST.reward.toLocaleString()} ${tr.shop_pts}`,
    [tr.shop_pts],
  );

  const handleOpen = async () => {
    if (loading || !status?.active) return;
    setLoading(true);
    setMsg("");

    try {
      const result = await claimTurboGumQuest(address);
      const reward = result.reward || TURBO_GUM_QUEST.reward;
      setStatus((current) =>
        current
          ? { ...current, claimed: true, claimedAt: new Date().toISOString() }
          : current,
      );
      setMsg(
        result.alreadyClaimed
          ? copy.alreadyClaimed
          : `+${reward.toLocaleString()} ${tr.shop_pts}!`,
      );
      onClaimed?.();
      await openTurboGumTarget(isInMiniApp);
      window.setTimeout(onClose, 650);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : tr.shop_claim_failed);
    } finally {
      setLoading(false);
    }
  };

  if (!status) return null;
  if (!status.active || status.claimed) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label={tr.play_modal_close}>
          x
        </button>

        <div className={styles.icon} aria-hidden="true">
          <ExternalLinkIcon size={28} />
        </div>
        <h2 className={styles.title}>{copy.title}</h2>
        <p className={styles.sub}>{copy.subtitle}</p>

        <div className={styles.reward}>
          <span>
            <small>{copy.rewardLabel}</small>
            <b>{pointsLabel}</b>
          </span>
          <span className={styles.rewardSeparator} aria-hidden="true" />
          <span>
            <small>{copy.timeLabel}</small>
            <b>{copy.daysLeft(status.daysLeft)}</b>
          </span>
        </div>

        <button
          className={styles.btn}
          onClick={handleOpen}
          disabled={loading}
          type="button"
        >
          <ExternalLinkIcon size={16} />
          {loading ? copy.opening : copy.action}
        </button>

        {msg && <p className={styles.msg}>{msg}</p>}
        {status.loadError && !msg && (
          <p className={styles.msg}>{status.loadError}</p>
        )}

        <button className={styles.skip} onClick={onClose} type="button">
          {tr.welcome_skip}
        </button>
      </div>
    </div>
  );
}

async function openTurboGumTarget(isInMiniApp: boolean): Promise<void> {
  if (isInMiniApp) {
    try {
      await sdk.actions.openMiniApp({ url: TURBO_GUM_QUEST.url });
      return;
    } catch {
      // Fall through to a Base App deep link.
    }

    try {
      await sdk.actions.openUrl({ url: TURBO_GUM_QUEST.baseAppUrl });
      return;
    } catch {
      // Fall through to browser navigation.
    }
  }

  const target = isInMiniApp ? TURBO_GUM_QUEST.baseAppUrl : TURBO_GUM_QUEST.url;
  const opened = window.open(target, "_blank", "noopener,noreferrer");
  if (!opened) window.location.href = target;
}
