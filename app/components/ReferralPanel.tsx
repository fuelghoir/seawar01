"use client";

import { useCallback, useEffect, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import {
  getBaseAppReferralLink,
  getReferralLink,
  getReferralStats,
  recordReferral,
  type ReferralStats,
} from "../lib/referrals";
import { TR, useSettings } from "../lib/settings";
import {
  CopyIcon,
  ExternalLinkIcon,
  ShareIcon,
  UsersIcon,
} from "./Icons";
import styles from "./ReferralPanel.module.css";

interface Props {
  address: string;
  refParam?: string | null;
  hideHeader?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

const EMPTY_STATS: ReferralStats = {
  count: 0,
  activeCount: 0,
  pendingCount: 0,
  paidCount: 0,
  unpaidActiveCount: 0,
  firstGameBonusPoints: 0,
};

export default function ReferralPanel({
  address,
  refParam,
  hideHeader = false,
  expanded: controlledExpanded,
  onToggleExpand,
}: Props) {
  const { lang } = useSettings();
  const tr = TR[lang];
  const copy = REFERRAL_COPY[lang === "ru" ? "ru" : "en"];

  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const [stats, setStats] = useState<ReferralStats>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState(false);
  const [copied, setCopied] = useState<"direct" | "base" | "share" | null>(null);
  const [link, setLink] = useState("");
  const [baseLink, setBaseLink] = useState("");
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const activeBonus = stats.firstGameBonusPoints;

  const toggle = () => {
    if (onToggleExpand) onToggleExpand();
    else setInternalExpanded((value) => !value);
  };

  useEffect(() => {
    if (!address) return;
    setLink(getReferralLink(address));
    setBaseLink(getBaseAppReferralLink(address));
  }, [address]);

  useEffect(() => {
    if (!refParam || !address) return;
    const ref = refParam.toLowerCase();
    const me = address.toLowerCase();
    if (ref === me) return;
    recordReferral(ref, me).catch(() => {});
  }, [refParam, address]);

  const loadStats = useCallback(async () => {
    if (!address) return;
    setStatsLoading(true);
    setStatsError(false);
    try {
      setStats(await getReferralStats(address));
    } catch {
      setStatsError(true);
    } finally {
      setStatsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleCopy = async (text: string, type: "direct" | "base") => {
    if (!text) return;
    try {
      await copyToClipboard(text);
      setCopied(type);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard may be unavailable in restricted browsers.
    }
  };

  const handleShare = async () => {
    const url = link || baseLink;
    if (!url) return;
    setShareMenuOpen((open) => !open);
  };

  const handleNativeShare = async () => {
    const url = link || baseLink;
    if (!url) return;
    setShareMenuOpen(false);

    try {
      if (await isMiniAppShareAvailable()) {
        await sdk.actions.composeCast({
          text: copy.shareText,
          embeds: [url],
        });
        setCopied("share");
        window.setTimeout(() => setCopied(null), 2000);
        return;
      }

      if (typeof navigator.share === "function") {
        await navigator.share({
          title: "Sea Battle",
          text: copy.shareText,
          url,
        });
      } else {
        await copyToClipboard(url);
      }
      setCopied("share");
      window.setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      if (isAbortError(err)) return;
      openExternal(getTwitterShareUrl(url, copy.shareText));
    }
  };

  const handleFarcasterShare = async () => {
    const url = link || baseLink;
    if (!url) return;
    setShareMenuOpen(false);

    try {
      if (await isMiniAppShareAvailable()) {
        await sdk.actions.composeCast({
          text: copy.shareText,
          embeds: [url],
        });
        return;
      }
    } catch {
      // Fall through to Warpcast web compose.
    }

    openExternal(getFarcasterShareUrl(url, copy.shareText));
  };

  const handleTwitterShare = () => {
    const url = link || baseLink;
    if (!url) return;
    setShareMenuOpen(false);
    openExternal(getTwitterShareUrl(url, copy.shareText));
  };

  const handleBaseOpen = async () => {
    const url = baseLink || link;
    if (!url) return;
    setShareMenuOpen(false);

    try {
      if (await isMiniAppShareAvailable()) {
        await sdk.actions.openUrl({ url });
        return;
      }
    } catch {
      // Fall through to regular navigation.
    }

    openExternal(url);
  };

  return (
    <div className={styles.section}>
      {!hideHeader && (
        <button className={styles.header} onClick={toggle} type="button">
          <div className={styles.headerLeft}>
            <span className={styles.label}>{tr.referrals}</span>
            <span className={styles.sub}>{tr.referrals_sub}</span>
          </div>
          <div className={styles.headerRight}>
            {stats.count > 0 && <span className={styles.badge}>{stats.count}</span>}
            <span className={styles.chevron}>{expanded ? "v" : ">"}</span>
          </div>
        </button>
      )}

      {expanded && (
        <div className={styles.body}>
          <div className={styles.inviteHero}>
            <div className={styles.heroIcon} aria-hidden="true">
              <UsersIcon size={24} />
            </div>
            <div className={styles.heroCopy}>
              <span className={styles.kicker}>{copy.kicker}</span>
              <h3>{copy.title}</h3>
              <p>{tr.referrals_desc}</p>
            </div>
          </div>

          <div className={styles.rewardStrip}>
            <div className={styles.rewardItem}>
              <span>+1,000</span>
              <small>{copy.firstGame}</small>
            </div>
            <div className={styles.rewardDivider} aria-hidden="true" />
            <div className={styles.rewardItem}>
              <span>10%</span>
              <small>{copy.lifetime}</small>
            </div>
          </div>

          <div className={styles.actionGrid}>
            <button
              className={`${styles.actionBtn} ${styles.actionPrimary}`}
              onClick={handleShare}
              disabled={!baseLink && !link}
              type="button"
            >
              <ShareIcon size={17} />
              {copied === "share" ? tr.copied_ok : copy.share}
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => handleCopy(baseLink, "base")}
              disabled={!baseLink}
              type="button"
            >
              <CopyIcon size={17} />
              {copied === "base" ? tr.copied_ok : copy.copyBase}
            </button>
          </div>

          {shareMenuOpen && (
            <div className={styles.sharePicker}>
              <button className={styles.shareOption} onClick={handleFarcasterShare} type="button">
                <ExternalLinkIcon size={15} />
                {copy.shareFarcaster}
              </button>
              <button className={styles.shareOption} onClick={handleTwitterShare} type="button">
                <ExternalLinkIcon size={15} />
                {copy.shareTwitter}
              </button>
              <button className={styles.shareOption} onClick={handleBaseOpen} type="button">
                <ExternalLinkIcon size={15} />
                {copy.openBase}
              </button>
              {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                <button className={styles.shareOption} onClick={handleNativeShare} type="button">
                  <ShareIcon size={15} />
                  {copy.systemShare}
                </button>
              )}
            </div>
          )}

          <div className={styles.stats} aria-busy={statsLoading}>
            <StatBox value={stats.count} label={tr.invited} />
            <StatBox value={stats.activeCount} label={tr.playing} good />
            <StatBox value={stats.pendingCount} label={tr.pending_ref} />
            <StatBox value={formatPoints(activeBonus)} label={copy.unlocked} good />
          </div>

          <div className={styles.linkGroup}>
            <div className={styles.linkHeader}>
              <span className={styles.linkLabel}>Base App</span>
              <a
                className={styles.openLink}
                href={baseLink || "#"}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!baseLink}
              >
                <ExternalLinkIcon size={14} />
                {copy.open}
              </a>
            </div>
            <div className={styles.linkRow}>
              <span className={styles.linkText}>{baseLink || "..."}</span>
              <button
                className={styles.copyBtn}
                onClick={() => handleCopy(baseLink, "base")}
                disabled={!baseLink}
                type="button"
              >
                {copied === "base" ? tr.copied_ok : tr.copy}
              </button>
            </div>

            <span className={styles.linkLabel}>{tr.direct_link}</span>
            <div className={styles.linkRow}>
              <span className={styles.linkText}>{link || "..."}</span>
              <button
                className={styles.copyBtn}
                onClick={() => handleCopy(link, "direct")}
                disabled={!link}
                type="button"
              >
                {copied === "direct" ? tr.copied_ok : tr.copy}
              </button>
            </div>
          </div>

          {statsError && <p className={styles.note}>{copy.statsError}</p>}
        </div>
      )}
    </div>
  );
}

function StatBox({
  value,
  label,
  good = false,
}: {
  value: number | string;
  label: string;
  good?: boolean;
}) {
  return (
    <div className={`${styles.statItem} ${good ? styles.statGood : ""}`}>
      <span className={styles.statVal}>{value}</span>
      <span className={styles.statKey}>{label}</span>
    </div>
  );
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function formatPoints(points: number) {
  return points >= 1000 ? `${Math.floor(points / 1000)}k` : points;
}

async function isMiniAppShareAvailable() {
  try {
    return await sdk.isInMiniApp();
  } catch {
    return false;
  }
}

function getTwitterShareUrl(url: string, text: string) {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

function getFarcasterShareUrl(url: string, text: string) {
  return `https://warpcast.com/~/compose?text=${encodeURIComponent(`${text} ${url}`)}`;
}

function openExternal(url: string) {
  window.location.assign(url);
}

function isAbortError(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

const REFERRAL_COPY = {
  en: {
    kicker: "Invite center",
    title: "Bring captains aboard",
    firstGame: "first-game bonus",
    lifetime: "of their game points",
    share: "Share invite",
    shareFarcaster: "Farcaster",
    shareTwitter: "X / Twitter",
    openBase: "Base App",
    systemShare: "Share sheet",
    copyBase: "Copy Base link",
    open: "Open",
    unlocked: "Bonus",
    shareText: "Join me in Sea Battle on Base.",
    statsError: "Referral stats are temporarily unavailable.",
  },
  ru: {
    shareFarcaster: "Farcaster",
    shareTwitter: "X / Twitter",
    openBase: "Base App",
    systemShare: "Share sheet",
    kicker: "Центр приглашений",
    title: "Зови капитанов в бой",
    firstGame: "за первую игру",
    lifetime: "с игровых очков",
    share: "Поделиться",
    copyBase: "Скопировать Base",
    open: "Открыть",
    unlocked: "Бонус",
    shareText: "Заходи ко мне в Sea Battle на Base.",
    statsError: "Статистика рефералов временно недоступна.",
  },
};
